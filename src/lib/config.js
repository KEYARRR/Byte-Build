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

// ASSUMPTION (project-calibrated, not from a published source): internal catalog tier mapping (1=entry, 2=mainstream, 3=upper-mid, 4=enthusiast, 5=flagship)
export const TIER_THRESHOLDS = {
  cpuHighTdpWatts: 125,
  cpuMidTdpWatts: 65,
  gpuHighWatts: 250,
  gpuMidWatts: 130,
};

// ASSUMPTION (project-calibrated, not from a published source): default workload weight allocations (percentages sum to 100 per profile)
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

// ASSUMPTION (project-calibrated, not from a published source): bottleneck balance tolerance (tier difference <= 1 treated as balanced)
export const BOTTLENECK_CONFIG = {
  balancedMaxTierDelta: 1,
};

// Power draw & headroom constants (all non-database figures labeled ASSUMPTION)
export const POWER_CONFIG = {
  motherboardBaseWatts: 45, // ASSUMPTION (project-calibrated, not from a published source): motherboard VRM/chipset allowance
  perRamStickWatts: 4, // ASSUMPTION (project-calibrated, not from a published source): per-DIMM wattage allowance
  storageDriveWatts: 6, // ASSUMPTION (project-calibrated, not from a published source): per storage drive wattage allowance
  airCoolerWatts: 6, // ASSUMPTION (project-calibrated, not from a published source): air cooler fan allowance
  aioCoolerWatts: 18, // ASSUMPTION (project-calibrated, not from a published source): AIO pump and fan allowance
  caseFansWatts: 12, // ASSUMPTION (project-calibrated, not from a published source): chassis fan allowance
  defaultCpuTdpWatts: 65, // ASSUMPTION (project-calibrated, not from a published source): fallback TDP when CPU TDP is missing
  cpuPeakTdpMultiplier: 1.35, // ASSUMPTION (project-calibrated, not from a published source): peak boost draw multiplier when peak_watts is not set
  defaultGpuWatts: 0,
  idleRatio: 0.18, // ASSUMPTION (project-calibrated, not from a published source): estimated idle fraction of active load
  overclockPeakMultiplier: 1.15, // ASSUMPTION (project-calibrated, not from a published source): +15% overclocked peak allowance
  psuHeadroomMultiplier: 1.25, // ASSUMPTION (project-calibrated, not from a published source): 25% headroom multiplier for transient spikes and efficiency curve
  defaultBufferWatts: 120, // ASSUMPTION (project-calibrated, not from a published source): default additive buffer when admin rule buffer is omitted
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