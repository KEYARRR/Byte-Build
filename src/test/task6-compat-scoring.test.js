import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBuildRules } from '../lib/compat.js';
import {
  calculateCompatibilityScore,
  getVerificationCoverage,
} from '../lib/scoring.js';

test('TC-53: Verified database build computes deterministic compatibility score and coverage', () => {
  const results = evaluateBuildRules(
    {
      Processors: { name: 'AMD Ryzen 5 7600', socket: 'AM5', has_igpu: true },
      Motherboards: {
        name: 'MSI B650M Mortar',
        socket: 'AM5',
        memory_type: 'DDR5',
        form_factor: 'mATX',
        m2_slots: 2,
        max_ram_gb: 128,
        max_ram_mhz: 6400,
      },
      Memory: {
        name: '32GB (2x16GB) DDR5-6000',
        memory_type: 'DDR5',
        capacity_gb: 16,
        speed_mhz: 6000,
        is_kit: true,
      },
      Storage: {
        name: '1TB NVMe SSD',
        capacity_gb: 1000,
        storage_interface: 'M.2 NVMe',
      },
      'Video Cards': {
        name: 'RTX 4070',
        length_mm: 242,
        gpu_pcie_8pin_req: 1,
        gpu_requires_12vhpwr: false,
      },
      'Power Supplies': {
        name: '750W Gold PSU',
        wattage: 750,
        pcie_8pin_count: 2,
        has_12vhpwr: false,
      },
      'CPU Coolers': {
        name: 'AK400 Air Cooler',
        supported_sockets: 'AM4,AM5,LGA1700',
        cooler_height_mm: 155,
      },
      Cases: {
        name: 'mATX Case',
        supported_form_factors: 'MATX,ITX',
        max_gpu_length_mm: 340,
        max_cooler_height_mm: 165,
      },
    },
    {
      ramStickCount: 2,
      peakWatts: 340,
      recommendedPsuWatts: 550,
      minStorageGb: 500,
    }
  );

  const cov = getVerificationCoverage(results);
  assert.ok(cov.verified >= 8, `Expected at least 8 verified rules, got ${cov.verified}`);

  const score = calculateCompatibilityScore(results);
  assert.equal(score, 100);
});

test('TC-54: Hard database failures reduce compatibility score deterministically', () => {
  const results = evaluateBuildRules(
    {
      Processors: { name: 'AMD Ryzen 5 7600', socket: 'AM5', has_igpu: true },
      Motherboards: {
        name: 'MSI B650M Mortar',
        socket: 'AM5',
        memory_type: 'DDR5',
        form_factor: 'mATX',
        m2_slots: 2,
        max_ram_gb: 128,
        max_ram_mhz: 6400,
      },
      Memory: {
        name: '16GB DDR4-3200',
        memory_type: 'DDR4',
        capacity_gb: 16,
        speed_mhz: 3200,
      },
    },
    { ramStickCount: 1 }
  );

  const memRule = results.find((r) => r.ruleId === 'RULE-MEM-01');
  assert.equal(memRule.status, 'fail');
  assert.equal(memRule.dataSource, 'database');

  const score = calculateCompatibilityScore(results);
  assert.ok(typeof score === 'number' && score < 100, `Expected score < 100, got ${score}`);
});