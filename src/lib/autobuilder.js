import { CATEGORIES, WORKLOAD_WEIGHTS } from './config.js';
import { calculateBuildTotal, getEffectiveItemPrice } from './pricing.js';
import { calculateRigWattage, getPsuProfile } from './power.js';
import { deriveComponentTier } from './scoring.js';
import { detectCpuSocket, detectMotherboardSocket } from './compat.js';

const TRIM_PRIORITY = [
  'Video Cards',
  'Processors',
  'Storage',
  'Memory',
  'Motherboards',
  'Cases',
  'CPU Coolers',
  'Power Supplies',
];

const AVOID_PSU_PATTERN =
  /\b(INPLAY|YGT|RAKK|OVATION|KEYTECH|BOSSTON|FORTRESS|INTELLIGENT|GENERIC|NEUTRON|CVS|KOREAN|TRUE\s*RATED)\b/i;

function isGenericOrAvoidPsu(part) {
  if (!part) return false;
  const combined = `${part.brand || ''} ${part.name || ''} ${part.specs || ''}`;
  const prof = getPsuProfile(part);
  if (prof.tierRank <= 2) return true;
  return AVOID_PSU_PATTERN.test(combined);
}

function detectMemoryType(part) {
  if (!part) return '';
  if (part.memory_type) return String(part.memory_type).trim().toUpperCase();
  const combined = `${part.name || ''} ${part.specs || ''}`.toUpperCase();
  if (combined.includes('DDR5')) return 'DDR5';
  if (combined.includes('DDR4')) return 'DDR4';
  const sock = detectMotherboardSocket(part);
  if (sock === 'AM5') return 'DDR5';
  if (sock === 'AM4') return 'DDR4';
  return '';
}

function parseStorageProfile(part) {
  if (!part) return { capacityGB: 0, isHdd: false, isNvme: false };
  const combined = `${part.name || ''} ${part.capacity || ''} ${part.storage_interface || ''} ${part.interface_type || ''} ${part.specs || ''}`.toUpperCase();

  let capacityGB =
    part.capacity_gb !== undefined && part.capacity_gb !== null && part.capacity_gb !== ''
      ? Number(part.capacity_gb)
      : 0;

  if (!capacityGB) {
    const tbMatch = combined.match(/(\d+(?:\.\d+)?)\s*TB/);
    const gbMatch = combined.match(/(\d+)\s*GB/);
    if (tbMatch) capacityGB = Math.round(Number(tbMatch[1]) * 1000);
    else if (gbMatch) capacityGB = Number(gbMatch[1]);
  }

  const isNvme = combined.includes('NVME') || combined.includes('M.2');
  const isHdd =
    !isNvme &&
    !combined.includes('SSD') &&
    (combined.includes('HDD') || combined.includes('HARD DRIVE') || combined.includes('RPM'));

  return { capacityGB, isHdd, isNvme };
}

export function runSmartBuildAssistant({
  products = [],
  budgetInput = 35000,
  profile = 'Gaming',
  overclockEnabled = false,
  previousBuild = {},
}) {
  const budget = Math.max(Number(budgetInput) || 20000, 15000);
  const inStock = (products || []).filter(
    (p) => p && p.stock_status !== 'Sold Out' && Number(p.price || 0) > 0
  );

  if (inStock.length === 0) {
    return {
      ok: false,
      reason: 'Catalog is still loading. Try again in a moment.',
      build: previousBuild,
      ramStickCount: 2,
      totalPrice: 0,
      budget,
    };
  }

  const targetSticks = 2;
  const itemCost = (category, item) => getEffectiveItemPrice(category, item, targetSticks);

  const byCat = (cat) =>
    inStock
      .filter((p) => String(p.category || '').toLowerCase() === cat.toLowerCase())
      .sort((a, b) => itemCost(cat, a) - itemCost(cat, b));

  const cpus = byCat('Processors');
  const boards = byCat('Motherboards');
  const gpus = byCat('Video Cards');
  const rams = byCat('Memory');
  const storages = byCat('Storage');
  const psus = byCat('Power Supplies');
  const coolers = byCat('CPU Coolers');
  const cases = byCat('Cases');

  const isOfficeApu = profile === 'Office/Productivity' && budget <= 28000;
  const rawWeights = WORKLOAD_WEIGHTS[profile] || WORKLOAD_WEIGHTS.Balanced;
  const weights = {
    cpu: (rawWeights.Processors ?? 24) / 100,
    gpu: isOfficeApu ? 0 : (rawWeights['Video Cards'] ?? 31) / 100,
    board: (rawWeights.Motherboards ?? 13) / 100,
    ram: (rawWeights.Memory ?? 9) / 100,
    storage: (rawWeights.Storage ?? 11) / 100,
    psu: Math.max((rawWeights['Power Supplies'] ?? 8) / 100, 0.08),
    cooler: (rawWeights['CPU Coolers'] ?? 3) / 100,
    case: (rawWeights.Cases ?? 3) / 100,
  };

  const pickBestWithinCap = (category, list, cap) => {
    if (!list || list.length === 0) return null;
    const affordable = list.filter((item) => itemCost(category, item) <= cap);
    const pool = affordable.length > 0 ? affordable : [list[0]];
    const ranked = [...pool].sort(
      (a, b) =>
        itemCost(category, b) - itemCost(category, a) ||
        Number(b.hardware_score || 0) - Number(a.hardware_score || 0)
    );
    return ranked[0] || null;
  };

  const apuPool = cpus.filter(
    (c) => /\b\d{4}G\b/i.test(`${c.name || ''} ${c.specs || ''}`) || c.has_igpu === true
  );
  const chosenCpu =
    isOfficeApu && apuPool.length > 0
      ? pickBestWithinCap('Processors', apuPool, budget * weights.cpu)
      : pickBestWithinCap('Processors', cpus, budget * weights.cpu);

  const targetSocket = detectCpuSocket(chosenCpu) || 'AM4';
  const compatibleBoards = boards.filter((b) => detectMotherboardSocket(b) === targetSocket);
  const boardPool = compatibleBoards.length > 0 ? compatibleBoards : boards;
  const chosenBoard = pickBestWithinCap('Motherboards', boardPool, budget * weights.board);

  const boardMemType =
    detectMemoryType(chosenBoard) || (targetSocket === 'AM5' ? 'DDR5' : 'DDR4');
  const compatibleRams = rams.filter((r) => detectMemoryType(r) === boardMemType);
  const ramPool = compatibleRams.length > 0 ? compatibleRams : rams;
  const chosenRam = pickBestWithinCap('Memory', ramPool, budget * weights.ram);

  const chosenGpu = isOfficeApu ? null : pickBestWithinCap('Video Cards', gpus, budget * weights.gpu);

  const fullSizeSsdPool = storages.filter((s) => {
    const sp = parseStorageProfile(s);
    return sp && !sp.isHdd && Number(sp.capacityGB || 0) >= 500;
  });
  const storagePool = fullSizeSsdPool.length > 0 ? fullSizeSsdPool : storages;
  const chosenStorage = pickBestWithinCap('Storage', storagePool, budget * weights.storage);
  const chosenCooler = pickBestWithinCap('CPU Coolers', coolers, budget * weights.cooler);
  const chosenCase = pickBestWithinCap('Cases', cases, budget * weights.case);

  const otherPartsCost = (b, excludeCat) =>
    CATEGORIES.reduce((sum, cat) => (cat === excludeCat ? sum : sum + itemCost(cat, b[cat])), 0);

  const getPsuRequirements = (partsObj) => {
    const powerSummary = calculateRigWattage(partsObj, targetSticks, overclockEnabled);
    const minSafeWatts = powerSummary.recommendedPsuWatts;
    const cpuTier = deriveComponentTier(partsObj.Processors, 'Processors') || 2;
    const gpuTier = deriveComponentTier(partsObj['Video Cards'], 'Video Cards') || 2;
    const hasDiscreteGpu = Boolean(partsObj['Video Cards']);
    const isHeavyRig =
      gpuTier >= 4 || cpuTier >= 4 || minSafeWatts >= 550 || budget >= 50000;
    const minRank = isHeavyRig ? 4 : hasDiscreteGpu || budget >= 30000 ? 3 : 2;
    return { minSafeWatts, minRank, hasDiscreteGpu, isHeavyRig };
  };

  const getMinimumSafePsu = (
    cpuPart,
    gpuPart,
    boardPart,
    ramPart,
    storagePart,
    coolerPart,
    casePart,
    maxPsuBudget = Infinity
  ) => {
    if (!psus.length) return null;
    const { minSafeWatts, minRank, hasDiscreteGpu } = getPsuRequirements({
      Processors: cpuPart,
      'Video Cards': gpuPart,
      Motherboards: boardPart,
      Memory: ramPart,
      Storage: storagePart,
      'CPU Coolers': coolerPart,
      Cases: casePart,
    });

    const targetPsuBudget = Math.min(
      maxPsuBudget,
      Math.max(budget * weights.psu, hasDiscreteGpu ? 2600 : 1800)
    );

    const withinBudget = psus.filter((p) => itemCost('Power Supplies', p) <= maxPsuBudget);
    const candidatePool = withinBudget.length > 0 ? withinBudget : psus;

    const reliablePool = candidatePool.filter((p) => !isGenericOrAvoidPsu(p));
    const activePool = reliablePool.length > 0 ? reliablePool : candidatePool;

    const rankPsus = (list) =>
      [...list].sort((a, b) => {
        const profA = getPsuProfile(a);
        const profB = getPsuProfile(b);
        if (profB.tierRank !== profA.tierRank) return profB.tierRank - profA.tierRank;
        const scoreDiff = Number(b.hardware_score || 0) - Number(a.hardware_score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return itemCost('Power Supplies', a) - itemCost('Power Supplies', b);
      });

    const qualified = activePool.filter((p) => {
      const prof = getPsuProfile(p);
      return (prof.watts || 0) >= minSafeWatts && prof.tierRank >= minRank;
    });

    if (qualified.length > 0) {
      const withinTarget = qualified.filter(
        (p) => itemCost('Power Supplies', p) <= targetPsuBudget
      );
      return rankPsus(withinTarget.length > 0 ? withinTarget : qualified)[0];
    }

    const wattSafe = activePool.filter((p) => (getPsuProfile(p).watts || 0) >= minSafeWatts);
    if (wattSafe.length > 0) {
      return rankPsus(wattSafe)[0];
    }

    return rankPsus(activePool)[0] || candidatePool[0] || null;
  };

  const buildObj = {
    Processors: chosenCpu || null,
    Motherboards: chosenBoard || null,
    'Video Cards': chosenGpu || null,
    Memory: chosenRam || null,
    Storage: chosenStorage || null,
    'Power Supplies': null,
    'CPU Coolers': chosenCooler || null,
    Cases: chosenCase || null,
  };

  const remainingForPsu = Math.max(0, budget - otherPartsCost(buildObj, 'Power Supplies'));
  buildObj['Power Supplies'] = getMinimumSafePsu(
    buildObj.Processors,
    buildObj['Video Cards'],
    buildObj.Motherboards,
    buildObj.Memory,
    buildObj.Storage,
    buildObj['CPU Coolers'],
    buildObj.Cases,
    remainingForPsu
  );

  const poolByCategory = {
    Processors: cpus,
    Motherboards: boardPool,
    'Video Cards': gpus,
    Memory: ramPool,
    Storage: storagePool,
    'Power Supplies': psus,
    'CPU Coolers': coolers,
    Cases: cases,
  };

  const upgradePriority =
    profile === 'Gaming'
      ? ['Video Cards', 'Processors', 'Power Supplies', 'Memory', 'Storage', 'Motherboards', 'CPU Coolers', 'Cases']
      : profile === 'Content Creation'
      ? ['Processors', 'Video Cards', 'Power Supplies', 'Memory', 'Storage', 'Motherboards', 'CPU Coolers', 'Cases']
      : isOfficeApu
      ? ['Processors', 'Storage', 'Memory', 'Power Supplies', 'Motherboards', 'Cases', 'CPU Coolers']
      : ['Video Cards', 'Processors', 'Power Supplies', 'Storage', 'Memory', 'Motherboards', 'CPU Coolers', 'Cases'];

  let improved = true;
  let steps = 0;

  while (improved && steps < 40) {
    improved = false;
    steps += 1;

    for (const cat of upgradePriority) {
      if (cat === 'Video Cards' && isOfficeApu) continue;
      const pool = poolByCategory[cat] || [];
      const currentCost = itemCost(cat, buildObj[cat]);
      const maxAllowed = budget - otherPartsCost(buildObj, cat);
      if (maxAllowed <= currentCost) continue;

      const betterOptions = pool.filter((candidate) => {
        const candCost = itemCost(cat, candidate);
        if (candCost <= currentCost || candCost > maxAllowed) return false;
        if (cat === 'Processors') {
          const sock = detectCpuSocket(candidate);
          if (buildObj.Motherboards && sock && detectMotherboardSocket(buildObj.Motherboards) !== sock) {
            return false;
          }
        }
        if (cat === 'Motherboards') {
          const sock = detectMotherboardSocket(candidate);
          if (buildObj.Processors && sock && detectCpuSocket(buildObj.Processors) !== sock) {
            return false;
          }
        }
        if (cat === 'Power Supplies') {
          if (isGenericOrAvoidPsu(candidate)) return false;
          const currentProf = getPsuProfile(buildObj['Power Supplies']);
          const candProf = getPsuProfile(candidate);
          if (candProf.tierRank < currentProf.tierRank) return false;
        }
        return true;
      });

      if (betterOptions.length > 0) {
        if (cat === 'Power Supplies') {
          betterOptions.sort((a, b) => {
            const profA = getPsuProfile(a);
            const profB = getPsuProfile(b);
            if (profB.tierRank !== profA.tierRank) return profB.tierRank - profA.tierRank;
            return itemCost(cat, a) - itemCost(cat, b);
          });
        } else {
          betterOptions.sort((a, b) => itemCost(cat, b) - itemCost(cat, a));
        }

        const trial = { ...buildObj, [cat]: betterOptions[0] };

        if (cat === 'Processors' || cat === 'Video Cards') {
          const psuCap = budget - otherPartsCost(trial, 'Power Supplies');
          const reqPsu = getMinimumSafePsu(
            trial.Processors,
            trial['Video Cards'],
            trial.Motherboards,
            trial.Memory,
            trial.Storage,
            trial['CPU Coolers'],
            trial.Cases,
            psuCap
          );
          const currentPsuProf = getPsuProfile(trial['Power Supplies']);
          const reqPsuProf = reqPsu ? getPsuProfile(reqPsu) : null;
          if (
            reqPsu &&
            ((currentPsuProf.watts || 0) < (reqPsuProf.watts || 0) ||
              (currentPsuProf.tierRank || 0) < (reqPsuProf.tierRank || 0) ||
              isGenericOrAvoidPsu(trial['Power Supplies']))
          ) {
            trial['Power Supplies'] = reqPsu;
          }
        }

        if (calculateBuildTotal(trial, CATEGORIES, targetSticks) <= budget) {
          Object.assign(buildObj, trial);
          improved = true;
        }
      }
    }
  }

  // Ceiling enforcement pass: step down lower-cost options without sacrificing PSU safety
  const isSafeTrimCandidate = (cat, item) => {
    if (cat !== 'Power Supplies') return true;
    const { minSafeWatts, minRank } = getPsuRequirements(buildObj);
    const prof = getPsuProfile(item);
    return (
      !isGenericOrAvoidPsu(item) &&
      (prof.watts || 0) >= minSafeWatts &&
      prof.tierRank >= minRank
    );
  };

  let trimmed = true;
  let trimSteps = 0;
  while (trimmed && trimSteps < 40 && calculateBuildTotal(buildObj, CATEGORIES, targetSticks) > budget) {
    trimmed = false;
    trimSteps += 1;

    for (const cat of TRIM_PRIORITY) {
      if (calculateBuildTotal(buildObj, CATEGORIES, targetSticks) <= budget) break;
      const pool = poolByCategory[cat] || [];
      const currentCost = itemCost(cat, buildObj[cat]);
      const allowedCap = budget - otherPartsCost(buildObj, cat);

      const withinCapCheaper = pool
        .filter(
          (item) =>
            itemCost(cat, item) < currentCost &&
            itemCost(cat, item) <= allowedCap &&
            isSafeTrimCandidate(cat, item)
        )
        .sort((a, b) => itemCost(cat, b) - itemCost(cat, a));

      if (withinCapCheaper.length > 0) {
        buildObj[cat] = withinCapCheaper[0];
        trimmed = true;
        break;
      }

      const anyCheaper = pool
        .filter((item) => itemCost(cat, item) < currentCost && isSafeTrimCandidate(cat, item))
        .sort((a, b) => itemCost(cat, b) - itemCost(cat, a));

      if (anyCheaper.length > 0) {
        buildObj[cat] = anyCheaper[0];
        trimmed = true;
        break;
      }
    }
  }

  const totalPrice = calculateBuildTotal(buildObj, CATEGORIES, targetSticks);
  const psuInfo = getPsuProfile(buildObj['Power Supplies']);
  const withinBudget = totalPrice <= budget;

  return {
    ok: true,
    withinBudget,
    build: buildObj,
    ramStickCount: targetSticks,
    totalPrice,
    budget,
    statusMessage: withinBudget
      ? `Recommended Build (${profile} · ${targetSocket} · ${targetSticks}x RAM · PSU Tier ${psuInfo.tier}) | Total: ₱${totalPrice.toLocaleString()} / Budget: ₱${budget.toLocaleString()}`
      : `Closest Build (${profile} · ${targetSocket} · ${targetSticks}x RAM · PSU Tier ${psuInfo.tier}) | Total: ₱${totalPrice.toLocaleString()} exceeds ₱${budget.toLocaleString()} budget`,
  };
}