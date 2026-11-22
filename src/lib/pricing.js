export function isPrebundledKit(item) {
  if (!item) return false;
  const text = `${item.name || ''} ${item.specs || ''}`.toLowerCase();
  return (
    /(?:^|[^a-z0-9])[24]\s*x\s*\d+/.test(text) ||
    /\b(dual|quad)[\s-]?channel\b/.test(text) ||
    /\bkit\b/.test(text)
  );
}

export function getEffectiveItemPrice(category, item, ramStickCount = 1) {
  if (!item) return 0;
  const unitPrice = Number(item.price) || 0;
  if (unitPrice <= 0) return 0;

  if (category === 'Memory') {
    if (isPrebundledKit(item)) {
      return unitPrice;
    }
    const sticks = Math.max(1, Number(ramStickCount) || 1);
    return unitPrice * sticks;
  }

  return unitPrice;
}

export function calculateBuildTotal(buildMap, categories, ramStickCount = 1) {
  if (!buildMap || !Array.isArray(categories)) return 0;
  return categories.reduce(
    (sum, cat) => sum + getEffectiveItemPrice(cat, buildMap[cat], ramStickCount),
    0
  );
}