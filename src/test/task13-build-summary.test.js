import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getShortCategoryLabel,
  buildSlotManifestRows,
  computePowerDisplayMetrics,
} from '../lib/buildSummary.js';

test('TC-70: buildSlotManifestRows maps all 8 categories with RAM kit details, PSU tier, and custom flags', () => {
  const rows = buildSlotManifestRows(
    {
      Processors: { id: 1, name: 'Ryzen 5 5600', price: 7500 },
      Memory: { id: 2, name: '16GB DDR4-3200', price: 2100 },
      'Power Supplies': { id: 3, name: 'Corsair RM750e', price: 5400, psu_tier: 'A' },
      Cases: { id: 'custom-1', name: 'Old Case', isCustomInput: true, unverified: true, price: 0 },
    },
    2
  );

  assert.equal(rows.length, 8);
  assert.equal(getShortCategoryLabel('Motherboards'), 'MOBO');

  const ramRow = rows.find((r) => r.category === 'Memory');
  assert.equal(ramRow.ramInfo.stickCount, 2);
  assert.equal(ramRow.priceLabel, '₱4,200');

  const psuRow = rows.find((r) => r.category === 'Power Supplies');
  assert.equal(psuRow.psuTier, 'A');

  const caseRow = rows.find((r) => r.category === 'Cases');
  assert.equal(caseRow.isUnverified, true);
  assert.equal(caseRow.priceLabel, 'Included');

  const gpuRow = rows.find((r) => r.category === 'Video Cards');
  assert.equal(gpuRow.priceLabel, '--');
});

test('TC-71: computePowerDisplayMetrics switches between Idle/Peak and detects PSU overload', () => {
  const idleView = computePowerDisplayMetrics({
    powerMetrics: {
      idleWatts: 65,
      activePeakWatts: 520,
      stockPeakWatts: 460,
      ocPeakWatts: 520,
      recommendedPsuWatts: 650,
    },
    psuInfo: { watts: 500 },
    powerDisplayView: 'idle',
    overclockEnabled: true,
  });

  assert.equal(idleView.displayedWatts, 65);
  assert.equal(idleView.modeLabel, 'Idle Draw');
  assert.equal(idleView.isOverPsuCap, true);

  const peakView = computePowerDisplayMetrics({
    powerMetrics: {
      idleWatts: 65,
      activePeakWatts: 520,
      stockPeakWatts: 460,
      ocPeakWatts: 520,
      recommendedPsuWatts: 650,
    },
    psuInfo: { watts: 500 },
    powerDisplayView: 'load',
    overclockEnabled: true,
  });

  assert.equal(peakView.displayedWatts, 520);
  assert.equal(peakView.modeLabel, 'OC Peak');
  assert.equal(peakView.loadPercent, 100);
});