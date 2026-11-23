import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortCatalogProducts,
  getBrandsForCategory,
  getCategoryCounts,
} from '../lib/catalog.js';

const ITEMS = [
  {
    id: 1,
    category: 'Motherboards',
    brand: 'MSI',
    name: 'MSI MAG B650M Mortar WiFi',
    form_factor: 'Micro-ATX',
    price: 11500,
    hardware_score: 86,
    stock_status: 'In Stock',
  },
  {
    id: 2,
    category: 'Motherboards',
    brand: 'ASUS',
    name: 'ASUS ROG Strix X670E-E',
    form_factor: 'ATX',
    price: 26500,
    hardware_score: 94,
    stock_status: 'In Stock',
  },
  {
    id: 3,
    category: 'Motherboards',
    brand: 'Gigabyte',
    name: 'Gigabyte B650M DS3H',
    form_factor: 'Micro-ATX',
    price: 7800,
    hardware_score: 76,
    stock_status: 'Sold Out',
  },
];

test('TC-57: Catalog filters by sold-out toggle, price range, form factor, and sorts accurately', () => {
  const hiddenSoldOut = filterAndSortCatalogProducts(ITEMS, {
    category: 'Motherboards',
    sortBy: 'price-asc',
    showSoldOut: false,
  });
  assert.equal(hiddenSoldOut.length, 2);
  assert.equal(hiddenSoldOut[0].id, 1);

  const includedSoldOut = filterAndSortCatalogProducts(ITEMS, {
    category: 'Motherboards',
    sortBy: 'price-asc',
    showSoldOut: true,
  });
  assert.equal(includedSoldOut.length, 3);
  assert.equal(includedSoldOut[0].id, 3);

  const byRating = filterAndSortCatalogProducts(ITEMS, {
    category: 'Motherboards',
    sortBy: 'rating',
    showSoldOut: true,
  });
  assert.equal(byRating[0].id, 2);

  const microAtzOnly = filterAndSortCatalogProducts(ITEMS, {
    category: 'Motherboards',
    formFactor: 'Micro-ATX',
    maxPrice: 12000,
    showSoldOut: true,
  });
  assert.deepEqual(
    microAtzOnly.map((i) => i.id),
    [3, 1]
  );
});

test('TC-58: getBrandsForCategory and getCategoryCounts respect visibility options', () => {
  const brands = getBrandsForCategory(ITEMS, 'Motherboards', { showSoldOut: false });
  assert.deepEqual(brands, ['All', 'MSI', 'ASUS']);

  const counts = getCategoryCounts(ITEMS, { showSoldOut: false });
  assert.equal(counts.Motherboards, 2);
  assert.equal(counts.Processors, 0);
});