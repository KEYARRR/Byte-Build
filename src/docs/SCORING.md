# ByteBuild Scoring, Bottleneck, and Power Estimation Model

This document states each deterministic formula and project-calibrated assumption used in `src/lib/config.js`, `src/lib/power.js`, `src/lib/scoring.js`, and `src/lib/compat.js`[cite: 3, 4, 6].

## 1. Power Parsing & Missing Wattage (`src/lib/power.js`)
- **CPU & GPU Wattage Parsing (`parseComponentPowerWatts`)**:
  - Accepts numbers adjacent to `TBP`, `TGP`, `TDP`, or `power` (excluding `PSU`, `power supply`, or `recommended`).
  - A spec like `"Recommended PSU 550W"` is never parsed as GPU draw.
- **Missing Wattage Handling**:
  - When GPU wattage is missing, GPU draw is treated as missing (`gpuWattsMissing = true`, `0W` added to partial sum) rather than silently fabricating a draw value.
  - When CPU TDP is missing, CPU TDP falls back to `defaultCpuTdpWatts = 65W` (**ASSUMPTION**), marked estimated.
  - `calculateRigWattage` returns `missingSpecs: [{ category, name }]` for any part missing wattage data, and `App.jsx` displays `"Power estimate incomplete: [parts] have no wattage data"`[cite: 10].

## 2. CPU Peak Draw & Recommended PSU Formula (`src/lib/power.js`, `src/lib/config.js`)
- **CPU Peak Draw (`getCpuPowerProfile`)**:
  - Uses `peak_watts` if present; otherwise `round(tdpWatts * 1.35)` (**ASSUMPTION**, `cpuPeakTdpMultiplier = 1.35`), labelled estimated.
  - A `125W` TDP processor such as an `i9-14900K` without an explicit `peak_watts` column has an estimated peak draw of `169W` (`round(125 * 1.35)`), not `125W`.
- **Single Recommended-PSU Formula (`computeRecommendedPsuWatts`)**:
  - `recommendedPsuWatts = max(minRecommendedPsuWatts, ceil(max(activePeakWatts * psuHeadroomMultiplier, activePeakWatts + bufferWatts) / psuStepWatts) * psuStepWatts)`
  - Uses `bufferWatts` from admin `dssRules.psuBufferWatts` (default `120W`, **ASSUMPTION**), `psuHeadroomMultiplier = 1.25` (**ASSUMPTION**), `psuStepWatts = 50W`, and `minRecommendedPsuWatts = 450W` (**ASSUMPTION**).
- **Idle Load**:
  - `idleWatts = round(activePeakWatts * idleRatio)` (`idleRatio = 0.18`, **ASSUMPTION**), with no hard-coded `12/14/10/4/2` constants.

## 3. Compatibility Score & Verification Coverage (`src/lib/scoring.js`)
- **Verification Coverage (`getVerificationCoverage`)**:
  - `verified`: Rules with `status === 'pass'` and `dataSource === 'database'`.
  - `estimated`: Rules with `dataSource === 'estimated'` (never counted as verified; estimated `fail` downgrades to `warn` with `"based on estimated specs"`).
  - `unknown`: Rules with `status === 'unknown'` due to missing specification columns.
- **Compatibility Score (`calculateCompatibilityScore`)**:
  - Returns `null` when `verified < 3` (displayed as `"Score: not enough data"`).
  - Otherwise starts at `100`, subtracts `30` per `fail` and `10` per `warn`, and clamps to `[0, 100]`.