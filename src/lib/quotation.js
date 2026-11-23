import { CATEGORIES } from './config.js';
import { getEffectiveItemPrice } from './pricing.js';
import { parseRam } from './ram.js';

export function formatPeso(value) {
  return `\u20B1${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

export function getQuotationCategoryLabel(category) {
  if (category === 'Video Cards') return 'Graphics Cards';
  if (category === 'Power Supplies') return 'Power Supply';
  if (category === 'CPU Coolers') return 'CPU Cooler';
  return category;
}

export function buildQuotationPayload({
  refCode,
  currentUser = null,
  selectedBuild = {},
  selectedRamCount = 2,
  totalPrice = 0,
  compatibilityScore = null,
}) {
  return {
    reference_code: refCode,
    user_id: currentUser ? currentUser.id : null,
    customer_email: currentUser ? currentUser.email : 'Walk-in / Guest',
    build_data: { ...selectedBuild, __ramStickCount: selectedRamCount },
    total_price: Number(totalPrice || 0),
    compatibility_score: compatibilityScore,
  };
}

export function buildQuotationHtmlDocument({
  refCode,
  printDateString,
  selectedBuild = {},
  selectedRamCount = 2,
  totalPrice = 0,
  compatibilityScore = null,
  verificationCoverage = { verified: 0, total: 0 },
  activePeakWatts = 0,
  recommendedPsuWatts = 0,
}) {
  const rowsHtml = CATEGORIES.map((cat) => {
    const item = selectedBuild?.[cat];
    if (!item) return '';

    const isMemory = cat === 'Memory';
    const ramDetails = isMemory ? parseRam(item, selectedRamCount) : null;
    const linePrice = getEffectiveItemPrice(cat, item, selectedRamCount);
    const componentDescription = ramDetails && ramDetails.perStickCapacity > 0
      ? `${item.name} (${ramDetails.stickCount} x ${ramDetails.perStickCapacity}GB)`
      : item.name;
    const unverifiedNote = item.unverified || item.isCustomInput ? ' [unverified]' : '';

    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #cbd5e1;font-weight:bold;color:#334155;">${getQuotationCategoryLabel(cat)}</td>
        <td style="padding:8px;border-bottom:1px solid #cbd5e1;color:#0f172a;">${componentDescription}${unverifiedNote} <span style="color:#64748b;font-size:11px;">(${item.sku_code || item.id})</span></td>
        <td style="padding:8px;border-bottom:1px solid #cbd5e1;text-align:right;font-family:sans-serif;font-weight:bold;">${formatPeso(linePrice)}</td>
      </tr>`;
  }).join('');

  const scoreTextHtml =
    compatibilityScore === null || compatibilityScore === undefined
      ? 'Not enough data'
      : `${compatibilityScore}% (${verificationCoverage.verified}/${verificationCoverage.total} verified)`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ByteBuild Quotation ${refCode}</title>
</head>
<body style="font-family:Arial,sans-serif;max-width:750px;margin:24px auto;padding:20px;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;">
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px;">
    <div>
      <h1 style="margin:0;font-size:20px;">BYTEBUILD COMPUTER SOLUTIONS</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#475569;">Quezon City, Metro Manila · Local PH Retail Distributor Quotation</p>
    </div>
    <div style="text-align:right;">
      <strong style="font-size:14px;">OFFICIAL QUOTATION</strong>
      <p style="margin:4px 0 0;font-family:monospace;font-size:12px;">REF: ${refCode}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Date: ${printDateString}</p>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#f1f5f9;text-align:left;">
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;">Category</th>
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;">Component Specification</th>
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;text-align:right;">Price (PHP)</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div style="margin-top:16px;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:12px;color:#475569;">Compatibility Score: <strong>${scoreTextHtml}</strong> · Rec. PSU: <strong>${recommendedPsuWatts}W</strong></div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Peak Load: ${activePeakWatts}W</div>
    </div>
    <div style="font-size:20px;font-weight:900;color:#1e3a8a;font-family:sans-serif;">${formatPeso(totalPrice)}</div>
  </div>
</body>
</html>`;
}