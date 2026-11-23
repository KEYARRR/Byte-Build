const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function buildAdminInsertPayload(form = {}, targetType = 'catalog', tableName = '') {
  const isReference = targetType === 'reference' || tableName === 'bytebuild_reference_parts';
  const isPreorderTable = tableName === 'bytebuild_preorder_inventory';

  const payload = {
    name: String(form.name || '').trim(),
    brand: String(form.brand || '').trim() || 'OEM',
    category: form.category || 'Processors',
    socket: String(form.socket || '').trim() || null,
    memory_type: String(form.memory_type || '').trim() || null,
    form_factor: String(form.form_factor || '').trim() || null,
    psu_tier: String(form.psu_tier || '').trim() || null,
    hardware_score: Number(form.hardware_score) || 75,
    specs: String(form.specs || '').trim() || 'Standard specification',
  };

  if (isReference) {
    payload.source_type = 'reference';
  } else {
    payload.price = Number(form.price) || 0;
    payload.stock_status = isPreorderTable ? 'Pre-Order' : form.stock_status || 'In Stock';
  }

  return payload;
}

export function buildAdminUpdatePayload(item = {}, isReferenceTable = false) {
  const updates = {
    name: String(item.name || '').trim(),
    brand: String(item.brand || '').trim() || 'OEM',
    category: item.category || 'Processors',
    socket: item.socket ? String(item.socket).trim() : null,
    memory_type: item.memory_type ? String(item.memory_type).trim() : null,
    form_factor: item.form_factor ? String(item.form_factor).trim() : null,
    psu_tier: item.psu_tier ? String(item.psu_tier).trim() : null,
    hardware_score: Number(item.hardware_score) || 75,
    specs: String(item.specs || ''),
  };

  if (!isReferenceTable) {
    updates.price = Number(item.price) || 0;
    updates.stock_status = item.stock_status || 'In Stock';
  }

  return updates;
}

export function filterAdminRecords(
  items = [],
  { categoryFilter = 'All', searchQuery = '' } = {}
) {
  const q = normalizeText(searchQuery);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const matchesCat =
      categoryFilter === 'All' ||
      normalizeText(item?.category) === normalizeText(categoryFilter);
    const matchesSearch =
      q === '' ||
      normalizeText(item?.name).includes(q) ||
      normalizeText(item?.brand).includes(q) ||
      normalizeText(item?.socket).includes(q) ||
      normalizeText(item?.psu_tier).includes(q);
    return matchesCat && matchesSearch;
  });
}

export function normalizeDssRules(rawRules = {}, defaults = {}) {
  const merged = { ...defaults, ...(rawRules && typeof rawRules === 'object' ? rawRules : {}) };

  return {
    psuBufferWatts: Math.max(0, Number(merged.psuBufferWatts ?? 120)),
    minRecommendedRamGB: Math.max(4, Number(merged.minRecommendedRamGB ?? 16)),
    minStorageCapacityGB: Math.max(120, Number(merged.minStorageCapacityGB ?? 500)),
    maxAllowedTierGap: Math.min(4, Math.max(1, Number(merged.maxAllowedTierGap ?? 2))),
    gamingGpuWeight: Number(merged.gamingGpuWeight ?? 36),
    gamingCpuWeight: Number(merged.gamingCpuWeight ?? 21),
    creatorGpuWeight: Number(merged.creatorGpuWeight ?? 29),
    creatorCpuWeight: Number(merged.creatorCpuWeight ?? 27),
  };
}