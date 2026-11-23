const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function hasCustomPartSpecs(form = {}) {
  return Boolean(
    String(form.socket || '').trim() ||
      String(form.memory_type || '').trim() ||
      String(form.form_factor || '').trim() ||
      Number(form.wattage || 0) > 0 ||
      String(form.specs || '').trim()
  );
}

export function createCustomOwnedPart(form = {}, now = Date.now()) {
  const trimmedName = String(form.name || '').trim();
  if (!trimmedName) return null;

  const hasSpecs = hasCustomPartSpecs(form);

  return {
    id: `custom-${now}`,
    name: trimmedName,
    brand: String(form.brand || '').trim() || 'Custom',
    category: form.category || 'Processors',
    price: Number(form.price) || 0,
    socket: String(form.socket || '').trim() || null,
    memory_type: String(form.memory_type || '').trim() || null,
    form_factor: String(form.form_factor || '').trim() || null,
    wattage: Number(form.wattage) || 0,
    specs: String(form.specs || '').trim(),
    specs_url: String(form.specs_url || '').trim() || null,
    stock_status: 'Owned (Custom)',
    source_type: 'reference',
    isCustomInput: true,
    unverified: !hasSpecs,
  };
}

export function isCustomPartItem(part) {
  return Boolean(part && (part.isCustomInput || part.unverified));
}

export function getCustomBuildSummary(build = {}) {
  const entries = Object.entries(build || {}).filter(([, part]) => isCustomPartItem(part));
  return {
    hasCustomPart: entries.length > 0,
    customCategories: entries.map(([cat]) => cat),
    customCount: entries.length,
    customNames: entries.map(([, part]) => part.name).filter(Boolean),
  };
}

export function buildLearnMoreUrl(item) {
  if (!item) return null;
  if (item.specs_url && /^https?:\/\//i.test(item.specs_url)) {
    return item.specs_url;
  }
  const query = encodeURIComponent(`${item.name || ''} ${item.category || ''} specifications`);
  return `https://www.google.com/search?q=${query}`;
}

export function getItemDisplayStatus(
  product,
  { inventoryMode = 'active', isReferenceView = false } = {}
) {
  if (!product) return 'unknown';
  if (isCustomPartItem(product)) return 'unverified';
  if (isReferenceView || product.source_type === 'reference') return 'reference';
  if (inventoryMode === 'preorder') return 'Pre-Order';
  return product.stock_status || 'In Stock';
}

export function isSameCategory(a, b) {
  return normalizeText(a) === normalizeText(b);
}