import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice, isPrebundledKit } from './pricing.js';
import { detectCpuSocket, detectMotherboardSocket } from './compat.js';
import { parseRam } from './ram.js';

const MIN_BUDGET = 15000;
const normalizeText = (value) => String(value || '').trim().toLowerCase();

function matchesCategory(product, targetCategory) {
  const cat = normalizeText(product?.category);
  const target = normalizeText(targetCategory);
  if (!cat) return false;
  if (cat === target) return true;
  if (target === 'memory' && (cat.includes('ram') || cat.includes('memory'))) return true;
  if (
    target === 'storage' &&
    (cat.includes('ssd') || cat.includes('nvme') || cat.includes('storage') || cat.includes('hdd'))
  ) {
    return true;
  }
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

function getStockPrice(product, category, ramStickCount = 2) {
  if (!product) return Infinity;
  const base = Number(product.price);
  if (!Number.isFinite(base) || base <= 0) return Infinity;
  if (category === 'Memory') {
    const eff = getEffectiveItemPrice('Memory', product, ramStickCount);
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

function pickCompatiblePair(cpus, mobos, remainingBudget, profile) {
  const pairs = [];
  for (const cpu of cpus) {
    const cpuSock = detectCpuSocket(cpu);
    for (const mobo of mobos) {
      const moboSock = detectMotherboardSocket(mobo);
      if (cpuSock && moboSock && cpuSock !== moboSock) continue;
      if ((cpuSock && !moboSock) || (!cpuSock && moboSock)) continue;

      const cpuPrice = getStockPrice(cpu, 'Processors');
      const moboPrice = getStockPrice(mobo, 'Motherboards');
      if (!Number.isFinite(cpuPrice) || !Number.isFinite(moboPrice)) continue;

      const pairCost = cpuPrice + moboPrice;
      const cpuScore = Number(cpu.hardware_score || 75);
      const moboScore = Number(mobo.hardware_score || 75);
      const score =
        profile === 'Content Creation' ? cpuScore * 1.3 + moboScore * 0.8 : cpuScore + moboScore;

      pairs.push({ cpu, mobo, cpuSock, moboSock, pairCost, score });
    }
  }

  if (pairs.length === 0) return null;

  const fitting = pairs.filter((p) => p.pairCost <= remainingBudget);
  const pool = fitting.length > 0 ? fitting : pairs;

  if (profile === 'Office/Productivity') {
    pool.sort((a, b) => a.pairCost - b.pairCost || b.score - a.score);
  } else {
    pool.sort((a, b) => b.score - a.score || a.pairCost - b.pairCost);
  }

  return pool[0];
}

function pickMemoryForBudget(ramCandidates, mobo, remainingBudget, profile) {
  const moboDdr = detectMemoryGen(mobo);
  const compatible = ramCandidates.filter((ram) => {
    const ramDdr = detectMemoryGen(ram);
    if (moboDdr && ramDdr && moboDdr !== ramDdr) return false;
    return true;
  });

  const pool = compatible.length > 0 ? compatible : ramCandidates;
  if (pool.length === 0) return { item: null, stickCount: 2, price: 0 };

  const scored = pool
    .map((item) => {
      const stickCount = 2;
      const parsed = parseRam(item, stickCount);
      const price = getStockPrice(item, 'Memory', stickCount);
      const gb = Number(parsed.totalCapacity || 0);
      const targetGb = profile === 'Content Creation' ? 32 : 16;
      const gbFit = gb >= targetGb ? 20 : gb >= 16 ? 12 : gb > 0 ? 5 : 0;
      const ddrBonus = moboDdr && detectMemoryGen(item) === moboDdr ? 15 : 0;
      const score = Number(item.hardware_score || 70) + gbFit + ddrBonus;
      return { item, stickCount, price, score };
    })
    .filter((entry) => Number.isFinite(entry.price));

  const fitting = scored.filter((entry) => entry.price <= remainingBudget);
  if (fitting.length > 0) {
    fitting.sort((a, b) => b.score - a.score || a.price - b.price);
    return fitting[0];
  }

  scored.sort((a, b) => a.price - b.price);
  return scored[0] || { item: null, stickCount: 2, price: 0 };
}

function pickStorageForBudget(storageCandidates, remainingBudget, profile) {
  if (storageCandidates.length === 0) return { item: null, price: 0 };

  const scored = storageCandidates
    .map((item) => {
      const price = getStockPrice(item, 'Storage');
      const specText = `${item.name || ''} ${item.specs || ''}`;
      const is1TbPlus = /\b(1TB|2TB|4TB|1000GB|2000GB)\b/i.test(specText);
      const isNvme = /\b(NVMe|M\.2|PCIe)\b/i.test(specText);
      const bonus =
        (isNvme ? 12 : 0) +
        (profile === 'Content Creation' && is1TbPlus ? 18 : is1TbPlus ? 10 : 4);
      return {
        item,
        price,
        score: Number(item.hardware_score || 70) + bonus,
      };
    })
    .filter((entry) => Number.isFinite(entry.price));

  const fitting = scored.filter((entry) => entry.price <= remainingBudget);
  if (fitting.length > 0) {
    fitting.sort((a, b) => b.score - a.score || a.price - b.price);
    return fitting[0];
  }

  scored.sort((a, b) => a.price - b.price);
  return scored[0] || { item: null, price: 0 };
}

function pickStandardPartForBudget(candidates, category, remainingBudget, profile) {
  if (!candidates || candidates.length === 0) return { item: null, price: 0 };

  const scored = candidates
    .map((item) => {
      const price = getStockPrice(item, category);
      const hwScore = Number(item.hardware_score || 75);
      let weight = hwScore;
      if (category === 'Video Cards') {
        weight =
          profile === 'Gaming'
            ? hwScore * 1.4
            : profile === 'Office/Productivity'
            ? hwScore * 0.6
            : hwScore;
      } else if (category === 'Power Supplies') {
        const tier = String(item.psu_tier || '').toUpperCase();
        const tierBonus = tier === 'A+' || tier === 'A' ? 14 : tier === 'B' ? 8 : 0;
        weight = hwScore + tierBonus;
      }
      return { item, price, weight };
    })
    .filter((entry) => Number.isFinite(entry.price));

  const fitting = scored.filter((entry) => entry.price <= remainingBudget);
  if (fitting.length > 0) {
    fitting.sort((a, b) => {
      if (profile === 'Office/Productivity' && category === 'Video Cards') {
        return a.price - b.price;
      }
      return b.weight - a.weight || a.price - b.price;
    });
    return fitting[0];
  }

  return { item: null, price: 0 };
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

  const pair = pickCompatiblePair(byCat.Processors, byCat.Motherboards, budget, profile);
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
  const notes = [];
  if (pair.cpuSock) {
    notes.push(`Matched socket ${pair.cpuSock}.`);
  }

  const ramPick = pickMemoryForBudget(byCat.Memory, pair.mobo, budget - spent, profile);
  const ramStickCount = ramPick.stickCount || 2;
  if (ramPick.item) {
    build.Memory = ramPick.item;
    spent += ramPick.price;
  } else {
    notes.push('No Memory SKU in stock.');
  }

  const storagePick = pickStorageForBudget(byCat.Storage, budget - spent, profile);
  if (storagePick.item) {
    build.Storage = storagePick.item;
    spent += storagePick.price;
  } else {
    notes.push('No Storage SKU in stock.');
  }

  const remainingOrder = ['Video Cards', 'Power Supplies', 'CPU Coolers', 'Cases'];
  for (const cat of remainingOrder) {
    const picked = pickStandardPartForBudget(byCat[cat], cat, budget - spent, profile);
    if (picked.item && spent + picked.price <= budget) {
      build[cat] = picked.item;
      spent += picked.price;
    }
  }

  const optionalOrder = ['Video Cards', 'CPU Coolers', 'Cases', 'Power Supplies'];
  for (const cat of optionalOrder) {
    if (spent <= budget) break;
    if (build[cat]) {
      const catPrice = getStockPrice(build[cat], cat);
      const cheaper = (byCat[cat] || [])
        .map((item) => ({ item, price: getStockPrice(item, cat) }))
        .filter((entry) => Number.isFinite(entry.price) && spent - catPrice + entry.price <= budget)
        .sort((a, b) => b.price - a.price)[0];

      if (cheaper) {
        spent = spent - catPrice + cheaper.price;
        build[cat] = cheaper.item;
      } else {
        spent -= catPrice;
        build[cat] = null;
      }
    }
  }

  const totalPrice = Math.round(spent);
  const withinBudget = totalPrice <= budget;
  const remaining = Math.max(0, Math.round(budget - totalPrice));
  const unfilledCategories = CATEGORIES.filter((cat) => !build[cat]);

  if (!withinBudget) {
    notes.push(
      `Core parts total ₱${totalPrice.toLocaleString()} against ₱${budget.toLocaleString()} budget.`
    );
  }
  if (overclockEnabled) {
    notes.push('Overclocking headroom mode noted.');
  }

  const filledCount = CATEGORIES.length - unfilledCategories.length;

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
    statusMessage: `Generated ${filledCount}/8-part ${profile} build for ₱${totalPrice.toLocaleString()} (Budget: ₱${budget.toLocaleString()}).`,
    notes,
  };
}

export function isPrebundledKitCheck(item) {
  return isPrebundledKit(item);
}