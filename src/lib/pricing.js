export function isPrebundledKit(item) {
  if (!item) return false;
  const text = `${item.name || ''} ${item.specs || ''}`.toLowerCase();
  return /\b(2x\d+|4x\d+|kit\s*of\s*[24]|dual[\s-]?channel\s*kit|quad[\s-]?channel\s*kit)\b/i.test(
    text
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