# ByteBuild Scoring, Bottleneck, and Power Estimation Model

This document describes how ByteBuild computes compatibility scores, component tiers, CPU/GPU pairing balance, and estimated system wattage/PSU recommendations using `src/lib/config.js`, `src/lib/pricing.js`, `src/lib/power.js`, `src/lib/scoring.js`, and `src/lib/autobuilder.js`.

## 1. Compatibility Score (`calculateCompatibilityScore`)
- Starts from a baseline of `100`.
- Each evaluated rule result applies a deterministic deduction:
  - `fail`: `-30` points
  - `warn`: `-10` points
  - `pass`: `0` points
  - `unknown`: `0` points (missing data is surfaced separately as `unknown` rather than fabricated as `pass` or zeroed out blindly)
- Clamped to the `[0, 100]` range.

## 2. Component Tiers & Bottleneck Balance
- `deriveComponentTier(item, category)`:
  - If `hardware_score` is present (`> 0`), maps scores into tiers `1..5` (`>=90` -> `5`, `>=75` -> `4`, `>=55` -> `3`, `>=35` -> `2`, else `1`).
  - Otherwise falls back to TDP/wattage thresholds (`TIER_THRESHOLDS` in `src/lib/config.js`; marked `TODO: cite source`).
- `evaluateBottleneckBalance(cpu, gpu)`:
  - Compares derived CPU and GPU tiers.
  - Treats `|cpuTier - gpuTier| <= balancedMaxTierDelta` (`1` in `BOTTLENECK_CONFIG`) as balanced (`pass`).
  - Flags larger tier gaps as `warn` and missing discrete GPU as `warn` (`No Discrete GPU (Integrated / APU Only)`).

## 3. Power Draw & Recommended PSU (`calculateRigWattage`)
- Sums component power draw across active parts:
  - CPU TDP (`tdp` / `wattage` or parsed `W` / `TDP`, defaulting to `defaultCpuTdpWatts = 65W` if missing)
  - GPU power (`wattage` / `tdp` or parsed `W`, `0W` if omitted)
  - Motherboard (`motherboardBaseWatts = 45W` when selected)
  - RAM (`ramStickCount * perRamStickWatts`, `4W` per stick when selected)
  - Storage (`storageDriveWatts = 6W` when selected)
  - CPU Cooler (`aioCoolerWatts = 18W` for AIO/liquid vs. `airCoolerWatts = 6W` for air cooler when selected)
  - Case (`caseFansWatts = 12W` when selected)
- Overclocking applies `overclockPeakMultiplier = 1.15` to peak load when enabled.
- Recommended PSU wattage applies `psuHeadroomMultiplier = 1.25`, rounds up to the next `psuStepWatts = 50W`, and enforces `minRecommendedPsuWatts = 450W`.
- Constants with `TODO: cite source` in `src/lib/config.js` indicate locally calibrated or provisional figures pending formal source citation.

## 4. Stick-Aware Pricing & Budget Auto-Builder
- `getEffectiveItemPrice`: Multiplies unit price by `ramStickCount` (`1`, `2`, `4`) for non-bundled `Memory` items; keeps pre-bundled kits (`2x...`, `4x...`, `kit`) at single kit price.
- `runSmartBuildAssistant`: Allocates initial targets using `WORKLOAD_WEIGHTS`, greedily upgrades within remaining budget while checking socket/PSU headroom, and runs a final ceiling guard so `totalPrice <= budget`.