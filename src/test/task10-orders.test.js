import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSavedBuildRecord,
  validatePreorderInput,
  buildPreorderRequestPayload,
} from '../lib/orders.js';

test('TC-61: normalizeSavedBuildRecord extracts RAM stick count without leaking __ramStickCount into slots', () => {
  const normalized = normalizeSavedBuildRecord({
    build_data: {
      __ramStickCount: 4,
      Processors: { id: 'cpu-1', name: 'Ryzen 5 7600' },
    },
  });

  assert.equal(normalized.ramStickCount, 4);
  assert.equal(normalized.buildData.Processors.id, 'cpu-1');
  assert.equal(normalized.buildData.__ramStickCount, undefined);
});

test('TC-62: validatePreorderInput and buildPreorderRequestPayload enforce valid customer info', () => {
  const invalid = validatePreorderInput({ customerName: '   ', contactNumber: '123' });
  assert.equal(invalid.valid, false);

  const valid = validatePreorderInput({
    customerName: 'Kenneth Rabang',
    contactNumber: '0917 555 0199',
  });
  assert.equal(valid.valid, true);

  const payload = buildPreorderRequestPayload({
    currentUser: { id: 'user-1', email: 'kenneth@bytebuild.ph' },
    customerName: valid.customerName,
    contactNumber: valid.contactNumber,
    product: { id: 42, name: 'RTX 4070 Super', price: 37500 },
  });

  assert.equal(payload.user_id, 'user-1');
  assert.equal(payload.product_id, '42');
  assert.equal(payload.estimated_price, 37500);
  assert.equal(payload.status, 'Pending Supplier Confirmation');
});