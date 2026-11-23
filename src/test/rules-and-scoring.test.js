import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBuildRules,
  hasIntegratedGraphics,
} from '../lib/compat.js';
import {
  calculateCompatibilityScore,
  getVerificationCoverage,
  evaluateBottleneckBalance,
} from '../lib/scoring.js';
import {
  calculateRigWattage,
  getGpuPowerProfile,
  getCpuPowerProfile,
  computeRecommendedPsuWatts,
} from '../lib/power.js';

test('TC-39: Empty build returns null compatibility score and 0 verified rules', () => {
  const results = evaluateBuildRules({});
  const coverage = getVerificationCoverage(results);
  const score = calculateCompatibilityScore(results);

  assert.equal(coverage.verified, 0);
  assert.equal(coverage.total, results.length);
  assert.equal(score, null);
});

test('TC-40: Estimated pass never counts as verified and estimated fail downgrades to warn', () => {
  // No explicit .socket column -> socket inferred from name -> dataSource: "estimated"
  const mismatchEstimated = evaluateBuildRules({
    Processors: { name: 'AMD Ryzen 5 7600X' },
    Motherboards: { name: 'MSI B550M PRO-VDH' },
  });

  const sockRule = mismatchEstimated.find((r) => r.ruleId === 'RULE-SOCK-01');
  assert.equal(sockRule.dataSource, 'estimated');
  assert.equal(sockRule.status, 'warn');
  assert.match(sockRule.message, /based on estimated specs/i);

  const matchEstimated = evaluateBuildRules({
    Processors: { name: 'AMD Ryzen 5 5600' },
    Motherboards: { name: 'MSI B550M PRO-VDH' },
    Memory: { name: '16GB DDR4-3200' },
  });
  const cov = getVerificationCoverage(matchEstimated);
  assert.equal(cov.verified, 0);
  assert.equal(calculateCompatibilityScore(matchEstimated), null);
});

test('TC-41: Missing GPU/PSU connector and clearance columns return unknown (no default guesses)', () => {
  const results = evaluateBuildRules({
    'Video Cards': { name: 'RTX 4060 8GB' },
    'Power Supplies': { name: '650W Bronze PSU', wattage: 650 },
    Cases: { name: 'Generic Mid-Tower Case' },
  });

  const connRule = results.find((r) => r.ruleId === 'RULE-PSU-CONN-01');
  assert.equal(connRule.status, 'unknown');
  assert.equal(connRule.dataSource, 'unknown');
  assert.ok(connRule.missingFields.includes('Video Cards.gpu_pcie_8pin_req'));
  assert.ok(connRule.missingFields.includes('Power Supplies.pcie_8pin_count'));

  const gpuLenRule = results.find((r) => r.ruleId === 'RULE-GPU-LEN-01');
  assert.equal(gpuLenRule.status, 'unknown');
  assert.ok(gpuLenRule.missingFields.includes('Video Cards.length_mm'));
  assert.ok(gpuLenRule.missingFields.includes('Cases.max_gpu_length_mm'));
});

test('TC-42: RULE-IGPU-01 warns only when >= 5 parts have no iGPU and no GPU, else unknown', () => {
  const cpuNoIgpu = { name: 'AMD Ryzen 5 5600', socket: 'AM4', has_igpu: false };

  const partialBuild = evaluateBuildRules({
    Processors: cpuNoIgpu,
    Motherboards: { name: 'MSI B550M', socket: 'AM4', memory_type: 'DDR4' },
  });
  assert.equal(
    partialBuild.find((r) => r.ruleId === 'RULE-IGPU-01').status,
    'unknown'
  );

  const fivePartBuild = evaluateBuildRules({
    Processors: cpuNoIgpu,
    Motherboards: { name: 'MSI B550M', socket: 'AM4', memory_type: 'DDR4' },
    Memory: { name: '16GB DDR4', memory_type: 'DDR4', capacity_gb: 16 },
    Storage: { name: '1TB NVMe SSD', capacity_gb: 1000, storage_interface: 'M.2 NVMe' },
    'Power Supplies': { name: '650W PSU', wattage: 650 },
  });
  assert.equal(
    fivePartBuild.find((r) => r.ruleId === 'RULE-IGPU-01').status,
    'warn'
  );
});

test('TC-43: hasIntegratedGraphics accurately classifies Intel F, Ryzen G, and AM5 CPUs', () => {
  assert.equal(hasIntegratedGraphics({ name: 'Intel Core i5-12400F' }), false);
  assert.equal(hasIntegratedGraphics({ name: 'AMD Ryzen 5 5600' }), false);
  assert.equal(hasIntegratedGraphics({ name: 'AMD Ryzen 5 4600G' }), true);
  assert.equal(hasIntegratedGraphics({ name: 'AMD Ryzen 5 7600X' }), true);
  assert.equal(hasIntegratedGraphics({ name: 'Intel Core i5-13600K' }), true);
});

test('TC-44: GPU wattage ignores Recommended PSU text and flags missing GPU draw', () => {
  const gpu = {
    name: 'RTX 4090 24GB',
    specs: 'Recommended PSU 850W, Triple Fan',
  };
  const prof = getGpuPowerProfile(gpu);
  assert.equal(prof.missingWatts, true);
  assert.equal(prof.watts, null);

  const rig = calculateRigWattage({ 'Video Cards': gpu });
  assert.equal(rig.hasMissingSpecs, true);
  assert.ok(rig.missingSpecs.some((m) => m.category === 'Video Cards'));
});

test('TC-45: i9-14900K peak draw exceeds 125W base TDP via 1.35x assumption', () => {
  const cpuProf = getCpuPowerProfile({ name: 'Intel Core i9-14900K', tdp: 125 });
  assert.ok(cpuProf.peakWatts > 125, `Expected > 125W, got ${cpuProf.peakWatts}W`);
  assert.equal(cpuProf.estimatedPeak, true);
});

test('TC-46: Single recommended PSU formula honors bufferWatts and 50W rounding', () => {
  // Peak 400W -> max(400 * 1.25 = 500, 400 + 150 = 550) -> 550W
  assert.equal(computeRecommendedPsuWatts(400, 150), 550);
  // Peak 200W -> max(250, 320) -> clamped to minimum 450W
  assert.equal(computeRecommendedPsuWatts(200, 120), 450);

  const bal = evaluateBottleneckBalance(
    { name: 'CPU', hardware_score: 75 },
    { name: 'GPU', hardware_score: 78 }
  );
  assert.equal(bal.status, 'pass');
  assert.ok(typeof bal.message === 'string' && bal.message.length > 0);
});