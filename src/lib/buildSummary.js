import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice } from './pricing.js';
import { parseRam } from './ram.js';
import { getPsuProfile } from './power.js';
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
    const ramInfo = isMemory && item ? parseRam(item, selectedRamCount) : null;
    const psuTier = isPsu && item ? getPsuProfile(item).tier : null;
    const priceLabel = item
      ? peso(getEffectiveItemPrice(category, item, selectedRamCount))
      : '-';

    return {
      category,
      shortLabel: SHORT_LABELS[category] || category,
      item,
      isMemory,
      isPsu,
      isUnverified,
      ramInfo,
      psuTier,
      priceLabel,
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
  const stockPeakWatts = Number(powerMetrics.stockPeakWatts ?? powerMetrics.activePeakWatts ?? 0);
  const ocPeakWatts = Number(powerMetrics.ocPeakWatts ?? stockPeakWatts);
  const activePeak = overclockEnabled ? ocPeakWatts : stockPeakWatts;
  const displayedWatts = powerDisplayView === 'idle' ? idleWatts : activePeak;
  const recommendedPsuWatts = Number(powerMetrics.recommendedPsuWatts || 0);
  const psuCapacityWatts = Number(psuInfo?.watts ?? psuInfo?.wattage ?? 0);
  const loadPercent =
    psuCapacityWatts > 0
      ? Math.min(100, Math.round((displayedWatts / psuCapacityWatts) * 100))
      : recommendedPsuWatts > 0
      ? Math.min(100, Math.round((displayedWatts / recommendedPsuWatts) * 100))
      : 0;
  const isOverPsuCap =
    (psuCapacityWatts > 0 && activePeak > psuCapacityWatts) ||
    (recommendedPsuWatts > 0 && activePeak > recommendedPsuWatts);

  return {
    modeLabel: powerDisplayView === 'idle' ? 'Idle Draw' : 'Peak Draw',
    displayedWatts,
    recommendedPsuWatts,
    idleWatts,
    stockPeakWatts,
    ocPeakWatts,
    loadPercent,
    isOverPsuCap,
    missingSpecs: Array.isArray(powerMetrics.missingSpecs) ? powerMetrics.missingSpecs : [],
  };
}