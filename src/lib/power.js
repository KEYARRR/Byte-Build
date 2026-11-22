import { POWER_CONFIG, PSU_TIER_RANK } from './config.js';

export function parseNumberFromText(text, regexes) {
  const hay = String(text || '');
  for (const rx of regexes) {
    const m = hay.match(rx);
    if (m && m[1]) {
      const val = Number(m[1]);
      if (Number.isFinite(val) && val > 0) return val;
    }
  }
  return null;
}

export function getCpuPowerProfile(cpu) {
  if (!cpu) {
    return { tdpWatts: 0, cores: null, missingTdp: false };
  }
  const explicitTdp = Number(cpu.tdp || cpu.wattage || 0);
  const parsedTdp =
    explicitTdp > 0
      ? explicitTdp
      : parseNumberFromText(`${cpu.name || ''} ${cpu.specs || ''}`, [
          /\b(\d{2,3})\s*W\b/i,
          /TDP[:\s]*(\d{2,3})/i,
        ]);

  const cores =
    Number(cpu.cores || 0) ||
    parseNumberFromText(`${cpu.name || ''} ${cpu.specs || ''}`, [
      /\b(\d{1,2})[\s-]?core/i,
    ]);

  if (parsedTdp && parsedTdp > 0) {
    return { tdpWatts: parsedTdp, cores: cores || null, missingTdp: false };
  }

  return {
    tdpWatts: POWER_CONFIG.defaultCpuTdpWatts,
    cores: cores || null,
    missingTdp: true,
  };
}

export function getGpuPowerProfile(gpu) {
  if (!gpu) {
    return { watts: POWER_CONFIG.defaultGpuWatts, missingWatts: false };
  }
  const explicitWatts = Number(gpu.wattage || gpu.tdp || 0);
  const parsedWatts =
    explicitWatts > 0
      ? explicitWatts
      : parseNumberFromText(`${gpu.name || ''} ${gpu.specs || ''}`, [
          /\b(\d{2,3})\s*W\b/i,
          /TDP[:\s]*(\d{2,3})/i,
        ]);

  if (parsedWatts && parsedWatts > 0) {
    return { watts: parsedWatts, missingWatts: false };
  }

  return { watts: 0, missingWatts: true };
}

export function getPsuProfile(psu) {
  if (!psu) {
    return { watts: null, tier: 'Unknown', tierRank: 0, missingWatts: true };
  }
  const explicitWatts = Number(psu.wattage || 0);
  const parsedWatts =
    explicitWatts > 0
      ? explicitWatts
      : parseNumberFromText(`${psu.name || ''} ${psu.specs || ''}`, [
          /\b(\d{3,4})\s*W\b/i,
        ]);

  const rawTier = String(psu.psu_tier || psu.tier || '').trim().toUpperCase();
  const tier = Object.prototype.hasOwnProperty.call(PSU_TIER_RANK, rawTier)
    ? rawTier
    : 'Unknown';

  return {
    watts: parsedWatts || null,
    tier,
    tierRank: PSU_TIER_RANK[tier] ?? 0,
    missingWatts: !parsedWatts,
  };
}

export function calculateRigWattage(rig, ramStickCount = 1, overclocked = false) {
  const safeRig = rig || {};
  const cpuProf = getCpuPowerProfile(safeRig.Processors);
  const gpuProf = getGpuPowerProfile(safeRig['Video Cards']);
  const sticks = Math.max(1, Number(ramStickCount) || 1);

  const coolerText = `${safeRig['CPU Coolers']?.name || ''} ${safeRig['CPU Coolers']?.specs || ''}`.toLowerCase();
  const isAio = /aio|liquid|240mm|280mm|360mm/i.test(coolerText);

  const moboWatts = safeRig.Motherboards ? POWER_CONFIG.motherboardBaseWatts : 0;
  const ramWatts = safeRig.Memory ? sticks * POWER_CONFIG.perRamStickWatts : 0;
  const storageWatts = safeRig.Storage ? POWER_CONFIG.storageDriveWatts : 0;
  const coolerWatts = safeRig['CPU Coolers']
    ? isAio
      ? POWER_CONFIG.aioCoolerWatts
      : POWER_CONFIG.airCoolerWatts
    : 0;
  const caseWatts = safeRig.Cases ? POWER_CONFIG.caseFansWatts : 0;

  const baseStockPeakWatts =
    cpuProf.tdpWatts +
    gpuProf.watts +
    moboWatts +
    ramWatts +
    storageWatts +
    coolerWatts +
    caseWatts;

  const activePeakWatts = overclocked
    ? Math.round(baseStockPeakWatts * POWER_CONFIG.overclockPeakMultiplier)
    : baseStockPeakWatts;

  const idleWatts = Math.round(activePeakWatts * POWER_CONFIG.idleRatio);

  const rawRecommended = activePeakWatts * POWER_CONFIG.psuHeadroomMultiplier;
  const steppedRecommended =
    Math.ceil(rawRecommended / POWER_CONFIG.psuStepWatts) * POWER_CONFIG.psuStepWatts;
  const recommendedPsuWatts = Math.max(
    POWER_CONFIG.minRecommendedPsuWatts,
    steppedRecommended
  );

  return {
    cpuWatts: cpuProf.tdpWatts,
    gpuWatts: gpuProf.watts,
    moboWatts,
    ramWatts,
    storageWatts,
    coolerWatts,
    caseWatts,
    stockPeakWatts: baseStockPeakWatts,
    activePeakWatts,
    idleWatts,
    recommendedPsuWatts,
    hasMissingSpecs: cpuProf.missingTdp || (Boolean(safeRig['Video Cards']) && gpuProf.missingWatts),
  };
}