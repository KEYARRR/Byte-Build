import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../lib/config.js';
import { createCustomOwnedPart } from '../lib/customParts.js';
import {
  buildSlotManifestRows,
  computePowerDisplayMetrics,
} from '../lib/buildSummary.js';

test('TC-70: buildSlotManifestRows maps all categories with RAM kit details, PSU tier, and custom flags', () => {
  const customCase = createCustomOwnedPart({
    category: 'Cases',
    name: 'mATX Case',
    brand: 'Custom',
    price: 0,
    specs: '',
  });

  const build = {
    Processors: { id: 1, name: 'Ryzen 5 5600', price: 7200 },
    Motherboards: { id: 2, name: 'B550M Pro', price: 6100 },
    Memory: { id: 3, name: '16GB (2x8GB) DDR4-3200 Kit', specs: '2x8GB 3200MHz', price: 3100 },
    Storage: { id: 4, name: '1TB NVMe SSD', price: 3500 },
    'Hard Drives': { id: 5, name: '2TB BarraCuda HDD', price: 3650 },
    'Video Cards': { id: 6, name: 'RTX 4060', price: 18500 },
    'Power Supplies': { id: 7, name: '650W Bronze', psu_tier: 'B', price: 3400 },
    'CPU Coolers': { id: 8, name: 'AG400 Air Cooler', price: 1250 },
    Cases: customCase,
  };

  const rows = buildSlotManifestRows(build, 2);
  assert.equal(rows.length, CATEGORIES.length);

  const hddRow = rows.find((r) => r.category === 'Hard Drives');
  assert.equal(hddRow.shortLabel, 'HDD');
  assert.equal(hddRow.priceLabel, '₱3,650');

  const ramRow = rows.find((r) => r.category === 'Memory');
  assert.equal(ramRow.ramInfo.stickCount, 2);

  const psuRow = rows.find((r) => r.category === 'Power Supplies');
  assert.equal(psuRow.psuTier, 'B');

  const caseRow = rows.find((r) => r.category === 'Cases');
  assert.equal(caseRow.isUnverified, true);
});

test('TC-71: computePowerDisplayMetrics switches between Idle/Peak and detects PSU overload', () => {
  const powerMetrics = {
    idleWatts: 45,
    stockPeakWatts: 310,
    ocPeakWatts: 365,
    activePeakWatts: 365,
    recommendedPsuWatts: 500,
    missingSpecs: [],
  };
  const psuInfo = { wattage: 350 };

  const peakOc = computePowerDisplayMetrics({
    powerMetrics,
    psuInfo,
    powerDisplayView: 'load',
    overclockEnabled: true,
  });
  assert.equal(peakOc.displayedWatts, 365);
  assert.equal(peakOc.isOverPsuCap, true);

  const idle = computePowerDisplayMetrics({
    powerMetrics,
    psuInfo,
    powerDisplayView: 'idle',
    overclockEnabled: false,
  });
  assert.equal(idle.displayedWatts, 45);
  assert.equal(idle.isOverPsuCap, false);
});