import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice } from './pricing.js';
import { getPsuProfile } from './power.js';
import { parseRam } from './ram.js';
import { isCustomPartItem } from './customParts.js';

const SHORT_LABELS = {
  Processors: 'CPU',
  Motherboards: 'MOBO',
  'Video Cards': 'GPU',
  Memory: 'RAM',
  Storage: 'SSD',
  'Power Supplies': 'PSU',
  'CPU Coolers': 'COOLER',
  Cases: 'CASE',
};

export function getShortCategoryLabel(category) {
  return SHORT_LABELS[category] || String(category || '').toUpperCase();
}

export function buildSlotManifestRows(selectedBuild = {}, selectedRamCount = 2) {
  return CATEGORIES.map((category) => {
    const item = selectedBuild?.[category] || null;
    const isMemory = category === 'Memory';
    const isPsu = category === 'Power Supplies';
    const isUnverified = isCustomPartItem(item);
    const ramInfo = isMemory && item ? parseRam(item, selectedRamCount) : null;
    const effectivePrice = item ? getEffectiveItemPrice(category, item, selectedRamCount) : 0;

    let priceLabel = '--';
    if (item) {
      priceLabel =
        effectivePrice > 0
          ? `\u20B1${Number(effectivePrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : 'Included';
    }

    return {
      category,
      shortLabel: getShortCategoryLabel(category),
      item,
      isMemory,
      isPsu,
      isUnverified,
      ramInfo,
      psuTier: isPsu && item ? getPsuProfile(item).tier : null,
      effectivePrice,
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
  const activePeakWatts = Number(powerMetrics.activePeakWatts || 0);
  const stockPeakWatts = Number(powerMetrics.stockPeakWatts || 0);
  const ocPeakWatts = Number(powerMetrics.ocPeakWatts || 0);
  const recommendedPsuWatts = Number(powerMetrics.recommendedPsuWatts || 0);
  const psuWatts = Number(psuInfo.watts || 0);

  const displayedWatts = powerDisplayView === 'idle' ? idleWatts : activePeakWatts;
  const capacityDenominator = psuWatts || recommendedPsuWatts || 650;
  const loadPercent =
    displayedWatts > 0 ? Math.min((displayedWatts / capacityDenominator) * 100, 100) : 0;
  const isOverPsuCap = psuWatts > 0 && activePeakWatts > psuWatts;

  return {
    displayedWatts,
    loadPercent,
    isOverPsuCap,
    modeLabel:
      powerDisplayView === 'idle'
        ? 'Idle Draw'
        : `${overclockEnabled ? 'OC' : 'Stock'} Peak`,
    idleWatts,
    stockPeakWatts,
    ocPeakWatts,
    recommendedPsuWatts,
    missingSpecs: Array.isArray(powerMetrics.missingSpecs) ? powerMetrics.missingSpecs : [],
  };
}