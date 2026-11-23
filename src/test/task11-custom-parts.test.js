import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCustomPartSpecs,
  createCustomOwnedPart,
  isCustomPartItem,
  getCustomBuildSummary,
  buildLearnMoreUrl,
  getItemDisplayStatus,
} from '../lib/customParts.js';

test('TC-65: hasCustomPartSpecs and createCustomOwnedPart classify verified vs unverified custom parts', () => {
  // Blank name returns null
  assert.equal(createCustomOwnedPart({ name: '   ' }), null);

  // Part with no specs is flagged unverified
  const noSpecPart = createCustomOwnedPart(
    { category: 'Cases', name: 'Generic Old ATX Tower', brand: '  ', wattage: 0 },
    1700000000000
  );
  assert.equal(noSpecPart.id, 'custom-1700000000000');
  assert.equal(noSpecPart.brand, 'Custom');
  assert.equal(noSpecPart.isCustomInput, true);
  assert.equal(noSpecPart.unverified, true);
  assert.equal(noSpecPart.stock_status, 'Owned (Custom)');
  assert.equal(noSpecPart.source_type, 'reference');
  assert.equal(hasCustomPartSpecs(noSpecPart), false);

  // Part with socket/memory/wattage specs is not flagged unverified
  const specPart = createCustomOwnedPart(
    {
      category: 'Motherboards',
      name: 'ASUS TUF B550M-PLUS',
      brand: 'ASUS',
      socket: 'AM4',
      memory_type: 'DDR4',
      form_factor: 'Micro-ATX',
    },
    1700000000001
  );
  assert.equal(specPart.isCustomInput, true);
  assert.equal(specPart.unverified, false);
  assert.equal(hasCustomPartSpecs(specPart), true);
});

test('TC-66: getCustomBuildSummary aggregates custom parts across build slots accurately', () => {
  const customCpu = createCustomOwnedPart({ category: 'Processors', name: 'Ryzen 5 3600' }, 1);
  const customPsu = createCustomOwnedPart({ category: 'Power Supplies', name: 'Old 500W PSU' }, 2);
  const stockGpu = { id: 10, category: 'Video Cards', name: 'RTX 4060', stock_status: 'In Stock' };

  const summary = getCustomBuildSummary({
    Processors: customCpu,
    'Video Cards': stockGpu,
    'Power Supplies': customPsu,
    Memory: null,
  });

  assert.equal(summary.hasCustomPart, true);
  assert.equal(summary.customCount, 2);
  assert.deepEqual(summary.customCategories, ['Processors', 'Power Supplies']);
  assert.deepEqual(summary.customNames, ['Ryzen 5 3600', 'Old 500W PSU']);
  assert.equal(isCustomPartItem(stockGpu), false);
});

test('TC-67: getItemDisplayStatus and buildLearnMoreUrl handle custom, reference, and unsafe URLs', () => {
  const customPart = createCustomOwnedPart({ category: 'Storage', name: 'Old 240GB SATA SSD' }, 3);
  assert.equal(getItemDisplayStatus(customPart), 'unverified');
  assert.equal(getItemDisplayStatus({ source_type: 'reference' }), 'reference');
  assert.equal(
    getItemDisplayStatus({ stock_status: 'In Stock' }, { inventoryMode: 'preorder' }),
    'Pre-Order'
  );

  assert.equal(
    buildLearnMoreUrl({ specs_url: 'https://manufacturer.example/ssd', name: 'SSD' }),
    'https://manufacturer.example/ssd'
  );
  assert.equal(
    buildLearnMoreUrl({ specs_url: 'javascript:alert(1)', name: 'Ryzen 5 3600', category: 'Processors' }),
    'https://www.google.com/search?q=Ryzen%205%203600%20Processors%20specifications'
  );
});