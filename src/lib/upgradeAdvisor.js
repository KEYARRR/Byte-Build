import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice } from './pricing.js';
import { detectCpuSocket, detectMotherboardSocket, hasIntegratedGraphics } from './compat.js';
import { deriveComponentTier } from './scoring.js';
import { parseRam } from './ram.js';

const CORE_UPGRADE_CATEGORIES = [
  'Processors',
  'Motherboards',
  'Memory',
  'Storage',
  'Power Supplies',
  'Cases',
];

function detectCapacityGb(item) {
  if (!item) return 0;
  const direct = Number(item.capacity_gb ?? item.storage_gb ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const text = `${item.name || ''} ${item.specs || ''}`;
  const tbMatch = text.match(/(\d+(?:\.\d+)?)\s*TB\b/i);
  if (tbMatch) return Math.round(Number(tbMatch[1]) * 1000);
  const gbMatch = text.match(/(\d{2,4})\s*GB\b/i);
  if (gbMatch) return Number(gbMatch[1]);
  return 0;
}

export function buildUnifiedUpgradeRows({
  existingPc = {},
  selectedBuild = {},
  existingRamCount = 2,
  selectedRamCount = 2,
}) {
  return CATEGORIES.map((category) => {
    const ownedItem = existingPc?.[category] || null;
    const upgradeItem = selectedBuild?.[category] || null;
    const activeItem = upgradeItem || ownedItem || null;

    const isUpgraded = Boolean(upgradeItem && ownedItem && upgradeItem.id !== ownedItem.id);
    const isAddedNew = Boolean(upgradeItem && !ownedItem);
    const isOwnedOnly = Boolean(ownedItem && !upgradeItem);

    const activeRamSticks =
      category === 'Memory'
        ? upgradeItem
          ? selectedRamCount
          : existingRamCount
        : 2;

    const upgradeCost = upgradeItem
      ? getEffectiveItemPrice(category, upgradeItem, selectedRamCount)
      : 0;

    const ownedReferenceCost = ownedItem
      ? getEffectiveItemPrice(category, ownedItem, existingRamCount)
      : 0;

    let statusLabel = 'Unassigned';
    if (isUpgraded) statusLabel = 'Upgrading';
    else if (isAddedNew) statusLabel = 'New Upgrade';
    else if (isOwnedOnly) statusLabel = 'Current Rig';

    return {
      category,
      ownedItem,
      upgradeItem,
      activeItem,
      statusLabel,
      isUpgraded,
      isAddedNew,
      isOwnedOnly,
      isUnverified: Boolean(activeItem?.isCustom || activeItem?.unverified),
      activeRamSticks,
      upgradeCost,
      ownedReferenceCost,
    };
  });
}

export function getUpgradeMissingCoreLabels({ existingPc = {}, selectedBuild = {} }) {
  const labelMap = {
    Processors: 'CPU',
    Motherboards: 'Motherboard',
    Memory: 'RAM',
    Storage: 'Boot Drive',
    'Power Supplies': 'PSU',
    Cases: 'Case',
  };

  return CORE_UPGRADE_CATEGORIES.filter(
    (cat) => !(selectedBuild?.[cat] || existingPc?.[cat])
  ).map((cat) => labelMap[cat] || cat);
}

export function buildNextUpgradeNotes({
  existingPc = {},
  selectedBuild = {},
  effectiveParts = {},
  ramStickCount = 2,
  powerMetrics = {},
  ruleResults = [],
}) {
  const notes = [];

  const cpu = effectiveParts.Processors || null;
  const mobo = effectiveParts.Motherboards || null;
  const gpu = effectiveParts['Video Cards'] || null;
  const ram = effectiveParts.Memory || null;
  const ssd = effectiveParts.Storage || null;
  const psu = effectiveParts['Power Supplies'] || null;

  const failRules = (ruleResults || []).filter((r) => r?.status === 'fail');
  const warnRules = (ruleResults || []).filter((r) => r?.status === 'warn');

  for (const r of failRules) {
    notes.push({
      priority: 'high',
      title: `Fix Conflict: ${r.title || r.ruleId}`,
      detail: r.message || 'Incompatible hardware pairing detected.',
      action: r.recommendation || 'Swap to a compatible component in the affected category.',
    });
  }

  const missingCore = getUpgradeMissingCoreLabels({ existingPc, selectedBuild });
  if (missingCore.length > 0) {
    notes.push({
      priority: 'medium',
      title: `Complete Core Rig (${missingCore.join(', ')})`,
      detail: `Missing core details for ${missingCore.join(', ')} in your current rig or upgrade selection.`,
      action: 'Select your existing part under Step 1 (or add a Custom Owned Part) so compatibility and wattage are fully checked.',
    });
  }

  if (cpu && mobo) {
    const cpuSock = String(detectCpuSocket(cpu) || cpu.socket || '').toUpperCase();
    const moboSock = String(detectMotherboardSocket(mobo) || mobo.socket || '').toUpperCase();
    if (cpuSock && moboSock && cpuSock === moboSock) {
      const cpuTier = deriveComponentTier(cpu, 'Processors');
      if (cpuTier <= 2) {
        notes.push({
          priority: 'low',
          title: `Drop-In CPU Headroom on ${cpuSock}`,
          detail: `${cpu.name} shares socket ${cpuSock} with ${mobo.name}, leaving room for a higher-tier CPU on the same board if needed.`,
          action: 'Check higher-tier CPUs on the same socket before replacing both CPU and motherboard.',
        });
      }
    }
  }

  if (ram) {
    const parsedRam = parseRam(ram, ramStickCount);
    if (parsedRam.totalCapacity > 0 && parsedRam.totalCapacity < 16) {
      notes.push({
        priority: 'medium',
        title: 'Upgrade Memory to 16GB+',
        detail: `Current memory is ${parsedRam.totalCapacity}GB (${ramStickCount} stick${ramStickCount > 1 ? 's' : ''}).`,
        action: 'Step up to a 16GB (or 32GB for creator/heavy multitasking) kit matching your board memory generation.',
      });
    } else if (ramStickCount === 1) {
      notes.push({
        priority: 'low',
        title: 'Enable Dual-Channel Memory',
        detail: `Memory is currently configured as a single stick (${parsedRam.totalCapacity || '?'}GB).`,
        action: 'Add a matching second stick when your board slots and budget allow.',
      });
    }
  }

  if (ssd) {
    const ssdGb = detectCapacityGb(ssd);
    if (ssdGb > 0 && ssdGb < 500) {
      notes.push({
        priority: 'medium',
        title: 'Expand Primary / Boot Storage to 500GB–1TB+',
        detail: `Current boot drive is ${ssdGb}GB, which can fill up quickly with modern games and apps.`,
        action: 'Consider a 1TB NVMe SSD or add a secondary drive for extra capacity.',
      });
    }
  }

  const peakWatts = Number(powerMetrics?.activePeakWatts || 0);
  const recWatts = Number(powerMetrics?.recommendedPsuWatts || 0);
  if (recWatts > 0 && !psu) {
    notes.push({
      priority: 'high',
      title: `Assign a ${recWatts}W+ Power Supply`,
      detail: `Estimated active draw is ${peakWatts}W, requiring around ${recWatts}W recommended PSU headroom.`,
      action: 'Select a reliable PSU at or above the recommended wattage before adding a stronger GPU.',
    });
  } else if (gpu && cpu) {
    const cpuTier = deriveComponentTier(cpu, 'Processors');
    const gpuTier = deriveComponentTier(gpu, 'Video Cards');
    if (gpuTier - cpuTier >= 2) {
      notes.push({
        priority: 'low',
        title: 'Watch CPU vs. GPU Tier Balance',
        detail: `${gpu.name} is noticeably higher tier than ${cpu.name}, which may limit frame pacing in CPU-heavy games.`,
        action: 'Consider a stronger CPU if targeting high-FPS competitive gaming.',
      });
    }
  }

  if (notes.length === 0 && warnRules.length === 0) {
    notes.push({
      priority: 'low',
      title: 'Rig Looks Balanced for Current Setup',
      detail:
        !gpu && cpu && hasIntegratedGraphics(cpu)
          ? 'Integrated graphics are active; adding a discrete GPU is the main performance upgrade path once PSU headroom is verified.'
          : 'No immediate conflicts or bottlenecks flagged across your current rig and selected upgrades.',
      action: 'Compare candidate parts in Compare & Swap or export your upgrade quotation.',
    });
  }

  return notes;
}