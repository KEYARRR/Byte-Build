import { parseRam } from './ram.js';

export function normalizeSocketText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\bSOCKET\b/g, '')
    .replace(/[\s-]+/g, '')
    .trim();
}

export function detectCpuSocket(part) {
  if (!part) return '';
  if (part.socket) {
    const normalized = normalizeSocketText(part.socket);
    if (normalized) return normalized;
  }

  const name = String(part.name || '').toUpperCase();
  const normalizedName = normalizeSocketText(name);

  if (normalizedName.includes('LGA1851')) return 'LGA1851';
  if (normalizedName.includes('LGA1700')) return 'LGA1700';
  if (normalizedName.includes('LGA1200')) return 'LGA1200';
  if (normalizedName.includes('LGA1151')) return 'LGA1151';

  // 1. Check Intel patterns BEFORE AMD ones
  if (/(?<![A-Z0-9])CORE\s*ULTRA\s*[3579]\s*2\d{2}[A-Z0-9]*(?![A-Z0-9])/.test(name)) {
    return 'LGA1851';
  }

  const intelCoreMatch = name.match(/(?<![A-Z0-9])I[3579][\s-]?(\d{4,5})[A-Z0-9]*(?![A-Z0-9])/);
  if (intelCoreMatch) {
    const modelNum = Number(intelCoreMatch[1]);
    if (modelNum >= 6000 && modelNum <= 9999) return 'LGA1151';
    if (modelNum >= 10000 && modelNum <= 11999) return 'LGA1200';
    if (modelNum >= 12000 && modelNum <= 14999) return 'LGA1700';
  }

  if (/(?<![A-Z0-9])(12TH|13TH|14TH)\s*GEN(?![A-Z0-9])/.test(name) && /\b(INTEL|CORE)\b/.test(name)) {
    return 'LGA1700';
  }
  if (/(?<![A-Z0-9])(10TH|11TH)\s*GEN(?![A-Z0-9])/.test(name) && /\b(INTEL|CORE)\b/.test(name)) {
    return 'LGA1200';
  }
  if (/(?<![A-Z0-9])(6TH|7TH|8TH|9TH)\s*GEN(?![A-Z0-9])/.test(name) && /\b(INTEL|CORE)\b/.test(name)) {
    return 'LGA1151';
  }

  // 2. Check AMD patterns
  if (normalizedName.includes('AM5')) return 'AM5';
  if (normalizedName.includes('AM4')) return 'AM4';

  if (/(?<![A-Z0-9])(ATHLON|200GE|220GE|240GE|3000G)(?![A-Z0-9])/.test(name)) {
    return 'AM4';
  }

  const ryzenMatch = name.match(/(?<![A-Z0-9])RYZEN\s*[3579]\s*(\d)\d{3}[A-Z0-9]*(?![A-Z0-9])/);
  if (ryzenMatch) {
    const seriesDigit = Number(ryzenMatch[1]);
    if (seriesDigit >= 1 && seriesDigit <= 5) return 'AM4';
    if (seriesDigit === 7 || seriesDigit === 8 || seriesDigit === 9) return 'AM5';
  }

  return '';
}

export function detectMotherboardSocket(part) {
  if (!part) return '';
  if (part.socket) {
    const normalized = normalizeSocketText(part.socket);
    if (normalized) return normalized;
  }

  const name = String(part.name || '').toUpperCase();
  const normalizedName = normalizeSocketText(name);

  if (normalizedName.includes('LGA1851')) return 'LGA1851';
  if (normalizedName.includes('LGA1700')) return 'LGA1700';
  if (normalizedName.includes('LGA1200')) return 'LGA1200';
  if (normalizedName.includes('LGA1151')) return 'LGA1151';
  if (normalizedName.includes('AM5')) return 'AM5';
  if (normalizedName.includes('AM4')) return 'AM4';

  // 1. Check Intel chipsets BEFORE AMD ones
  if (/(?<![A-Z0-9])(Z890|B860|H810)[A-Z]*(?![A-Z0-9])/.test(name)) return 'LGA1851';
  if (/(?<![A-Z0-9])(H610|B660|B760|H670|Z690|Z790)[A-Z]*(?![A-Z0-9])/.test(name)) {
    return 'LGA1700';
  }
  if (/(?<![A-Z0-9])(H410|B460|H470|Z490|H510|B560|H570|Z590)[A-Z]*(?![A-Z0-9])/.test(name)) {
    return 'LGA1200';
  }
  if (
    /(?<![A-Z0-9])(H110|B150|H170|Z170|B250|H270|Z270|H310|B360|B365|H370|Z370|Z390)[A-Z]*(?![A-Z0-9])/.test(
      name
    )
  ) {
    return 'LGA1151';
  }

  // 2. Check AMD chipsets
  if (/(?<![A-Z0-9])(A620|B650|B850|X670|X870)[A-Z]*(?![A-Z0-9])/.test(name)) return 'AM5';
  if (/(?<![A-Z0-9])(A320|A520|B350|B450|B550|X370|X470|X570)[A-Z]*(?![A-Z0-9])/.test(name)) {
    return 'AM4';
  }

  return '';
}

export function hasIntegratedGraphics(cpu) {
  if (!cpu) return null;
  if (typeof cpu.has_igpu === 'boolean') return cpu.has_igpu;
  if (isCustomPart(cpu)) return null;
  const name = String(cpu.name || '').toUpperCase();
  const specs = String(cpu.specs || '').toUpperCase();
  const combined = `${name} ${specs}`;

  if (/\bI[3579][\s-]?\d{4,5}(?:KF|KSF|F)\b/.test(name)) return false;
  if (/\bCORE\s+ULTRA\s+[3579][\s-]?\d{3}(?:KF|F)\b/.test(name)) return false;
  if (/\b[789]\d{3}F\b/.test(name)) return false;

  if (
    /\bRYZEN\s+[3579]\s+[12345]\d{3}(?:X3D|XT|X)?\b/.test(name) &&
    !/\b\d{4}G(?:E|T)?\b/.test(name)
  ) {
    return false;
  }

  if (
    /\b\d{4}G(?:E|T)?\b/.test(name) ||
    /\b(?:ATHLON|200GE|220GE|240GE|3000G)\b/.test(name) ||
    /\bRYZEN\s+[3579]\s+[789]\d{3}[A-Z0-9]*\b/.test(name) ||
    /\bCORE\s+(?:I[3579]|ULTRA\s+[3579])\b/.test(name) ||
    /(RADEON\s+GRAPHICS|UHD\s+GRAPHICS|IRIS\s+XE|INTEGRATED\s+GRAPHICS)/.test(combined)
  ) {
    return true;
  }
  return null;
}

export function getCustomPartFlags(build = {}) {
  const customCategories = Object.entries(build)
    .filter(([, part]) => Boolean(part && (part.isCustomInput || part.unverified)))
    .map(([cat]) => cat);

  return {
    hasCustomPart: customCategories.length > 0,
    customCategories,
  };
}

function isCustomPart(part) {
  return Boolean(part && (part.isCustomInput || part.unverified));
}

function parseDriveCapacityGb(drive) {
  if (!drive || isCustomPart(drive)) return { gb: null, estimated: false };
  if (drive.capacity_gb !== undefined && drive.capacity_gb !== null && drive.capacity_gb !== '') {
    return { gb: Number(drive.capacity_gb), estimated: false };
  }
  const combined = `${drive.name || ''} ${drive.capacity || ''} ${drive.specs || ''}`.toUpperCase();
  const tbM = combined.match(/(\d+(?:\.\d+)?)\s*TB/);
  const gbM = combined.match(/(\d+)\s*GB/);
  const gb = tbM ? Math.round(Number(tbM[1]) * 1000) : gbM ? Number(gbM[1]) : null;
  return { gb, estimated: Boolean(gb) };
}

function normalizeFormFactor(raw) {
  const txt = String(raw || '').toUpperCase();
  if (!txt) return '';
  if (txt.includes('MINI-ITX') || txt.includes('ITX')) return 'ITX';
  if (txt.includes('MICRO-ATX') || txt.includes('M-ATX') || txt.includes('MATX')) return 'MATX';
  if (txt.includes('E-ATX') || txt.includes('EATX')) return 'EATX';
  if (txt.includes('ATX')) return 'ATX';
  return '';
}

function inferBoardFormFactor(board) {
  if (!board) return { value: '', estimated: false };
  if (board.form_factor) {
    const ff = normalizeFormFactor(board.form_factor);
    if (ff) return { value: ff, estimated: false };
  }
  if (isCustomPart(board)) return { value: '', estimated: false };
  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  if (/(MINI-ITX|\bITX\b)/.test(combined)) return { value: 'ITX', estimated: true };
  if (/(MICRO-ATX|M-ATX|MATX|\b(?:A520|B450|B550|A620|B650|B760|B660|H610)M\b)/.test(combined)) {
    return { value: 'MATX', estimated: true };
  }
  if (/(E-ATX|EATX)/.test(combined)) return { value: 'EATX', estimated: true };
  if (/\bATX\b/.test(combined)) return { value: 'ATX', estimated: true };
  return { value: '', estimated: false };
}

function inferSupportedFormFactors(pcCase) {
  if (!pcCase) return { values: [], estimated: false };
  if (pcCase.supported_form_factors) {
    const values = String(pcCase.supported_form_factors)
      .split(',')
      .map((s) => normalizeFormFactor(s))
      .filter(Boolean);
    if (values.length > 0) return { values, estimated: false };
  }
  if (pcCase.form_factor) {
    const ff = normalizeFormFactor(pcCase.form_factor);
    if (ff === 'EATX') return { values: ['EATX', 'ATX', 'MATX', 'ITX'], estimated: false };
    if (ff === 'ATX') return { values: ['ATX', 'MATX', 'ITX'], estimated: false };
    if (ff === 'MATX') return { values: ['MATX', 'ITX'], estimated: false };
    if (ff === 'ITX') return { values: ['ITX'], estimated: false };
  }
  if (isCustomPart(pcCase)) return { values: [], estimated: false };
  const combined = `${pcCase.name || ''} ${pcCase.specs || ''}`.toUpperCase();
  if (/(MINI-ITX|\bITX\b)/.test(combined) && !combined.includes('ATX')) {
    return { values: ['ITX'], estimated: true };
  }
  if (/(MICRO-ATX|M-ATX|MATX)/.test(combined)) {
    return { values: ['MATX', 'ITX'], estimated: true };
  }
  if (/\bATX\b/.test(combined) || combined.includes('MID TOWER') || combined.includes('MID-TOWER')) {
    return { values: ['ATX', 'MATX', 'ITX'], estimated: true };
  }
  return { values: [], estimated: false };
}

function inferCoolerSockets(cooler) {
  if (!cooler) return { sockets: [], estimated: false };
  if (cooler.supported_sockets) {
    const sockets = String(cooler.supported_sockets)
      .split(',')
      .map((s) => normalizeSocketText(s))
      .filter(Boolean);
    if (sockets.length > 0) return { sockets, estimated: false };
  }
  if (isCustomPart(cooler)) return { sockets: [], estimated: false };
  const combined = `${cooler.name || ''} ${cooler.specs || ''}`.toUpperCase();
  const normCombined = normalizeSocketText(combined);
  const explicit = [];
  if (normCombined.includes('AM4')) explicit.push('AM4');
  if (normCombined.includes('AM5')) explicit.push('AM5');
  if (normCombined.includes('LGA1700')) explicit.push('LGA1700');
  if (normCombined.includes('LGA1851')) explicit.push('LGA1851');
  if (normCombined.includes('LGA1200')) explicit.push('LGA1200');
  if (normCombined.includes('LGA1151')) explicit.push('LGA1151');
  if (explicit.length > 0) return { sockets: explicit, estimated: true };
  return { sockets: [], estimated: false };
}

function inferM2Slots(board) {
  if (!board) return { slots: null, estimated: false };
  if (board.m2_slots !== undefined && board.m2_slots !== null && board.m2_slots !== '') {
    return { slots: Number(board.m2_slots), estimated: false };
  }
  if (isCustomPart(board)) return { slots: null, estimated: false };
  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  const match = combined.match(/(\d)\s*X?\s*M\.2/);
  if (match) return { slots: Number(match[1]), estimated: true };
  return { slots: null, estimated: false };
}

function inferBoardRamLimits(board) {
  if (!board) return { maxGb: null, maxMhz: null, estimated: false };
  const maxGb =
    board.max_ram_gb !== undefined && board.max_ram_gb !== null && board.max_ram_gb !== ''
      ? Number(board.max_ram_gb)
      : null;
  const maxMhz =
    board.max_ram_mhz !== undefined && board.max_ram_mhz !== null && board.max_ram_mhz !== ''
      ? Number(board.max_ram_mhz)
      : null;

  if (maxGb !== null || maxMhz !== null) {
    return { maxGb, maxMhz, estimated: false };
  }
  if (isCustomPart(board)) return { maxGb: null, maxMhz: null, estimated: false };

  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  const gbMatch = combined.match(/MAX\s*(\d{2,3})\s*GB/);
  const mhzMatch = combined.match(/(\d{4})\s*MHZ/);
  if (gbMatch || mhzMatch) {
    return {
      maxGb: gbMatch ? Number(gbMatch[1]) : null,
      maxMhz: mhzMatch ? Number(mhzMatch[1]) : null,
      estimated: true,
    };
  }
  return { maxGb: null, maxMhz: null, estimated: false };
}

function inferGpuLengthMm(gpu) {
  if (!gpu) return { mm: null, estimated: false };
  if (gpu.length_mm !== undefined && gpu.length_mm !== null && gpu.length_mm !== '') {
    return { mm: Number(gpu.length_mm), estimated: false };
  }
  if (isCustomPart(gpu)) return { mm: null, estimated: false };
  const combined = `${gpu.name || ''} ${gpu.specs || ''}`.toUpperCase();
  const mmMatch = combined.match(/(\d{2,3})\s*MM/);
  if (mmMatch) return { mm: Number(mmMatch[1]), estimated: true };
  return { mm: null, estimated: false };
}

function inferCaseClearance(pcCase) {
  if (!pcCase) return { maxGpuMm: null, maxCoolerMm: null, gpuEstimated: false, coolerEstimated: false };
  const maxGpuMm =
    pcCase.max_gpu_length_mm !== undefined &&
    pcCase.max_gpu_length_mm !== null &&
    pcCase.max_gpu_length_mm !== ''
      ? Number(pcCase.max_gpu_length_mm)
      : null;
  const maxCoolerMm =
    pcCase.max_cooler_height_mm !== undefined &&
    pcCase.max_cooler_height_mm !== null &&
    pcCase.max_cooler_height_mm !== ''
      ? Number(pcCase.max_cooler_height_mm)
      : null;

  if (maxGpuMm !== null || maxCoolerMm !== null) {
    return { maxGpuMm, maxCoolerMm, gpuEstimated: false, coolerEstimated: false };
  }
  if (isCustomPart(pcCase)) {
    return { maxGpuMm: null, maxCoolerMm: null, gpuEstimated: false, coolerEstimated: false };
  }

  const combined = `${pcCase.name || ''} ${pcCase.specs || ''}`.toUpperCase();
  const gpuMatch = combined.match(/(?:GPU|VGA)[^\d]{0,12}(\d{2,3})\s*MM/);
  const clrMatch = combined.match(/(?:COOLER|CPU)[^\d]{0,12}(\d{2,3})\s*MM/);
  return {
    maxGpuMm: gpuMatch ? Number(gpuMatch[1]) : null,
    maxCoolerMm: clrMatch ? Number(clrMatch[1]) : null,
    gpuEstimated: Boolean(gpuMatch),
    coolerEstimated: Boolean(clrMatch),
  };
}

function inferCoolerHeightMm(cooler) {
  if (!cooler) return { mm: null, estimated: false };
  if (
    cooler.cooler_height_mm !== undefined &&
    cooler.cooler_height_mm !== null &&
    cooler.cooler_height_mm !== ''
  ) {
    return { mm: Number(cooler.cooler_height_mm), estimated: false };
  }
  if (isCustomPart(cooler)) return { mm: null, estimated: false };
  const combined = `${cooler.name || ''} ${cooler.specs || ''}`.toUpperCase();
  const mmMatch = combined.match(/(\d{2,3})\s*MM/);
  if (mmMatch && Number(mmMatch[1]) >= 40 && Number(mmMatch[1]) <= 185) {
    return { mm: Number(mmMatch[1]), estimated: true };
  }
  return { mm: null, estimated: false };
}

function finalizeRule(rule) {
  if (rule.dataSource === 'estimated' && rule.status === 'fail') {
    return {
      ...rule,
      status: 'warn',
      message: `${rule.message} (based on estimated specs)`,
    };
  }
  return rule;
}

export function evaluateBuildRules(build = {}, ctx = {}) {
  const results = [];
  const cpu = build.Processors || null;
  const board = build.Motherboards || null;
  const gpu = build['Video Cards'] || null;
  const ram = build.Memory || null;
  const storage = build.Storage || null;
  const hardDrive = build['Hard Drives'] || null;
  const psu = build['Power Supplies'] || null;
  const cooler = build['CPU Coolers'] || null;
  const pcCase = build.Cases || null;
  const partCount = Object.values(build).filter(Boolean).length;

  // 1. RULE-SOCK-01: CPU <-> Motherboard Socket
  const cpuSocket = detectCpuSocket(cpu);
  const boardSocket = detectMotherboardSocket(board);
  const sockEstimated = Boolean(
    (cpu && !cpu.socket && cpuSocket) || (board && !board.socket && boardSocket)
  );
  const sockUnverified = isCustomPart(cpu) || isCustomPart(board);
  const sockMissing = [];
  if (!cpu || !cpuSocket) sockMissing.push('Processors.socket');
  if (!board || !boardSocket) sockMissing.push('Motherboards.socket');

  if (sockMissing.length > 0) {
    results.push({
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      title: 'CPU & Motherboard Socket',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: sockMissing,
      unverified: sockUnverified,
      message: `Socket comparison incomplete (CPU: ${cpuSocket || 'unknown'}, Board: ${boardSocket || 'unknown'}).`,
      recommendation: 'Ensure both CPU and Motherboard specify matching sockets.',
    });
  } else if (cpuSocket !== boardSocket) {
    results.push(
      finalizeRule({
        ruleId: 'RULE-SOCK-01',
        category: 'Processors',
        title: 'CPU & Motherboard Socket',
        status: 'fail',
        dataSource: sockEstimated ? 'estimated' : 'database',
        missingFields: [],
        unverified: sockUnverified,
        message: `Socket mismatch: ${cpu.name} (${cpuSocket}) is not compatible with ${board.name} (${boardSocket}).`,
        recommendation: `Choose an ${cpuSocket} motherboard or matching ${boardSocket} CPU.`,
      })
    );
  } else {
    results.push({
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      title: 'CPU & Motherboard Socket',
      status: 'pass',
      dataSource: sockEstimated ? 'estimated' : 'database',
      missingFields: [],
      unverified: sockUnverified,
      message: `Socket ${cpuSocket} verified between CPU and Motherboard.`,
    });
  }

  // Advisory for A320 boards paired with Ryzen 5000 CPUs (BIOS support varies / unverified)
  const boardUpper = `${board?.name || ''} ${board?.specs || ''}`.toUpperCase();
  const cpuUpper = `${cpu?.name || ''} ${cpu?.specs || ''}`.toUpperCase();
  if (board && cpu && /\bA320\b/.test(boardUpper) && /\bRYZEN\s+[3579]\s+5\d{3}[A-Z0-9]*\b/.test(cpuUpper)) {
    results.push({
      ruleId: 'RULE-A320-5000',
      category: 'Motherboards',
      title: 'A320 BIOS / Ryzen 5000 Support',
      status: 'warn',
      dataSource: 'estimated',
      missingFields: [],
      unverified: true,
      message:
        'A320 boards often require a BIOS update for Ryzen 5000 (and some models lack support). Verify exact board BIOS support before purchase.',
      recommendation: 'Confirm exact A320 board BIOS support or choose a B450/B550 board.',
    });
  }

  // 2. RULE-MEM-01: RAM <-> Motherboard Memory Type
  let ramType = ram?.memory_type ? String(ram.memory_type).trim().toUpperCase() : '';
  let ramMemEstimated = false;
  if (!ramType && ram) {
    const rText = `${ram.name || ''} ${ram.specs || ''}`.toUpperCase();
    if (/\bDDR5\b/.test(rText)) {
      ramType = 'DDR5';
      ramMemEstimated = true;
    } else if (/\bDDR4\b/.test(rText)) {
      ramType = 'DDR4';
      ramMemEstimated = true;
    }
  }
  let boardMemType = board?.memory_type ? String(board.memory_type).trim().toUpperCase() : '';
  let boardMemEstimated = false;
  if (!boardMemType && board) {
    const bText = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
    if (/\bDDR5\b/.test(bText)) {
      boardMemType = 'DDR5';
      boardMemEstimated = true;
    } else if (/\bDDR4\b/.test(bText)) {
      boardMemType = 'DDR4';
      boardMemEstimated = true;
    } else if (boardSocket === 'AM5') {
      boardMemType = 'DDR5';
      boardMemEstimated = true;
    } else if (boardSocket === 'AM4') {
      boardMemType = 'DDR4';
      boardMemEstimated = true;
    }
  }
  const memUnverified = isCustomPart(ram) || isCustomPart(board);
  const memMissing = [];
  if (!ram || !ramType) memMissing.push('Memory.memory_type');
  if (!board || !boardMemType) memMissing.push('Motherboards.memory_type');

  if (memMissing.length > 0) {
    results.push({
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      title: 'Memory Standard Compatibility',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: memMissing,
      unverified: memUnverified,
      message: `Memory standard incomplete (RAM: ${ramType || 'unknown'}, Board: ${boardMemType || 'unknown'}).`,
      recommendation: 'Verify DDR4/DDR5 generation on both RAM and Motherboard.',
    });
  } else if (ramType !== boardMemType) {
    results.push(
      finalizeRule({
        ruleId: 'RULE-MEM-01',
        category: 'Memory',
        title: 'Memory Standard Compatibility',
        status: 'fail',
        dataSource: ramMemEstimated || boardMemEstimated ? 'estimated' : 'database',
        missingFields: [],
        unverified: memUnverified,
        message: `${ram.name} (${ramType}) cannot be installed in ${board.name} (${boardMemType}).`,
        recommendation: `Select ${boardMemType} memory modules.`,
      })
    );
  } else {
    results.push({
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      title: 'Memory Standard Compatibility',
      status: 'pass',
      dataSource: ramMemEstimated || boardMemEstimated ? 'estimated' : 'database',
      missingFields: [],
      unverified: memUnverified,
      message: `${ramType} memory standard matches motherboard.`,
    });
  }

  // 3. RULE-PSU-01: PSU Wattage & Headroom
  let psuWatts =
    psu?.wattage !== undefined && psu?.wattage !== null && psu?.wattage !== ''
      ? Number(psu.wattage)
      : null;
  let psuWattsEstimated = false;
  if (!psuWatts && psu && !isCustomPart(psu)) {
    const m = String(`${psu.name || ''} ${psu.specs || ''}`).match(/(\d{3,4})\s*W\b/i);
    if (m) {
      psuWatts = Number(m[1]);
      psuWattsEstimated = true;
    }
  }
  const peakWatts = Number(ctx.peakWatts || 0);
  const recPsuWatts = Number(ctx.recommendedPsuWatts || 0);
  const psuUnverified = isCustomPart(psu);
  const psuMissing = [];
  if (!psu || !psuWatts) psuMissing.push('Power Supplies.wattage');
  if (!peakWatts) psuMissing.push('estimatedPeakWatts');

  if (psuMissing.length > 0) {
    results.push({
      ruleId: 'RULE-PSU-01',
      category: 'Power Supplies',
      title: 'Power Supply Capacity & Headroom',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: psuMissing,
      unverified: psuUnverified,
      message: `PSU wattage (${psuWatts || 'unknown'}W) or system load (${peakWatts || 'unknown'}W) is incomplete.`,
      recommendation: 'Select a power supply with verified wattage rating.',
    });
  } else {
    const ds = psuWattsEstimated || ctx.hasEstimatedPower ? 'estimated' : 'database';
    if (psuWatts < peakWatts) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-PSU-01',
          category: 'Power Supplies',
          title: 'Power Supply Capacity & Headroom',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: psuUnverified,
          message: `${psu.name} (${psuWatts}W) is below peak system draw (${peakWatts}W).`,
          recommendation: `Upgrade to at least a ${recPsuWatts || peakWatts + 120}W power supply.`,
        })
      );
    } else if (recPsuWatts && psuWatts < recPsuWatts) {
      results.push({
        ruleId: 'RULE-PSU-01',
        category: 'Power Supplies',
        title: 'Power Supply Capacity & Headroom',
        status: 'warn',
        dataSource: ds,
        missingFields: [],
        unverified: psuUnverified,
        message: `${psu.name} (${psuWatts}W) covers peak draw (${peakWatts}W) but is below recommended ${recPsuWatts}W headroom.`,
        recommendation: `Consider a ${recPsuWatts}W unit for transient spike margin.`,
      });
    } else {
      results.push({
        ruleId: 'RULE-PSU-01',
        category: 'Power Supplies',
        title: 'Power Supply Capacity & Headroom',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: psuUnverified,
        message: `${psuWatts}W PSU satisfies ${peakWatts}W peak draw and ${recPsuWatts || psuWatts}W target.`,
      });
    }
  }

  // 4. RULE-STOR-01: Primary Storage + Secondary Hard Drive Capacity
  const minStorageGb = Number(ctx.minStorageGb || 500);
  const ssdInfo = parseDriveCapacityGb(storage);
  const hddInfo = parseDriveCapacityGb(hardDrive);
  const storEstimated = Boolean(ssdInfo.estimated || hddInfo.estimated);
  const storUnverified = isCustomPart(storage) || isCustomPart(hardDrive);

  const hasAnyDrive = Boolean(storage || hardDrive);
  const totalStorageGb = (ssdInfo.gb || 0) + (hddInfo.gb || 0);
  const hasKnownCapacity = ssdInfo.gb !== null || hddInfo.gb !== null;

  if (!hasAnyDrive || !hasKnownCapacity) {
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Storage Baseline',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: ['Storage.capacity_gb'],
      unverified: storUnverified,
      message: 'Storage drive or capacity is not specified.',
      recommendation: `Select an SSD/HDD configuration of at least ${minStorageGb}GB.`,
    });
  } else if (totalStorageGb < minStorageGb) {
    const breakdown =
      storage && hardDrive
        ? ` (${ssdInfo.gb || 0}GB SSD + ${hddInfo.gb || 0}GB HDD)`
        : '';
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Storage Baseline',
      status: 'warn',
      dataSource: storEstimated ? 'estimated' : 'database',
      missingFields: [],
      unverified: storUnverified,
      message: `Combined storage (${totalStorageGb}GB)${breakdown} is below the ${minStorageGb}GB recommended baseline.`,
      recommendation: `Add a larger SSD or pair with a secondary Hard Drive for extra capacity.`,
    });
  } else {
    const hasBalancedHdd = Boolean(storage && hardDrive);
    const breakdown = hasBalancedHdd
      ? ` (${ssdInfo.gb || 0}GB SSD + ${hddInfo.gb || 0}GB HDD)`
      : '';
    const futureUpgradeTip =
      storage && (ssdInfo.gb || 0) < minStorageGb
        ? `Future Upgrade Tip: Your ${ssdInfo.gb || 0}GB SSD + ${hddInfo.gb || 0}GB HDD covers bulk storage now; upgrading to a 500GB–1TB NVMe SSD later will give more fast game/app space.`
        : undefined;
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Storage Baseline',
      status: 'pass',
      dataSource: storEstimated ? 'estimated' : 'database',
      hasBalancedHdd,
      missingFields: [],
      unverified: storUnverified,
      message: `Combined storage (${totalStorageGb}GB)${breakdown} meets the ${minStorageGb}GB baseline.`,
      recommendation: futureUpgradeTip,
    });
  }

  // 5. RULE-GPU-LEN-01: GPU Length vs Case Max GPU Clearance
  const gpuLenInfo = inferGpuLengthMm(gpu);
  const caseClearance = inferCaseClearance(pcCase);
  const gpuCaseUnverified = isCustomPart(gpu) || isCustomPart(pcCase);
  const gpuLenMissing = [];
  if (!gpu || !gpuLenInfo.mm) gpuLenMissing.push('Video Cards.length_mm');
  if (!pcCase || !caseClearance.maxGpuMm) gpuLenMissing.push('Cases.max_gpu_length_mm');

  if (gpuLenMissing.length > 0) {
    results.push({
      ruleId: 'RULE-GPU-LEN-01',
      category: 'Cases',
      title: 'GPU Length vs. Case Clearance',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: gpuLenMissing,
      unverified: gpuCaseUnverified,
      message: `GPU length (${gpuLenInfo.mm || 'unknown'}mm) vs. case max GPU clearance (${caseClearance.maxGpuMm || 'unknown'}mm) is incomplete.`,
      recommendation: 'Verify GPU length and chassis clearance specifications.',
    });
  } else {
    const ds = gpuLenInfo.estimated || caseClearance.gpuEstimated ? 'estimated' : 'database';
    if (gpuLenInfo.mm > caseClearance.maxGpuMm) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-GPU-LEN-01',
          category: 'Cases',
          title: 'GPU Length vs. Case Clearance',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: gpuCaseUnverified,
          message: `${gpu.name} (${gpuLenInfo.mm}mm) exceeds ${pcCase.name} max GPU length (${caseClearance.maxGpuMm}mm).`,
          recommendation: 'Select a longer chassis or shorter dual-fan GPU.',
        })
      );
    } else {
      results.push({
        ruleId: 'RULE-GPU-LEN-01',
        category: 'Cases',
        title: 'GPU Length vs. Case Clearance',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: gpuCaseUnverified,
        message: `GPU length (${gpuLenInfo.mm}mm) fits within case clearance (${caseClearance.maxGpuMm}mm).`,
      });
    }
  }

  // 6. RULE-CLR-HGT-01: CPU Cooler Height vs Case Max Cooler Clearance
  const coolerHInfo = inferCoolerHeightMm(cooler);
  const clrCaseUnverified = isCustomPart(cooler) || isCustomPart(pcCase);
  const clrHMissing = [];
  if (!cooler || !coolerHInfo.mm) clrHMissing.push('CPU Coolers.cooler_height_mm');
  if (!pcCase || !caseClearance.maxCoolerMm) clrHMissing.push('Cases.max_cooler_height_mm');

  if (clrHMissing.length > 0) {
    results.push({
      ruleId: 'RULE-CLR-HGT-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Height vs. Case Clearance',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: clrHMissing,
      unverified: clrCaseUnverified,
      message: `Cooler height (${coolerHInfo.mm || 'unknown'}mm) vs. case max cooler clearance (${caseClearance.maxCoolerMm || 'unknown'}mm) is incomplete.`,
      recommendation: 'Verify cooler height against chassis CPU cooler clearance.',
    });
  } else {
    const ds = coolerHInfo.estimated || caseClearance.coolerEstimated ? 'estimated' : 'database';
    if (coolerHInfo.mm > caseClearance.maxCoolerMm) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-CLR-HGT-01',
          category: 'CPU Coolers',
          title: 'CPU Cooler Height vs. Case Clearance',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: clrCaseUnverified,
          message: `${cooler.name} (${coolerHInfo.mm}mm) exceeds ${pcCase.name} cooler clearance (${caseClearance.maxCoolerMm}mm).`,
          recommendation: 'Choose a lower-profile air cooler, AIO liquid cooler, or wider case.',
        })
      );
    } else {
      results.push({
        ruleId: 'RULE-CLR-HGT-01',
        category: 'CPU Coolers',
        title: 'CPU Cooler Height vs. Case Clearance',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: clrCaseUnverified,
        message: `Cooler height (${coolerHInfo.mm}mm) fits within case clearance (${caseClearance.maxCoolerMm}mm).`,
      });
    }
  }

  // 7. RULE-MFF-01: Motherboard Form Factor vs Case Supported Form Factors
  const boardFfInfo = inferBoardFormFactor(board);
  const caseFfInfo = inferSupportedFormFactors(pcCase);
  const mffUnverified = isCustomPart(board) || isCustomPart(pcCase);
  const mffMissing = [];
  if (!board || !boardFfInfo.value) mffMissing.push('Motherboards.form_factor');
  if (!pcCase || caseFfInfo.values.length === 0) mffMissing.push('Cases.supported_form_factors');

  if (mffMissing.length > 0) {
    results.push({
      ruleId: 'RULE-MFF-01',
      category: 'Cases',
      title: 'Motherboard & Case Form Factor',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: mffMissing,
      unverified: mffUnverified,
      message: `Form factor data missing (Board: ${boardFfInfo.value || 'unknown'}, Case: ${caseFfInfo.values.join(', ') || 'unknown'}).`,
      recommendation: 'Confirm chassis supports the motherboard form factor.',
    });
  } else {
    const ds = boardFfInfo.estimated || caseFfInfo.estimated ? 'estimated' : 'database';
    if (!caseFfInfo.values.includes(boardFfInfo.value)) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-MFF-01',
          category: 'Cases',
          title: 'Motherboard & Case Form Factor',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: mffUnverified,
          message: `${board.name} (${boardFfInfo.value}) does not fit in ${pcCase.name} (supports ${caseFfInfo.values.join(', ')}).`,
          recommendation: `Choose a case supporting ${boardFfInfo.value} motherboards.`,
        })
      );
    } else {
      results.push({
        ruleId: 'RULE-MFF-01',
        category: 'Cases',
        title: 'Motherboard & Case Form Factor',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: mffUnverified,
        message: `${boardFfInfo.value} motherboard fits ${pcCase.name} (${caseFfInfo.values.join(', ')}).`,
      });
    }
  }

  // 8. RULE-SLOTS-01: Motherboard M.2 Slots vs NVMe Storage
  const m2Info = inferM2Slots(board);
  let storIface = storage?.storage_interface ? String(storage.storage_interface).trim().toUpperCase() : '';
  let ifaceEstimated = false;
  if (!storIface && storage && !isCustomPart(storage)) {
    const sText = `${storage.name || ''} ${storage.specs || ''}`.toUpperCase();
    if (/NVME|M\.2/.test(sText)) {
      storIface = 'M.2 NVMe';
      ifaceEstimated = true;
    } else if (/SATA|HDD/.test(sText)) {
      storIface = 'SATA';
      ifaceEstimated = true;
    }
  }
  const slotUnverified = isCustomPart(board) || isCustomPart(storage);
  const slotMissing = [];
  if (!board || m2Info.slots === null) slotMissing.push('Motherboards.m2_slots');
  if (!storage || !storIface) slotMissing.push('Storage.storage_interface');

  if (slotMissing.length > 0) {
    results.push({
      ruleId: 'RULE-SLOTS-01',
      category: 'Storage',
      title: 'Motherboard M.2 / Storage Slot Check',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: slotMissing,
      unverified: slotUnverified,
      message: 'Motherboard M.2 slot count or storage interface is unknown.',
      recommendation: 'Verify available M.2 or SATA ports on the motherboard.',
    });
  } else {
    const ds = m2Info.estimated || ifaceEstimated ? 'estimated' : 'database';
    if ((storIface.includes('M.2') || storIface.includes('NVME')) && m2Info.slots < 1) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-SLOTS-01',
          category: 'Storage',
          title: 'Motherboard M.2 / Storage Slot Check',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: slotUnverified,
          message: `${storage.name} requires an M.2 slot, but ${board.name} reports 0 M.2 slots.`,
          recommendation: 'Use a SATA SSD or choose a motherboard with M.2 support.',
        })
      );
    } else {
      results.push({
        ruleId: 'RULE-SLOTS-01',
        category: 'Storage',
        title: 'Motherboard M.2 / Storage Slot Check',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: slotUnverified,
        message: `Motherboard provides ${m2Info.slots} M.2 slot(s) for ${storage.name}.`,
      });
    }
  }

  // 9. RULE-PSU-CONN-01: PSU PCIe / 12VHPWR Connectors vs GPU Requirement
  const gpuNeeds12v = Boolean(gpu?.gpu_requires_12vhpwr);
  const gpu8PinReq =
    gpu?.gpu_pcie_8pin_req !== undefined &&
    gpu?.gpu_pcie_8pin_req !== null &&
    gpu?.gpu_pcie_8pin_req !== ''
      ? Number(gpu.gpu_pcie_8pin_req)
      : null;
  const psuHas12vKnown = typeof psu?.has_12vhpwr === 'boolean';
  const psuHas12v = Boolean(psu?.has_12vhpwr);
  const psu8PinCount =
    psu?.pcie_8pin_count !== undefined &&
    psu?.pcie_8pin_count !== null &&
    psu?.pcie_8pin_count !== ''
      ? Number(psu.pcie_8pin_count)
      : null;
  const connUnverified = isCustomPart(gpu) || isCustomPart(psu);

  if (!gpu || !psu) {
    const missing = [];
    if (!gpu) missing.push('Video Cards.gpu_pcie_8pin_req');
    if (!psu) missing.push('Power Supplies.pcie_8pin_count');
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: missing,
      unverified: connUnverified,
      message: 'GPU power connector requirements or PSU PCIe cable count is incomplete.',
      recommendation: 'Verify PSU PCIe 8-pin / 12VHPWR cables match GPU requirements.',
    });
  } else if (gpuNeeds12v) {
    if (!psuHas12vKnown) {
      results.push({
        ruleId: 'RULE-PSU-CONN-01',
        category: 'Power Supplies',
        title: 'GPU & PSU Power Connectors',
        status: 'unknown',
        dataSource: 'unknown',
        missingFields: ['Power Supplies.has_12vhpwr'],
        unverified: connUnverified,
        message: `${gpu.name} requires 12VHPWR, but ${psu.name} 12VHPWR support is unknown.`,
        recommendation: 'Verify PSU supports native 12VHPWR/12V-2x6.',
      });
    } else if (!psuHas12v) {
      results.push({
        ruleId: 'RULE-PSU-CONN-01',
        category: 'Power Supplies',
        title: 'GPU & PSU Power Connectors',
        status: 'fail',
        dataSource: 'database',
        missingFields: [],
        unverified: connUnverified,
        message: `${gpu.name} requires a native 12VHPWR connector, which ${psu.name} lacks.`,
        recommendation: 'Select an ATX 3.0/3.1 PSU with native 12VHPWR/12V-2x6 cable.',
      });
    } else {
      results.push({
        ruleId: 'RULE-PSU-CONN-01',
        category: 'Power Supplies',
        title: 'GPU & PSU Power Connectors',
        status: 'pass',
        dataSource: 'database',
        missingFields: [],
        unverified: connUnverified,
        message: `${psu.name} provides the native 12VHPWR connector required by ${gpu.name}.`,
      });
    }
  } else if (gpu8PinReq === null || psu8PinCount === null) {
    const missing = [];
    if (gpu8PinReq === null) missing.push('Video Cards.gpu_pcie_8pin_req');
    if (psu8PinCount === null) missing.push('Power Supplies.pcie_8pin_count');
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: missing,
      unverified: connUnverified,
      message: 'GPU power connector requirements or PSU PCIe cable count is incomplete.',
      recommendation: 'Verify PSU PCIe 8-pin / 12VHPWR cables match GPU requirements.',
    });
  } else if (psu8PinCount < gpu8PinReq) {
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'fail',
      dataSource: 'database',
      missingFields: [],
      unverified: connUnverified,
      message: `${gpu.name} requires ${gpu8PinReq}x 8-pin PCIe connectors, but ${psu.name} provides ${psu8PinCount}.`,
      recommendation: 'Upgrade to a PSU with sufficient PCIe 8-pin cables.',
    });
  } else {
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'pass',
      dataSource: 'database',
      missingFields: [],
      unverified: connUnverified,
      message: 'PSU PCIe power connectors satisfy GPU requirements.',
    });
  }

  // 10. RULE-CLR-SOCK-01: CPU Cooler Socket Support
  const coolerSockInfo = inferCoolerSockets(cooler);
  const clrSockUnverified = isCustomPart(cooler) || isCustomPart(cpu);
  const clrSockMissing = [];
  if (!cpu || !cpuSocket) clrSockMissing.push('Processors.socket');
  if (!cooler || coolerSockInfo.sockets.length === 0) clrSockMissing.push('CPU Coolers.supported_sockets');

  if (clrSockMissing.length > 0) {
    results.push({
      ruleId: 'RULE-CLR-SOCK-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Mounting Compatibility',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: clrSockMissing,
      unverified: clrSockUnverified,
      message: `Cooler socket support (${coolerSockInfo.sockets.join(', ') || 'unknown'}) or CPU socket (${cpuSocket || 'unknown'}) is missing.`,
      recommendation: 'Confirm mounting bracket support for your CPU socket.',
    });
  } else if (!coolerSockInfo.sockets.includes(cpuSocket)) {
    results.push(
      finalizeRule({
        ruleId: 'RULE-CLR-SOCK-01',
        category: 'CPU Coolers',
        title: 'CPU Cooler Mounting Compatibility',
        status: 'fail',
        dataSource: coolerSockInfo.estimated ? 'estimated' : 'database',
        missingFields: [],
        unverified: clrSockUnverified,
        message: `${cooler.name} supports ${coolerSockInfo.sockets.join(', ')}, not ${cpuSocket}.`,
        recommendation: `Select a cooler with ${cpuSocket} mounting hardware.`,
      })
    );
  } else {
    results.push({
      ruleId: 'RULE-CLR-SOCK-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Mounting Compatibility',
      status: 'pass',
      dataSource: coolerSockInfo.estimated ? 'estimated' : 'database',
      missingFields: [],
      unverified: clrSockUnverified,
      message: `${cooler.name} supports socket ${cpuSocket}.`,
    });
  }

  // 11. RULE-RAM-LIM-01: RAM Total Capacity (16GB minimum) & Speed vs Motherboard Max Limits
  const minRamGb = Math.max(16, Number(ctx.minRamGb || 16));
  const ramLimits = inferBoardRamLimits(board);
  const parsedRam = ram && !isCustomPart(ram) ? parseRam(ram, ctx.ramStickCount || 1) : null;
  const totalRamGb = parsedRam ? parsedRam.totalGb : 0;
  const ramMhz = parsedRam ? parsedRam.speedMhz : null;
  const ramLimUnverified = isCustomPart(ram) || isCustomPart(board);
  const ramLimMissing = [];
  if (!board || (!ramLimits.maxGb && !ramLimits.maxMhz)) {
    ramLimMissing.push('Motherboards.max_ram_gb', 'Motherboards.max_ram_mhz');
  }
  if (!ram || (!totalRamGb && !ramMhz)) {
    ramLimMissing.push('Memory.capacity_gb');
  }

  if (ramLimMissing.length > 0) {
    results.push({
      ruleId: 'RULE-RAM-LIM-01',
      category: 'Memory',
      title: 'Motherboard RAM Capacity & Speed Limits',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: ramLimMissing,
      unverified: ramLimUnverified,
      message: 'Motherboard max RAM capacity and speed limits are not specified.',
      recommendation: 'Check motherboard QVL/specs for supported memory capacity and frequency.',
    });
  } else {
    const ds = ramLimits.estimated || parsedRam?.estimated ? 'estimated' : 'database';
    if ((ramLimits.maxGb && totalRamGb > ramLimits.maxGb) || (ramLimits.maxMhz && ramMhz > ramLimits.maxMhz)) {
      results.push(
        finalizeRule({
          ruleId: 'RULE-RAM-LIM-01',
          category: 'Memory',
          title: 'Motherboard RAM Capacity & Speed Limits',
          status: 'fail',
          dataSource: ds,
          missingFields: [],
          unverified: ramLimUnverified,
          message: `Memory (${totalRamGb}GB @ ${ramMhz || '?'}MHz) exceeds motherboard limit (${ramLimits.maxGb || '?'}GB / ${ramLimits.maxMhz || '?'}MHz).`,
          recommendation: 'Reduce module capacity/count or pick a higher-rated memory kit/board.',
        })
      );
    } else if (totalRamGb > 0 && totalRamGb < minRamGb) {
      results.push({
        ruleId: 'RULE-RAM-LIM-01',
        category: 'Memory',
        title: 'Motherboard RAM Capacity & Speed Limits',
        status: 'warn',
        dataSource: ds,
        missingFields: [],
        unverified: ramLimUnverified,
        ramCapacityGb: totalRamGb,
        message: `RAM configuration (${totalRamGb}GB) is below the ${minRamGb}GB recommended baseline.`,
        recommendation: `Upgrade to at least ${minRamGb}GB of RAM within ${ramLimits.maxGb || '?'}GB max.`,
      });
    } else {
      results.push({
        ruleId: 'RULE-RAM-LIM-01',
        category: 'Memory',
        title: 'Motherboard RAM Capacity & Speed Limits',
        status: 'pass',
        dataSource: ds,
        missingFields: [],
        unverified: ramLimUnverified,
        ramCapacityGb: totalRamGb,
        message: `RAM configuration (${totalRamGb}GB) meets the ${minRamGb}GB baseline and is within motherboard limits (${ramLimits.maxGb}GB max).`,
      });
    }
  }

  // 12. RULE-IGPU-01: Integrated Graphics / Display Output Check
  const hasIgpu = hasIntegratedGraphics(cpu);
  const igpuUnverified = isCustomPart(cpu);
  if (!cpu || hasIgpu === null) {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: 'unknown',
      dataSource: 'unknown',
      missingFields: ['Processors.has_igpu'],
      unverified: igpuUnverified,
      message: 'Processor integrated graphics availability is unknown.',
      recommendation: 'Ensure either an iGPU or dedicated graphics card is present for display output.',
    });
  } else if (gpu) {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: 'pass',
      dataSource: typeof cpu.has_igpu === 'boolean' ? 'database' : 'estimated',
      missingFields: [],
      unverified: igpuUnverified,
      message: `${cpu.name} has no iGPU; display output is handled by ${gpu.name}.`,
      recommendation: 'Connect monitor cable directly to the dedicated graphics card.',
    });
  } else if (hasIgpu) {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: 'pass',
      dataSource: typeof cpu.has_igpu === 'boolean' ? 'database' : 'estimated',
      missingFields: [],
      unverified: igpuUnverified,
      message: `${cpu.name} includes integrated graphics.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: partCount >= 5 ? 'warn' : 'unknown',
      dataSource: partCount >= 5 ? (typeof cpu.has_igpu === 'boolean' ? 'database' : 'estimated') : 'unknown',
      missingFields: partCount >= 5 ? [] : ['Video Cards'],
      unverified: igpuUnverified,
      message: `${cpu.name} has no integrated graphics and no dedicated GPU is selected.`,
      recommendation: 'Add a dedicated graphics card or choose a CPU with integrated graphics.',
    });
  }

  return results;
}