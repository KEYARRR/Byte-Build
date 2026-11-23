import { parseRam } from './ram.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function getPsuProfile(psu) {
  if (!psu) {
    return {
      tier: 'Unknown',
      tierRank: 0,
      watts: 0,
    };
  }

  const rawTier = String(psu.psu_tier || '').trim().toUpperCase();
  const text = `${psu.name || ''} ${psu.psu_tier || ''} ${psu.specs || ''}`.toUpperCase();

  let tier = rawTier;
  if (!tier) {
    if (text.includes('A+') || text.includes('TIER A+') || text.includes('PLATINUM') || text.includes('TITANIUM')) {
      tier = 'A+';
    } else if (/\bTIER\s*A\b/.test(text) || text.includes('GOLD') || text.includes('RM') || text.includes('FOCUS GX') || text.includes('CORE REACTOR')) {
      tier = 'A';
    } else if (/\bTIER\s*B\b/.test(text) || text.includes('BRONZE') || text.includes('CX') || text.includes('MWE')) {
      tier = 'B';
    } else if (/\bTIER\s*C\b/.test(text)) {
      tier = 'C';
    } else if (/\bTIER\s*D\b/.test(text)) {
      tier = 'D';
    } else if (/\bTIER\s*E\b/.test(text)) {
      tier = 'E';
    } else if (/\bTIER\s*F\b/.test(text) || text.includes('GENERIC')) {
      tier = 'F';
    } else {
      tier = 'C';
    }
  }

  const tierRankMap = {
    'A+': 5,
    A: 4,
    B: 3,
    C: 2,
    D: 1,
    E: 1,
    F: 0,
  };

  let watts = Number(psu.wattage || 0);
  if (!watts) {
    const match = text.match(/(\d{3,4})\s*W\b/);
    if (match) watts = Number(match[1]);
  }

  return {
    tier,
    tierRank: tierRankMap[tier] ?? 2,
    watts,
  };
}

export function getCpuPowerProfile(cpu) {
  if (!cpu) {
    return {
      baseWatts: 0,
      peakWatts: 0,
      idleWatts: 0,
      missingWatts: false,
      estimatedPeak: false,
    };
  }

  const explicitTdp = Number(cpu.tdp || cpu.wattage || 0);
  let baseWatts = explicitTdp;
  let missingWatts = false;

  if (!baseWatts) {
    const combined = `${cpu.name || ''} ${cpu.specs || ''}`.toUpperCase();
    const tdpMatch = combined.match(/(\d{2,3})\s*W\s*(?:TDP)?\b/);
    if (tdpMatch) {
      baseWatts = Number(tdpMatch[1]);
    } else {
      const name = String(cpu.name || '').toUpperCase();
      if (/\b(?:I9|RYZEN\s*9)\b/.test(name)) baseWatts = 125;
      else if (/\b(?:I7|RYZEN\s*7)\b/.test(name)) baseWatts = 105;
      else if (/\b(?:I5|RYZEN\s*5)\b/.test(name)) baseWatts = 65;
      else if (/\b(?:I3|RYZEN\s*3|ATHLON)\b/.test(name)) baseWatts = 65;
      else missingWatts = true;
    }
  }

  if (missingWatts || !baseWatts) {
    return {
      baseWatts: 0,
      peakWatts: 0,
      idleWatts: 0,
      missingWatts: true,
      estimatedPeak: false,
    };
  }

  const isHighDraw = /\b(?:I9|I7|RYZEN\s*9|RYZEN\s*7)\b/.test(String(cpu.name || '').toUpperCase());
  const peakMultiplier = isHighDraw || baseWatts >= 105 ? 1.35 : 1.2;
  const peakWatts = Math.round(baseWatts * peakMultiplier);
  const idleWatts = Math.max(8, Math.round(baseWatts * 0.14));

  return {
    baseWatts,
    peakWatts,
    idleWatts,
    missingWatts: false,
    estimatedPeak: peakMultiplier > 1.2,
  };
}

export function getGpuPowerProfile(gpu) {
  if (!gpu) {
    return {
      watts: null,
      idleWatts: 0,
      missingWatts: false,
    };
  }

  const explicitWatts = Number(gpu.wattage || gpu.tdp || 0);
  if (explicitWatts > 0) {
    return {
      watts: explicitWatts,
      idleWatts: Math.max(10, Math.round(explicitWatts * 0.1)),
      missingWatts: false,
    };
  }

  const cleanedSpecs = String(gpu.specs || '').replace(
    /(?:RECOMMENDED|MINIMUM|MIN|SUGGESTED)?\s*(?:PSU|POWER\s*SUPPLY)[^\d]{0,10}\d{3,4}\s*W/gi,
    ''
  );
  const combined = `${gpu.name || ''} ${cleanedSpecs}`.toUpperCase();
  const drawMatch = combined.match(/\b(\d{2,3})\s*W\b/);

  if (drawMatch) {
    const watts = Number(drawMatch[1]);
    return {
      watts,
      idleWatts: Math.max(10, Math.round(watts * 0.1)),
      missingWatts: false,
    };
  }

  return {
    watts: null,
    idleWatts: 0,
    missingWatts: true,
  };
}

export function computeRecommendedPsuWatts(peakWatts, bufferWatts = 120) {
  const peak = Number(peakWatts || 0);
  if (peak <= 0) return 0;
  const buffer = Number.isFinite(Number(bufferWatts)) ? Number(bufferWatts) : 120;
  const rawTarget = Math.max(peak * 1.25, peak + buffer);
  const rounded = Math.ceil(rawTarget / 50) * 50;
  return Math.max(450, rounded);
}

export function calculateRigWattage(parts = {}, ramStickCount = 2, options = {}) {
  const overclocked = typeof options === 'boolean' ? options : Boolean(options?.overclocked);
  const bufferWatts = typeof options === 'object' && options?.bufferWatts !== undefined
    ? Number(options.bufferWatts)
    : 120;

  const cpu = parts.Processors || null;
  const gpu = parts['Video Cards'] || null;
  const board = parts.Motherboards || null;
  const ram = parts.Memory || null;
  const storage = parts.Storage || null;
  const cooler = parts['CPU Coolers'] || null;

  const missingSpecs = [];

  const cpuProfile = getCpuPowerProfile(cpu);
  if (cpu && cpuProfile.missingWatts) {
    missingSpecs.push({ category: 'Processors', name: cpu.name });
  }

  const gpuProfile = getGpuPowerProfile(gpu);
  if (gpu && gpuProfile.missingWatts) {
    missingSpecs.push({ category: 'Video Cards', name: gpu.name });
  }

  const boardWatts = board ? Number(board.wattage || 35) : 0;
  const parsedRam = ram ? parseRam(ram, ramStickCount) : null;
  const ramWatts = parsedRam && parsedRam.stickCount > 0 ? parsedRam.stickCount * 4 : 0;
  const storageWatts = storage ? Number(storage.wattage || 6) : 0;
  const coolerWatts = cooler
    ? Number(
        cooler.wattage ||
          (normalizeText(cooler.name).includes('aio') || normalizeText(cooler.name).includes('liquid')
            ? 12
            : 5)
      )
    : 0;

  const baseIdle =
    (cpuProfile.idleWatts || 0) +
    (gpuProfile.idleWatts || 0) +
    (board ? Math.round(boardWatts * 0.35) : 0) +
    (ram ? Math.max(2, Math.round(ramWatts * 0.5)) : 0) +
    (storage ? 2 : 0) +
    (cooler ? Math.max(2, Math.round(coolerWatts * 0.5)) : 0);

  const stockPeakWatts =
    (cpuProfile.peakWatts || 0) +
    (gpuProfile.watts || 0) +
    boardWatts +
    ramWatts +
    storageWatts +
    coolerWatts;

  const ocFactor = overclocked ? 1.15 : 1.0;
  const ocPeakWatts = stockPeakWatts > 0 ? Math.round(stockPeakWatts * ocFactor) : 0;
  const activePeakWatts = overclocked ? ocPeakWatts : stockPeakWatts;
  const recommendedPsuWatts = computeRecommendedPsuWatts(activePeakWatts, bufferWatts);

  return {
    idleWatts: baseIdle,
    stockPeakWatts,
    ocPeakWatts,
    activePeakWatts,
    recommendedPsuWatts,
    missingSpecs,
    hasMissingSpecs: missingSpecs.length > 0,
    hasEstimatedCpuPeak: Boolean(cpuProfile.estimatedPeak),
  };
}