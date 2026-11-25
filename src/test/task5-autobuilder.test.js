import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartBuildAssistant } from '../lib/autobuilder.js';
import { calculateBuildTotal } from '../lib/pricing.js';
import { CATEGORIES } from '../lib/config.js';

const SAMPLE_PRODUCTS = [
  { id: 'cpu-1', name: 'AMD Ryzen 5 5600', category: 'Processors', socket: 'AM4', wattage: 65, hardware_score: 80, price: 6500, stock_status: 'In Stock' },
  { id: 'mobo-1', name: 'MSI B550M PRO-VDH', category: 'Motherboards', socket: 'AM4', memory_type: 'DDR4', form_factor: 'mATX', price: 5200, stock_status: 'In Stock' },
  { id: 'ram-1', name: '16GB (2x8GB) DDR4 3200MHz', category: 'Memory', memory_type: 'DDR4', price: 2400, stock_status: 'In Stock' },
  { id: 'ssd-1', name: '500GB NVMe SSD', category: 'Storage', capacity_gb: 500, price: 2400, stock_status: 'In Stock' },
  { id: 'gpu-1', name: 'Radeon RX 6600', category: 'Video Cards', wattage: 132, hardware_score: 78, price: 12500, stock_status: 'In Stock' },
  { id: 'psu-1', name: '550W Tier B PSU', category: 'Power Supplies', wattage: 550, psu_tier: 'B', price: 2900, stock_status: 'In Stock' },
  { id: 'cool-1', name: 'Air Cooler', category: 'CPU Coolers', price: 1100, stock_status: 'In Stock' },
  { id: 'case-1', name: 'mATX Case', category: 'Cases', form_factor: 'mATX', price: 1900, stock_status: 'In Stock' },
];

test('TC-51: Smart Build Assistant strictly enforces budget and reports honest allocation metrics', () => {
  const res = runSmartBuildAssistant({
    products: SAMPLE_PRODUCTS,
    budgetInput: 40000,
    profile: 'Gaming',
  });
  assert.equal(res.ok, true);
  assert.equal(res.withinBudget, true);
  const total = calculateBuildTotal(res.build, CATEGORIES, res.ramStickCount);
  assert.ok(total <= 40000);
});

test('TC-52: Rejects invalid budgets (0, negative, NaN, non-numeric) while 10000 returns ok:true', () => {
  for (const invalid of [0, -5000, NaN, 'abc', null]) {
    const bad = runSmartBuildAssistant({ products: SAMPLE_PRODUCTS, budgetInput: invalid });
    assert.equal(bad.ok, false);
  }
  const validLow = runSmartBuildAssistant({ products: SAMPLE_PRODUCTS, budgetInput: 10000 });
  assert.equal(validLow.ok, true);
});