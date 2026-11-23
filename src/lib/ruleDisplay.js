export const RULE_DISPLAY_META = {
  'RULE-SOCK-01': {
    shortLabel: 'CPU Socket',
    whyItMatters: 'Ensures the processor physically fits and communicates with the motherboard.',
  },
  'RULE-MEM-01': {
    shortLabel: 'RAM Generation',
    whyItMatters: 'Confirms DDR4 or DDR5 memory sticks match the motherboard slots.',
  },
  'RULE-PSU-01': {
    shortLabel: 'Power Headroom',
    whyItMatters: 'Verifies the power supply handles peak load and transient power spikes safely.',
  },
  'RULE-STOR-01': {
    shortLabel: 'Storage Baseline',
    whyItMatters: 'Checks combined SSD and Hard Drive capacity for OS, apps, games, and media.',
  },
  'RULE-GPU-LEN-01': {
    shortLabel: 'GPU Clearance',
    whyItMatters: 'Confirms the graphics card length fits inside the PC case without blocking fans.',
  },
  'RULE-CLR-HGT-01': {
    shortLabel: 'Cooler Height',
    whyItMatters: 'Ensures the CPU cooler clears the case side panel.',
  },
  'RULE-MFF-01': {
    shortLabel: 'Case Form Factor',
    whyItMatters: 'Verifies the motherboard size (ATX, mATX, ITX) mounts properly in the case.',
  },
  'RULE-SLOTS-01': {
    shortLabel: 'M.2 Drive Slots',
    whyItMatters: 'Confirms the motherboard has an available M.2 slot for NVMe SSDs.',
  },
  'RULE-PSU-CONN-01': {
    shortLabel: 'GPU Power Cables',
    whyItMatters: 'Checks that the power supply has the right PCIe 8-pin or 12VHPWR cables.',
  },
  'RULE-CLR-SOCK-01': {
    shortLabel: 'Cooler Bracket',
    whyItMatters: 'Verifies the cooler includes mounting hardware for the chosen CPU socket.',
  },
  'RULE-RAM-LIM-01': {
    shortLabel: 'RAM Capacity & Speed',
    whyItMatters: 'Confirms at least 16GB capacity and speeds stay within motherboard limits.',
  },
  'RULE-IGPU-01': {
    shortLabel: 'Display Output',
    whyItMatters: 'Flags missing display output only when the CPU lacks iGPU and no GPU is added.',
  },
};

export function getStatusBadgeLabel(status, unverified = false, dataSource = 'database') {
  if (unverified) return 'Unverified';
  if (status === 'pass' && dataSource === 'estimated') return 'Estimated';
  if (status === 'pass') return 'Verified';
  if (status === 'fail') return 'Conflict';
  if (status === 'warn') return 'Advisory';
  return 'Needs Spec Check';
}

export function getRuleChipMeta(rule = {}) {
  const meta = RULE_DISPLAY_META[rule.ruleId] || {};
  const label = meta.shortLabel || rule.title || rule.ruleId || 'Rule';
  const whyItMatters = meta.whyItMatters || '';

  const isGreenBalancedRule =
    rule.status === 'pass' &&
    !rule.unverified &&
    ((rule.ruleId === 'RULE-RAM-LIM-01' && Number(rule.ramCapacityGb ?? 16) >= 16) ||
      rule.ruleId === 'RULE-IGPU-01' ||
      (rule.ruleId === 'RULE-STOR-01' && Boolean(rule.hasBalancedHdd)));

  let dotClass = 'bg-slate-400';
  if (isGreenBalancedRule) {
    dotClass = 'bg-emerald-400';
  } else if (rule.status === 'pass' && rule.dataSource === 'estimated') {
    dotClass = 'bg-amber-400';
  } else if (rule.status === 'pass') {
    dotClass = 'bg-emerald-400';
  } else if (rule.status === 'fail') {
    dotClass = 'bg-red-400';
  } else if (rule.status === 'warn') {
    dotClass = 'bg-amber-400';
  }

  const badgeLabel = isGreenBalancedRule
    ? 'Verified'
    : getStatusBadgeLabel(rule.status, rule.unverified, rule.dataSource);

  return {
    ruleId: rule.ruleId,
    label,
    whyItMatters,
    dotClass,
    badgeLabel,
  };
}