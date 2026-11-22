import { BOTTLENECK_CONFIG, TIER_THRESHOLDS } from './config.js';
import { getCpuPowerProfile, getGpuPowerProfile } from './power.js';

export function deriveComponentTier(item, category) {
  if (!item) return null;
  const explicitScore = Number(item.hardware_score);
  if (Number.isFinite(explicitScore) && explicitScore > 0) {
    if (explicitScore >= 90) return 5;
    if (explicitScore >= 75) return 4;
    if (explicitScore >= 55) return 3;
    if (explicitScore >= 35) return 2;
    return 1;
  }

  if (category === 'Processors') {
    const { tdpWatts } = getCpuPowerProfile(item);
    if (tdpWatts >= TIER_THRESHOLDS.cpuHighTdpWatts) return 4;
    if (tdpWatts >= TIER_THRESHOLDS.cpuMidTdpWatts) return 3;
    return 2;
  }

  if (category === 'Video Cards') {
    const { watts } = getGpuPowerProfile(item);
    if (watts >= TIER_THRESHOLDS.gpuHighWatts) return 4;
    if (watts >= TIER_THRESHOLDS.gpuMidWatts) return 3;
    return 2;
  }

  return 3;
}

export function evaluateBottleneckBalance(cpuItem, gpuItem) {
  if (!cpuItem && !gpuItem) {
    return { status: 'unknown', label: 'Incomplete Build', tierDelta: null };
  }
  if (!gpuItem) {
    return {
      status: 'warn',
      label: 'No Discrete GPU (Integrated / APU Only)',
      tierDelta: null,
    };
  }
  if (!cpuItem) {
    return {
      status: 'unknown',
      label: 'CPU Missing for Balance Check',
      tierDelta: null,
    };
  }

  const cpuTier = deriveComponentTier(cpuItem, 'Processors') ?? 2;
  const gpuTier = deriveComponentTier(gpuItem, 'Video Cards') ?? 2;
  const delta = Math.abs(cpuTier - gpuTier);

  if (delta <= BOTTLENECK_CONFIG.balancedMaxTierDelta) {
    return {
      status: 'pass',
      label: 'Balanced CPU & GPU Pairing',
      tierDelta: delta,
    };
  }

  if (cpuTier > gpuTier) {
    return {
      status: 'warn',
      label: `CPU Tier (${cpuTier}) Above GPU Tier (${gpuTier})`,
      tierDelta: delta,
    };
  }

  return {
    status: 'warn',
    label: `GPU Tier (${gpuTier}) Above CPU Tier (${cpuTier})`,
    tierDelta: delta,
  };
}

export function calculateCompatibilityScore(ruleResults = []) {
  if (!Array.isArray(ruleResults) || ruleResults.length === 0) {
    return 100;
  }

  let penalty = 0;
  for (const res of ruleResults) {
    if (res.status === 'fail') penalty += 30;
    else if (res.status === 'warn') penalty += 10;
    // 'unknown' intentionally does not inflate pass score nor unfairly zero it out;
    // surface 'unknown' counts separately in the UI summary.
  }

  return Math.max(0, Math.min(100, 100 - penalty));
}