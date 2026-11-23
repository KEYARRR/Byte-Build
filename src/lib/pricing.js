import { parseRam } from './ram.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export function isPrebundledKit(item) {
  if (!item) return false;
  if (typeof item.is_kit === 'boolean') return item.is_kit;
  if (typeof item.prebundled_kit === 'boolean') return item.prebundled_kit;

  const text = `${item.name || ''} ${item.capacity || ''} ${item.specs || ''}`.toUpperCase();
  if (
    text.includes('KIT') ||
    text.includes('DUAL CHANNEL') ||
    text.includes('QUAD CHANNEL') ||
    /(\d+)\s*(?:X|×)\s*(\d+(?:\.\d+)?)\s*GB/.test(text)
  ) {
    return true;
  }

  return false;
}

export function getEffectiveItemPrice(category, item, ramStickCount = 2) {
  if (!item) return 0;
  const basePrice = Number(item.price || 0);
  if (basePrice <= 0) return 0;

  if (normalizeText(category) === 'memory') {
    const parsed = parseRam(item, ramStickCount);
    if (parsed.isKit) {
      return basePrice;
    }
    const sticks = Math.max(1, Number(ramStickCount) || 1);
    return basePrice * sticks;
  }

  return basePrice;
}

export function calculateBuildTotal(build = {}, categories = [], ramStickCount = 2) {
  const categoryList = Array.isArray(categories) && categories.length > 0
    ? categories
    : Object.keys(build || {});

  return categoryList.reduce((sum, category) => {
    const item = build?.[category];
    if (!item) return sum;
    return sum + getEffectiveItemPrice(category, item, ramStickCount);
  }, 0);
}