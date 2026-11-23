const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function deriveComponentTier(part, category = '') {
  if (!part) return 0;

  const explicitScore = Number(part.hardware_score);
  if (Number.isFinite(explicitScore) && explicitScore > 0) {
    if (explicitScore >= 90) return 5;
    if (explicitScore >= 82) return 4;
    if (explicitScore >= 72) return 3;
    if (explicitScore >= 60) return 2;
    return 1;
  }

  const text = `${part.name || ''} ${part.specs || ''}`.toUpperCase();
  const cat = normalizeText(category || part.category);

  if (cat === 'processors') {
    if (/(I9|RYZEN\s*9|ULTRA\s*9|7950|9950|14900|285K)/.test(text)) return 5;
    if (/(I7|RYZEN\s*7|ULTRA\s*7|7800X3D|7700|9700|14700|265K)/.test(text)) return 4;
    if (/(I5|RYZEN\s*5|ULTRA\s*5|7600|5600|14600|12400|245K)/.test(text)) return 3;
    return 2;
  }

  if (cat === 'video cards') {
    if (/(4090|4080|5080|5090|7900\s*XTX|7900\s*XT)/.test(text)) return 5;
    if (/(4070|5070|7800\s*XT|7700\s*XT|3080)/.test(text)) return 4;
    if (/(4060|5060|7600|6600|3060|A750|A580)/.test(text)) return 3;
    return 2;
  }

  return 3;
}

export function evaluateBottleneckBalance(cpu, gpu) {
  if (!cpu || !gpu) {
    return {
      status: 'unknown',
      cpuTier: cpu ? deriveComponentTier(cpu, 'Processors') : 0,
      gpuTier: gpu ? deriveComponentTier(gpu, 'Video Cards') : 0,
      message: '',
    };
  }

  const cpuTier = deriveComponentTier(cpu, 'Processors');
  const gpuTier = deriveComponentTier(gpu, 'Video Cards');
  const diff = gpuTier - cpuTier;

  if (diff >= 2) {
    return {
      status: 'warn',
      cpuTier,
      gpuTier,
      message: `GPU tier (${gpuTier}/5) is significantly ahead of CPU tier (${cpuTier}/5) — potential CPU bottleneck in high-FPS/CPU-bound titles.`,
    };
  }

  if (diff <= -2) {
    return {
      status: 'warn',
      cpuTier,
      gpuTier,
      message: `CPU tier (${cpuTier}/5) is well ahead of GPU tier (${gpuTier}/5) — GPU may limit graphics/resolution headroom.`,
    };
  }

  return {
    status: 'pass',
    cpuTier,
    gpuTier,
    message: `CPU (Tier ${cpuTier}/5) and GPU (Tier ${gpuTier}/5) performance tiers are well balanced.`,
  };
}

export function getVerificationCoverage(ruleResults = []) {
  if (!Array.isArray(ruleResults) || ruleResults.length === 0) {
    return {
      verified: 0,
      estimated: 0,
      total: 0,
    };
  }

  const total = ruleResults.length;
  let verified = 0;
  let estimated = 0;

  for (const rule of ruleResults) {
    if (!rule) continue;
    if (rule.status === 'pass' && !rule.unverified && rule.dataSource === 'database') {
      verified += 1;
    } else if (rule.dataSource === 'estimated') {
      estimated += 1;
    }
  }

  return {
    verified,
    estimated,
    total,
  };
}

export function calculateCompatibilityScore(ruleResults = []) {
  if (!Array.isArray(ruleResults) || ruleResults.length === 0) {
    return null;
  }

  const coverage = getVerificationCoverage(ruleResults);
  if (coverage.verified === 0) {
    return null;
  }

  let score = 100;

  for (const rule of ruleResults) {
    if (!rule) continue;
    if (rule.status === 'fail') {
      score -= 25;
    } else if (rule.status === 'warn') {
      score -= 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}