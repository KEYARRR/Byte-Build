import { deriveComponentTier } from './scoring.js';
import { detectCpuSocket, hasIntegratedGraphics } from './compat.js';

export function buildDiagnosticIssues(ruleResults = []) {
  const mapped = (Array.isArray(ruleResults) ? ruleResults : [])
    .filter((r) => r && (r.status === 'fail' || r.status === 'warn' || r.status === 'unknown'))
    .map((r) => ({
      id: r.ruleId,
      category: r.category || 'General',
      status: r.status,
      unverified: Boolean(r.unverified),
      severity:
        r.status === 'fail'
          ? 'critical'
          : r.status === 'warn'
          ? 'warning'
          : r.unverified
          ? 'unverified'
          : 'unknown',
      title: r.title || r.ruleId,
      message: r.message || r.detail || '',
      action: r.recommendation || r.action || 'Review component specifications.',
    }));

  return {
    actionableIssues: mapped.filter(
      (i) => i.severity === 'critical' || i.severity === 'warning' || i.unverified
    ),
    unknownCatalogIssues: mapped.filter((i) => i.severity === 'unknown' && !i.unverified),
  };
}

export function buildSystemRecommendation({
  actionableIssues = [],
  selectedItems = [],
  existingPc = {},
  currentCpu = null,
  currentPsu = null,
  psuTier = 'Unknown',
  activePeakWatts = 0,
  recommendedPsuWatts = 0,
}) {
  const critical = actionableIssues.find((issue) => issue.severity === 'critical');
  const unverifiedCustom = actionableIssues.find((issue) => issue.unverified);
  const warnings = actionableIssues.filter((issue) => issue.severity === 'warning');
  const preOrderPart = selectedItems.find((item) => item?.stock_status === 'Pre-Order');

  if (critical) {
    return {
      title: critical.title,
      tone: 'danger',
      summary: `${critical.message}\n\nRecommended Action: ${critical.action}`,
    };
  }

  if (unverifiedCustom) {
    return {
      title: 'Unverified Custom Part',
      tone: 'warning',
      summary: `${unverifiedCustom.message}\n\nRecommended Action: ${unverifiedCustom.action}`,
    };
  }

  if (warnings.length > 0) {
    return {
      title: `${warnings.length} Hardware Balance Note${warnings.length > 1 ? 's' : ''}`,
      tone: 'warning',
      summary: `Hardware is operational, with ${warnings.length} balance note(s).\n\nPrimary Focus: ${warnings[0].message}`,
    };
  }

  if (preOrderPart) {
    return {
      title: 'Pre-Order Allocation Pending',
      tone: 'info',
      summary: `${preOrderPart.name} is reserved via supplier pre-order.`,
    };
  }

  if (selectedItems.length === 0 && Object.values(existingPc || {}).filter(Boolean).length === 0) {
    return {
      title: 'System Validator Ready',
      tone: 'neutral',
      summary:
        'Select components or run the Smart Build Assistant to verify compatibility, power draw, and balance.',
    };
  }

  const cpuSock = detectCpuSocket(currentCpu);
  return {
    title: 'Platform Architecture Verified',
    tone: 'success',
    summary: `All checked platform rules passed.\n• Socket: ${cpuSock || 'Verified'}\n• PSU Tier: ${
      currentPsu ? `Tier ${psuTier}` : 'Pending'
    }\n• Peak Load: ${activePeakWatts}W (Rec PSU: ${recommendedPsuWatts}W).`,
  };
}

export function evaluatePerformanceTier({
  currentCpu = null,
  currentGpu = null,
  actionableIssues = [],
  workloadProfile = 'Gaming',
} = {}) {
  const cpuTier = deriveComponentTier(currentCpu, 'Processors');
  const gpuTier = deriveComponentTier(currentGpu, 'Video Cards');
  const hasApuGraphics = hasIntegratedGraphics(currentCpu) === true && !currentGpu;
  const profile = String(workloadProfile || 'Gaming');

  const critical = actionableIssues.find((issue) => issue.severity === 'critical');
  if (critical) {
    return {
      label: 'Compatibility Conflict Detected',
      description: critical.message,
    };
  }

  if (!currentGpu && !hasApuGraphics) {
    return {
      label: 'Select a Graphics Card',
      description:
        'Choose a GPU (or an APU with integrated graphics) to evaluate gaming and productivity performance tiers.',
    };
  }

  if (gpuTier >= 4 && cpuTier >= 4) {
    return {
      label: 'Performance Gaming & Creator Rig',
      description:
        'Strong CPU and GPU tier alignment for high-frame-rate 1440p gaming and creative workloads.',
    };
  }

  if (profile === 'Office/Productivity') {
    return {
      label: 'Office / Productivity Configuration',
      description:
        'Tuned for everyday productivity, coursework, multitasking, and energy-efficient operation.',
    };
  }

  if (profile === 'Content Creation') {
    if (cpuTier >= 4 || gpuTier >= 4) {
      return {
        label: 'Creator Workstation Configuration',
        description:
          'Strong CPU and GPU tier balance for video editing, rendering, and creative workloads.',
      };
    }
    return {
      label: 'Entry Creator Configuration',
      description:
        'Starter creator setup for photo/video editing, design tasks, and daily productivity.',
    };
  }

  if (profile === 'Mixed/Balanced' || profile === 'Balanced') {
    return {
      label: 'Balanced Multi-Purpose Configuration',
      description:
        'Evenly balanced across gaming, productivity, and general desktop workloads.',
    };
  }

  if (gpuTier === 3 || cpuTier === 3 || Boolean(currentGpu)) {
    return {
      label: '1080p Gaming & Esports Configuration',
      description:
        'Configured for gaming workloads with dedicated graphics output; stepping up GPU tier expands graphics headroom.',
    };
  }

  return {
    label: 'Integrated Graphics Gaming Starter',
    description:
      'Uses integrated graphics for light gaming and everyday desktop workloads.',
  };
}