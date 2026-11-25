import { CATEGORIES, WORKLOAD_WEIGHTS } from './config.js';
import { calculateBuildTotal, isPrebundledKit } from './pricing.js';
import { calculateRigWattage, getPsuProfile } from './power.js';
import {
  evaluateBuildRules,
  detectCpuSocket,
  detectMotherboardSocket,
  hasIntegratedGraphics,
} from './compat.js';
import { deriveComponentTier } from './scoring.js';
import { parseRam } from './ram.js';

export const PSU_QUALITY_PREMIUM = 0.25;
export const TIGHT_BUDGET_PSU_CEILING = 25000;
const ALLOWED_PSU_TIERS = new Set(['A+', 'A', 'B']);
const MAX_REPAIR_ITERATIONS = 8;

const PLATFORM_SPECS = [
  { key: 'AM4-DDR4', vendor: 'ryzen', socket: 'AM4', ddr: 'DDR4' },
  { key: 'AM5-DDR5', vendor: 'ryzen', socket: 'AM5', ddr: 'DDR5' },
  { key: 'LGA1700-DDR4', vendor: 'intel', socket: 'LGA1700', ddr: 'DDR4' },
  { key: 'LGA1700-DDR5', vendor: 'intel', socket: 'LGA1700', ddr: 'DDR5' },
  { key: 'LGA1851-DDR5', vendor: 'intel', socket: 'LGA1851', ddr: 'DDR5' },
  { key: 'LGA1200-DDR4', vendor: 'intel', socket: 'LGA1200', ddr: 'DDR4' },
];

// Upper limit per category when the builder spends leftover budget on upgrades (about 1.5x the target share).
const CATEGORY_BUDGET_CAPS = {
  Gaming: { 'Video Cards': 0.55, Processors: 0.27, Storage: 0.16, Memory: 0.16, Motherboards: 0.14, 'CPU Coolers': 0.06, Cases: 0.08, 'Hard Drives': 0.06 },
  'Office/Productivity': { 'Video Cards': 0.2, Processors: 0.30, Storage: 0.24, Memory: 0.20, Motherboards: 0.14, 'CPU Coolers': 0.07, Cases: 0.12, 'Hard Drives': 0.08 },
  'Content Creation': { 'Video Cards': 0.34, Processors: 0.38, Storage: 0.20, Memory: 0.24, Motherboards: 0.16, 'CPU Coolers': 0.08, Cases: 0.07, 'Hard Drives': 0.08 },
  Balanced: { 'Video Cards': 0.38, Processors: 0.32, Storage: 0.18, Memory: 0.18, Motherboards: 0.15, 'CPU Coolers': 0.07, Cases: 0.08, 'Hard Drives': 0.06 },
};

const norm = (v) => String(v || '').trim().toLowerCase();

// Target share of the budget per category for each workload profile.
// Used to score how well a candidate build matches what the profile should prioritise.
const PROFILE_TARGET_SHARE = {
  Gaming: { 'Video Cards': 0.34, Processors: 0.18, Motherboards: 0.09, Memory: 0.09, Storage: 0.09, 'Hard Drives': 0.02, 'Power Supplies': 0.09, 'CPU Coolers': 0.03, Cases: 0.05 },
  'Content Creation': { 'Video Cards': 0.20, Processors: 0.26, Motherboards: 0.11, Memory: 0.13, Storage: 0.12, 'Hard Drives': 0.03, 'Power Supplies': 0.08, 'CPU Coolers': 0.04, Cases: 0.03 },
  'Office/Productivity': { 'Video Cards': 0.0, Processors: 0.26, Motherboards: 0.11, Memory: 0.14, Storage: 0.16, 'Hard Drives': 0.04, 'Power Supplies': 0.10, 'CPU Coolers': 0.05, Cases: 0.14 },
  Balanced: { 'Video Cards': 0.26, Processors: 0.22, Motherboards: 0.10, Memory: 0.11, Storage: 0.11, 'Hard Drives': 0.03, 'Power Supplies': 0.09, 'CPU Coolers': 0.04, Cases: 0.04 },
};

function spendFitScore(build, ramStickCount, budget, profile) {
  const target = PROFILE_TARGET_SHARE[profile] || PROFILE_TARGET_SHARE.Balanced;
  let diff = 0;
  for (const cat of Object.keys(target)) {
    const item = build[cat];
    const spend = item ? calculateBuildTotal({ [cat]: item }, CATEGORIES, ramStickCount) : 0;
    diff += Math.abs(spend / Math.max(1, budget) - target[cat]);
  }
  return Math.max(0, 100 - diff * 100);
}

// Orders boards only (never used as a compatibility claim): 1 = entry, 2 = mainstream, 3 = enthusiast.
function boardChipsetRank(board) {
  const t = `${board?.name || ''} ${board?.specs || ''}`.toUpperCase();
  if (/(?<![A-Z0-9])(?:B550|X570|X470|X370|Z890|Z790|Z690|Z590|Z490|Z390|X670|X870|B850)/.test(t)) return 3;
  if (/(?<![A-Z0-9])(?:B450|B350|A520|B650|B860|B760|B660|B560|B460|H770|H670|H570|H470)/.test(t)) return 2;
  if (/(?<![A-Z0-9])(?:A320|A620|H810|H610|H510|H410|H310|H110)/.test(t)) return 1;
  return 2;
}

function closestByPrice(list, targetPrice) {
  return [...list].sort(
    (a, b) =>
      Math.abs(Number(a.price || 0) - targetPrice) - Math.abs(Number(b.price || 0) - targetPrice) ||
      Number(a.price || 0) - Number(b.price || 0)
  );
}

function normalizeProfileKey(profile = 'Gaming') {
  const p = String(profile || '').trim();
  if (p === 'Mixed/Balanced' || p === 'Balanced') return 'Balanced';
  if (p === 'Office/Productivity' || p === 'Office') return 'Office/Productivity';
  if (p === 'Content Creation' || p === 'Creator') return 'Content Creation';
  return 'Gaming';
}

function normalizePlatformPreference(pref = 'auto') {
  const p = norm(pref);
  if (p === 'ryzen' || p === 'amd') return 'ryzen';
  if (p === 'intel') return 'intel';
  return 'auto';
}

function isAvailableInStock(item) {
  if (!item) return false;
  const st = norm(item.stock_status);
  return st !== 'sold out' && st !== 'out of stock';
}

function isEntryTierCpu(cpu) {
  if (!cpu) return false;
  const tier = deriveComponentTier(cpu, 'Processors');
  if (tier <= 1) return true;
  const text = `${cpu.name || ''} ${cpu.specs || ''}`.toUpperCase();
  return /\b(?:I3|CORE\s+3|PENTIUM|CELERON|RYZEN\s+3|ATHLON)\b/.test(text);
}

// For budgets of ₱30,000 and above, require at least Intel Core i5
// or AMD Ryzen 5 class. Higher i7/i9 and Ryzen 7/9 models also qualify.
// This checks the model-family text rather than relying only on hardware_score.
function meetsMinimumCpuTier(cpu) {
  if (!cpu) return false;
  const text = `${cpu.name || ''} ${cpu.specs || ''}`.toUpperCase();
  return /\b(?:CORE\s*)?I[579]\b/.test(text) ||
    /\bCORE\s+ULTRA\s+[579]\b/.test(text) ||
    /\bRYZEN\s+[579]\b/.test(text);
}

function cpuHasUsableIgpu(cpu) {
  if (!cpu) return false;
  const upperName = String(cpu.name || '').toUpperCase();
  if (/\b(?:I[3579][\s-]?\d{4,5}|CORE\s+ULTRA\s+[3579][\s-]?\d{3}|[789]\d{3})(?:KF|KSF|F)\b/.test(upperName)) {
    return false;
  }
  return hasIntegratedGraphics(cpu) === true;
}

function isRyzen5000Cpu(cpu) {
  const text = `${cpu?.name || ''} ${cpu?.specs || ''}`.toUpperCase();
  return /\bRYZEN\s+[3579]\s+5\d{3}/i.test(text) || /\b5(?:500|600|700|800|900|950)[A-Z0-9]*\b/.test(text);
}

function isA320Board(board) {
  const text = `${board?.name || ''} ${board?.specs || ''}`.toUpperCase();
  return /\bA320\b|A320M/.test(text);
}

function isBoardCompatibleWithCpu(cpu, board) {
  if (!cpu || !board) return true;
  if (isRyzen5000Cpu(cpu) && isA320Board(board)) return false;
  return true;
}

function isBudgetOrUnratedPsu(item) {
  const tierInfo = normalizePsuTier(item);
  if (tierInfo.isUnknown) return true;
  return !ALLOWED_PSU_TIERS.has(tierInfo.tier);
}

function detectMemoryGen(item) {
  const explicit = String(item?.memory_type || item?.ddr || '').toUpperCase();
  if (explicit.includes('DDR5')) return 'DDR5';
  if (explicit.includes('DDR4')) return 'DDR4';
  const text = `${item?.name || ''} ${item?.specs || ''}`.toUpperCase();
  if (/\bDDR\s*5\b/.test(text)) return 'DDR5';
  if (/\bDDR\s*4\b/.test(text)) return 'DDR4';
  return 'UNKNOWN';
}

function detectBoardMemoryGen(board, cpuSocket = '') {
  const gen = detectMemoryGen(board);
  if (gen !== 'UNKNOWN') return gen;
  const sock = String(detectMotherboardSocket(board) || board?.socket || cpuSocket || '').toUpperCase();
  if (sock === 'AM4' || sock === 'LGA1200') return 'DDR4';
  if (sock === 'AM5' || sock === 'LGA1851') return 'DDR5';
  return 'UNKNOWN';
}

function detectCapacityGb(item) {
  if (!item) return 0;
  const direct = Number(item.capacity_gb ?? item.storage_gb ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const text = `${item.name || ''} ${item.specs || ''}`;
  const tbMatch = text.match(/(\d+(?:\.\d+)?)\s*TB\b/i);
  if (tbMatch) return Math.round(Number(tbMatch[1]) * 1000);
  const gbMatch = text.match(/(\d{2,4})\s*GB\b/i);
  if (gbMatch) return Number(gbMatch[1]);
  return 0;
}

function normalizePsuTier(rawItem) {
  const explicitRaw = String(rawItem?.psu_tier || rawItem?.tier || '').trim().toUpperCase();
  const prof = getPsuProfile(rawItem);
  const candidateTier = explicitRaw || String(prof?.tier || '').trim().toUpperCase();
  if (!candidateTier || candidateTier === 'UNKNOWN' || candidateTier === 'UNRATED' || candidateTier === 'N/A') {
    return { tier: 'UNKNOWN', tierRank: 0, isUnknown: true };
  }
  return {
    tier: candidateTier,
    tierRank: Number(prof?.tierRank ?? 0),
    isUnknown: false,
  };
}

function detectGpuWattage(gpu) {
  if (!gpu) return 0;
  const direct = Number(gpu.wattage ?? gpu.tdp ?? gpu.power_draw ?? 0);
  if (direct > 0) return direct;
  const text = `${gpu.name || ''} ${gpu.specs || ''}`;
  const m = text.match(/(\d{2,3})\s*W\b/i);
  return m ? Number(m[1]) : 0;
}

function gpuNeeds12Vhpwr(gpu) {
  if (!gpu) return false;
  if (gpu.gpu_requires_12vhpwr) return true;
  return /12vhpwr|12v-2x6|16-pin/i.test(`${gpu.name || ''} ${gpu.specs || ''}`);
}

function gpuPcie8PinReq(gpu) {
  if (!gpu) return 0;
  const direct = Number(gpu.gpu_pcie_8pin_req || 0);
  if (direct > 0) return direct;
  const text = `${gpu.name || ''} ${gpu.specs || ''}`;
  const m = text.match(/(\d+)\s*x?\s*(?:8-pin|pcie\s*8)/i);
  return m ? Number(m[1]) : 0;
}

function psuSupportsGpuConnectors(psu, gpu) {
  if (!psu || !gpu) return true;
  const text = `${psu.name || ''} ${psu.specs || ''}`;
  if (gpuNeeds12Vhpwr(gpu)) {
    const hasFlag = Boolean(psu.has_12vhpwr || psu.pcie_5) || /12vhpwr|12v-2x6|atx\s*3\.[01]/i.test(text);
    if (!hasFlag) return false;
  }
  const req8 = gpuPcie8PinReq(gpu);
  if (req8 > 0 && typeof psu.pcie_8pin_count === 'number' && psu.pcie_8pin_count < req8) {
    return false;
  }
  return true;
}

function summarizeRules(rules = []) {
  let fail = 0;
  let warn = 0;
  let unknown = 0;
  let unverified = 0;
  for (const r of rules) {
    if (!r) continue;
    if (r.status === 'fail') fail += 1;
    else if (r.status === 'warn') warn += 1;
    else if (r.status === 'unknown') unknown += 1;
    if (r.unverified) unverified += 1;
  }
  return { fail, warn, unknown, unverified };
}

function pickPsuForBuild({
  psus,
  build,
  ramStickCount,
  overclocked,
  gpu,
  budgetCap,
  usedBeforePsu,
  profile = 'Gaming',
  psuOffset = 0,
}) {
  if (!psus.length) return { psu: null, note: 'No PSU available in stock.' };
  const probeBuild = { ...build, 'Power Supplies': null };
  const power = calculateRigWattage(probeBuild, ramStickCount, { overclocked });
  const neededWatts = Number(power.recommendedPsuWatts || 450);
  const peakWatts = Number(power.activePeakWatts || 0);
  const maxSpend = typeof budgetCap === 'number' ? Math.max(0, budgetCap - usedBeforePsu) : Infinity;

  const profiles = psus.map((p) => {
    const prof = getPsuProfile(p);
    const tierInfo = normalizePsuTier(p);
    const watts = Number(prof.watts ?? prof.wattage ?? p.wattage ?? 0);
    const price = Number(p.price || 0);
    return {
      item: p,
      tier: tierInfo.tier,
      isUnknownTier: tierInfo.isUnknown,
      tierRank: tierInfo.isUnknown ? 0 : Number(prof.tierRank ?? 0),
      watts,
      price,
      meetsWattage: watts >= neededWatts && watts >= peakWatts,
      meetsConnectors: psuSupportsGpuConnectors(p, gpu),
      isFloor: ALLOWED_PSU_TIERS.has(tierInfo.tier),
    };
  });

  const strictPool = profiles.filter(
    (x) => x.isFloor && x.meetsWattage && x.meetsConnectors && x.price <= maxSpend
  );

  const gpuDraw = detectGpuWattage(gpu);
  const cpuDraw = Number(build.Processors?.wattage ?? build.Processors?.tdp ?? 0);
  const highDrawRig = gpuDraw >= 150 || cpuDraw >= 125;

  if (strictPool.length > 0) {
    const tierA = strictPool.filter((x) => x.tier === 'A' || x.tier === 'A+').sort((a, b) => a.price - b.price);
    const tierB = strictPool.filter((x) => x.tier === 'B').sort((a, b) => a.price - b.price);

    if (highDrawRig && tierA.length > 0) {
      return { psu: tierA[psuOffset % tierA.length].item, note: null };
    }
    if (tierB.length > 0 && tierA.length > 0) {
      if (tierA[0].price <= tierB[0].price * (1 + PSU_QUALITY_PREMIUM)) {
        return { psu: tierA[psuOffset % tierA.length].item, note: null };
      }
      return { psu: tierB[psuOffset % tierB.length].item, note: null };
    }
    const sortedAll = [...strictPool].sort((a, b) => a.price - b.price);
    return { psu: sortedAll[psuOffset % sortedAll.length].item, note: null };
  }

  const hasDiscreteGpu = Boolean(gpu);
  const canUseCheapFallback =
    (!hasDiscreteGpu && Number(budgetCap || 0) < TIGHT_BUDGET_PSU_CEILING) ||
    profile === 'Office/Productivity';

  if (!canUseCheapFallback) {
    const anyTierBPlus = profiles
      .filter((x) => x.isFloor && x.meetsWattage && x.meetsConnectors)
      .sort((a, b) => a.price - b.price);
    return {
      psu: anyTierBPlus[0]?.item || null,
      note: 'Skipped budget/unrated PSU because PSU budget cannot be skimmed on GPU or ₱25k+ builds.',
    };
  }

  const affordableWattage = profiles
    .filter((x) => x.meetsWattage && x.price <= maxSpend)
    .sort((a, b) => b.tierRank - a.tierRank || a.price - b.price);
  if (affordableWattage.length > 0) {
    const chosen = affordableWattage[0];
    return {
      psu: chosen.item,
      note: chosen.isUnknownTier
        ? 'Budget-constrained fallback: unrated PSU used only because budget is tight and no Tier B+ unit fit.'
        : !chosen.isFloor
        ? 'Budget-constrained fallback: lower-tier PSU used only because no Tier B+ unit fit within budget.'
        : null,
    };
  }

  const affordableAny = profiles
    .filter((x) => x.price <= maxSpend)
    .sort((a, b) => b.tierRank - a.tierRank || b.watts - a.watts || a.price - b.price);
  if (affordableAny.length > 0) {
    const chosen = affordableAny[0];
    return {
      psu: chosen.item,
      note: 'Tight budget fallback: selected most capable affordable PSU within budget.',
    };
  }

  return { psu: null, note: null };
}

function evaluateCandidate(build, ramStickCount, overclocked) {
  const power = calculateRigWattage(build, ramStickCount, { overclocked });
  const rules = evaluateBuildRules(build, {
    ramStickCount,
    peakWatts: power.activePeakWatts,
    recommendedPsuWatts: power.recommendedPsuWatts,
    hasEstimatedPower: Boolean(power.hasMissingSpecs || power.hasEstimatedCpuPeak),
  });
  const summary = summarizeRules(rules);
  const total = calculateBuildTotal(build, CATEGORIES, ramStickCount);
  return { power, rules, summary, total };
}

function repairBuildCandidate(initialBuild, ramStickCount, budget, overclocked, poolByCat, profile, platform, notes) {
  let build = { ...initialBuild };
  const triedBoards = new Set([initialBuild.Motherboards?.id]);
  let evalRes = evaluateCandidate(build, ramStickCount, overclocked);

  for (let step = 0; step < MAX_REPAIR_ITERATIONS; step += 1) {
    const psuRule = evalRes.rules.find((r) => r.ruleId === 'RULE-PSU-01');
    const currentPsu = build['Power Supplies'];
    const illegalCheapPsu =
      currentPsu &&
      isBudgetOrUnratedPsu(currentPsu) &&
      (Boolean(build['Video Cards']) || budget >= TIGHT_BUDGET_PSU_CEILING) &&
      profile !== 'Office/Productivity';

    const hasBoardIssue =
      !isBoardCompatibleWithCpu(build.Processors, build.Motherboards) ||
      evalRes.rules.some(
        (r) =>
          r.category === 'Motherboards' &&
          (r.status === 'fail' || r.status === 'warn' || r.unverified)
      );

    const needsRepair =
      !currentPsu ||
      illegalCheapPsu ||
      hasBoardIssue ||
      evalRes.summary.fail > 0 ||
      (psuRule && (psuRule.status === 'warn' || psuRule.status === 'fail'));

    if (!needsRepair && evalRes.total <= budget) break;

    if (hasBoardIssue) {
      const validBoards = (poolByCat.Motherboards || [])
        .filter((m) => {
          const sockOk = String(detectMotherboardSocket(m) || m.socket || '').toUpperCase() === platform.socket;
          const gen = detectBoardMemoryGen(m, platform.socket);
          return (
            sockOk &&
            (gen === platform.ddr || gen === 'UNKNOWN') &&
            isBoardCompatibleWithCpu(build.Processors, m) &&
            !triedBoards.has(m.id)
          );
        })
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

      if (validBoards.length > 0) {
        build = { ...build, Motherboards: validBoards[0] };
        triedBoards.add(validBoards[0].id);
        notes.push(`Upgraded Motherboard to ${validBoards[0].name} for native CPU compatibility.`);
        evalRes = evaluateCandidate(build, ramStickCount, overclocked);
        continue;
      }
    }

    const currentPsuId = currentPsu?.id;
    const withoutPsuTotal = calculateBuildTotal({ ...build, 'Power Supplies': null }, CATEGORIES, ramStickCount);
    const psuPick = pickPsuForBuild({
      psus: poolByCat['Power Supplies'] || [],
      build,
      ramStickCount,
      overclocked,
      gpu: build['Video Cards'],
      budgetCap: budget,
      usedBeforePsu: withoutPsuTotal,
      profile,
    });
    if (psuPick.psu && psuPick.psu.id !== currentPsuId) {
      build = { ...build, 'Power Supplies': psuPick.psu };
      notes.push(`Adjusted PSU to ${psuPick.psu.name} to satisfy quality and headroom rules.`);
      evalRes = evaluateCandidate(build, ramStickCount, overclocked);
      continue;
    }

    const gpus = [...(poolByCat['Video Cards'] || [])].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    const currentGpuPrice = Number(build['Video Cards']?.price || 0);
    const cheaperGpu = [...gpus].reverse().find((g) => Number(g.price || 0) < currentGpuPrice);
    if (cheaperGpu && (evalRes.total > budget || !build['Power Supplies'] || illegalCheapPsu || (psuRule && psuRule.status !== 'pass'))) {
      build = { ...build, 'Video Cards': cheaperGpu };
      notes.push(`Swapped GPU to ${cheaperGpu.name} to stay within budget and preserve PSU headroom.`);
      evalRes = evaluateCandidate(build, ramStickCount, overclocked);
      continue;
    }

    const failOrWarnCats = new Set(
      evalRes.rules.filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => r.category)
    );
    let swappedAccessory = false;
    for (const cat of ['Cases', 'CPU Coolers']) {
      if (!failOrWarnCats.has(cat)) continue;
      const list = [...(poolByCat[cat] || [])].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      const alt = list.find((item) => item.id !== build[cat]?.id);
      if (alt) {
        build = { ...build, [cat]: alt };
        notes.push(`Swapped ${cat} to ${alt.name} for compatibility.`);
        evalRes = evaluateCandidate(build, ramStickCount, overclocked);
        swappedAccessory = true;
        break;
      }
    }
    if (swappedAccessory) continue;

    if (evalRes.total > budget && build['Hard Drives']) {
      build = { ...build, 'Hard Drives': null };
      notes.push('Removed optional Hard Drive to stay within budget.');
      evalRes = evaluateCandidate(build, ramStickCount, overclocked);
      continue;
    }

    if (evalRes.total > budget) {
      const sameSocketCpus = (poolByCat.Processors || [])
        .filter((c) => {
          const sockOk = String(detectCpuSocket(c) || c.socket || '').toUpperCase() === platform.socket;
          const igpuOk = Boolean(build['Video Cards']) || cpuHasUsableIgpu(c);
          const cpuTierOk = budget < 30000 || meetsMinimumCpuTier(c);
          return sockOk && igpuOk && cpuTierOk && Number(c.price || 0) < Number(build.Processors?.price || 0);
        })
        .sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
      if (sameSocketCpus.length > 0) {
        build = { ...build, Processors: sameSocketCpus[0] };
        notes.push(`Adjusted CPU to ${sameSocketCpus[0].name} to stay within budget.`);
        evalRes = evaluateCandidate(build, ramStickCount, overclocked);
        continue;
      }
    }

    break;
  }

  return { build, evalRes };
}

function maximizeBuildBudget({
  build,
  evalRes,
  ramStickCount,
  budget,
  overclocked,
  poolByCat,
  profile,
  platform,
}) {
  let currentBuild = { ...build };
  let currentEval = evalRes;
  let currentRamSticks = ramStickCount;
  const caps = CATEGORY_BUDGET_CAPS[profile] || CATEGORY_BUDGET_CAPS.Balanced;

  const priorityOrder =
    profile === 'Office/Productivity'
      ? ['Processors', 'Storage', 'Memory', 'Motherboards', 'Hard Drives', 'CPU Coolers', 'Cases']
      : profile === 'Content Creation'
      ? ['Processors', 'Memory', 'Video Cards', 'Storage', 'Motherboards', 'CPU Coolers', 'Cases', 'Hard Drives']
      : profile === 'Balanced'
      ? ['Processors', 'Video Cards', 'Memory', 'Storage', 'Motherboards', 'CPU Coolers', 'Cases', 'Hard Drives']
      : ['Video Cards', 'Processors', 'Storage', 'Memory', 'Motherboards', 'CPU Coolers', 'Cases', 'Hard Drives'];

  const sortedPsus = [...(poolByCat['Power Supplies'] || [])].sort(
    (a, b) => Number(a.price || 0) - Number(b.price || 0)
  );

  for (let pass = 0; pass < 3; pass += 1) {
    let improvedThisPass = false;

    for (const cat of priorityOrder) {
      const remaining = budget - currentEval.total;
      if (remaining < 300) break;

      const currentItem = currentBuild[cat];
      if (cat === 'Video Cards' && !currentItem) continue;
      if (cat === 'Hard Drives' && !currentItem) {
        const ssdGbNow = detectCapacityGb(currentBuild.Storage);
        const wantsBulk = profile === 'Content Creation' || profile === 'Office/Productivity';
        if (ssdGbNow >= 1000 || (ssdGbNow >= 500 && !(wantsBulk && budget >= 40000))) continue;
      }

      const currentPrice = currentItem
        ? calculateBuildTotal({ [cat]: currentItem }, CATEGORIES, currentRamSticks)
        : 0;
      const categoryCap = budget * (caps[cat] ?? 0.20);

      if (cat === 'Memory' && currentItem && !isPrebundledKit(currentItem) && currentRamSticks === 2 && budget >= 35000) {
        const parsedCurrent = parseRam(currentItem, currentRamSticks);
        if (parsedCurrent.totalCapacity <= 16) {
          const fourStickPrice = calculateBuildTotal({ Memory: currentItem }, CATEGORIES, 4);
          if (fourStickPrice <= categoryCap && fourStickPrice - currentPrice <= remaining) {
            const trialEval = evaluateCandidate(currentBuild, 4, overclocked);
            if (
              trialEval.total <= budget &&
              trialEval.summary.fail <= currentEval.summary.fail &&
              trialEval.summary.warn <= currentEval.summary.warn
            ) {
              currentRamSticks = 4;
              currentEval = trialEval;
              improvedThisPass = true;
              continue;
            }
          }
        }
      }

      const candidates = (poolByCat[cat] || []).filter((item) => {
        if (!item || item.id === currentItem?.id) return false;
        const itemPrice = calculateBuildTotal({ [cat]: item }, CATEGORIES, currentRamSticks);
        if (itemPrice <= currentPrice) return false;
        if (itemPrice > categoryCap) return false;
        if (itemPrice - currentPrice > remaining) return false;

        if (cat === 'Processors') {
          const sockOk = String(detectCpuSocket(item) || item.socket || '').toUpperCase() === platform.socket;
          const igpuOk = Boolean(currentBuild['Video Cards']) || cpuHasUsableIgpu(item);
          const cpuTierOk = budget < 30000 || meetsMinimumCpuTier(item);
          const officeTierOk = profile !== 'Office/Productivity' || deriveComponentTier(item, 'Processors') <= 4;
          return sockOk && igpuOk && cpuTierOk && officeTierOk && isBoardCompatibleWithCpu(item, currentBuild.Motherboards);
        }
        if (cat === 'Video Cards' && currentBuild.Processors) {
          const cpuTier = deriveComponentTier(currentBuild.Processors, 'Processors');
          const gpuTier = deriveComponentTier(item, 'Video Cards');
          if (gpuTier - cpuTier > 2) return false;
        }
        if (cat === 'Motherboards') {
          const sockOk = String(detectMotherboardSocket(item) || item.socket || '').toUpperCase() === platform.socket;
          const gen = detectBoardMemoryGen(item, platform.socket);
          return sockOk && (gen === platform.ddr || gen === 'UNKNOWN') && isBoardCompatibleWithCpu(currentBuild.Processors, item);
        }
        if (cat === 'Memory') {
          return detectMemoryGen(item) === platform.ddr;
        }
        if (cat === 'Storage') {
          return detectCapacityGb(item) >= detectCapacityGb(currentItem);
        }
        return true;
      });

      if (!candidates.length) continue;

      candidates.sort((a, b) => {
        if (cat === 'Processors' || cat === 'Video Cards') {
          const tierDiff = deriveComponentTier(b, cat) - deriveComponentTier(a, cat);
          if (tierDiff !== 0) return tierDiff;
        }
        if (cat === 'Storage') {
          const capDiff = detectCapacityGb(b) - detectCapacityGb(a);
          if (capDiff !== 0) return capDiff;
        }
        if (cat === 'Memory') {
          const capDiff = parseRam(b, currentRamSticks).totalCapacity - parseRam(a, currentRamSticks).totalCapacity;
          if (capDiff !== 0) return capDiff;
        }
        const scoreDiff = Number(b.hardware_score || 0) - Number(a.hardware_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.price || 0) - Number(a.price || 0);
      });

      for (const upgrade of candidates) {
        let trialBuild = { ...currentBuild, [cat]: upgrade };
        let trialEval = evaluateCandidate(trialBuild, currentRamSticks, overclocked);

        if (
          (cat === 'Processors' || cat === 'Video Cards') &&
          (trialEval.summary.fail > currentEval.summary.fail || trialEval.summary.warn > currentEval.summary.warn)
        ) {
          const withoutPsuTotal = calculateBuildTotal(
            { ...trialBuild, 'Power Supplies': null },
            CATEGORIES,
            currentRamSticks
          );
          const psuPick = pickPsuForBuild({
            psus: sortedPsus,
            build: trialBuild,
            ramStickCount: currentRamSticks,
            overclocked,
            gpu: trialBuild['Video Cards'],
            budgetCap: budget,
            usedBeforePsu: withoutPsuTotal,
            profile,
          });
          if (psuPick.psu) {
            trialBuild = { ...trialBuild, 'Power Supplies': psuPick.psu };
            trialEval = evaluateCandidate(trialBuild, currentRamSticks, overclocked);
          }
        }

        if (
          trialEval.total <= budget &&
          trialEval.summary.fail <= currentEval.summary.fail &&
          trialEval.summary.warn <= currentEval.summary.warn
        ) {
          currentBuild = trialBuild;
          currentEval = trialEval;
          improvedThisPass = true;
          break;
        }
      }
    }

    if (!improvedThisPass) break;
  }

  return { build: currentBuild, evalRes: currentEval, ramStickCount: currentRamSticks };
}

function attachHddIfHelpful({ build, hdds, budget, ramStickCount, notes, reserve = 0 }) {
  if (!hdds || hdds.length === 0 || !build.Storage) return;
  const ssdGb = detectCapacityGb(build.Storage);
  if (ssdGb <= 0 || ssdGb >= 500) return;

  const sortedHdds = [...hdds].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const targetHdd = sortedHdds.find((h) => ssdGb + detectCapacityGb(h) >= 500) || sortedHdds[0];
  if (!targetHdd) return;

  const hddPrice = Number(targetHdd.price || 0);
  const currentTotal = calculateBuildTotal(build, CATEGORIES, ramStickCount);
  if (currentTotal + hddPrice + reserve <= budget) {
    build['Hard Drives'] = targetHdd;
    notes.push(`Paired ${build.Storage.name} with ${targetHdd.name} for 500GB+ storage.`);
  }
}

function buildPlatformCandidates({
  platform,
  budget,
  profile,
  overclocked,
  poolByCat,
  hasAnyIgpuInCatalog,
  forceNoGpu = false,
}) {
  const isGaming = profile === 'Gaming';
  const isCreator = profile === 'Content Creation';
  const isOffice = profile === 'Office/Productivity';
  const isBalanced = profile === 'Balanced';

  const cpus = (poolByCat.Processors || []).filter((c) => {
    const socketOk = String(detectCpuSocket(c) || c.socket || '').toUpperCase() === platform.socket;
    const cpuTierOk = budget < 30000 || meetsMinimumCpuTier(c);
    return socketOk && cpuTierOk;
  });
  const allBoards = (poolByCat.Motherboards || [])
    .filter((m) => {
      const sockOk = String(detectMotherboardSocket(m) || m.socket || '').toUpperCase() === platform.socket;
      const gen = detectBoardMemoryGen(m, platform.socket);
      return sockOk && (gen === platform.ddr || gen === 'UNKNOWN');
    })
    .sort((a, b) => {
      const aKnown = detectBoardMemoryGen(a, platform.socket) === platform.ddr ? 0 : 1;
      const bKnown = detectBoardMemoryGen(b, platform.socket) === platform.ddr ? 0 : 1;
      return aKnown - bKnown || Number(a.price || 0) - Number(b.price || 0);
    });

  const rams = (poolByCat.Memory || []).filter((r) => detectMemoryGen(r) === platform.ddr);
  const gpus = poolByCat['Video Cards'] || [];
  const ssds = poolByCat.Storage || [];
  const hdds = poolByCat['Hard Drives'] || [];
  const coolers = poolByCat['CPU Coolers'] || [];
  const cases = poolByCat.Cases || [];
  const psus = poolByCat['Power Supplies'] || [];

  if (!cpus.length || !allBoards.length || !rams.length || !ssds.length || !coolers.length || !cases.length || !psus.length) {
    return [];
  }

  const sortedCpus = [...cpus].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const igpuCpus = sortedCpus.filter(cpuHasUsableIgpu);
  const sortedGpus = [...gpus].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const ramEffectivePrice = (r) => calculateBuildTotal({ Memory: r }, CATEGORIES, 2) || Number(r.price || 0);
  const sortedRams = [...rams].sort((a, b) => ramEffectivePrice(a) - ramEffectivePrice(b));
  const sortedSsds = [...ssds].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const sortedCoolers = [...coolers].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const sortedCases = [...cases].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const sortedPsus = [...psus].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

  const allowGpu = !isOffice || budget >= 55000;
  const lowBudget = budget < TIGHT_BUDGET_PSU_CEILING;
  const needsDedicatedGpu = allowGpu && !forceNoGpu && !(lowBudget && igpuCpus[0] && Number(igpuCpus[0].price || 0) <= budget * 0.35);

  if (!needsDedicatedGpu && igpuCpus.length === 0 && hasAnyIgpuInCatalog) {
    return [];
  }

  const weights = WORKLOAD_WEIGHTS?.[profile] || WORKLOAD_WEIGHTS?.Gaming || {};
  const cpuShare = Number(weights.Processors ?? (isCreator ? 27 : isOffice ? 25 : 21)) / 100;
  const gpuShare = Number(weights['Video Cards'] ?? (isGaming ? 36 : isOffice ? 10 : 29)) / 100;

  const tierBPlusPsus = sortedPsus.filter((p) => !isBudgetOrUnratedPsu(p));
  const reservePsu =
    (!needsDedicatedGpu && budget < TIGHT_BUDGET_PSU_CEILING) || isOffice
      ? sortedPsus[0]
      : tierBPlusPsus[0] || sortedPsus[0];

  let baseCpuPool = !needsDedicatedGpu ? (igpuCpus.length > 0 ? igpuCpus : sortedCpus) : sortedCpus;
  if ((isCreator || isBalanced) && budget >= 35000) {
    const nonEntryCpus = baseCpuPool.filter((c) => !isEntryTierCpu(c));
    if (nonEntryCpus.length > 0) {
      baseCpuPool = nonEntryCpus;
    }
  }

  const cpuCapRatio = isOffice ? 0.24 : isCreator ? 0.52 : isBalanced ? 0.45 : needsDedicatedGpu ? 0.45 : 0.55;
  if (isOffice) {
    const officeCpus = baseCpuPool.filter((c) => deriveComponentTier(c, 'Processors') <= 4);
    if (officeCpus.length > 0) baseCpuPool = officeCpus;
  }
  const eligibleCpus = baseCpuPool.filter((c) => Number(c.price || 0) <= budget * cpuCapRatio);
  let cpuChoices = eligibleCpus.length > 0 ? eligibleCpus : [baseCpuPool[0] || sortedCpus[0]];
  // With a dedicated GPU the CPU's built-in graphics are wasted: drop an APU when a non-APU of equal/better tier costs at most 35% more.
  if (needsDedicatedGpu && !isOffice) {
    const nonApu = cpuChoices.filter((c) => !cpuHasUsableIgpu(c));
    if (nonApu.length > 0) {
      cpuChoices = cpuChoices.filter(
        (c) =>
          !cpuHasUsableIgpu(c) ||
          !nonApu.some(
            (n) =>
              deriveComponentTier(n, 'Processors') >= deriveComponentTier(c, 'Processors') &&
              Number(n.price || 0) <= Number(c.price || 0) * 1.35
          )
      );
    }
  }

  const gpuChoices = needsDedicatedGpu && sortedGpus.length > 0
    ? sortedGpus.filter((g) => Number(g.price || 0) <= budget * (isOffice ? 0.2 : 0.55))
    : [null];
  if (needsDedicatedGpu && gpuChoices.length === 0 && sortedGpus.length > 0) {
    gpuChoices.push(sortedGpus[0]);
  }

  const results = [];
  const seenKeys = new Set();

  for (let cIdx = 0; cIdx < cpuChoices.length; cIdx += 1) {
    const cpu = cpuChoices[cIdx];
    const compatBoards = allBoards.filter((b) => isBoardCompatibleWithCpu(cpu, b));
    const boardPool = compatBoards.length > 0 ? compatBoards : allBoards;
    const minChipsetRank = budget >= 30000 ? 2 : 1;
    const rankedBoards = boardPool.filter((b) => boardChipsetRank(b) >= minChipsetRank);
    const boardShare = isCreator ? 0.11 : isOffice ? 0.08 : isBalanced ? 0.10 : 0.09;
    const boardChoices = closestByPrice(rankedBoards.length > 0 ? rankedBoards : boardPool, budget * boardShare).slice(0, 2);

    for (let gIdx = 0; gIdx < gpuChoices.length; gIdx += 1) {
      const gpu = gpuChoices[gIdx];
      const board = boardChoices[(cIdx + gIdx) % boardChoices.length];
      const highDrawCpu = /\b(?:RYZEN\s*[79]|I[79]|ULTRA\s*[79])\b/i.test(String(cpu?.name || '')) || deriveComponentTier(cpu, 'Processors') >= 4;
      const caseChoices = closestByPrice(sortedCases, budget * (isCreator ? 0.03 : 0.05));
      const coolerChoices = closestByPrice(sortedCoolers, budget * (highDrawCpu && !isOffice ? 0.05 : 0.03));
      const pcCase = caseChoices[(cIdx + gIdx) % Math.min(2, caseChoices.length)];
      const cooler = coolerChoices[(cIdx + gIdx) % Math.min(2, coolerChoices.length)];

      const gpuTier = gpu ? deriveComponentTier(gpu, 'Video Cards') : 0;
      const want32Gb = isCreator
        ? budget >= 35000
        : isOffice
        ? budget >= 90000
        : budget >= 65000 && (!isGaming || gpuTier >= 3);
      const ramCap = budget * (isCreator ? 0.26 : 0.2);
      const ramPrice = (r) => calculateBuildTotal({ Memory: r }, CATEGORIES, 2);
      const ramTotalGb = (r) => parseRam(r, 2).totalCapacity;
      const chosenRam =
        (want32Gb && sortedRams.find((r) => ramTotalGb(r) >= 32 && ramPrice(r) <= ramCap)) ||
        sortedRams.find((r) => ramTotalGb(r) === 16) ||
        sortedRams.find((r) => ramTotalGb(r) >= 16) ||
        sortedRams[0];
      const parsedChosenRam = parseRam(chosenRam, 2);
      const ramStickCount = parsedChosenRam.isKit ? Math.max(2, parsedChosenRam.stickCount || 2) : 2;

      const ssdChoices = sortedSsds.filter((s) => detectCapacityGb(s) >= 240);
      const preferred500Ssd = ssdChoices.find(
        (s) => detectCapacityGb(s) >= 500 && Number(s.price || 0) <= budget * 0.24
      );
      const fallback240Ssd = ssdChoices[0] || sortedSsds[0];

      const baseCostWithoutSsd =
        Number(cpu?.price || 0) +
        Number(board?.price || 0) +
        Number(gpu?.price || 0) +
        Number(cooler?.price || 0) +
        Number(pcCase?.price || 0) +
        Number(reservePsu?.price || 0) +
        calculateBuildTotal({ Memory: chosenRam }, CATEGORIES, ramStickCount);

      const preferred1TbSsd =
        (isCreator || isOffice) && budget >= 40000
          ? ssdChoices.find((s2) => detectCapacityGb(s2) >= 1000 && Number(s2.price || 0) <= budget * 0.14)
          : null;
      const chosenSsd =
        preferred1TbSsd && baseCostWithoutSsd + Number(preferred1TbSsd.price || 0) <= budget
          ? preferred1TbSsd
          : preferred500Ssd && baseCostWithoutSsd + Number(preferred500Ssd.price || 0) <= budget
          ? preferred500Ssd
          : fallback240Ssd;

      const notes = [];
      const draft = {
        Processors: cpu,
        Motherboards: board,
        Memory: chosenRam,
        'Video Cards': gpu,
        Storage: chosenSsd,
        'Hard Drives': null,
        'CPU Coolers': cooler,
        Cases: pcCase,
        'Power Supplies': null,
      };

      attachHddIfHelpful({
        build: draft,
        hdds,
        budget,
        ramStickCount,
        notes,
        reserve: Number(reservePsu?.price || 0),
      });

      const usedBeforePsu = calculateBuildTotal(draft, CATEGORIES, ramStickCount);
      if (usedBeforePsu + Number(reservePsu?.price || 0) > budget * 1.08) {
        continue;
      }

      const psuPick = pickPsuForBuild({
        psus: sortedPsus,
        build: draft,
        ramStickCount,
        overclocked,
        gpu,
        budgetCap: budget,
        usedBeforePsu,
        profile,
        psuOffset: cIdx + gIdx,
      });
      if (psuPick.note) notes.push(psuPick.note);
      draft['Power Supplies'] = psuPick.psu || reservePsu;

      const repaired = repairBuildCandidate(
        draft,
        ramStickCount,
        budget,
        overclocked,
        poolByCat,
        profile,
        platform,
        notes
      );

      if (repaired.evalRes.total > budget) continue;

      const maximized = maximizeBuildBudget({
        build: repaired.build,
        evalRes: repaired.evalRes,
        ramStickCount,
        budget,
        overclocked,
        poolByCat,
        profile,
        platform,
      });

      const finalBuild = maximized.build;
      const finalRamCount = maximized.ramStickCount;

      const sig = [
        finalBuild.Processors?.id || 'none',
        finalBuild.Motherboards?.id || 'none',
        finalBuild['Video Cards']?.id || 'none',
        finalBuild.Storage?.id || 'none',
        finalBuild.Cases?.id || 'none',
      ].join('|');
      if (seenKeys.has(sig)) continue;
      seenKeys.add(sig);

      const finalCpuTier = deriveComponentTier(finalBuild.Processors, 'Processors');
      const finalGpuTier = finalBuild['Video Cards']
        ? deriveComponentTier(finalBuild['Video Cards'], 'Video Cards')
        : 0;
      const finalRamGb = parseRam(finalBuild.Memory, finalRamCount).totalCapacity || 0;
      const finalSsdGb = detectCapacityGb(finalBuild.Storage);

      const igpuBonus = !finalBuild['Video Cards'] && cpuHasUsableIgpu(finalBuild.Processors) ? 18 : 0;
      const budgetUtilization = (Number(maximized.evalRes.total) / Math.max(1, budget)) * 100;

      // Profile-specific scoring: each profile rewards different tiers and penalises mismatches
      const tierGap = Math.abs(finalGpuTier - finalCpuTier);
      let profileTierScore;
      if (isCreator) {
        profileTierScore =
          finalCpuTier * 36 +
          (finalRamGb >= 32 ? 22 : finalRamGb >= 16 ? 8 : 0) +
          finalGpuTier * 14 +
          (finalSsdGb >= 1000 ? 12 : finalSsdGb >= 500 ? 6 : 0) -
          (finalGpuTier > finalCpuTier + 1 ? 20 : 0);
      } else if (isOffice) {
        profileTierScore =
          finalCpuTier * 20 +
          (finalSsdGb >= 1000 ? 18 : finalSsdGb >= 500 ? 10 : 0) +
          (finalRamGb >= 32 ? 8 : finalRamGb >= 16 ? 8 : 0) +
          igpuBonus -
          (finalGpuTier > 2 ? (finalGpuTier - 2) * 20 : 0) -
          (finalCpuTier > 3 ? (finalCpuTier - 3) * 20 : 0);
      } else if (isBalanced) {
        profileTierScore =
          finalCpuTier * 24 +
          finalGpuTier * 22 +
          (finalRamGb >= 32 ? 14 : finalRamGb >= 16 ? 8 : 0) +
          (finalSsdGb >= 1000 ? 12 : finalSsdGb >= 500 ? 6 : 0) -
          Math.max(0, tierGap - 1) * 15;
      } else {
        const bottleneckPenalty =
          (isEntryTierCpu(finalBuild.Processors) && finalGpuTier >= 2 ? 25 : 0) +
          (finalCpuTier >= finalGpuTier + 2 ? 15 : 0);
        profileTierScore =
          finalGpuTier * 34 +
          finalCpuTier * 18 +
          (finalRamGb >= 32 ? 12 : finalRamGb >= 16 ? 6 : 0) +
          (finalSsdGb >= 1000 ? 10 : finalSsdGb >= 500 ? 5 : 0) -
          bottleneckPenalty;
      }

      const fit = spendFitScore(finalBuild, finalRamCount, budget, profile);
      const warnPenalty = maximized.evalRes.summary.warn * 12;
      const apuWaste =
        finalBuild['Video Cards'] && cpuHasUsableIgpu(finalBuild.Processors) && !isOffice ? 15 : 0;
      const weightSum =
        fit * 0.9 +
        profileTierScore +
        Math.min(budgetUtilization, 97) * 0.3 +
        Number(finalBuild.Processors?.hardware_score || 0) * cpuShare +
        Number(finalBuild['Video Cards']?.hardware_score || 0) * gpuShare -
        warnPenalty -
        apuWaste;

      results.push({
        platform: platform.key,
        vendor: platform.vendor,
        build: finalBuild,
        ramStickCount: finalRamCount,
        evalRes: maximized.evalRes,
        ruleSummary: maximized.evalRes.summary,
        notes,
        score: weightSum,
      });
    }
  }

  return results;
}

function computeCheapestCompleteBuildPrice(
  poolByCat,
  overclocked = false,
  allowedPlatforms = PLATFORM_SPECS,
  requireMidTierCpu = false
) {
  let minCost = Infinity;
  for (const plat of allowedPlatforms) {
    const cpus = (poolByCat.Processors || []).filter((c) => {
      const socketOk = String(detectCpuSocket(c) || c.socket || '').toUpperCase() === plat.socket;
      return socketOk && (!requireMidTierCpu || meetsMinimumCpuTier(c));
    });
    const boards = (poolByCat.Motherboards || []).filter((m) => {
      const sockOk = String(detectMotherboardSocket(m) || m.socket || '').toUpperCase() === plat.socket;
      const gen = detectBoardMemoryGen(m, plat.socket);
      return sockOk && (gen === plat.ddr || gen === 'UNKNOWN');
    });
    const rams = (poolByCat.Memory || []).filter((r) => detectMemoryGen(r) === plat.ddr);
    const ssds = poolByCat.Storage || [];
    const coolers = poolByCat['CPU Coolers'] || [];
    const cases = poolByCat.Cases || [];
    const psus = poolByCat['Power Supplies'] || [];

    if (!cpus.length || !boards.length || !rams.length || !ssds.length || !coolers.length || !cases.length || !psus.length) {
      continue;
    }

    const sortedCpus = [...cpus].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    const cpu = sortedCpus.find(cpuHasUsableIgpu) || sortedCpus[0];
    const compatBoards = boards.filter((b) => isBoardCompatibleWithCpu(cpu, b));
    const board = [...(compatBoards.length > 0 ? compatBoards : boards)].sort(
      (a, b) => Number(a.price || 0) - Number(b.price || 0)
    )[0];
    const ram = [...rams].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
    const stickCount = 2;
    const ssd = [...ssds].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
    const cooler = [...coolers].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
    const pcCase = [...cases].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];

    const partial = {
      Processors: cpu,
      Motherboards: board,
      Memory: ram,
      'Video Cards': null,
      Storage: ssd,
      'Hard Drives': null,
      'Power Supplies': null,
      'CPU Coolers': cooler,
      Cases: pcCase,
    };
    const power = calculateRigWattage(partial, stickCount, { overclocked });
    const needed = Number(power.recommendedPsuWatts || 450);
    const sortedPsus = [...psus].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    const psu =
      sortedPsus.find((p) => {
        const prof = getPsuProfile(p);
        const tierInfo = normalizePsuTier(p);
        const w = Number(prof.watts ?? prof.wattage ?? p.wattage ?? 0);
        return ALLOWED_PSU_TIERS.has(tierInfo.tier) && w >= needed;
      }) ||
      sortedPsus.find((p) => Number(getPsuProfile(p).watts ?? getPsuProfile(p).wattage ?? 0) >= needed) ||
      sortedPsus[0];

    const full = { ...partial, 'Power Supplies': psu };
    const cost = calculateBuildTotal(full, CATEGORIES, stickCount);
    if (cost < minCost) minCost = cost;
  }
  return Number.isFinite(minCost) ? minCost : 0;
}

export function runSmartBuildAssistant({
  products = [],
  budgetInput = 40000,
  profile = 'Gaming',
  platformPreference = 'auto',
  variationIndex = 0,
  overclockEnabled = false,
} = {}) {
  const budget = Number(budgetInput);
  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      ok: false,
      withinBudget: false,
      reason: 'Please enter a valid positive budget greater than PHP 0.',
      build: CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat]: null }), {}),
      ramStickCount: 2,
      ruleSummary: { fail: 0, warn: 0, unknown: 0 },
      notes: [],
      statusMessage: '',
    };
  }

  const profileKey = normalizeProfileKey(profile);
  const pref = normalizePlatformPreference(platformPreference);
  const matchingPlatforms =
    pref === 'auto'
      ? PLATFORM_SPECS
      : PLATFORM_SPECS.filter((p) => p.vendor === pref);
  const platformsToTry = matchingPlatforms.length > 0 ? matchingPlatforms : PLATFORM_SPECS;

  const available = (Array.isArray(products) ? products : []).filter(isAvailableInStock);
  const poolByCat = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = available.filter((p) => norm(p.category) === norm(cat));
    return acc;
  }, {});
  const hasAnyIgpuInCatalog = (poolByCat.Processors || []).some(cpuHasUsableIgpu);

  const runCandidates = (forceNoGpu) =>
    platformsToTry.flatMap((platform) =>
      buildPlatformCandidates({
        platform,
        budget,
        profile: profileKey,
        overclocked: Boolean(overclockEnabled),
        poolByCat,
        hasAnyIgpuInCatalog,
        forceNoGpu,
      })
    );

  let candidates = runCandidates(false);
  let usedIgpuFallback = false;
  if (!candidates.some((c) => c.evalRes.total <= budget) && hasAnyIgpuInCatalog) {
    // Budget too tight for a dedicated GPU: retry around a CPU with integrated graphics instead of giving up.
    const igpuCandidates = runCandidates(true);
    if (igpuCandidates.some((c) => c.evalRes.total <= budget)) {
      candidates = igpuCandidates;
      usedIgpuFallback = true;
    }
  }

  const withinBudget = candidates.filter((c) => c.evalRes.total <= budget);
  const pool = withinBudget.length > 0 ? withinBudget : candidates;
  const minComplete = computeCheapestCompleteBuildPrice(
    poolByCat,
    Boolean(overclockEnabled),
    platformsToTry,
    budget >= 30000
  );
  const minFormatted = Number(minComplete).toLocaleString();

  if (pool.length > 0) {
    pool.sort((a, b) => {
      // Failures are a hard tier; warnings are already a penalty inside the profile score.
      if (a.ruleSummary.fail !== b.ruleSummary.fail) return a.ruleSummary.fail - b.ruleSummary.fail;
      if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
      return b.evalRes.total - a.evalRes.total;
    });

    const bestTierFail = pool[0].ruleSummary.fail;
    const topScore = pool[0].score;
    const topTotal = pool[0].evalRes.total;

    const cleanTopPool = pool.filter(
      (c) =>
        c.ruleSummary.fail === bestTierFail &&
        c.score >= topScore * 0.94 &&
        c.evalRes.total >= topTotal * 0.88
    );
    const rotationPool = cleanTopPool.length > 0 ? cleanTopPool : pool.slice(0, 5);
    const varStep = Math.max(0, Number(variationIndex) || 0);
    const best = rotationPool[varStep % rotationPool.length] || pool[0];

    const essentialMissing = CATEGORIES.filter(
      (cat) => cat !== 'Hard Drives' && cat !== 'Video Cards' && !best.build[cat]
    );
    const totalFormatted = Number(best.evalRes.total || 0).toLocaleString();
    const budgetFormatted = Number(budget).toLocaleString();

    const isBelowRealMinimum =
      essentialMissing.length > 0 || (minComplete > 0 && budget < minComplete);

    const failNote =
      best.ruleSummary.fail > 0
        ? ' Note: No zero-fail combination was available within this budget.'
        : '';

    const rawNotes = Array.isArray(best.notes) ? best.notes : [];
    const friendlyNotes = [];
    if (usedIgpuFallback) {
      friendlyNotes.push('Budget is too tight for a dedicated graphics card, so this build uses a CPU with integrated graphics. Add a GPU later when budget allows.');
    }
    if (rawNotes.some((n) => /500gb\+ storage/i.test(String(n)))) {
      friendlyNotes.push('Added extra storage for 500GB+ total.');
    }
    if (rawNotes.some((n) => /skipped budget\/unrated psu|adjusted psu/i.test(String(n)))) {
      friendlyNotes.push('Equipped with a reliable power supply.');
    }
    if (rawNotes.some((n) => /swapped gpu|adjusted cpu/i.test(String(n)))) {
      friendlyNotes.push('Balanced parts to fit your budget.');
    }

    const statusMessage = isBelowRealMinimum
      ? `Budget is below the minimum for a full build from current stock (starts at ₱${minFormatted}). Showing closest compatible parts.`
      : `Built a ${profileKey} PC for ₱${totalFormatted} within your ₱${budgetFormatted} budget (${best.platform}).${failNote}`;

    return {
      ok: true,
      withinBudget: best.evalRes.total <= budget,
      totalPrice: best.evalRes.total,
      platform: best.platform,
      build: best.build,
      ramStickCount: best.ramStickCount,
      unfilledCategories: essentialMissing,
      ruleSummary: best.ruleSummary,
      notes: friendlyNotes,
      statusMessage,
    };
  }

  const allowedSockets = new Set(platformsToTry.map((p) => p.socket));
  const partialBuild = CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat]: null }), {});
  let running = 0;
  for (const cat of CATEGORIES) {
    let list = poolByCat[cat] || [];
    if (cat === 'Processors') {
      list = list.filter((c) => {
        const socketOk = allowedSockets.has(String(detectCpuSocket(c) || c.socket || '').toUpperCase());
        const cpuTierOk = budget < 30000 || meetsMinimumCpuTier(c);
        return socketOk && cpuTierOk;
      });
      if (hasAnyIgpuInCatalog && list.some(cpuHasUsableIgpu)) {
        list = list.filter(cpuHasUsableIgpu);
      }
    } else if (cat === 'Motherboards') {
      list = list.filter((m) => allowedSockets.has(String(detectMotherboardSocket(m) || m.socket || '').toUpperCase()));
    }
    const cheapest = [...list].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
    if (cheapest && running + Number(cheapest.price || 0) <= budget) {
      partialBuild[cat] = cheapest;
      running += Number(cheapest.price || 0);
    }
  }
  const unfilledCategories = CATEGORIES.filter(
    (cat) => cat !== 'Hard Drives' && cat !== 'Video Cards' && !partialBuild[cat]
  );

  const hasQualifyingCpu = (poolByCat.Processors || []).some((cpu) => {
    const socketOk = allowedSockets.has(String(detectCpuSocket(cpu) || cpu.socket || '').toUpperCase());
    return socketOk && (budget < 30000 || meetsMinimumCpuTier(cpu));
  });

  const fallbackStatus = budget >= 30000 && !hasQualifyingCpu
    ? 'No Intel Core i5 or AMD Ryzen 5 (or higher) processor is available in the current compatible stock. The Auto Builder did not substitute an entry-level CPU.'
    : `Budget is below the minimum for a full build from current stock${minComplete > 0 ? ` (starts at ₱${minFormatted})` : ''}. Showing closest compatible parts.`;

  return {
    ok: true,
    withinBudget: running <= budget,
    totalPrice: running,
    platform: null,
    build: partialBuild,
    ramStickCount: 1,
    unfilledCategories,
    ruleSummary: summarizeRules(evaluateBuildRules(partialBuild, { ramStickCount: 1 })),
    notes: [],
    statusMessage: fallbackStatus,
  };
}