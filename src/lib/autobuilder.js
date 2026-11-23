import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice, isPrebundledKit } from './pricing.js';
import { detectCpuSocket, detectMotherboardSocket } from './compat.js';
import { parseRam } from './ram.js';

const MIN_BUDGET = 15000;
const normalizeText = (value) => String(value || '').trim().toLowerCase();

const PROFILE_SHARES = {
  Gaming: {
    'Video Cards': 0.29,
    Processors: 0.20,
    Motherboards: 0.13,
    Memory: 0.09,
    Storage: 0.08,
    'Hard Drives': 0.04,
    'Power Supplies': 0.07,
    Cases: 0.06,
    'CPU Coolers': 0.04,
  },
  'Content Creation': {
    Processors: 0.23,
    'Video Cards': 0.21,
    Motherboards: 0.13,
    Memory: 0.11,
    Storage: 0.10,
    'Hard Drives': 0.07,
    'Power Supplies': 0.07,
    Cases: 0.04,
    'CPU Coolers': 0.04,
  },
  'Office/Productivity': {
    Processors: 0.21,
    Motherboards: 0.14,
    Memory: 0.11,
    Storage: 0.11,
    'Hard Drives': 0.08,
    'Power Supplies': 0.09,
    Cases: 0.08,
    'CPU Coolers': 0.05,
    'Video Cards': 0.13,
  },
  Balanced: {
    'Video Cards': 0.25,
    Processors: 0.20,
    Motherboards: 0.13,
    Memory: 0.10,
    Storage: 0.09,
    'Hard Drives': 0.05,
    'Power Supplies': 0.07,
    Cases: 0.06,
    'CPU Coolers': 0.05,
  },
};

function matchesCategory(product, targetCategory) {
  const cat = normalizeText(product?.category);
  const target = normalizeText(targetCategory);
  if (!cat) return false;
  if (cat === target) return true;
  if (target === 'hard drives') {
    return cat.includes('hdd') || cat.includes('hard drive') || cat.includes('hard disk');
  }
  if (target === 'storage') {
    if (cat.includes('hdd') || cat.includes('hard drive') || cat.includes('hard disk')) return false;
    return cat.includes('ssd') || cat.includes('nvme') || cat.includes('storage');
  }
  if (target === 'memory' && (cat.includes('ram') || cat.includes('memory'))) return true;
  if (
    target === 'video cards' &&
    (cat.includes('gpu') || cat.includes('graphics') || cat.includes('video'))
  ) {
    return true;
  }
  if (target === 'power supplies' && (cat.includes('psu') || cat.includes('power'))) return true;
  if (
    target === 'cpu coolers' &&
    (cat.includes('cooler') || cat.includes('fan') || cat.includes('aio'))
  ) {
    return true;
  }
  if (target === 'processors' && (cat.includes('cpu') || cat.includes('processor'))) return true;
  if (
    target === 'motherboards' &&
    (cat.includes('mobo') || cat.includes('motherboard') || cat.includes('board'))
  ) {
    return true;
  }
  if (target === 'cases' && (cat.includes('case') || cat.includes('chassis'))) return true;
  return false;
}

function resolveRamStickCount(product) {
  if (isPrebundledKit(product)) return 2;
  const parsed = parseRam(product, 2);
  if (parsed?.stickCount === 1 || parsed?.stickCount === 2 || parsed?.stickCount === 4) {
    return parsed.stickCount;
  }
  return 2;
}

function getStockPrice(product, category, ramStickCount = 2) {
  if (!product) return Infinity;
  const base = Number(product.price);
  if (!Number.isFinite(base) || base <= 0) return Infinity;
  if (category === 'Memory') {
    const count = isPrebundledKit(product) ? 2 : ramStickCount;
    const eff = getEffectiveItemPrice('Memory', product, count);
    return Number.isFinite(eff) && eff > 0 ? eff : base;
  }
  return base;
}

function detectMemoryGen(part) {
  if (!part) return '';
  const combined = `${part.memory_type || ''} ${part.name || ''} ${part.specs || ''}`.toUpperCase();
  if (combined.includes('DDR5')) return 'DDR5';
  if (combined.includes('DDR4')) return 'DDR4';
  return '';
}

function getCheapestCandidatePrice(candidates, category, mobo = null) {
  let pool = (candidates || []).filter((item) => {
    const sticks = category === 'Memory' ? resolveRamStickCount(item) : 1;
    return Number.isFinite(getStockPrice(item, category, sticks));
  });

  if (category === 'Memory' && mobo) {
    const moboDdr = detectMemoryGen(mobo);
    if (moboDdr) {
      const ddrMatches = pool.filter((ram) => {
        const ramDdr = detectMemoryGen(ram);
        return !ramDdr || ramDdr === moboDdr;
      });
      if (ddrMatches.length > 0) pool = ddrMatches;
    }
  }

  if (pool.length === 0) return Infinity;
  return Math.min(
    ...pool.map((item) => {
      const sticks = category === 'Memory' ? resolveRamStickCount(item) : 1;
      return getStockPrice(item, category, sticks);
    })
  );
}

function getMinCostForSlots(byCat, categoriesToFill, mobo) {
  let totalMin = 0;
  for (const cat of categoriesToFill) {
    const cheapest = getCheapestCandidatePrice(byCat[cat], cat, mobo);
    if (!Number.isFinite(cheapest)) return Infinity;
    totalMin += cheapest;
  }
  return totalMin;
}

function scorePair(cpu, mobo, budget, profile) {
  const shares = PROFILE_SHARES[profile] || PROFILE_SHARES.Balanced;
  const targetCpuSpend = budget * (shares.Processors || 0.2);
  const targetMoboSpend = budget * (shares.Motherboards || 0.13);
  const cpuPrice = getStockPrice(cpu, 'Processors');
  const moboPrice = getStockPrice(mobo, 'Motherboards');
  const cpuScore = Number(cpu.hardware_score || 75);
  const moboScore = Number(mobo.hardware_score || 75);

  const cpuFit = 1 - Math.min(1, Math.abs(cpuPrice - targetCpuSpend) / Math.max(1, targetCpuSpend));
  const moboFit = 1 - Math.min(1, Math.abs(moboPrice - targetMoboSpend) / Math.max(1, targetMoboSpend));
  const baseQuality =
    profile === 'Content Creation' ? cpuScore * 1.2 + moboScore * 0.8 : cpuScore + moboScore;

  return baseQuality * (0.65 + 0.35 * ((cpuFit + moboFit) / 2));
}

function pickCompatiblePair(cpus, mobos, byCat, budget, profile) {
  const allRemaining = [
    'Memory',
    'Storage',
    'Hard Drives',
    'Video Cards',
    'Power Supplies',
    'CPU Coolers',
    'Cases',
  ];
  const pairs = [];

  for (const cpu of cpus) {
    const cpuSock = detectCpuSocket(cpu);
    const cpuPrice = getStockPrice(cpu, 'Processors');
    if (!Number.isFinite(cpuPrice) || cpuPrice > budget) continue;

    for (const mobo of mobos) {
      const moboSock = detectMotherboardSocket(mobo);
      if (cpuSock && moboSock && cpuSock !== moboSock) continue;
      if ((cpuSock && !moboSock) || (!cpuSock && moboSock)) continue;

      const moboPrice = getStockPrice(mobo, 'Motherboards');
      if (!Number.isFinite(moboPrice)) continue;

      const pairCost = cpuPrice + moboPrice;
      if (pairCost > budget) continue;

      const minOthers = getMinCostForSlots(byCat, allRemaining, mobo);
      const fitsFullRig = Number.isFinite(minOthers) && pairCost + minOthers <= budget;

      pairs.push({
        cpu,
        mobo,
        cpuSock,
        moboSock,
        pairCost,
        fitsFullRig,
        score: scorePair(cpu, mobo, budget, profile),
      });
    }
  }

  if (pairs.length === 0) return null;

  const fullRigPairs = pairs.filter((p) => p.fitsFullRig);
  const pool = fullRigPairs.length > 0 ? fullRigPairs : pairs;

  if (profile === 'Office/Productivity') {
    pool.sort((a, b) => a.pairCost - b.pairCost || b.score - a.score);
  } else {
    pool.sort((a, b) => b.score - a.score || a.pairCost - b.pairCost);
  }

  return pool[0];
}

function pickPartForSlot({
  candidates,
  category,
  mobo,
  budget,
  spentSoFar,
  remainingSlotsAfterThis,
  byCat,
  profile,
}) {
  if (!candidates || candidates.length === 0) return { item: null, stickCount: 1, price: 0 };

  const remainingBudget = budget - spentSoFar;
  if (remainingBudget <= 0) return { item: null, stickCount: 1, price: 0 };

  const minCostAfterThis = getMinCostForSlots(byCat, remainingSlotsAfterThis, mobo);
  const safeMinAfter = Number.isFinite(minCostAfterThis) ? minCostAfterThis : 0;
  const maxAllowedPrice = remainingBudget - safeMinAfter;

  const shares = PROFILE_SHARES[profile] || PROFILE_SHARES.Balanced;
  const idealSlotPrice = budget * (shares[category] || 0.08);
  const moboDdr = category === 'Memory' ? detectMemoryGen(mobo) : '';

  let filtered = candidates;
  if (category === 'Memory' && moboDdr) {
    const ddrMatches = candidates.filter((ram) => {
      const ramDdr = detectMemoryGen(ram);
      return !ramDdr || ramDdr === moboDdr;
    });
    if (ddrMatches.length > 0) filtered = ddrMatches;
  }

  const evaluated = filtered
    .map((item) => {
      const stickCount = category === 'Memory' ? resolveRamStickCount(item) : 1;
      const price = getStockPrice(item, category, stickCount);
      if (!Number.isFinite(price)) return null;

      const fitsWithRemainingSlots = price <= maxAllowedPrice;
      const fitsRemainingBudget = price <= remainingBudget;
      const hwScore = Number(item.hardware_score || 75);
      const specText = `${item.name || ''} ${item.specs || ''}`;

      let bonus = 0;
      if (category === 'Storage') {
        const is500GbPlus = /\b(500GB|512GB|1TB|2TB|4TB|1000GB|2000GB)\b/i.test(specText);
        const is1TbPlus = /\b(1TB|2TB|4TB|1000GB|2000GB)\b/i.test(specText);
        const isNvme = /\b(NVMe|M\.2|PCIe)\b/i.test(specText);
        bonus = (is500GbPlus ? 18 : -10) + (is1TbPlus ? 10 : 0) + (isNvme ? 8 : 0);
      } else if (category === 'Hard Drives') {
        const is1TbPlus = /\b(1TB|2TB|4TB|6TB|8TB|1000GB|2000GB|4000GB)\b/i.test(specText);
        const is2TbPlus = /\b(2TB|4TB|6TB|8TB|2000GB|4000GB)\b/i.test(specText);
        bonus = (is1TbPlus ? 14 : 4) + (is2TbPlus ? 8 : 0);
      } else if (category === 'Memory') {
        const parsed = parseRam(item, stickCount);
        const targetGb = profile === 'Content Creation' ? 32 : 16;
        bonus = parsed.totalCapacity >= targetGb ? 14 : parsed.totalCapacity >= 16 ? 8 : 0;
      } else if (category === 'Power Supplies') {
        const tier = String(item.psu_tier || '').toUpperCase();
        bonus = tier === 'A+' || tier === 'A' ? 12 : tier === 'B' ? 8 : -5;
      }

      const closeness =
        1 - Math.min(1, Math.abs(price - idealSlotPrice) / Math.max(1, idealSlotPrice));
      const rankScore = hwScore * 0.65 + bonus + closeness * 30;

      return {
        item,
        stickCount,
        price,
        fitsWithRemainingSlots,
        fitsRemainingBudget,
        rankScore,
      };
    })
    .filter(Boolean);

  if (evaluated.length === 0) return { item: null, stickCount: 1, price: 0 };

  const fullRigEligible = evaluated.filter((e) => e.fitsWithRemainingSlots);
  if (fullRigEligible.length > 0) {
    fullRigEligible.sort((a, b) => b.rankScore - a.rankScore || a.price - b.price);
    return fullRigEligible[0];
  }

  const budgetEligible = evaluated.filter((e) => e.fitsRemainingBudget);
  if (budgetEligible.length > 0) {
    budgetEligible.sort((a, b) => a.price - b.price || b.rankScore - a.rankScore);
    return budgetEligible[0];
  }

  return { item: null, stickCount: 1, price: 0 };
}

export function runSmartBuildAssistant({
  products = [],
  budgetInput = 40000,
  profile = 'Gaming',
  overclockEnabled = false,
} = {}) {
  const budget = Number(budgetInput);
  if (!Number.isFinite(budget) || budget < MIN_BUDGET) {
    return {
      ok: false,
      withinBudget: false,
      budgetRemaining: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 0,
      remainingBudget: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 0,
      unfilledCategories: [...CATEGORIES],
      reason: `Please enter a valid target budget of at least ₱${MIN_BUDGET.toLocaleString()}.`,
    };
  }

  const available = (Array.isArray(products) ? products : []).filter(
    (p) => p && p.stock_status !== 'Sold Out' && Number(p.price) > 0
  );

  const byCat = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = available.filter((p) => matchesCategory(p, cat));
    return acc;
  }, {});

  const pair = pickCompatiblePair(byCat.Processors, byCat.Motherboards, byCat, budget, profile);
  if (!pair) {
    return {
      ok: false,
      withinBudget: false,
      budgetRemaining: Math.round(budget),
      remainingBudget: Math.round(budget),
      unfilledCategories: [...CATEGORIES],
      reason: 'No socket-compatible Processor and Motherboard pair found in current stock.',
    };
  }

  const build = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = null;
    return acc;
  }, {});

  build.Processors = pair.cpu;
  build.Motherboards = pair.mobo;

  let spent = pair.pairCost;
  let ramStickCount = 2;
  const notes = [];
  if (pair.cpuSock) {
    notes.push(`Matched socket ${pair.cpuSock}.`);
  }

  const slotOrder = [
    'Memory',
    'Storage',
    'Hard Drives',
    'Video Cards',
    'Power Supplies',
    'CPU Coolers',
    'Cases',
  ];
  for (let i = 0; i < slotOrder.length; i++) {
    const cat = slotOrder[i];
    const slotsAfter = slotOrder.slice(i + 1);
    const picked = pickPartForSlot({
      candidates: byCat[cat],
      category: cat,
      mobo: pair.mobo,
      budget,
      spentSoFar: spent,
      remainingSlotsAfterThis: slotsAfter,
      byCat,
      profile,
    });

    if (picked.item && spent + picked.price <= budget) {
      build[cat] = picked.item;
      spent += picked.price;
      if (cat === 'Memory') {
        ramStickCount = picked.stickCount || 2;
      }
    }
  }

  const totalPrice = Math.round(spent);
  const withinBudget = totalPrice <= budget;
  const remaining = Math.max(0, Math.round(budget - totalPrice));
  const unfilledCategories = CATEGORIES.filter((cat) => !build[cat]);
  const filledCount = CATEGORIES.length - unfilledCategories.length;

  if (unfilledCategories.length > 0) {
    notes.push(`Unfilled slots: ${unfilledCategories.join(', ')}.`);
  }
  if (overclockEnabled) {
    notes.push('Overclocking headroom mode noted.');
  }

  return {
    ok: true,
    build,
    ramStickCount,
    totalPrice,
    allocatedBudget: totalPrice,
    withinBudget,
    budgetRemaining: remaining,
    remainingBudget: remaining,
    unallocatedBudget: remaining,
    leftoverBudget: remaining,
    unfilledCategories,
    statusMessage: `Generated ${filledCount}/${CATEGORIES.length}-part ${profile} build for ₱${totalPrice.toLocaleString()} (Budget: ₱${budget.toLocaleString()}).`,
    notes,
  };
}

export function isPrebundledKitCheck(item) {
  return isPrebundledKit(item);
}