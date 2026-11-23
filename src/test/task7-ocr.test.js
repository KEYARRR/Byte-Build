import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOcrTextToCatalog, applyInStockOcrMatches } from '../lib/ocr.js';

const ACTIVE_ITEMS = [
  {
    id: 'cpu-1',
    category: 'Processors',
    brand: 'AMD',
    name: 'AMD Ryzen 5 5600',
    price: 7500,
    stock_status: 'In Stock',
  },
  {
    id: 'gpu-1',
    category: 'Video Cards',
    brand: 'ASUS',
    name: 'ASUS Dual RTX 4060 8GB',
    price: 18500,
    stock_status: 'Sold Out',
  },
];

const PREORDER_ITEMS = [
  {
    id: 'mobo-1',
    category: 'Motherboards',
    brand: 'MSI',
    name: 'MSI B550M PRO-VDH WIFI',
    price: 6200,
    stock_status: 'Pre-Order',
  },
];

test('TC-55: matchOcrTextToCatalog classifies In Stock, Pre-Order, Sold Out, and Unavailable lines', () => {
  const sheet = [
    '1. Ryzen 5 5600',
    '2. MSI B550M PRO-VDH',
    '3. ASUS RTX 4060',
    '4. Noctua NH-D15 Chromax',
  ].join('\n');

  const results = matchOcrTextToCatalog(sheet, ACTIVE_ITEMS, PREORDER_ITEMS);
  assert.equal(results.length, 4);
  assert.equal(results[0].status, 'In Stock');
  assert.equal(results[0].matchedPart.id, 'cpu-1');
  assert.equal(results[1].status, 'Pre-Order');
  assert.equal(results[1].matchedPart.id, 'mobo-1');
  assert.equal(results[2].status, 'Sold Out');
  assert.equal(results[3].status, 'Unavailable');
  assert.equal(results[3].matchedPart, null);
});

test('TC-56: applyInStockOcrMatches loads only In Stock parts into matching build slots', () => {
  const results = matchOcrTextToCatalog(
    'Ryzen 5 5600\nMSI B550M PRO-VDH\nASUS RTX 4060',
    ACTIVE_ITEMS,
    PREORDER_ITEMS
  );

  const { build, loadedCount } = applyInStockOcrMatches({}, results);
  assert.equal(loadedCount, 1);
  assert.equal(build.Processors.id, 'cpu-1');
  assert.equal(build.Motherboards, undefined);
  assert.equal(build['Video Cards'], undefined);
});