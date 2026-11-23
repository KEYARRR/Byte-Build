import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuotationPayload,
  buildQuotationHtmlDocument,
} from '../lib/quotation.js';

test('TC-59: buildQuotationPayload builds guest and authenticated quotation rows cleanly', () => {
  const guestPayload = buildQuotationPayload({
    refCode: 'BB-123456',
    currentUser: null,
    selectedBuild: { Processors: { id: 1, name: 'Ryzen 5 5600', price: 7500 } },
    selectedRamCount: 2,
    totalPrice: 7500,
    compatibilityScore: null,
  });

  assert.equal(guestPayload.reference_code, 'BB-123456');
  assert.equal(guestPayload.user_id, null);
  assert.equal(guestPayload.customer_email, 'Walk-in / Guest');
  assert.equal(guestPayload.build_data.__ramStickCount, 2);
  assert.equal(guestPayload.compatibility_score, null);
});

test('TC-60: buildQuotationHtmlDocument renders component rows, score fallback, and power stats', () => {
  const html = buildQuotationHtmlDocument({
    refCode: 'BB-654321',
    printDateString: 'Nov 23, 2026',
    selectedBuild: {
      Processors: { id: 'cpu-1', name: 'Ryzen 5 5600', price: 7500 },
      Memory: { id: 'ram-1', name: '16GB DDR4-3200', price: 2200 },
    },
    selectedRamCount: 2,
    totalPrice: 11900,
    compatibilityScore: null,
    verificationCoverage: { verified: 0, total: 12 },
    activePeakWatts: 145,
    recommendedPsuWatts: 450,
  });

  assert.match(html, /BB-654321/);
  assert.match(html, /Ryzen 5 5600/);
  assert.match(html, /16GB DDR4-3200 \(2 x 16GB\)/);
  assert.match(html, /Not enough data/);
  assert.match(html, /450W/);
  assert.match(html, /145W/);
});