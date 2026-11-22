export function detectCpuSocket(part) {
  if (!part) return '';
  if (part.socket) return String(part.socket).trim().toUpperCase();
  const name = String(part.name || '').toUpperCase();
  if (/(LGA\s?1700|12TH|13TH|14TH|I[3579]-1[234]\d{2})/.test(name)) {
    return 'LGA1700';
  }
  if (
    /(AM5|7500|7600|7700|7800|7900|7950|8400F|8500G|8600G|8700G|9600|9700|9800|9900|9950)/.test(
      name
    )
  ) {
    return 'AM5';
  }
  if (
    /(AM4|ATHLON|200GE|2200G|3000G|3200G|3400G|3600|4500|5500|5600|5700|5800|5900|5950)/.test(
      name
    )
  ) {
    return 'AM4';
  }
  return '';
}

export function detectMotherboardSocket(part) {
  if (!part) return '';
  if (part.socket) return String(part.socket).trim().toUpperCase();
  const name = String(part.name || '').toUpperCase();
  if (/(A620|B650|B850|X670|X870)/.test(name)) return 'AM5';
  if (/(A320|A520|B350|B450|B550|X370|X470|X570)/.test(name)) return 'AM4';
  if (/(H610|B660|B760|H670|Z690|Z790)/.test(name)) return 'LGA1700';
  return '';
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
  if (!board) return '';
  if (board.form_factor) return normalizeFormFactor(board.form_factor);
  if (isCustomPart(board)) return '';
  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  if (/(MINI-ITX|\bITX\b)/.test(combined)) return 'ITX';
  if (/(MICRO-ATX|M-ATX|MATX|\b(?:A520|B450|B550|A620|B650|B760|B660|H610)M\b)/.test(combined)) {
    return 'MATX';
  }
  if (/(E-ATX|EATX)/.test(combined)) return 'EATX';
  if (/\bATX\b/.test(combined)) return 'ATX';
  return '';
}

function inferSupportedFormFactors(pcCase) {
  if (!pcCase) return [];
  if (pcCase.supported_form_factors) {
    return String(pcCase.supported_form_factors)
      .split(',')
      .map((s) => normalizeFormFactor(s))
      .filter(Boolean);
  }
  if (pcCase.form_factor) {
    const ff = normalizeFormFactor(pcCase.form_factor);
    if (ff === 'ATX') return ['ATX', 'MATX', 'ITX'];
    if (ff === 'MATX') return ['MATX', 'ITX'];
    if (ff === 'ITX') return ['ITX'];
  }
  if (isCustomPart(pcCase)) return [];
  const combined = `${pcCase.name || ''} ${pcCase.specs || ''}`.toUpperCase();
  if (/(MINI-ITX|\bITX\b)/.test(combined) && !combined.includes('ATX')) return ['ITX'];
  if (/(MICRO-ATX|M-ATX|MATX)/.test(combined)) return ['MATX', 'ITX'];
  if (/\bATX\b/.test(combined) || combined.includes('MID TOWER') || combined.includes('MID-TOWER')) {
    return ['ATX', 'MATX', 'ITX'];
  }
  return [];
}

function inferCoolerSockets(cooler) {
  if (!cooler) return [];
  if (cooler.supported_sockets) {
    return String(cooler.supported_sockets)
      .toUpperCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (isCustomPart(cooler)) return [];
  const combined = `${cooler.name || ''} ${cooler.specs || ''}`.toUpperCase();
  const explicit = [];
  if (combined.includes('AM4')) explicit.push('AM4');
  if (combined.includes('AM5')) explicit.push('AM5');
  if (combined.includes('LGA1700') || combined.includes('LGA 1700')) explicit.push('LGA1700');
  if (explicit.length > 0) return explicit;
  if (
    /(AG400|AK400|AK500|AK620|LS520|LS720|LT520|LT720|HYPER\s?212|GAMMAXX|PEERLESS ASSASSIN|PHANTOM SPIRIT|SE-214|SE-224|DEEPCOOL|THERMALRIGHT|ID-COOLING|NOCTUA|AIO|240MM|360MM)/.test(
      combined
    )
  ) {
    return ['AM4', 'AM5', 'LGA1700'];
  }
  return [];
}

function inferM2Slots(board) {
  if (!board) return null;
  if (board.m2_slots !== undefined && board.m2_slots !== null) {
    return Number(board.m2_slots);
  }
  if (isCustomPart(board)) return null;
  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  const match = combined.match(/(\d)\s*X?\s*M\.2/);
  if (match) return Number(match[1]);
  if (/(X670|X870|Z690|Z790)/.test(combined)) return 4;
  if (/(B650|B850|B760|B550|B450|A520|A620|H610)/.test(combined)) return 2;
  return null;
}

function inferBoardRamLimits(board) {
  if (!board) return { maxGb: null, maxMhz: null };
  const maxGb =
    board.max_ram_gb !== undefined && board.max_ram_gb !== null
      ? Number(board.max_ram_gb)
      : null;
  const maxMhz =
    board.max_ram_mhz !== undefined && board.max_ram_mhz !== null
      ? Number(board.max_ram_mhz)
      : null;

  if (maxGb !== null || maxMhz !== null) {
    return { maxGb, maxMhz };
  }
  if (isCustomPart(board)) return { maxGb: null, maxMhz: null };

  const combined = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  if (/(B650|B850|X670|X870|AM5)/.test(combined)) {
    return { maxGb: 192, maxMhz: 6400 };
  }
  if (/(B760|Z690|Z790|H610|B660)/.test(combined)) {
    return { maxGb: 128, maxMhz: 5600 };
  }
  if (/(B550|B450|A520|A320|X570)/.test(combined)) {
    return { maxGb: 128, maxMhz: 4400 };
  }
  return { maxGb: null, maxMhz: null };
}

function inferGpuLengthMm(gpu) {
  if (!gpu) return null;
  if (gpu.length_mm !== undefined && gpu.length_mm !== null) return Number(gpu.length_mm);
  if (isCustomPart(gpu)) return null;
  const combined = `${gpu.name || ''} ${gpu.specs || ''}`.toUpperCase();
  const mmMatch = combined.match(/(\d{3})\s*MM/);
  if (mmMatch) return Number(mmMatch[1]);
  if (/(TRIPLE|3X|GAMING OC|STRIX|SUPRIM|AORUS|4080|4090|5080|5090|7900)/.test(combined)) return 315;
  if (/(MINI|ITX|LP|LOW PROFILE|SINGLE FAN)/.test(combined)) return 185;
  if (/(RTX|RX|GTX|ARC|RADEON|GEFORCE)/.test(combined)) return 245;
  return null;
}

function inferCaseClearance(pcCase) {
  if (!pcCase) return { maxGpuMm: null, maxCoolerMm: null };
  const maxGpuMm =
    pcCase.max_gpu_length_mm !== undefined && pcCase.max_gpu_length_mm !== null
      ? Number(pcCase.max_gpu_length_mm)
      : null;
  const maxCoolerMm =
    pcCase.max_cooler_height_mm !== undefined && pcCase.max_cooler_height_mm !== null
      ? Number(pcCase.max_cooler_height_mm)
      : null;

  if (maxGpuMm !== null || maxCoolerMm !== null) {
    return { maxGpuMm, maxCoolerMm };
  }
  if (isCustomPart(pcCase)) return { maxGpuMm: null, maxCoolerMm: null };

  const combined = `${pcCase.name || ''} ${pcCase.specs || ''}`.toUpperCase();
  if (/(MINI-ITX|\bITX\b)/.test(combined) && !combined.includes('ATX')) {
    return { maxGpuMm: 280, maxCoolerMm: 140 };
  }
  if (/(MICRO-ATX|M-ATX|MATX)/.test(combined)) {
    return { maxGpuMm: 330, maxCoolerMm: 160 };
  }
  if (/\bATX\b/.test(combined) || combined.includes('MID TOWER') || combined.includes('MID-TOWER')) {
    return { maxGpuMm: 360, maxCoolerMm: 165 };
  }
  return { maxGpuMm: null, maxCoolerMm: null };
}

function inferCoolerHeightMm(cooler) {
  if (!cooler) return null;
  if (cooler.cooler_height_mm !== undefined && cooler.cooler_height_mm !== null) {
    return Number(cooler.cooler_height_mm);
  }
  if (isCustomPart(cooler)) return null;
  const combined = `${cooler.name || ''} ${cooler.specs || ''}`.toUpperCase();
  const mmMatch = combined.match(/(\d{2,3})\s*MM/);
  if (mmMatch && Number(mmMatch[1]) >= 40 && Number(mmMatch[1]) <= 180) {
    return Number(mmMatch[1]);
  }
  if (/(240|360|AIO|LIQUID)/.test(combined)) return 55;
  if (/(STOCK|WRAITH|LOW PROFILE)/.test(combined)) return 70;
  if (
    /(AG400|AK400|AK500|AK620|HYPER\s?212|GAMMAXX|PEERLESS ASSASSIN|PHANTOM SPIRIT|SE-214|SE-224|DEEPCOOL|THERMALRIGHT|ID-COOLING|NOCTUA)/.test(
      combined
    )
  ) {
    return 155;
  }
  return null;
}

function inferHasIgpu(cpu) {
  if (!cpu) return null;
  if (typeof cpu.has_igpu === 'boolean') return cpu.has_igpu;
  if (isCustomPart(cpu)) return null;
  const name = String(cpu.name || '').toUpperCase();
  if (/(F\b|KF\b|KSF\b)/.test(name)) return false;
  if (/RYZEN\s+[3579]\s+[12345]\d{3}X?\b/.test(name) && !name.includes('G')) return false;
  if (
    /(G\b|GE\b|ATHLON|7600|7700|7800X3D|7900|7950|9600|9700|9800X3D|9900|9950|CORE I[3579])/.test(
      name
    )
  ) {
    return true;
  }
  return null;
}

export function evaluateBuildRules(build = {}, ctx = {}) {
  const results = [];
  const cpu = build.Processors || null;
  const board = build.Motherboards || null;
  const gpu = build['Video Cards'] || null;
  const ram = build.Memory || null;
  const storage = build.Storage || null;
  const psu = build['Power Supplies'] || null;
  const cooler = build['CPU Coolers'] || null;
  const pcCase = build.Cases || null;

  // 1. RULE-SOCK-01: CPU <-> Motherboard Socket
  const cpuSocket = detectCpuSocket(cpu);
  const boardSocket = detectMotherboardSocket(board);
  const sockUnverified = isCustomPart(cpu) || isCustomPart(board);
  if (!cpu || !board || !cpuSocket || !boardSocket) {
    results.push({
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      title: 'CPU & Motherboard Socket',
      status: 'unknown',
      unverified: sockUnverified,
      message: `Socket comparison incomplete (CPU: ${cpuSocket || 'unknown'}, Board: ${boardSocket || 'unknown'}).`,
      recommendation: 'Ensure both CPU and Motherboard specify matching sockets.',
    });
  } else if (cpuSocket !== boardSocket) {
    results.push({
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      title: 'CPU & Motherboard Socket',
      status: 'fail',
      unverified: sockUnverified,
      message: `Socket mismatch: ${cpu.name} (${cpuSocket}) is incompatible with ${board.name} (${boardSocket}).`,
      recommendation: `Choose an ${cpuSocket} motherboard or matching ${boardSocket} CPU.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-SOCK-01',
      category: 'Processors',
      title: 'CPU & Motherboard Socket',
      status: 'pass',
      unverified: sockUnverified,
      message: `Socket ${cpuSocket} verified between CPU and Motherboard.`,
    });
  }

  // 2. RULE-MEM-01: RAM <-> Motherboard Memory Type
  const ramType =
    ram?.memory_type ||
    (/DDR5/i.test(`${ram?.name || ''} ${ram?.specs || ''}`)
      ? 'DDR5'
      : /DDR4/i.test(`${ram?.name || ''} ${ram?.specs || ''}`)
      ? 'DDR4'
      : '');
  const boardMemType =
    board?.memory_type ||
    (/DDR5/i.test(`${board?.name || ''} ${board?.specs || ''}`) || boardSocket === 'AM5'
      ? 'DDR5'
      : /DDR4/i.test(`${board?.name || ''} ${board?.specs || ''}`) || boardSocket === 'AM4'
      ? 'DDR4'
      : '');
  const memUnverified = isCustomPart(ram) || isCustomPart(board);
  if (!ram || !board || !ramType || !boardMemType) {
    results.push({
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      title: 'Memory Standard Compatibility',
      status: 'unknown',
      unverified: memUnverified,
      message: `Memory standard incomplete (RAM: ${ramType || 'unknown'}, Board: ${boardMemType || 'unknown'}).`,
      recommendation: 'Verify DDR4/DDR5 generation on both RAM and Motherboard.',
    });
  } else if (ramType.toUpperCase() !== boardMemType.toUpperCase()) {
    results.push({
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      title: 'Memory Standard Compatibility',
      status: 'fail',
      unverified: memUnverified,
      message: `${ram.name} (${ramType}) cannot be installed in ${board.name} (${boardMemType}).`,
      recommendation: `Select ${boardMemType} memory modules.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-MEM-01',
      category: 'Memory',
      title: 'Memory Standard Compatibility',
      status: 'pass',
      unverified: memUnverified,
      message: `${ramType} memory standard matches motherboard.`,
    });
  }

  // 3. RULE-PSU-01: PSU Wattage & Headroom
  const psuWatts =
    Number(psu?.wattage || 0) ||
    Number((String(psu?.name || '').match(/(\d{3,4})\s*W/i) || [])[1] || 0);
  const peakWatts = Number(ctx.peakWatts || 0);
  const recPsuWatts = Number(ctx.recommendedPsuWatts || 0);
  const psuUnverified = isCustomPart(psu);
  if (!psu || !psuWatts || !peakWatts) {
    results.push({
      ruleId: 'RULE-PSU-01',
      category: 'Power Supplies',
      title: 'Power Supply Capacity & Headroom',
      status: 'unknown',
      unverified: psuUnverified,
      message: `PSU wattage (${psuWatts || 'unknown'}W) or system load (${peakWatts || 'unknown'}W) is incomplete.`,
      recommendation: 'Select a power supply with verified wattage rating.',
    });
  } else if (psuWatts < peakWatts) {
    results.push({
      ruleId: 'RULE-PSU-01',
      category: 'Power Supplies',
      title: 'Power Supply Capacity & Headroom',
      status: 'fail',
      unverified: psuUnverified,
      message: `${psu.name} (${psuWatts}W) is below peak system draw (${peakWatts}W).`,
      recommendation: `Upgrade to at least a ${recPsuWatts || peakWatts + 120}W power supply.`,
    });
  } else if (recPsuWatts && psuWatts < recPsuWatts) {
    results.push({
      ruleId: 'RULE-PSU-01',
      category: 'Power Supplies',
      title: 'Power Supply Capacity & Headroom',
      status: 'warn',
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
      unverified: psuUnverified,
      message: `${psuWatts}W PSU satisfies ${peakWatts}W peak draw and ${recPsuWatts || psuWatts}W target.`,
    });
  }

  // 4. RULE-STOR-01: Primary Storage Capacity
  const minStorageGb = Number(ctx.minStorageGb || 500);
  let storageGb = Number(storage?.capacity_gb || 0);
  if (!storageGb && storage) {
    const combinedStor = `${storage.name || ''} ${storage.capacity || ''} ${storage.specs || ''}`.toUpperCase();
    const tbM = combinedStor.match(/(\d+)\s*TB/);
    const gbM = combinedStor.match(/(\d+)\s*GB/);
    storageGb = tbM ? Number(tbM[1]) * 1000 : gbM ? Number(gbM[1]) : 0;
  }
  const storUnverified = isCustomPart(storage);
  if (!storage || !storageGb) {
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Primary Storage Baseline',
      status: 'unknown',
      unverified: storUnverified,
      message: 'Primary storage drive or capacity is not specified.',
      recommendation: `Select an NVMe SSD of at least ${minStorageGb}GB.`,
    });
  } else if (storageGb < minStorageGb) {
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Primary Storage Baseline',
      status: 'warn',
      unverified: storUnverified,
      message: `${storage.name} (${storageGb}GB) is below the ${minStorageGb}GB recommended baseline.`,
      recommendation: `Step up to a ${minStorageGb}GB or 1TB NVMe SSD.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-STOR-01',
      category: 'Storage',
      title: 'Primary Storage Baseline',
      status: 'pass',
      unverified: storUnverified,
      message: `${storageGb}GB storage meets the ${minStorageGb}GB baseline.`,
    });
  }

  // 5. RULE-GPU-LEN-01: GPU Length vs Case Max GPU Clearance
  const gpuLen = inferGpuLengthMm(gpu);
  const { maxGpuMm, maxCoolerMm } = inferCaseClearance(pcCase);
  const gpuCaseUnverified = isCustomPart(gpu) || isCustomPart(pcCase);
  if (!gpu || !pcCase || !gpuLen || !maxGpuMm) {
    results.push({
      ruleId: 'RULE-GPU-LEN-01',
      category: 'Cases',
      title: 'GPU Length vs. Case Clearance',
      status: 'unknown',
      unverified: gpuCaseUnverified,
      message: `GPU length (${gpuLen || 'unknown'}mm) vs. case max GPU clearance (${maxGpuMm || 'unknown'}mm) is incomplete.`,
      recommendation: 'Verify GPU length and chassis clearance specifications.',
    });
  } else if (gpuLen > maxGpuMm) {
    results.push({
      ruleId: 'RULE-GPU-LEN-01',
      category: 'Cases',
      title: 'GPU Length vs. Case Clearance',
      status: 'fail',
      unverified: gpuCaseUnverified,
      message: `${gpu.name} (${gpuLen}mm) exceeds ${pcCase.name} max GPU length (${maxGpuMm}mm).`,
      recommendation: 'Select a longer chassis or shorter dual-fan GPU.',
    });
  } else {
    results.push({
      ruleId: 'RULE-GPU-LEN-01',
      category: 'Cases',
      title: 'GPU Length vs. Case Clearance',
      status: 'pass',
      unverified: gpuCaseUnverified,
      message: `GPU length (${gpuLen}mm) fits within case clearance (${maxGpuMm}mm).`,
    });
  }

  // 6. RULE-CLR-HGT-01: CPU Cooler Height vs Case Max Cooler Clearance
  const coolerH = inferCoolerHeightMm(cooler);
  const clrCaseUnverified = isCustomPart(cooler) || isCustomPart(pcCase);
  if (!cooler || !pcCase || !coolerH || !maxCoolerMm) {
    results.push({
      ruleId: 'RULE-CLR-HGT-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Height vs. Case Clearance',
      status: 'unknown',
      unverified: clrCaseUnverified,
      message: `Cooler height (${coolerH || 'unknown'}mm) vs. case max cooler clearance (${maxCoolerMm || 'unknown'}mm) is incomplete.`,
      recommendation: 'Verify cooler height against chassis CPU cooler clearance.',
    });
  } else if (coolerH > maxCoolerMm) {
    results.push({
      ruleId: 'RULE-CLR-HGT-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Height vs. Case Clearance',
      status: 'fail',
      unverified: clrCaseUnverified,
      message: `${cooler.name} (${coolerH}mm) exceeds ${pcCase.name} cooler clearance (${maxCoolerMm}mm).`,
      recommendation: 'Choose a lower-profile air cooler, AIO liquid cooler, or wider case.',
    });
  } else {
    results.push({
      ruleId: 'RULE-CLR-HGT-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Height vs. Case Clearance',
      status: 'pass',
      unverified: clrCaseUnverified,
      message: `Cooler height (${coolerH}mm) fits within case clearance (${maxCoolerMm}mm).`,
    });
  }

  // 7. RULE-MFF-01: Motherboard Form Factor vs Case Supported Form Factors
  const boardFf = inferBoardFormFactor(board);
  const caseFfs = inferSupportedFormFactors(pcCase);
  const mffUnverified = isCustomPart(board) || isCustomPart(pcCase);
  if (!board || !pcCase || !boardFf || caseFfs.length === 0) {
    results.push({
      ruleId: 'RULE-MFF-01',
      category: 'Cases',
      title: 'Motherboard & Case Form Factor',
      status: 'unknown',
      unverified: mffUnverified,
      message: `Form factor data missing (Board: ${boardFf || 'unknown'}, Case: ${caseFfs.join(', ') || 'unknown'}).`,
      recommendation: 'Confirm chassis supports the motherboard form factor.',
    });
  } else if (!caseFfs.includes(boardFf)) {
    results.push({
      ruleId: 'RULE-MFF-01',
      category: 'Cases',
      title: 'Motherboard & Case Form Factor',
      status: 'fail',
      unverified: mffUnverified,
      message: `${board.name} (${boardFf}) does not fit in ${pcCase.name} (supports ${caseFfs.join(', ')}).`,
      recommendation: `Choose a case supporting ${boardFf} motherboards.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-MFF-01',
      category: 'Cases',
      title: 'Motherboard & Case Form Factor',
      status: 'pass',
      unverified: mffUnverified,
      message: `${boardFf} motherboard fits ${pcCase.name} (${caseFfs.join(', ')}).`,
    });
  }

  // 8. RULE-SLOTS-01: Motherboard M.2 Slots vs NVMe Storage
  const m2Slots = inferM2Slots(board);
  const storIface = String(
    storage?.storage_interface ||
      (/NVME|M\.2/i.test(`${storage?.name || ''} ${storage?.specs || ''}`) ? 'M.2 NVMe' : '')
  ).toUpperCase();
  const slotUnverified = isCustomPart(board) || isCustomPart(storage);
  if (!board || !storage || m2Slots === null || !storIface) {
    results.push({
      ruleId: 'RULE-SLOTS-01',
      category: 'Storage',
      title: 'Motherboard M.2 / Storage Slot Check',
      status: 'unknown',
      unverified: slotUnverified,
      message: 'Motherboard M.2 slot count or storage interface is unknown.',
      recommendation: 'Verify available M.2 or SATA ports on the motherboard.',
    });
  } else if ((storIface.includes('M.2') || storIface.includes('NVME')) && m2Slots < 1) {
    results.push({
      ruleId: 'RULE-SLOTS-01',
      category: 'Storage',
      title: 'Motherboard M.2 / Storage Slot Check',
      status: 'fail',
      unverified: slotUnverified,
      message: `${storage.name} requires an M.2 slot, but ${board.name} reports 0 M.2 slots.`,
      recommendation: 'Use a SATA SSD or choose a motherboard with M.2 support.',
    });
  } else {
    results.push({
      ruleId: 'RULE-SLOTS-01',
      category: 'Storage',
      title: 'Motherboard M.2 / Storage Slot Check',
      status: 'pass',
      unverified: slotUnverified,
      message: `Motherboard provides ${m2Slots} M.2 slot(s) for ${storage.name}.`,
    });
  }

  // 9. RULE-PSU-CONN-01: PSU PCIe / 12VHPWR Connectors vs GPU Requirement
  const gpuNeeds12v = Boolean(gpu?.gpu_requires_12vhpwr);
  const gpu8PinReq =
    gpu?.gpu_pcie_8pin_req !== undefined && gpu?.gpu_pcie_8pin_req !== null
      ? Number(gpu.gpu_pcie_8pin_req)
      : gpu && !isCustomPart(gpu)
      ? 1
      : null;
  const psuHas12vKnown = typeof psu?.has_12vhpwr === 'boolean';
  const psuHas12v = Boolean(psu?.has_12vhpwr);
  const psu8PinCount =
    psu?.pcie_8pin_count !== undefined && psu?.pcie_8pin_count !== null
      ? Number(psu.pcie_8pin_count)
      : psuWatts >= 750
      ? 4
      : psuWatts >= 550
      ? 2
      : psuWatts > 0
      ? 1
      : null;
  const connUnverified = isCustomPart(gpu) || isCustomPart(psu);

  if (!gpu || !psu) {
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'unknown',
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
        unverified: connUnverified,
        message: `${psu.name} provides the native 12VHPWR connector required by ${gpu.name}.`,
      });
    }
  } else if (gpu8PinReq === null || psu8PinCount === null) {
    results.push({
      ruleId: 'RULE-PSU-CONN-01',
      category: 'Power Supplies',
      title: 'GPU & PSU Power Connectors',
      status: 'unknown',
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
      unverified: connUnverified,
      message: 'PSU PCIe power connectors satisfy GPU requirements.',
    });
  }

  // 10. RULE-CLR-SOCK-01: CPU Cooler Socket Support
  const coolerSockets = inferCoolerSockets(cooler);
  const clrSockUnverified = isCustomPart(cooler) || isCustomPart(cpu);
  if (!cooler || !cpu || !cpuSocket || coolerSockets.length === 0) {
    results.push({
      ruleId: 'RULE-CLR-SOCK-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Mounting Compatibility',
      status: 'unknown',
      unverified: clrSockUnverified,
      message: `Cooler socket support (${coolerSockets.join(', ') || 'unknown'}) or CPU socket (${cpuSocket || 'unknown'}) is missing.`,
      recommendation: 'Confirm mounting bracket support for your CPU socket.',
    });
  } else if (!coolerSockets.includes(cpuSocket)) {
    results.push({
      ruleId: 'RULE-CLR-SOCK-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Mounting Compatibility',
      status: 'fail',
      unverified: clrSockUnverified,
      message: `${cooler.name} supports ${coolerSockets.join(', ')}, not ${cpuSocket}.`,
      recommendation: `Select a cooler with ${cpuSocket} mounting hardware.`,
    });
  } else {
    results.push({
      ruleId: 'RULE-CLR-SOCK-01',
      category: 'CPU Coolers',
      title: 'CPU Cooler Mounting Compatibility',
      status: 'pass',
      unverified: clrSockUnverified,
      message: `${cooler.name} supports socket ${cpuSocket}.`,
    });
  }

  // 11. RULE-RAM-LIM-01: RAM Total Capacity & Speed vs Motherboard Max Limits
  const { maxGb, maxMhz } = inferBoardRamLimits(board);
  const stickCap =
    Number(ram?.capacity_gb || 0) ||
    Number((String(ram?.name || '').match(/(\d+)\s*GB/i) || [])[1] || 0);
  const ramSticks = Number(ctx.ramStickCount || 1);
  const totalRamGb = stickCap * ramSticks;
  const ramMhz =
    Number(ram?.speed_mhz || 0) ||
    Number((String(ram?.name || '').match(/(\d{4})\s*MHZ/i) || [])[1] || 0);
  const ramLimUnverified = isCustomPart(ram) || isCustomPart(board);

  if (!ram || !board || (!maxGb && !maxMhz) || (!totalRamGb && !ramMhz)) {
    results.push({
      ruleId: 'RULE-RAM-LIM-01',
      category: 'Memory',
      title: 'Motherboard RAM Capacity & Speed Limits',
      status: 'unknown',
      unverified: ramLimUnverified,
      message: 'Motherboard max RAM capacity and speed limits are not specified.',
      recommendation: 'Check motherboard QVL/specs for supported memory capacity and frequency.',
    });
  } else if ((maxGb && totalRamGb > maxGb) || (maxMhz && ramMhz > maxMhz)) {
    results.push({
      ruleId: 'RULE-RAM-LIM-01',
      category: 'Memory',
      title: 'Motherboard RAM Capacity & Speed Limits',
      status: 'fail',
      unverified: ramLimUnverified,
      message: `Memory (${totalRamGb}GB @ ${ramMhz || '?'}MHz) exceeds motherboard limit (${maxGb || '?'}GB / ${maxMhz || '?'}MHz).`,
      recommendation: 'Reduce module capacity/count or pick a higher-rated memory kit/board.',
    });
  } else {
    results.push({
      ruleId: 'RULE-RAM-LIM-01',
      category: 'Memory',
      title: 'Motherboard RAM Capacity & Speed Limits',
      status: 'pass',
      unverified: ramLimUnverified,
      message: `RAM configuration (${totalRamGb}GB) is within motherboard limits (${maxGb}GB max).`,
    });
  }

  // 12. RULE-IGPU-01: Integrated Graphics / Display Output Check
  const hasIgpu = inferHasIgpu(cpu);
  const igpuUnverified = isCustomPart(cpu);
  if (!cpu || hasIgpu === null) {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: 'unknown',
      unverified: igpuUnverified,
      message: 'Processor integrated graphics availability is unknown.',
      recommendation: 'Ensure either an iGPU or dedicated graphics card is present for display output.',
    });
  } else if (!hasIgpu) {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: gpu ? 'pass' : 'fail',
      unverified: igpuUnverified,
      message: gpu
        ? `${cpu.name} has no iGPU; display output is handled by ${gpu.name}.`
        : `${cpu.name} has no integrated graphics and no dedicated GPU is selected.`,
      recommendation: gpu
        ? 'Connect monitor cable directly to the dedicated graphics card.'
        : 'Add a dedicated graphics card or choose an APU/CPU with integrated graphics.',
    });
  } else {
    results.push({
      ruleId: 'RULE-IGPU-01',
      category: 'Processors',
      title: 'Integrated Graphics Availability',
      status: 'pass',
      unverified: igpuUnverified,
      message: `${cpu.name} includes integrated graphics.`,
    });
  }

  return results;
}