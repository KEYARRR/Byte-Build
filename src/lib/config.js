export const CATEGORIES = [
  'Processors',
  'Motherboards',
  'Video Cards',
  'Memory',
  'Storage',
  'Power Supplies',
  'CPU Coolers',
  'Cases',
];

export const CATEGORY_LABELS = {
  Processors: 'CPU',
  Motherboards: 'MOBO',
  'Video Cards': 'GPU',
  Memory: 'RAM',
  Storage: 'SSD',
  'Power Supplies': 'PSU',
  'CPU Coolers': 'COOLER',
  Cases: 'CASE',
};

export const RAM_STICK_COUNTS = [1, 2, 4];

// TODO: cite source — internal catalog tier mapping (1=entry, 2=mainstream, 3=upper-mid, 4=enthusiast, 5=flagship)
export const TIER_THRESHOLDS = {
  cpuHighTdpWatts: 125,
  cpuMidTdpWatts: 65,
  gpuHighWatts: 250,
  gpuMidWatts: 130,
};

// TODO: cite source — default workload weight allocations (percentages sum to 100 per profile)
export const WORKLOAD_WEIGHTS = {
  Gaming: {
    Processors: 21,
    'Video Cards': 36,
    Motherboards: 13,
    Memory: 9,
    Storage: 10,
    'Power Supplies': 8,
    'CPU Coolers': 3,
    Cases: 3,
  },
  'Content Creation': {
    Processors: 27,
    'Video Cards': 29,
    Motherboards: 14,
    Memory: 11,
    Storage: 11,
    'Power Supplies': 7,
    'CPU Coolers': 2,
    Cases: 3,
  },
  'Office/Productivity': {
    Processors: 28,
    'Video Cards': 0,
    Motherboards: 20,
    Memory: 14,
    Storage: 22,
    'Power Supplies': 8,
    'CPU Coolers': 4,
    Cases: 4,
  },
  Balanced: {
    Processors: 24,
    'Video Cards': 31,
    Motherboards: 13,
    Memory: 9,
    Storage: 11,
    'Power Supplies': 7,
    'CPU Coolers': 3,
    Cases: 3,
  },
};

// TODO: cite source — bottleneck balance tolerance (tier difference <= 1 treated as balanced)
export const BOTTLENECK_CONFIG = {
  balancedMaxTierDelta: 1,
};

// Power draw & headroom constants (headroom/multipliers align with PSU calculator guidance; per-part base numbers marked TODO where locally calibrated)
export const POWER_CONFIG = {
  motherboardBaseWatts: 45, // TODO: cite source (general VRM/chipset allowance; notes 50-80W typical)
  perRamStickWatts: 4, // TODO: cite source (per-DIMM estimate; notes 10-15W per 16GB)
  storageDriveWatts: 6, // TODO: cite source (per NVMe/SATA drive estimate)
  airCoolerWatts: 6, // notes 5-10W for air coolers
  aioCoolerWatts: 18, // notes 10-30W for AIO pumps/fans
  caseFansWatts: 12, // TODO: cite source (case fan allowance; notes 20-50W with RGB)
  defaultCpuTdpWatts: 65, // TODO: cite source (default fallback when CPU TDP is missing)
  defaultGpuWatts: 0,
  idleRatio: 0.18, // TODO: cite source (estimated idle fraction of active load)
  overclockPeakMultiplier: 1.15, // notes +15% CPU overclocking allowance
  psuHeadroomMultiplier: 1.25, // 25% headroom multiplier for transient spikes/efficiency curve
  psuStepWatts: 50,
  minRecommendedPsuWatts: 450,
};

export const PSU_TIER_RANK = {
  'A+': 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
  Unknown: 0,
};