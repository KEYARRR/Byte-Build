import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice, isPrebundledKit } from './pricing.js';
import { getPsuProfile } from './power.js';
import { parseRam } from './ram.js';
import { isCustomPartItem } from './customParts.js';

const SHORT_LABELS = {
  Processors: 'CPU',
  Motherboards: 'MOBO',
  Memory: 'RAM',
  Storage: 'SSD',
  'Hard Drives': 'HDD',
  'Video Cards': 'GPU',
  'Power Supplies': 'PSU',
  'CPU Coolers': 'COOLER',
  Cases: 'CASE',
};

const peso = (value) =>
  `\u20B1${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

export function buildSlotManifestRows(selectedBuild = {}, selectedRamCount = 2) {
  return CATEGORIES.map((category) => {
    const item = selectedBuild[category] || null;
    const isMemory = category === 'Memory';
    const isPsu = category === 'Power Supplies';
    const isUnverified = isCustomPartItem(item);

    const ramInfo =
      isMemory && item
        ? {
            ...parseRam(item, selectedRamCount),
            isKit: isPrebundledKit(item),
          }
        : null;

    const psuTier = isPsu && item ? getPsuProfile(item).tier : null;

    const itemPrice = item
      ? getEffectiveItemPrice(category, item, isMemory ? selectedRamCount : 1)
      : 0;

    return {
      category,
      shortLabel: SHORT_LABELS[category] || category.slice(0, 4).toUpperCase(),
      item,
      isMemory,
      isPsu,
      isUnverified,
      ramInfo,
      psuTier,
      priceLabel: item ? peso(itemPrice) : '--',
    };
  });
}

export function computePowerDisplayMetrics({
  powerMetrics = {},
  psuInfo = {},
  powerDisplayView = 'load',
  overclockEnabled = false,
} = {}) {
  const idleWatts = Number(powerMetrics.idleWatts || 0);
  const stockPeakWatts = Number(powerMetrics.stockPeakWatts ?? powerMetrics.peakWatts ?? 0);
  const ocPeakWatts = Number(powerMetrics.ocPeakWatts ?? powerMetrics.peakWatts ?? 0);
  const activePeakWatts = Number(
    powerMetrics.activePeakWatts ?? (overclockEnabled ? ocPeakWatts : stockPeakWatts)
  );
  const recommendedPsuWatts = Number(powerMetrics.recommendedPsuWatts || 0);
  const psuWattage = Number(psuInfo.wattage || 0);

  const displayedWatts = powerDisplayView === 'idle' ? idleWatts : activePeakWatts;
  const referenceCap = psuWattage > 0 ? psuWattage : Math.max(recommendedPsuWatts, displayedWatts, 1);
  const loadPercent = Math.min(100, Math.max(0, Math.round((displayedWatts / referenceCap) * 100)));
  const isOverPsuCap = psuWattage > 0 && displayedWatts > psuWattage;

  return {
    modeLabel: powerDisplayView === 'idle' ? 'Idle Draw' : 'Peak Draw',
    displayedWatts,
    idleWatts,
    stockPeakWatts,
    ocPeakWatts,
    activePeakWatts,
    recommendedPsuWatts,
    loadPercent,
    isOverPsuCap,
    missingSpecs: Array.isArray(powerMetrics.missingSpecs) ? powerMetrics.missingSpecs : [],
  };
}