import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../lib/config.js';
import { calculateBuildTotal, getEffectiveItemPrice, isPrebundledKit } from '../lib/pricing.js';
import { calculateRigWattage } from '../lib/power.js';
import { calculateCompatibilityScore, deriveComponentTier, evaluateBottleneckBalance } from '../lib/scoring.js';
import { evaluateBuildRules, getCustomPartFlags } from '../lib/compat.js';
import { runSmartBuildAssistant } from '../lib/autobuilder.js';

function getRule(results, ruleId) {
  return results.find((r) => r.ruleId === ruleId);
}

describe('ByteBuild Compatibility & Scoring Test Suite (TC-39+)', () => {
  it('TC-39: table-driven rule states for socket mismatch, DDR4 vs DDR5, weak PSU, and small/missing storage', () => {
    const cases = [
      {
        name: 'AM5 CPU vs LGA1700 board fails socket check',
        build: {
          Processors: { name: 'Ryzen 5 7600', socket: 'AM5', tdp: 65 },
          Motherboards: { name: 'B760M Pro', socket: 'LGA1700', memory_type: 'DDR5' },
        },
        ctx: {},
        ruleId: 'RULE-SOCK-01',
        expectedStatus: 'fail',
      },
      {
        name: 'DDR5 RAM vs DDR4 board fails memory check',
        build: {
          Memory: { name: '32GB DDR5 6000MHz', memory_type: 'DDR5' },
          Motherboards: { name: 'B550M Pro', memory_type: 'DDR4' },
        },
        ctx: {},
        ruleId: 'RULE-MEM-01',
        expectedStatus: 'fail',
      },
      {
        name: 'PSU wattage below peak draw fails power check',
        build: {
          'Power Supplies': { name: 'Generic 350W', wattage: 350, psu_tier: 'D' },
        },
        ctx: { peakWatts: 420, recommendedPsuWatts: 550 },
        ruleId: 'RULE-PSU-01',
        expectedStatus: 'fail',
      },
      {
        name: 'PSU wattage above peak draw but below recommended headroom warns',
        build: {
          'Power Supplies': { name: 'Bronze 450W', wattage: 450, psu_tier: 'C' },
        },
        ctx: { peakWatts: 400, recommendedPsuWatts: 500 },
        ruleId: 'RULE-PSU-01',
        expectedStatus: 'warn',
      },
      {
        name: '240GB SSD warns for being below 500GB recommended minimum',
        build: {
          Storage: { name: '240GB SATA SSD', capacity_gb: 240, specs: 'SATA SSD' },
        },
        ctx: {},
        ruleId: 'RULE-STOR-01',
        expectedStatus: 'warn',
      },
      {
        name: 'Missing storage evaluates to unknown',
        build: {},
        ctx: {},
        ruleId: 'RULE-STOR-01',
        expectedStatus: 'unknown',
      },
    ];

    for (const tc of cases) {
      const results = evaluateBuildRules(tc.build, tc.ctx);
      const hit = getRule(results, tc.ruleId);
      expect(hit, `Missing ${tc.ruleId} for: ${tc.name}`).toBeDefined();
      expect(hit.status, tc.name).toBe(tc.expectedStatus);
    }
  });

  it('TC-40: auto-builder respects budget ceiling and keeps build total <= budget', () => {
    const catalog = [
      { id: 'c1', category: 'Processors', name: 'Ryzen 5 5600', socket: 'AM4', tdp: 65, price: 6500, stock_status: 'In Stock' },
      { id: 'c2', category: 'Processors', name: 'Ryzen 7 5700X', socket: 'AM4', tdp: 65, price: 9500, stock_status: 'In Stock' },
      { id: 'b1', category: 'Motherboards', name: 'B550M Mortar', socket: 'AM4', memory_type: 'DDR4', form_factor: 'mATX', m2_slots: 2, max_ram_gb: 128, max_ram_mhz: 4400, price: 6000, stock_status: 'In Stock' },
      { id: 'g1', category: 'Video Cards', name: 'RX 6600 8GB', wattage: 132, length_mm: 240, gpu_pcie_8pin_req: 1, price: 11500, stock_status: 'In Stock' },
      { id: 'g2', category: 'Video Cards', name: 'RTX 4060 8GB', wattage: 115, length_mm: 245, gpu_pcie_8pin_req: 1, price: 17500, stock_status: 'In Stock' },
      { id: 'r1', category: 'Memory', name: '8GB DDR4 3200MHz', memory_type: 'DDR4', capacity_gb: 8, speed_mhz: 3200, price: 1200, stock_status: 'In Stock' },
      { id: 's1', category: 'Storage', name: '1TB NVMe SSD', capacity_gb: 1000, storage_interface: 'M.2 NVMe', price: 3500, stock_status: 'In Stock' },
      { id: 'p1', category: 'Power Supplies', name: '650W 80+ Bronze', wattage: 650, psu_tier: 'B', pcie_8pin_count: 2, price: 3200, stock_status: 'In Stock' },
      { id: 'k1', category: 'CPU Coolers', name: 'Tower Air Cooler', cooler_height_mm: 150, supported_sockets: 'AM4', price: 1100, stock_status: 'In Stock' },
      { id: 'cs1', category: 'Cases', name: 'Micro-ATX Mesh Case', supported_form_factors: 'mATX, ITX', max_gpu_length_mm: 320, max_cooler_height_mm: 165, price: 2200, stock_status: 'In Stock' },
    ];

    const budgets = [36500, 42000, 50000];
    for (const budget of budgets) {
      const res = runSmartBuildAssistant({
        products: catalog,
        budgetInput: budget,
        profile: 'Gaming',
      });
      expect(res.ok).toBe(true);
      expect(res.withinBudget).toBe(true);
      expect(res.totalPrice).toBeLessThanOrEqual(budget);
      const recalculated = calculateBuildTotal(res.build, CATEGORIES, res.ramStickCount);
      expect(recalculated).toBe(res.totalPrice);
    }

    const belowMinimum = runSmartBuildAssistant({
      products: catalog,
      budgetInput: 26000,
      profile: 'Gaming',
    });
    expect(belowMinimum.ok).toBe(true);
    expect(belowMinimum.withinBudget).toBe(false);
    expect(belowMinimum.totalPrice).toBe(36400);
  });

  it('TC-41: RAM stick pricing multiplies single sticks (1x, 2x, 4x) and preserves prebundled kit price', () => {
    const singleStick = { name: '16GB DDR5 5600MHz', price: 2500 };
    expect(isPrebundledKit(singleStick)).toBe(false);
    expect(getEffectiveItemPrice('Memory', singleStick, 1)).toBe(2500);
    expect(getEffectiveItemPrice('Memory', singleStick, 2)).toBe(5000);
    expect(getEffectiveItemPrice('Memory', singleStick, 4)).toBe(10000);

    const dualKit = { name: 'Corsair 32GB (2x16GB) DDR5 6000MHz Kit', price: 6200 };
    expect(isPrebundledKit(dualKit)).toBe(true);
    expect(getEffectiveItemPrice('Memory', dualKit, 2)).toBe(6200);
    expect(getEffectiveItemPrice('Memory', dualKit, 4)).toBe(6200);
  });

  it('TC-42: custom part with missing specs returns unknown and sets unverified flag', () => {
    const buildWithCustomPart = {
      Processors: {
        name: 'Custom Unlisted CPU',
        isCustomInput: true,
      },
      Motherboards: {
        name: 'B650M Gaming',
        socket: 'AM5',
        memory_type: 'DDR5',
      },
    };

    const flags = getCustomPartFlags(buildWithCustomPart);
    expect(flags.hasCustomPart).toBe(true);
    expect(flags.customCategories).toContain('Processors');

    const results = evaluateBuildRules(buildWithCustomPart);
    const sockRule = getRule(results, 'RULE-SOCK-01');
    expect(sockRule.status).toBe('unknown');
    expect(sockRule.unverified).toBe(true);
  });

  it('TC-43: physical clearance, slots, PSU connectors, cooler socket, RAM limits, and iGPU rules cover pass/fail/unknown', () => {
    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU 280mm', length_mm: 280 },
          Cases: { name: 'Case 320mm', max_gpu_length_mm: 320 },
        }),
        'RULE-GPU-LEN-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU 350mm', length_mm: 350 },
          Cases: { name: 'Case 300mm', max_gpu_length_mm: 300 },
        }),
        'RULE-GPU-LEN-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU Unknown Len' },
          Cases: { name: 'Case 300mm', max_gpu_length_mm: 300 },
        }),
        'RULE-GPU-LEN-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          'CPU Coolers': { name: 'Cooler 155mm', cooler_height_mm: 155 },
          Cases: { name: 'Case 165mm', max_cooler_height_mm: 165 },
        }),
        'RULE-CLR-HGT-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          'CPU Coolers': { name: 'Cooler 175mm', cooler_height_mm: 175 },
          Cases: { name: 'Case 160mm', max_cooler_height_mm: 160 },
        }),
        'RULE-CLR-HGT-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          'CPU Coolers': { name: 'Cooler No Height' },
          Cases: { name: 'Case 160mm', max_cooler_height_mm: 160 },
        }),
        'RULE-CLR-HGT-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board mATX', form_factor: 'mATX' },
          Cases: { name: 'Case ATX/mATX', supported_form_factors: 'ATX, mATX' },
        }),
        'RULE-MFF-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board ATX', form_factor: 'ATX' },
          Cases: { name: 'Case mATX only', supported_form_factors: 'mATX, ITX' },
        }),
        'RULE-MFF-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board No FF' },
          Cases: { name: 'Case ATX', supported_form_factors: 'ATX' },
        }),
        'RULE-MFF-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board 2 M.2', m2_slots: 2 },
          Storage: { name: 'NVMe SSD', storage_interface: 'M.2 NVMe' },
        }),
        'RULE-SLOTS-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board 0 M.2', m2_slots: 0 },
          Storage: { name: 'NVMe SSD', storage_interface: 'M.2 NVMe' },
        }),
        'RULE-SLOTS-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          Motherboards: { name: 'Board Unknown Slots' },
          Storage: { name: 'NVMe SSD', storage_interface: 'M.2 NVMe' },
        }),
        'RULE-SLOTS-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU 2x8pin', gpu_pcie_8pin_req: 2, gpu_requires_12vhpwr: false },
          'Power Supplies': { name: 'PSU 2x8pin', pcie_8pin_count: 2, has_12vhpwr: false },
        }),
        'RULE-PSU-CONN-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU 12VHPWR', gpu_requires_12vhpwr: true },
          'Power Supplies': { name: 'PSU No 12VHPWR', pcie_8pin_count: 2, has_12vhpwr: false },
        }),
        'RULE-PSU-CONN-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          'Video Cards': { name: 'GPU 2x8pin', gpu_pcie_8pin_req: 2 },
          'Power Supplies': { name: 'PSU Unknown 8pin' },
        }),
        'RULE-PSU-CONN-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU AM5', socket: 'AM5' },
          'CPU Coolers': { name: 'Cooler AM5', supported_sockets: 'AM4, AM5' },
        }),
        'RULE-CLR-SOCK-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU AM5', socket: 'AM5' },
          'CPU Coolers': { name: 'Cooler LGA1700', supported_sockets: 'LGA1700' },
        }),
        'RULE-CLR-SOCK-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU AM5', socket: 'AM5' },
          'CPU Coolers': { name: 'Cooler No Sockets' },
        }),
        'RULE-CLR-SOCK-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules(
          {
            Memory: { name: '16GB DDR4 3200MHz', capacity_gb: 16, speed_mhz: 3200 },
            Motherboards: { name: 'Board 128GB/3600', max_ram_gb: 128, max_ram_mhz: 3600 },
          },
          { ramStickCount: 2 }
        ),
        'RULE-RAM-LIM-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules(
          {
            Memory: { name: '64GB DDR5 7200MHz', capacity_gb: 64, speed_mhz: 7200 },
            Motherboards: { name: 'Board 64GB/6000', max_ram_gb: 64, max_ram_mhz: 6000 },
          },
          { ramStickCount: 1 }
        ),
        'RULE-RAM-LIM-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          Memory: { name: '16GB DDR4 3200MHz', capacity_gb: 16, speed_mhz: 3200 },
          Motherboards: { name: 'Board No Limits' },
        }),
        'RULE-RAM-LIM-01'
      ).status
    ).toBe('unknown');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU with iGPU', has_igpu: true },
        }),
        'RULE-IGPU-01'
      ).status
    ).toBe('pass');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU without iGPU', has_igpu: false },
        }),
        'RULE-IGPU-01'
      ).status
    ).toBe('fail');

    expect(
      getRule(
        evaluateBuildRules({
          Processors: { name: 'CPU Unknown iGPU' },
        }),
        'RULE-IGPU-01'
      ).status
    ).toBe('unknown');
  });

  it('TC-44: hand-calculated compatibility score, tiering, bottleneck balance, and rig wattage', () => {
    const score = calculateCompatibilityScore([
      { status: 'pass' },
      { status: 'fail' },
      { status: 'warn' },
      { status: 'warn' },
      { status: 'unknown' },
    ]);
    expect(score).toBe(50);

    expect(deriveComponentTier({ hardware_score: 92 }, 'Processors')).toBe(5);
    expect(deriveComponentTier({ hardware_score: 45 }, 'Video Cards')).toBe(2);
    const balance = evaluateBottleneckBalance(
      { name: 'CPU', hardware_score: 80 },
      { name: 'GPU', hardware_score: 78 }
    );
    expect(balance.status).toBe('pass');

    const power = calculateRigWattage(
      {
        Processors: { name: 'Test CPU', tdp: 65 },
        'Video Cards': { name: 'Test GPU', wattage: 200 },
        Motherboards: { name: 'Test Mobo' },
        Memory: { name: 'Test RAM' },
        Storage: { name: 'Test SSD' },
        'CPU Coolers': { name: 'Air Cooler' },
        Cases: { name: 'Test Case' },
      },
      2,
      false
    );
    expect(power.stockPeakWatts).toBe(342);
    expect(power.activePeakWatts).toBe(342);
    expect(power.recommendedPsuWatts).toBe(450);
  });
});