import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomOwnedPart,
  getCustomBuildSummary,
  buildLearnMoreUrl,
} from '../lib/customParts.js';
import {
  buildAdminInsertPayload,
  filterAdminRecords,
  normalizeDssRules,
} from '../lib/admin.js';

test('TC-63: createCustomOwnedPart flags spec-less custom parts as unverified and builds safe URLs', () => {
  const unverified = createCustomOwnedPart(
    { category: 'Motherboards', name: 'Mystery OEM Board' },
    100
  );
  assert.equal(unverified.unverified, true);
  assert.equal(unverified.isCustomInput, true);

  const withSpecs = createCustomOwnedPart(
    { category: 'Processors', name: 'Ryzen 5 5600', socket: 'AM4' },
    101
  );
  assert.equal(withSpecs.unverified, false);
  assert.equal(withSpecs.isCustomInput, true);

  const summary = getCustomBuildSummary({ Motherboards: unverified, Processors: withSpecs });
  assert.equal(summary.hasCustomPart, true);
  assert.equal(summary.customCount, 2);
  assert.deepEqual(summary.customCategories, ['Motherboards', 'Processors']);

  assert.equal(
    buildLearnMoreUrl({ specs_url: 'https://example.com/specs' }),
    'https://example.com/specs'
  );
  assert.equal(
    buildLearnMoreUrl({ specs_url: 'javascript:alert(1)', name: 'CPU' }).startsWith('https://'),
    true
  );
});

test('TC-64: Admin payload builder, record filter, and DSS rule normalization enforce bounds', () => {
  const insertRow = buildAdminInsertPayload(
    {
      name: 'Test PSU',
      brand: 'Corsair',
      category: 'Power Supplies',
      price: '4500',
      psu_tier: 'A',
    },
    'catalog',
    'bytebuild_current_inventory'
  );
  assert.equal(insertRow.price, 4500);
  assert.equal(insertRow.psu_tier, 'A');

  const filtered = filterAdminRecords(
    [
      { id: 1, name: 'RM750e', brand: 'Corsair', category: 'Power Supplies', psu_tier: 'A' },
      { id: 2, name: 'B550M', brand: 'MSI', category: 'Motherboards', socket: 'AM4' },
    ],
    { categoryFilter: 'Power Supplies', searchQuery: 'rm750' }
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 1);

  const rules = normalizeDssRules({ psuBufferWatts: -50, maxAllowedTierGap: 99 });
  assert.equal(rules.psuBufferWatts, 0);
  assert.equal(rules.maxAllowedTierGap, 4);
});