import { isPrebundledKit } from './pricing.js';

/**
 * Unified RAM parser for capacity, stick count, kit detection, total GB, and speed MHz.
 * Never invents a default capacity when none is present.
 */
export function parseRam(part, stickCount = 2) {
  if (!part) {
    return {
      stickCount: 0,
      perStickCapacity: 0,
      totalCapacity: 0,
      totalGb: 0,
      speedMhz: null,
      isKit: false,
      estimated: false,
    };
  }

  const combined = `${part.name || ''} ${part.capacity || ''} ${part.specs || ''}`.toUpperCase();
  const isKit = Boolean(isPrebundledKit(part));

  const packMatch = combined.match(/(\d+)\s*(?:X|×)\s*(\d+(?:\.\d+)?)\s*GB/);
  const singleCapMatch = combined.match(/(\d+(?:\.\d+)?)\s*GB/);

  let perStickCapacity = 0;
  let parsedSticksFromText = null;
  let estimated = false;

  if (
    part.capacity_gb !== undefined &&
    part.capacity_gb !== null &&
    part.capacity_gb !== '' &&
    Number.isFinite(Number(part.capacity_gb)) &&
    Number(part.capacity_gb) > 0
  ) {
    perStickCapacity = Number(part.capacity_gb);
    if (packMatch) {
      parsedSticksFromText = Number(packMatch[1]);
    }
  } else if (packMatch) {
    parsedSticksFromText = Number(packMatch[1]);
    perStickCapacity = Number(packMatch[2]);
    estimated = true;
  } else if (singleCapMatch) {
    perStickCapacity = Number(singleCapMatch[1]);
    estimated = true;
  }

  const requestedSticks = Math.max(1, Number(stickCount) || 1);
  let effectiveSticks = requestedSticks;

  if (isKit) {
    effectiveSticks = parsedSticksFromText
      ? Math.max(requestedSticks, parsedSticksFromText)
      : Math.max(2, requestedSticks);
  } else if (parsedSticksFromText && !stickCount) {
    effectiveSticks = parsedSticksFromText;
  }

  const totalCapacity = perStickCapacity > 0 ? perStickCapacity * effectiveSticks : 0;

  let speedMhz = null;
  if (
    part.speed_mhz !== undefined &&
    part.speed_mhz !== null &&
    part.speed_mhz !== '' &&
    Number.isFinite(Number(part.speed_mhz)) &&
    Number(part.speed_mhz) > 0
  ) {
    speedMhz = Number(part.speed_mhz);
  } else {
    const ddrSpeedMatch = combined.match(/\bDDR[45][-\s]?(\d{4})\b/);
    const mhzMatch = combined.match(/\b(\d{4})\s*MHZ\b/);
    if (ddrSpeedMatch) {
      speedMhz = Number(ddrSpeedMatch[1]);
      estimated = true;
    } else if (mhzMatch) {
      speedMhz = Number(mhzMatch[1]);
      estimated = true;
    }
  }

  return {
    stickCount: effectiveSticks,
    perStickCapacity,
    totalCapacity,
    totalGb: totalCapacity,
    speedMhz,
    isKit,
    estimated,
  };
}