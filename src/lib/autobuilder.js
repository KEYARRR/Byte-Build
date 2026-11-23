import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice, calculateBuildTotal } from './pricing.js';
import { calculateRigWattage, getPsuProfile } from './power.js';
import { parseRam } from './ram.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

function sortCandidatesByValue(items, category, ramStickCount = 2) {
  return [...items].sort((a, b) => {
    const scoreDiff = Number(b.hardware_score || 70) - Number(a.hardware_score || 70);
    if (scoreDiff !== 0) return scoreDiff;
    return (
      getEffectiveItemPrice(category, b, ramStickCount) -
      getEffectiveItemPrice(category, a, ramStickCount)
    );
  });
}

function pickBestUnderCap(items, cap, category, ramStickCount = 2) {
  if (!Array.isArray(items) || items.length === 0 || cap < 0) return null;
  const affordable = sortCandidatesByValue(items, category, ramStickCount).filter(
    (item) => getEffectiveItemPrice(category, item, ramStickCount) <= cap
  );
  return affordable[0] || null;
}

/**
 * Down-steps or drops parts in priority order (lowest-priority slots first)
 * until total build cost strictly respects `budget`.
 */
function enforceStrictBudget(build, byCat, budget, ramStickCount, notes) {
  const dropOrder = [
    'CPU Coolers',
    'Cases',
    'Storage',
    'Memory',
    'Power Supplies',
    'Motherboards',
    'Video Cards',
    'Processors',
  ];

  let currentTotal = calculateBuildTotal(build, CATEGORIES, ramStickCount);
  if (currentTotal <= budget) return currentTotal;

  for (const cat of dropOrder) {
    if (currentTotal <= budget) break;
    const currentItem = build[cat];
    if (!currentItem) continue;

    const currentCost = getEffectiveItemPrice(cat, currentItem, ramStickCount);
    const maxAllowedForCat = Math.max(0, currentCost - (currentTotal - budget));

    const cheaperAlt = pickBestUnderCap(
      (byCat[cat] || []).filter((p) => p.id !== currentItem.id),
      maxAllowedForCat,
      cat,
      ramStickCount
    );

    if (cheaperAlt) {
      build[cat] = cheaperAlt;
      notes.push(`Downgraded ${cat} to "${cheaperAlt.name}" to stay within budget.`);
    } else {
      build[cat] = null;
      notes.push(`Omitted ${cat} ("${currentItem.name}") because no option fit remaining budget.`);
    }

    currentTotal = calculateBuildTotal(build, CATEGORIES, ramStickCount);
  }

  return currentTotal;
}

export function runSmartBuildAssistant({
  products = [],
  budgetInput = 40000,
  profile = 'Gaming',
  overclockEnabled = false,
}) {
  const budget = Number(budgetInput || 0);
  if (!Number.isFinite(budget) || budget < 15000) {
    return {
      ok: false,
      withinBudget: false,
      budget,
      totalPrice: 0,
      remainingBudget: 0,
      unfilledCategories: [...CATEGORIES],
      notes: [],
      reason: 'Please enter a valid target budget of at least ₱15,000.',
    };
  }

  const available = products.filter((p) => p && p.stock_status !== 'Sold Out');
  const byCat = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = available.filter((p) => normalizeText(p.category) === normalizeText(cat));
    return acc;
  }, {});

  const ramStickCount = 2;
  const build = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = null;
    return acc;
  }, {});

  const notes = [];

  const gpuShare =
    profile === 'Gaming'
      ? 0.34
      : profile === 'Content Creation'
      ? 0.25
      : profile === 'Office/Productivity'
      ? 0.08
      : 0.26;
  const cpuShare =
    profile === 'Content Creation'
      ? 0.27
      : profile === 'Office/Productivity'
      ? 0.26
      : 0.22;

  if (profile !== 'Office/Productivity' || budget >= 35000) {
    build['Video Cards'] = pickBestUnderCap(
      byCat['Video Cards'],
      budget * gpuShare,
      'Video Cards',
      ramStickCount
    );
  } else {
    notes.push('Discrete GPU skipped for Office/Productivity under ₱35,000 budget.');
  }

  build.Processors = pickBestUnderCap(
    byCat.Processors,
    budget * cpuShare,
    'Processors',
    ramStickCount
  );

  build.Motherboards = pickBestUnderCap(
    byCat.Motherboards,
    budget * 0.16,
    'Motherboards',
    ramStickCount
  );

  build.Memory = pickBestUnderCap(
    byCat.Memory,
    budget * 0.11,
    'Memory',
    ramStickCount
  );

  build.Storage = pickBestUnderCap(
    byCat.Storage,
    budget * 0.09,
    'Storage',
    ramStickCount
  );

  build.Cases = pickBestUnderCap(
    byCat.Cases,
    budget * 0.07,
    'Cases',
    ramStickCount
  );

  build['CPU Coolers'] = pickBestUnderCap(
    byCat['CPU Coolers'],
    budget * 0.05,
    'CPU Coolers',
    ramStickCount
  );

  const wattsInfo = calculateRigWattage(build, ramStickCount, {
    overclocked: Boolean(overclockEnabled),
  });
  const psuCandidates = (byCat['Power Supplies'] || []).filter((psu) => {
    const prof = getPsuProfile(psu);
    return prof.tierRank >= 2 && prof.watts >= (wattsInfo.recommendedPsuWatts || 450);
  });

  build['Power Supplies'] =
    pickBestUnderCap(psuCandidates, budget * 0.11, 'Power Supplies', ramStickCount) ||
    pickBestUnderCap(byCat['Power Supplies'], budget * 0.12, 'Power Supplies', ramStickCount);

  // Strictly enforce total cost <= budget without silently injecting out-of-budget previous parts
  const totalPrice = enforceStrictBudget(build, byCat, budget, ramStickCount, notes);
  const withinBudget = totalPrice <= budget;
  const remainingBudget = Math.max(0, budget - totalPrice);
  const unfilledCategories = CATEGORIES.filter((cat) => !build[cat]);
  const parsedRam = parseRam(build.Memory, ramStickCount);

  const honestySuffix =
    unfilledCategories.length > 0
      ? ` · Unfilled: ${unfilledCategories.join(', ')}`
      : ' · Strict budget enforced';

  return {
    ok: true,
    withinBudget,
    build,
    ramStickCount,
    parsedRam,
    budget,
    totalPrice,
    remainingBudget,
    unfilledCategories,
    notes,
    statusMessage: `Recommended Build (${profile}) · RAM: ${parsedRam.totalGb}GB · Total: ₱${totalPrice.toLocaleString()} / Budget: ₱${budget.toLocaleString()} (Remaining: ₱${remainingBudget.toLocaleString()})${honestySuffix}`,
  };
}