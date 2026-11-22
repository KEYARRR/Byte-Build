import { CATEGORIES, WORKLOAD_WEIGHTS } from './config.js';
import { calculateBuildTotal, getEffectiveItemPrice } from './pricing.js';
import { calculateRigWattage, getPsuProfile } from './power.js';
import { deriveComponentTier } from './scoring.js';
import {
  detectCpuSocket,
  detectMotherboardSocket,
  detectMemoryType,
  parseStorageProfile,
} from './compat.js';

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
    psu: (rawWeights['Power Supplies'] ?? 7) / 100,
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

  const apuPool = cpus.filter((c) => /\b\d{4}G\b/i.test(`${c.name || ''} ${c.specs || ''}`) || c.has_igpu === true);
  const chosenCpu =
    isOfficeApu && apuPool.length > 0
      ? pickBestWithinCap('Processors', apuPool, budget * weights.cpu)
      : pickBestWithinCap('Processors', cpus, budget * weights.cpu);

  const targetSocket = detectCpuSocket(chosenCpu) || 'AM4';
  const compatibleBoards = boards.filter((b) => detectMotherboardSocket(b) === targetSocket);
  const boardPool = compatibleBoards.length > 0 ? compatibleBoards : boards;
  const chosenBoard = pickBestWithinCap('Motherboards', boardPool, budget * weights.board);

  const boardMemType = detectMemoryType(chosenBoard) || (targetSocket === 'AM5' ? 'DDR5' : 'DDR4');
  const compatibleRams = rams.filter((r) => detectMemoryType(r) === boardMemType);
  const ramPool = compatibleRams.length > 0 ? compatibleRams : rams;
  const chosenRam = pickBestWithinCap('Memory', ramPool, budget * weights.ram);

  const chosenGpu = isOfficeApu ? null : pickBestWithinCap('Video Cards', gpus, budget * weights.gpu);

  const fullSizeSsdPool = storages.filter((s) => {
    const sp = parseStorageProfile(s);
    return sp && !sp.isHdd && Number(sp.capacityGB || 0) >= 500;
  });
  const storagePool = fullSizeSsdPool.length > 0 ? fullSizeSsdPool : storages;
  const chosenStorage = pickBestWithinCap('Storage', storagePool, Math.max(budget * weights.storage, 4000));
  const chosenCooler = pickBestWithinCap('CPU Coolers', coolers, Math.max(budget * weights.cooler, 1500));
  const chosenCase = pickBestWithinCap('Cases', cases, Math.max(budget * weights.case, 1800));

  const getMinimumSafePsu = (cpuPart, gpuPart, boardPart, ramPart, storagePart, coolerPart, casePart) => {
    const powerSummary = calculateRigWattage(
      {
        Processors: cpuPart,
        'Video Cards': gpuPart,
        Motherboards: boardPart,
        Memory: ramPart,
        Storage: storagePart,
        'CPU Coolers': coolerPart,
        Cases: casePart,
      },
      targetSticks,
      overclockEnabled
    );
    const minSafeWatts = powerSummary.recommendedPsuWatts;
    const cpuTier = deriveComponentTier(cpuPart, 'Processors') || 2;
    const gpuTier = deriveComponentTier(gpuPart, 'Video Cards') || 2;
    const minRank = gpuTier >= 5 || cpuTier >= 5 ? 4 : 3;

    const qualified = psus.filter((p) => {
      const prof = getPsuProfile(p);
      return (prof.watts || 0) >= minSafeWatts && prof.tierRank >= minRank;
    });
    const fallback = psus.filter((p) => (getPsuProfile(p).watts || 0) >= minSafeWatts);
    return qualified[0] || fallback[0] || psus[0] || null;
  };

  const buildObj = {
    Processors: chosenCpu || null,
    Motherboards: chosenBoard || null,
    'Video Cards': chosenGpu || null,
    Memory: chosenRam || null,
    Storage: chosenStorage || null,
    'Power Supplies': getMinimumSafePsu(
      chosenCpu,
      chosenGpu,
      chosenBoard,
      chosenRam,
      chosenStorage,
      chosenCooler,
      chosenCase
    ),
    'CPU Coolers': chosenCooler || null,
    Cases: chosenCase || null,
  };

  const otherPartsCost = (b, excludeCat) =>
    CATEGORIES.reduce((sum, cat) => (cat === excludeCat ? sum : sum + itemCost(cat, b[cat])), 0);

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
      ? ['Video Cards', 'Processors', 'Memory', 'Storage', 'Power Supplies', 'Motherboards', 'CPU Coolers', 'Cases']
      : profile === 'Content Creation'
      ? ['Processors', 'Video Cards', 'Memory', 'Storage', 'Motherboards', 'Power Supplies', 'CPU Coolers', 'Cases']
      : isOfficeApu
      ? ['Processors', 'Storage', 'Memory', 'Motherboards', 'Power Supplies', 'Cases', 'CPU Coolers']
      : ['Video Cards', 'Processors', 'Storage', 'Memory', 'Motherboards', 'Power Supplies', 'CPU Coolers', 'Cases'];

  let improved = true;
  let steps = 0;

  while (improved && steps < 32) {
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
        return true;
      });

      if (betterOptions.length > 0) {
        betterOptions.sort((a, b) => itemCost(cat, b) - itemCost(cat, a));
        const trial = { ...buildObj, [cat]: betterOptions[0] };

        if (cat === 'Processors' || cat === 'Video Cards') {
          const reqPsu = getMinimumSafePsu(
            trial.Processors,
            trial['Video Cards'],
            trial.Motherboards,
            trial.Memory,
            trial.Storage,
            trial['CPU Coolers'],
            trial.Cases
          );
          if (reqPsu && (getPsuProfile(trial['Power Supplies']).watts || 0) < (getPsuProfile(reqPsu).watts || 0)) {
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

  // Final ceiling guard: trim down if any total exceeds budget
  const trimOrder = ['Video Cards', 'Processors', 'Storage', 'Memory', 'Motherboards', 'Power Supplies', 'Cases', 'CPU Coolers'];
  for (const cat of trimOrder) {
    if (calculateBuildTotal(buildObj, CATEGORIES, targetSticks) <= budget) break;
    const pool = poolByCategory[cat] || [];
    const currentCost = itemCost(cat, buildObj[cat]);
    const allowedCap = budget - otherPartsCost(buildObj, cat);
    const lowerOptions = pool
      .filter((item) => itemCost(cat, item) < currentCost && itemCost(cat, item) <= allowedCap)
      .sort((a, b) => itemCost(cat, b) - itemCost(cat, a));
    if (lowerOptions.length > 0) {
      buildObj[cat] = lowerOptions[0];
    }
  }

  const totalPrice = calculateBuildTotal(buildObj, CATEGORIES, targetSticks);
  const psuInfo = getPsuProfile(buildObj['Power Supplies']);

  return {
    ok: true,
    build: buildObj,
    ramStickCount: targetSticks,
    totalPrice,
    budget,
    statusMessage: `Recommended Build (${profile} · ${targetSocket} · ${targetSticks}x RAM · PSU Tier ${psuInfo.tier}) — Total: ₱${totalPrice.toLocaleString()} / Budget: ₱${budget.toLocaleString()}`,
  };
}