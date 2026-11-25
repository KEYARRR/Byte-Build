import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnifiedUpgradeRows,
  getUpgradeMissingCoreLabels,
  buildNextUpgradeNotes,
} from '../src/lib/upgradeAdvisor.js';
import { evaluateBuildRules } from '../src/lib/compat.js';

describe('TC-39: Upgrade Advisor, Unified Rig & Next-Upgrade Notes', () => {
  const sampleExistingPc = {
    Processors: {
      id: 'cpu-5600',
      name: 'AMD Ryzen 5 5600',
      category: 'Processors',
      socket: 'AM4',
      price: 6450,
    },
    Motherboards: {
      id: 'mobo-b550m',
      name: 'MSI B550M PRO-VDH',
      category: 'Motherboards',
      socket: 'AM4',
      memory_type: 'DDR4',
      price: 4950,
    },
    Memory: {
      id: 'ram-16gb',
      name: 'Kingston Fury 8GB DDR4 3200MHz',
      category: 'Memory',
      memory_type: 'DDR4',
      price: 1650,
    },
    Storage: {
      id: 'ssd-240gb',
      name: 'WD Green 240GB SSD',
      category: 'Storage',
      price: 1450,
    },
    'Power Supplies': {
      id: 'psu-650w',
      name: 'Corsair CV650 650W',
      category: 'Power Supplies',
      psu_tier: 'C',
      price: 3200,
    },
    Cases: {
      id: 'case-matx',
      name: 'DarkFlash DLM21 Mesh',
      category: 'Cases',
      form_factor: 'mATX',
      price: 2850,
    },
  };

  it('merges current rig and shop upgrades into one list and sums only upgrade costs', () => {
    const selectedBuild = {
      'Video Cards': {
        id: 'gpu-rx6600',
        name: 'Gigabyte Radeon RX 6600 8GB',
        category: 'Video Cards',
        price: 16950,
      },
    };

    const rows = buildUnifiedUpgradeRows({
      existingPc: sampleExistingPc,
      selectedBuild,
      existingRamCount: 2,
      selectedRamCount: 2,
    });

    const gpuRow = rows.find((r) => r.category === 'Video Cards');
    const cpuRow = rows.find((r) => r.category === 'Processors');

    assert.equal(gpuRow.statusLabel, 'New Upgrade');
    assert.equal(gpuRow.upgradeCost, 16950);
    assert.equal(cpuRow.statusLabel, 'Current Rig');
    assert.equal(cpuRow.upgradeCost, 0);

    const missingCore = getUpgradeMissingCoreLabels({
      existingPc: sampleExistingPc,
      selectedBuild,
    });
    assert.deepEqual(missingCore, []);
  });

  it('evaluates combined rig rules and generates actionable next-upgrade notes', () => {
    const effectiveParts = {
      ...sampleExistingPc,
      'Video Cards': {
        id: 'gpu-rx6600',
        name: 'Gigabyte Radeon RX 6600 8GB',
        category: 'Video Cards',
        price: 16950,
      },
    };

    const ruleResults = evaluateBuildRules(effectiveParts, {
      ramStickCount: 2,
      peakWatts: 260,
      recommendedPsuWatts: 450,
      minRamGb: 16,
      minStorageGb: 500,
    });

    const notes = buildNextUpgradeNotes({
      existingPc: sampleExistingPc,
      selectedBuild: { 'Video Cards': effectiveParts['Video Cards'] },
      effectiveParts,
      ramStickCount: 2,
      powerMetrics: { activePeakWatts: 260, recommendedPsuWatts: 450 },
      ruleResults,
    });

    assert.ok(Array.isArray(notes));
    assert.ok(notes.length > 0);
  });
});