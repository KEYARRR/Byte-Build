import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../lib/config.js';
import { runSmartBuildAssistant } from '../lib/autobuilder.js';
import { evaluateBuildRules } from '../lib/compat.js';
import { calculateCompatibilityScore, getVerificationCoverage } from '../lib/scoring.js';
import { buildQuotationPayload, buildQuotationHtmlDocument } from '../lib/quotation.js';
import { normalizeSavedBuildRecord, buildPreorderRequestPayload } from '../lib/orders.js';

test('TC-74: End-to-end Smart Build Assistant -> Rules -> Scoring -> Quotation flow stays consistent', () => {
  const catalog = [
    { id: 1, category: 'Processors', name: 'AMD Ryzen 5 5600', socket: 'AM4', has_igpu: false, tdp_watts: 65, price: 7200, hardware_score: 78, stock_status: 'In Stock' },
    { id: 2, category: 'Motherboards', name: 'MSI B550M PRO-VDH', socket: 'AM4', memory_type: 'DDR4', form_factor: 'mATX', m2_slots: 2, max_ram_gb: 128, max_ram_mhz: 4400, price: 6100, hardware_score: 76, stock_status: 'In Stock' },
    { id: 3, category: 'Video Cards', name: 'RTX 4060 8GB', tdp_watts: 115, length_mm: 240, gpu_pcie_8pin_req: 1, gpu_requires_12vhpwr: false, price: 18500, hardware_score: 82, stock_status: 'In Stock' },
    { id: 4, category: 'Memory', name: '16GB (2x8GB) DDR4-3200 Kit', memory_type: 'DDR4', capacity_gb: 8, speed_mhz: 3200, is_kit: true, price: 3100, hardware_score: 75, stock_status: 'In Stock' },
    { id: 5, category: 'Storage', name: 'Kingston NV3 1TB NVMe', capacity_gb: 1000, storage_interface: 'M.2 NVMe', price: 3500, hardware_score: 78, stock_status: 'In Stock' },
    { id: 6, category: 'Power Supplies', name: '650W 80+ Bronze PSU', wattage: 650, psu_tier: 'B', pcie_8pin_count: 2, has_12vhpwr: false, price: 3400, hardware_score: 76, stock_status: 'In Stock' },
    { id: 7, category: 'CPU Coolers', name: 'Tower Air Cooler 120mm', supported_sockets: 'AM4,AM5', cooler_height_mm: 154, price: 1350, hardware_score: 74, stock_status: 'In Stock' },
    { id: 8, category: 'Cases', name: 'mATX Airflow Case', supported_form_factors: 'MATX,ITX', max_gpu_length_mm: 330, max_cooler_height_mm: 165, price: 2350, hardware_score: 75, stock_status: 'In Stock' },
  ];

  const gen = runSmartBuildAssistant({
    products: catalog,
    budgetInput: 46000,
    profile: 'Gaming',
  });

  assert.equal(gen.ok, true);
  assert.equal(gen.withinBudget, true);
  assert.ok(CATEGORIES.every((cat) => cat in gen.build));

  const rules = evaluateBuildRules(gen.build, {
    ramStickCount: gen.ramStickCount,
    peakWatts: 240,
    recommendedPsuWatts: 450,
    minStorageGb: 500,
  });
  const coverage = getVerificationCoverage(rules);
  const score = calculateCompatibilityScore(rules);

  assert.ok(coverage.verified >= 8);
  assert.ok(typeof score === 'number' && score >= 75 && score <= 100);

  const authUser = { id: 'usr-99', email: 'builder@bytebuild.ph' };
  const quotePayload = buildQuotationPayload({
    refCode: 'BB-999001',
    currentUser: authUser,
    selectedBuild: gen.build,
    selectedRamCount: gen.ramStickCount,
    totalPrice: gen.totalPrice,
    compatibilityScore: score,
  });
  assert.equal(quotePayload.user_id, 'usr-99');
  assert.equal(quotePayload.customer_email, 'builder@bytebuild.ph');

  const html = buildQuotationHtmlDocument({
    refCode: 'BB-999001',
    printDateString: 'Nov 23, 2026',
    selectedBuild: gen.build,
    selectedRamCount: gen.ramStickCount,
    totalPrice: gen.totalPrice,
    compatibilityScore: score,
    verificationCoverage: coverage,
    activePeakWatts: 240,
    recommendedPsuWatts: 450,
  });
  assert.match(html, new RegExp(`${score}% \\(`));
});

test('TC-75: Saved build round-trip and pre-order request payload preserve user account metadata', () => {
  const user = { id: 'usr-99', email: 'builder@bytebuild.ph' };
  const preOrder = buildPreorderRequestPayload({
    currentUser: user,
    customerName: 'Kenneth Rabang',
    contactNumber: '0917 000 1111',
    product: { id: 'po-7', name: 'RTX 5070 Ti 16GB', price: 48900 },
  });

  assert.equal(preOrder.user_id, 'usr-99');
  assert.equal(preOrder.email, 'builder@bytebuild.ph');
  assert.equal(preOrder.estimated_price, 48900);

  const restored = normalizeSavedBuildRecord({
    build_data: {
      __ramStickCount: 2,
      Processors: { id: 1, name: 'AMD Ryzen 5 5600', price: 7200 },
    },
  });
  assert.equal(restored.ramStickCount, 2);
  assert.equal(restored.buildData.Processors.name, 'AMD Ryzen 5 5600');
});