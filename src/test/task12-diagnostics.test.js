import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiagnosticIssues,
  buildSystemRecommendation,
  evaluatePerformanceTier,
} from '../lib/diagnostics.js';

test('TC-68: buildDiagnosticIssues separates actionable issues from unknown catalog rules', () => {
  const { actionableIssues, unknownCatalogIssues } = buildDiagnosticIssues([
    {
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      status: 'fail',
      title: 'Memory Standard Compatibility',
      message: 'DDR4 vs DDR5 mismatch',
      recommendation: 'Use DDR5 RAM',
    },
    {
      ruleId: 'RULE-GPU-LEN-01',
      category: 'Cases',
      status: 'unknown',
      unverified: false,
      title: 'GPU Length vs. Case Clearance',
      message: 'Missing clearance column',
    },
    {
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      status: 'unknown',
      unverified: true,
      title: 'CPU & Motherboard Socket',
      message: 'Custom CPU unverified',
    },
  ]);

  assert.equal(actionableIssues.length, 2);
  assert.equal(actionableIssues[0].severity, 'critical');
  assert.equal(actionableIssues[1].severity, 'unverified');
  assert.equal(unknownCatalogIssues.length, 1);
  assert.equal(unknownCatalogIssues[0].id, 'RULE-GPU-LEN-01');
});

test('TC-69: buildSystemRecommendation and evaluatePerformanceTier return clear status states', () => {
  const ready = buildSystemRecommendation({
    actionableIssues: [],
    selectedItems: [],
    existingPc: {},
  });
  assert.equal(ready.tone, 'neutral');

  const noGpu = evaluatePerformanceTier({
    currentCpu: { name: 'Ryzen 5 5600', socket: 'AM4', has_igpu: false, hardware_score: 78 },
    currentGpu: null,
    actionableIssues: [],
  });
  assert.equal(noGpu.label, 'Select a Graphics Card');

  const balanced = evaluatePerformanceTier({
    currentCpu: { name: 'Ryzen 7 7800X3D', socket: 'AM5', has_igpu: true, hardware_score: 95 },
    currentGpu: { name: 'RTX 4070 Ti Super', hardware_score: 90 },
    actionableIssues: [],
  });
  assert.equal(balanced.label, 'Performance Gaming & Creator Rig');
});