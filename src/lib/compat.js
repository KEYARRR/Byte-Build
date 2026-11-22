import { getPsuProfile, parseNumberFromText } from './power.js';
import { deriveComponentTier, evaluateBottleneckBalance } from './scoring.js';

const SOCKET_ALIASES = [
  ['AM5', 'AM5'],
  ['AM4', 'AM4'],
  ['LGA1851', 'LGA1851'],
  ['LGA1700', 'LGA1700'],
];

const CPU_SOCKET_PATTERNS = [
  { socket: 'AM5', pattern: /RYZEN\s*(7000|8000|9000)|AM5/ },
  { socket: 'AM4', pattern: /RYZEN\s*(1000|2000|3000|4000|5000)|ATHLON|AM4/ },
  { socket: 'LGA1851', pattern: /CORE\s*ULTRA|LGA\s*1851|LGA1851/ },
  { socket: 'LGA1700', pattern: /12TH|13TH|14TH|I[3579]-1[234]\d{2}|LGA\s*1700|LGA1700/ },
];

const MOBO_SOCKET_PATTERNS = [
  { socket: 'AM5', pattern: /\b(A620|B650|B850|X670|X870|AM5)\b/ },
  { socket: 'AM4', pattern: /\b(A520|B450|B550|X470|X570|AM4)\b/ },
  { socket: 'LGA1851', pattern: /\b(H810|B860|Z890|LGA1851)\b/ },
  { socket: 'LGA1700', pattern: /\b(H610|B660|B760|Z690|Z790|LGA1700)\b/ },
];

export function normalizeSocket(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  const hit = SOCKET_ALIASES.find(([needle]) => s.includes(needle));
  return hit ? hit[1] : s;
}

export function detectCpuSocket(cpu) {
  if (!cpu) return null;
  if (cpu.socket) return normalizeSocket(cpu.socket);
  const hay = `${cpu.name || ''} ${cpu.specs || ''}`.toUpperCase();
  const hit = CPU_SOCKET_PATTERNS.find(({ pattern }) => pattern.test(hay));
  return hit ? hit.socket : null;
}

export function detectMotherboardSocket(board) {
  if (!board) return null;
  if (board.socket) return normalizeSocket(board.socket);
  const hay = `${board.name || ''} ${board.specs || ''}`.toUpperCase();
  const hit = MOBO_SOCKET_PATTERNS.find(({ pattern }) => pattern.test(hay));
  return hit ? hit.socket : null;
}

export function detectMemoryType(item) {
  if (!item) return null;
  if (item.memory_type) {
    const m = String(item.memory_type).toUpperCase();
    if (m.includes('DDR5')) return 'DDR5';
    if (m.includes('DDR4')) return 'DDR4';
  }
  const hay = `${item.name || ''} ${item.specs || ''}`.toUpperCase();
  if (/DDR5/.test(hay)) return 'DDR5';
  if (/DDR4/.test(hay)) return 'DDR4';
  return null;
}

export function parseStorageProfile(storage) {
  if (!storage) return null;
  const hay = `${storage.name || ''} ${storage.specs || ''} ${storage.capacity || ''}`;
  const isHdd = /\bHDD\b|HARD\s*DRIVE|RPM/i.test(hay) && !/SSD|NVME/i.test(hay);
  const capExplicit = Number(storage.capacity_gb || 0);
  let capacityGB = capExplicit > 0 ? capExplicit : null;

  if (!capacityGB) {
    const tbMatch = hay.match(/\b(\d+(?:\.\d+)?)\s*TB\b/i);
    const gbMatch = hay.match(/\b(\d{2,4})\s*GB\b/i);
    if (tbMatch) capacityGB = Math.round(Number(tbMatch[1]) * 1000);
    else if (gbMatch) capacityGB = Number(gbMatch[1]);
  }

  return { capacityGB, isHdd };
}

export function getCustomPartFlags(build = {}) {
  const entries = Object.entries(build || {});
  const customEntries = entries.filter(([, item]) => Boolean(item?.isCustomInput));
  return {
    hasCustomPart: customEntries.length > 0,
    customCategories: customEntries.map(([cat]) => cat),
    customNames: customEntries.map(([, item]) => item.name).filter(Boolean),
  };
}

export const COMPATIBILITY_RULES = [
  {
    id: 'RULE-SOCK-01',
    category: 'Motherboards',
    appliesTo: ['Processors', 'Motherboards'],
    severity: 'fail',
    description: 'CPU socket must match motherboard socket',
    inputs: ['Processors.socket', 'Motherboards.socket'],
    check(build) {
      const cpu = build?.Processors;
      const board = build?.Motherboards;
      if (!cpu || !board) {
        return {
          status: 'unknown',
          message: 'Socket compatibility cannot be verified until both CPU and motherboard are selected.',
          details: { cpuSocket: detectCpuSocket(cpu), boardSocket: detectMotherboardSocket(board) },
        };
      }
      const cpuSock = detectCpuSocket(cpu);
      const boardSock = detectMotherboardSocket(board);
      if (!cpuSock || !boardSock) {
        return {
          status: 'unknown',
          message: `Missing socket data for comparison (CPU: ${cpuSock || 'unknown'}, Board: ${boardSock || 'unknown'}).`,
          details: { cpuSocket: cpuSock, boardSocket: boardSock },
        };
      }
      if (cpuSock !== boardSock) {
        return {
          status: 'fail',
          message: `Incompatible sockets: CPU uses ${cpuSock} vs. motherboard uses ${boardSock}.`,
          details: { cpuSocket: cpuSock, boardSocket: boardSock },
        };
      }
      return {
        status: 'pass',
        message: `Socket match confirmed: ${cpuSock} on both CPU and motherboard.`,
        details: { cpuSocket: cpuSock, boardSocket: boardSock },
      };
    },
  },
  {
    id: 'RULE-MEM-01',
    category: 'Memory',
    appliesTo: ['Memory', 'Motherboards'],
    severity: 'fail',
    description: 'RAM generation (DDR4/DDR5) must match motherboard memory support',
    inputs: ['Memory.memory_type', 'Motherboards.memory_type'],
    check(build) {
      const ram = build?.Memory;
      const board = build?.Motherboards;
      if (!ram || !board) {
        return {
          status: 'unknown',
          message: 'Memory generation check requires both RAM and motherboard.',
          details: { ramType: detectMemoryType(ram), boardRamType: detectMemoryType(board) },
        };
      }
      const ramType = detectMemoryType(ram);
      const boardType = detectMemoryType(board);
      if (!ramType || !boardType) {
        return {
          status: 'unknown',
          message: `Missing DDR standard info (RAM: ${ramType || 'unknown'}, Board: ${boardType || 'unknown'}).`,
          details: { ramType, boardRamType: boardType },
        };
      }
      if (ramType !== boardType) {
        return {
          status: 'fail',
          message: `Memory mismatch: RAM is ${ramType} vs. motherboard supports ${boardType}.`,
          details: { ramType, boardRamType: boardType },
        };
      }
      return {
        status: 'pass',
        message: `Memory standard match: ${ramType} supported by motherboard.`,
        details: { ramType, boardRamType: boardType },
      };
    },
  },
  {
    id: 'RULE-STOR-01',
    category: 'Storage',
    appliesTo: ['Storage'],
    severity: 'warn',
    description: 'Primary storage should be an SSD with at least 500GB capacity',
    inputs: ['Storage.capacity_gb', 'Storage.specs'],
    check(build) {
      const storage = build?.Storage;
      if (!storage) {
        return {
          status: 'unknown',
          message: 'No storage drive selected yet.',
          details: { capacityGB: null, isHdd: null },
        };
      }
      const prof = parseStorageProfile(storage);
      if (!prof || !prof.capacityGB) {
        return {
          status: 'unknown',
          message: `Storage capacity is not specified for "${storage.name}".`,
          details: prof || {},
        };
      }
      if (prof.isHdd) {
        return {
          status: 'warn',
          message: `"${storage.name}" is an HDD (${prof.capacityGB}GB); an SSD (500GB+) is recommended for OS responsiveness.`,
          details: prof,
        };
      }
      if (prof.capacityGB < 500) {
        return {
          status: 'warn',
          message: `Storage capacity is ${prof.capacityGB}GB (below the 500GB recommended minimum).`,
          details: prof,
        };
      }
      return {
        status: 'pass',
        message: `Storage meets baseline: ${prof.capacityGB}GB SSD.`,
        details: prof,
      };
    },
  },
  {
    id: 'RULE-PSU-01',
    category: 'Power Supplies',
    appliesTo: ['Power Supplies', 'Processors', 'Video Cards'],
    severity: 'fail',
    description: 'PSU wattage must cover estimated peak draw and tier requirements',
    inputs: ['Power Supplies.wattage', 'Power Supplies.psu_tier', 'estimatedPeakWatts'],
    check(build, ctx = {}) {
      const psu = build?.['Power Supplies'];
      const peakWatts = Number(ctx.peakWatts || 0);
      const recWatts = Number(ctx.recommendedPsuWatts || 0);
      if (!psu) {
        return {
          status: 'unknown',
          message: 'No power supply selected.',
          details: { psuWatts: null, peakWatts, recWatts },
        };
      }
      const prof = getPsuProfile(psu);
      if (!prof.watts) {
        return {
          status: 'unknown',
          message: `PSU wattage is missing for "${psu.name}".`,
          details: { psuWatts: null, peakWatts, recWatts },
        };
      }
      if (peakWatts > 0 && prof.watts < peakWatts) {
        return {
          status: 'fail',
          message: `PSU rated ${prof.watts}W is below estimated peak draw (${peakWatts}W).`,
          details: { psuWatts: prof.watts, peakWatts, recWatts },
        };
      }
      if (recWatts > 0 && prof.watts < recWatts) {
        return {
          status: 'warn',
          message: `PSU rated ${prof.watts}W is below recommended headroom (${recWatts}W vs. ${peakWatts}W peak).`,
          details: { psuWatts: prof.watts, peakWatts, recWatts },
        };
      }
      return {
        status: 'pass',
        message: `PSU ${prof.watts}W (Tier ${prof.tier}) covers ${peakWatts}W peak load (rec: ${recWatts}W).`,
        details: { psuWatts: prof.watts, tier: prof.tier, peakWatts, recWatts },
      };
    },
  },
  {
    id: 'RULE-GPU-LEN-01',
    category: 'Cases',
    appliesTo: ['Video Cards', 'Cases'],
    severity: 'fail',
    description: 'GPU length must fit within case maximum GPU clearance',
    inputs: ['Video Cards.length_mm', 'Cases.max_gpu_length_mm'],
    check(build) {
      const gpu = build?.['Video Cards'];
      const pcCase = build?.Cases;
      if (!gpu) {
        return { status: 'pass', message: 'No discrete GPU selected; case GPU clearance not required.', details: {} };
      }
      if (!pcCase) {
        return { status: 'unknown', message: 'Case not selected to verify GPU length clearance.', details: {} };
      }
      const gpuLen = Number(gpu.length_mm) || parseNumberFromText(`${gpu.name} ${gpu.specs}`, [/(\d{3})\s*mm/i]);
      const maxLen =
        Number(pcCase.max_gpu_length_mm) ||
        parseNumberFromText(`${pcCase.name} ${pcCase.specs}`, [/max\s*gpu[^\d]*(\d{3})\s*mm/i, /(\d{3})\s*mm\s*gpu/i]);
      if (!gpuLen || !maxLen) {
        return {
          status: 'unknown',
          message: `GPU length (${gpuLen || 'unknown'}mm) vs. case max GPU clearance (${maxLen || 'unknown'}mm) is incomplete.`,
          details: { gpuLen, maxLen },
        };
      }
      if (gpuLen > maxLen) {
        return {
          status: 'fail',
          message: `GPU length (${gpuLen}mm) exceeds case max clearance (${maxLen}mm).`,
          details: { gpuLen, maxLen },
        };
      }
      return {
        status: 'pass',
        message: `GPU length (${gpuLen}mm) fits inside case max clearance (${maxLen}mm).`,
        details: { gpuLen, maxLen },
      };
    },
  },
  {
    id: 'RULE-CLR-HGT-01',
    category: 'CPU Coolers',
    appliesTo: ['CPU Coolers', 'Cases'],
    severity: 'fail',
    description: 'Air cooler height must fit within case maximum cooler clearance',
    inputs: ['CPU Coolers.cooler_height_mm', 'Cases.max_cooler_height_mm'],
    check(build) {
      const cooler = build?.['CPU Coolers'];
      const pcCase = build?.Cases;
      if (!cooler || !pcCase) {
        return { status: 'unknown', message: 'Cooler or case missing for cooler height check.', details: {} };
      }
      const isLiquid = /aio|liquid|240mm|280mm|360mm/i.test(`${cooler.name || ''} ${cooler.specs || ''}`);
      if (isLiquid) {
        return {
          status: 'unknown',
          message: 'Liquid/AIO radiator clearance requires radiator support check (not tower height).',
          details: { isLiquid: true },
        };
      }
      const heightMm =
        Number(cooler.cooler_height_mm) ||
        parseNumberFromText(`${cooler.name} ${cooler.specs}`, [/(\d{2,3})\s*mm/i]);
      const maxHeightMm =
        Number(pcCase.max_cooler_height_mm) ||
        parseNumberFromText(`${pcCase.name} ${pcCase.specs}`, [/cooler[^\d]*(\d{2,3})\s*mm/i]);
      if (!heightMm || !maxHeightMm) {
        return {
          status: 'unknown',
          message: `Cooler height (${heightMm || 'unknown'}mm) vs. case clearance (${maxHeightMm || 'unknown'}mm) is incomplete.`,
          details: { heightMm, maxHeightMm },
        };
      }
      if (heightMm > maxHeightMm) {
        return {
          status: 'fail',
          message: `Cooler height (${heightMm}mm) exceeds case limit (${maxHeightMm}mm).`,
          details: { heightMm, maxHeightMm },
        };
      }
      return {
        status: 'pass',
        message: `Cooler height (${heightMm}mm) fits within case limit (${maxHeightMm}mm).`,
        details: { heightMm, maxHeightMm },
      };
    },
  },
  {
    id: 'RULE-MFF-01',
    category: 'Cases',
    appliesTo: ['Motherboards', 'Cases'],
    severity: 'fail',
    description: 'Motherboard form factor must be supported by the case',
    inputs: ['Motherboards.form_factor', 'Cases.supported_form_factors'],
    check(build) {
      const board = build?.Motherboards;
      const pcCase = build?.Cases;
      if (!board || !pcCase) {
        return { status: 'unknown', message: 'Motherboard or case missing for form factor check.', details: {} };
      }
      const boardFf = String(board.form_factor || '').trim().toUpperCase();
      const caseFfRaw = String(pcCase.supported_form_factors || '').trim().toUpperCase();
      if (!boardFf || !caseFfRaw) {
        return {
          status: 'unknown',
          message: `Form factor data missing (Board: ${boardFf || 'unknown'}, Case: ${caseFfRaw || 'unknown'}).`,
          details: { boardFf, supportedFormFactors: caseFfRaw },
        };
      }
      const supportedList = caseFfRaw.split(/[,/|;]+/).map((s) => s.trim()).filter(Boolean);
      if (!supportedList.includes(boardFf)) {
        return {
          status: 'fail',
          message: `Board form factor ${boardFf} is not listed under case supported form factors (${supportedList.join(', ')}).`,
          details: { boardFf, supportedFormFactors: supportedList },
        };
      }
      return {
        status: 'pass',
        message: `Board form factor ${boardFf} is supported by case (${supportedList.join(', ')}).`,
        details: { boardFf, supportedFormFactors: supportedList },
      };
    },
  },
  {
    id: 'RULE-SLOTS-01',
    category: 'Storage',
    appliesTo: ['Motherboards', 'Storage'],
    severity: 'warn',
    description: 'Motherboard M.2/SATA slot counts should cover selected storage interfaces',
    inputs: ['Motherboards.m2_slots', 'Motherboards.sata_ports', 'Storage.storage_interface'],
    check(build) {
      const board = build?.Motherboards;
      const storage = build?.Storage;
      if (!board || !storage) {
        return { status: 'unknown', message: 'Motherboard or storage missing for slot check.', details: {} };
      }
      const iface = String(storage.storage_interface || storage.specs || '').toUpperCase();
      const isM2 = /M\.2|NVME/.test(iface);
      const isSata = /SATA/.test(iface) && !isM2;

      if (isM2) {
        const m2Slots = Number(board.m2_slots);
        if (!Number.isFinite(m2Slots) || board.m2_slots === null || board.m2_slots === undefined) {
          return { status: 'unknown', message: 'Motherboard M.2 slot count is unknown.', details: { required: 'M.2', m2Slots: null } };
        }
        return m2Slots >= 1
          ? { status: 'pass', message: `Motherboard provides ${m2Slots} M.2 slot(s) for M.2 storage.`, details: { m2Slots } }
          : { status: 'fail', message: 'Motherboard has 0 M.2 slots for selected M.2 drive.', details: { m2Slots } };
      }

      if (isSata) {
        const sataPorts = Number(board.sata_ports);
        if (!Number.isFinite(sataPorts) || board.sata_ports === null || board.sata_ports === undefined) {
          return { status: 'unknown', message: 'Motherboard SATA port count is unknown.', details: { required: 'SATA', sataPorts: null } };
        }
        return sataPorts >= 1
          ? { status: 'pass', message: `Motherboard provides ${sataPorts} SATA port(s) for SATA storage.`, details: { sataPorts } }
          : { status: 'fail', message: 'Motherboard has 0 SATA ports for selected SATA drive.', details: { sataPorts } };
      }

      return { status: 'unknown', message: 'Storage interface type (M.2 vs. SATA) is not specified.', details: {} };
    },
  },
  {
    id: 'RULE-PSU-CONN-01',
    category: 'Power Supplies',
    appliesTo: ['Power Supplies', 'Video Cards'],
    severity: 'fail',
    description: 'PSU PCIe 8-pin / 12VHPWR connectors must cover GPU power connectors',
    inputs: ['Power Supplies.pcie_8pin_count', 'Power Supplies.has_12vhpwr', 'Video Cards.gpu_pcie_8pin_req', 'Video Cards.gpu_requires_12vhpwr'],
    check(build) {
      const gpu = build?.['Video Cards'];
      const psu = build?.['Power Supplies'];
      if (!gpu) {
        return { status: 'pass', message: 'No discrete GPU selected; GPU power connectors not required.', details: {} };
      }
      if (!psu) {
        return { status: 'unknown', message: 'PSU not selected to verify GPU power connectors.', details: {} };
      }
      const req12v = Boolean(gpu.gpu_requires_12vhpwr);
      const has12v = psu.has_12vhpwr === true;
      const req8Pin =
        gpu.gpu_pcie_8pin_req !== null && gpu.gpu_pcie_8pin_req !== undefined
          ? Number(gpu.gpu_pcie_8pin_req)
          : null;
      const has8Pin =
        psu.pcie_8pin_count !== null && psu.pcie_8pin_count !== undefined
          ? Number(psu.pcie_8pin_count)
          : null;

      if (req12v && (psu.has_12vhpwr === undefined || psu.has_12vhpwr === null)) {
        return { status: 'unknown', message: 'GPU requires 12VHPWR, but PSU 12VHPWR support is unknown.', details: { req12v, has12v: null } };
      }
      if (req12v && !has12v) {
        return { status: 'fail', message: 'GPU requires 12VHPWR connector, which is not listed on the selected PSU.', details: { req12v, has12v } };
      }
      if (req8Pin !== null && has8Pin === null) {
        return { status: 'unknown', message: `GPU requires ${req8Pin}x 8-pin PCIe, but PSU 8-pin count is unknown.`, details: { req8Pin, has8Pin: null } };
      }
      if (req8Pin !== null && has8Pin !== null && has8Pin < req8Pin) {
        return { status: 'fail', message: `PSU has ${has8Pin}x 8-pin PCIe connectors vs. GPU requiring ${req8Pin}x.`, details: { req8Pin, has8Pin } };
      }
      return {
        status: 'pass',
        message: `PSU connector support verified (8-pin: ${has8Pin ?? 'N/A'} vs req ${req8Pin ?? 0}; 12VHPWR: ${has12v ? 'Yes' : 'No'}).`,
        details: { req8Pin, has8Pin, req12v, has12v },
      };
    },
  },
  {
    id: 'RULE-CLR-SOCK-01',
    category: 'CPU Coolers',
    appliesTo: ['CPU Coolers', 'Processors'],
    severity: 'fail',
    description: 'CPU cooler must support the selected CPU socket',
    inputs: ['CPU Coolers.supported_sockets', 'Processors.socket'],
    check(build) {
      const cooler = build?.['CPU Coolers'];
      const cpu = build?.Processors;
      if (!cooler || !cpu) {
        return { status: 'unknown', message: 'Cooler or CPU missing for socket support check.', details: {} };
      }
      const cpuSock = detectCpuSocket(cpu);
      const rawSupported = String(cooler.supported_sockets || '').toUpperCase();
      if (!cpuSock || !rawSupported) {
        return {
          status: 'unknown',
          message: `Cooler socket support (${rawSupported || 'unknown'}) or CPU socket (${cpuSock || 'unknown'}) is missing.`,
          details: { cpuSocket: cpuSock, supportedSockets: rawSupported || null },
        };
      }
      const list = rawSupported.split(/[,/|;]+/).map((s) => normalizeSocket(s)).filter(Boolean);
      if (!list.includes(cpuSock)) {
        return {
          status: 'fail',
          message: `Cooler supported sockets (${list.join(', ')}) do not include CPU socket ${cpuSock}.`,
          details: { cpuSocket: cpuSock, supportedSockets: list },
        };
      }
      return {
        status: 'pass',
        message: `Cooler supports CPU socket ${cpuSock}.`,
        details: { cpuSocket: cpuSock, supportedSockets: list },
      };
    },
  },
  {
    id: 'RULE-RAM-LIM-01',
    category: 'Memory',
    appliesTo: ['Memory', 'Motherboards'],
    severity: 'warn',
    description: 'Total RAM capacity and speed should not exceed motherboard limits',
    inputs: ['Memory.capacity_gb', 'Memory.speed_mhz', 'Motherboards.max_ram_gb', 'Motherboards.max_ram_mhz'],
    check(build, ctx = {}) {
      const ram = build?.Memory;
      const board = build?.Motherboards;
      if (!ram || !board) {
        return { status: 'unknown', message: 'RAM or motherboard missing for capacity/speed limit check.', details: {} };
      }
      const sticks = Math.max(1, Number(ctx.ramStickCount) || 1);
      const kitMatch = `${ram.name || ''} ${ram.specs || ''}`.match(/\b(\d+)x(\d+)\s*GB\b/i);
      const perStickGb =
        Number(ram.capacity_gb) ||
        (kitMatch ? Number(kitMatch[2]) : parseNumberFromText(`${ram.name} ${ram.specs}`, [/(\d{1,3})\s*GB/i]));
      const totalGb = kitMatch
        ? Number(kitMatch[1]) * Number(kitMatch[2])
        : perStickGb
        ? perStickGb * sticks
        : null;

      const ramMhz =
        Number(ram.speed_mhz) ||
        parseNumberFromText(`${ram.name} ${ram.specs}`, [/(\d{4})\s*(?:MHz|MT\/s)/i]);
      const maxGb =
        board.max_ram_gb !== null && board.max_ram_gb !== undefined ? Number(board.max_ram_gb) : null;
      const maxMhz =
        board.max_ram_mhz !== null && board.max_ram_mhz !== undefined ? Number(board.max_ram_mhz) : null;

      if ((totalGb && maxGb && totalGb > maxGb) || (ramMhz && maxMhz && ramMhz > maxMhz)) {
        return {
          status: 'fail',
          message: `RAM exceeds board limit: ${totalGb || '?'}GB/${ramMhz || '?'}MHz vs. board max ${maxGb || '?'}GB/${maxMhz || '?'}MHz.`,
          details: { totalGb, maxGb, ramMhz, maxMhz },
        };
      }
      if (!maxGb && !maxMhz) {
        return {
          status: 'unknown',
          message: 'Motherboard max RAM capacity and speed limits are not specified.',
          details: { totalGb, ramMhz, maxGb, maxMhz },
        };
      }
      return {
        status: 'pass',
        message: `RAM within board limits (${totalGb ?? '?'}GB / ${ramMhz ?? '?'}MHz).`,
        details: { totalGb, maxGb, ramMhz, maxMhz },
      };
    },
  },
  {
    id: 'RULE-IGPU-01',
    category: 'Video Cards',
    appliesTo: ['Video Cards', 'Processors'],
    severity: 'warn',
    description: 'Display output requires a discrete GPU or a CPU with integrated graphics',
    inputs: ['Video Cards', 'Processors.has_igpu'],
    check(build) {
      const gpu = build?.['Video Cards'];
      const cpu = build?.Processors;
      if (gpu) {
        return { status: 'pass', message: `Discrete GPU selected (${gpu.name}); display output available.`, details: { hasDiscreteGpu: true } };
      }
      if (!cpu) {
        return { status: 'unknown', message: 'No GPU selected and CPU integrated graphics status is unknown.', details: { hasDiscreteGpu: false, hasIgpu: null } };
      }
      if (cpu.has_igpu === true) {
        return { status: 'pass', message: `No discrete GPU selected, but CPU (${cpu.name}) has integrated graphics.`, details: { hasDiscreteGpu: false, hasIgpu: true } };
      }
      if (cpu.has_igpu === false) {
        return { status: 'fail', message: `No discrete GPU selected and CPU (${cpu.name}) lacks integrated graphics (no display output).`, details: { hasDiscreteGpu: false, hasIgpu: false } };
      }
      return {
        status: 'unknown',
        message: `No discrete GPU selected; integrated graphics support for "${cpu.name}" is unknown.`,
        details: { hasDiscreteGpu: false, hasIgpu: null },
      };
    },
  },
];

export function evaluateBuildRules(build, context = {}) {
  const customFlags = getCustomPartFlags(build);
  return COMPATIBILITY_RULES.map((rule) => {
    const outcome = rule.check(build, context);
    const ruleTouchesCustom =
      customFlags.hasCustomPart &&
      (!Array.isArray(rule.appliesTo) ||
        rule.appliesTo.length === 0 ||
        rule.appliesTo.some((cat) => customFlags.customCategories.includes(cat)));

    return {
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      description: rule.description,
      status: outcome.status,
      message: outcome.message,
      details: outcome.details || {},
      unverified: Boolean(ruleTouchesCustom),
    };
  });
}

export function summarizeBalance(build) {
  return evaluateBottleneckBalance(build?.Processors, build?.['Video Cards']);
}

export function getTierSummary(item, category) {
  return deriveComponentTier(item, category);
}