import { CATEGORIES } from './config.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function detectPartFormFactor(part) {
  const raw = `${part?.form_factor || ''} ${part?.name || ''} ${part?.specs || ''}`.toUpperCase();
  if (raw.includes('MINI-ITX') || raw.includes('ITX')) return 'Mini-ITX';
  if (raw.includes('MICRO-ATX') || raw.includes('M-ATX') || raw.includes('MATX')) return 'Micro-ATX';
  if (raw.includes('E-ATX') || raw.includes('EATX')) return 'E-ATX';
  if (raw.includes('ATX')) return 'ATX';
  return 'Standard';
}

export function isProductVisibleInMode(product, { isReferenceView = false, inventoryMode = 'active', showSoldOut = false } = {}) {
  if (!product) return false;
  if (!isReferenceView && inventoryMode === 'active' && !showSoldOut && product.stock_status === 'Sold Out') {
    return false;
  }
  return true;
}

export function getBrandsForCategory(products = [], category, filterOpts = {}) {
  const active = normalizeText(category);
  const brands = (Array.isArray(products) ? products : [])
    .filter((product) => {
      if (normalizeText(product?.category) !== active || !product?.brand) return false;
      return isProductVisibleInMode(product, filterOpts);
    })
    .map((product) => product.brand);

  return ['All', ...new Set(brands)];
}

export function getFormFactorsForCategory(products = [], category, filterOpts = {}) {
  const active = normalizeText(category);
  const factors = (Array.isArray(products) ? products : [])
    .filter((product) => {
      if (normalizeText(product?.category) !== active) return false;
      return isProductVisibleInMode(product, filterOpts);
    })
    .map((product) => detectPartFormFactor(product))
    .filter((ff) => ff !== 'Standard');

  return ['All', ...new Set(factors)];
}

export function getCategoryCounts(products = [], filterOpts = {}) {
  const list = Array.isArray(products) ? products : [];
  return CATEGORIES.reduce((acc, category) => {
    acc[category] = list.filter((product) => {
      if (normalizeText(product?.category) !== normalizeText(category)) return false;
      return isProductVisibleInMode(product, filterOpts);
    }).length;
    return acc;
  }, {});
}

export function filterAndSortCatalogProducts(
  products = [],
  {
    category = 'Processors',
    searchQuery = '',
    brand = 'All',
    formFactor = 'All',
    minPrice = '',
    maxPrice = '',
    sortBy = 'price-asc',
    isReferenceView = false,
    inventoryMode = 'active',
    showSoldOut = false,
  } = {}
) {
  const active = normalizeText(category);
  const query = normalizeText(searchQuery);
  const minP = minPrice !== '' && minPrice !== null ? Number(minPrice) : null;
  const maxP = maxPrice !== '' && maxPrice !== null ? Number(maxPrice) : null;

  const filtered = (Array.isArray(products) ? products : []).filter((product) => {
    if (normalizeText(product?.category) !== active) return false;
    if (!isProductVisibleInMode(product, { isReferenceView, inventoryMode, showSoldOut })) {
      return false;
    }

    const searchableText = [
      product?.name,
      product?.brand,
      product?.sku_code,
      product?.socket,
      product?.chipset,
      product?.memory_type,
      product?.capacity,
      product?.interface_type,
      product?.form_factor,
      product?.psu_tier,
      product?.specs,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesSearch = query === '' || searchableText.includes(query);
    const matchesBrand = brand === 'All' || product?.brand === brand;
    const matchesFormFactor =
      formFactor === 'All' || detectPartFormFactor(product) === formFactor;

    const itemPrice = Number(product?.price || 0);
    const matchesMinPrice = minP === null || itemPrice >= minP;
    const matchesMaxPrice = maxP === null || itemPrice <= maxP;

    return (
      matchesSearch &&
      matchesBrand &&
      matchesFormFactor &&
      matchesMinPrice &&
      matchesMaxPrice
    );
  });

  return filtered.sort((a, b) => {
    const priceA = Number(a?.price || 0);
    const priceB = Number(b?.price || 0);
    if (sortBy === 'price-asc') return priceA - priceB;
    if (sortBy === 'price-desc') return priceB - priceA;
    if (sortBy === 'rating') {
      return Number(b?.hardware_score || 0) - Number(a?.hardware_score || 0);
    }
    return 0;
  });
}