import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartBuildAssistant } from '../lib/autobuilder.js';

const SAMPLE_CATALOG = [
  { id: 1, category: 'Processors', name: 'Ryzen 5 5600', price: 7500, hardware_score: 78, stock_status: 'In Stock' },
  { id: 2, category: 'Processors', name: 'Ryzen 7 7800X3D', price: 24500, hardware_score: 96, stock_status: 'In Stock' },
  { id: 3, category: 'Motherboards', name: 'MSI B550M PRO-VDH', price: 6200, hardware_score: 76, stock_status: 'In Stock' },
  { id: 4, category: 'Video Cards', name: 'RTX 4060 8GB', price: 18500, hardware_score: 82, stock_status: 'In Stock' },
  { id: 5, category: 'Memory', name: '16GB (2x8GB) DDR4-3200 Kit', price: 3200, is_kit: true, hardware_score: 75, stock_status: 'In Stock' },
  { id: 6, category: 'Storage', name: 'Kingston NV3 1TB NVMe', price: 3600, hardware_score: 78, stock_status: 'In Stock' },
  { id: 7, category: 'Power Supplies', name: '650W 80+ Bronze PSU', price: 3400, psu_tier: 'B', wattage: 650, hardware_score: 76, stock_status: 'In Stock' },
  { id: 8, category: 'CPU Coolers', name: 'Tower Air Cooler 120mm', price: 1400, hardware_score: 74, stock_status: 'In Stock' },
  { id: 9, category: 'Cases', name: 'MATX Airflow Case', price: 2400, hardware_score: 75, stock_status: 'In Stock' },
];

test('TC-51: Smart Build Assistant strictly enforces budget and reports honest allocation metrics', () => {
  const budget = 32000;
  const res = runSmartBuildAssistant({
    products: SAMPLE_CATALOG,
    budgetInput: budget,
    profile: 'Gaming',
  });

  assert.equal(res.ok, true);
  assert.equal(res.withinBudget, true);
  assert.ok(res.totalPrice <= budget, `Expected totalPrice <= ${budget}, got ${res.totalPrice}`);
  assert.equal(res.remainingBudget, budget - res.totalPrice);
  assert.ok(Array.isArray(res.unfilledCategories));
  assert.match(res.statusMessage, /Budget:/);
});

test('TC-52: Smart Build Assistant rejects budgets below minimum threshold cleanly', () => {
  const res = runSmartBuildAssistant({
    products: SAMPLE_CATALOG,
    budgetInput: 5000,
    profile: 'Gaming',
  });

  assert.equal(res.ok, false);
  assert.equal(res.withinBudget, false);
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
});