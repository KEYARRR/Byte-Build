import { CATEGORIES } from './config.js';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const OCR_STOP_WORDS = new Set([
  'cpu',
  'gpu',
  'ram',
  'ssd',
  'hdd',
  'psu',
  'case',
  'mobo',
  'motherboard',
  'processor',
  'memory',
  'storage',
  'cooler',
  'power',
  'supply',
  'video',
  'card',
  'pcs',
  'php',
  'with',
  'for',
  'the',
  'and',
  'specs',
  'build',
]);

export function matchOcrTextToCatalog(rawText = '', activeProducts = [], preorderProducts = []) {
  const shopPool = [
    ...(Array.isArray(activeProducts)
      ? activeProducts.map((p) => ({ ...p, _source: 'active' }))
      : []),
    ...(Array.isArray(preorderProducts)
      ? preorderProducts.map((p) => ({ ...p, _source: 'preorder' }))
      : []),
  ];

  const lines = String(rawText || '')
    .split('\n')
    .map((line) => line.replace(/^[\s\-•*0-9.)]+/, '').trim())
    .filter((line) => line.length >= 4);

  return lines.map((line) => {
    const tokens = line
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length >= 2 && !OCR_STOP_WORDS.has(tok));

    if (tokens.length === 0) {
      return { rawLine: line, status: 'Unavailable', matchedPart: null };
    }

    const scored = shopPool
      .map((item) => {
        const hay = `${item.name || ''} ${item.brand || ''} ${item.sku_code || ''} ${
          item.specs || ''
        }`.toLowerCase();
        const hits = tokens.reduce((count, tok) => (hay.includes(tok) ? count + 1 : count), 0);
        const exactModelBonus = tokens.some((tok) => /\d{3,4}/.test(tok) && hay.includes(tok))
          ? 1
          : 0;
        return { item, hits, score: hits + exactModelBonus };
      })
      .filter((entry) => entry.hits >= Math.min(2, tokens.length))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aInStock =
          a.item._source === 'active' && a.item.stock_status !== 'Sold Out' ? 1 : 0;
        const bInStock =
          b.item._source === 'active' && b.item.stock_status !== 'Sold Out' ? 1 : 0;
        return bInStock - aInStock;
      });

    const best = scored[0]?.item || null;
    if (!best) {
      return { rawLine: line, status: 'Unavailable', matchedPart: null };
    }

    const status =
      best._source === 'preorder' || best.stock_status === 'Pre-Order'
        ? 'Pre-Order'
        : best.stock_status === 'Sold Out'
        ? 'Sold Out'
        : 'In Stock';

   const cleanPart = Object.fromEntries(
  Object.entries(best).filter(([key]) => key !== '_source')
);
return { rawLine: line, status, matchedPart: cleanPart };
  });
}

export function applyInStockOcrMatches(currentBuild = {}, ocrScanResults = []) {
  const next = { ...currentBuild };
  const inStockMatches = (Array.isArray(ocrScanResults) ? ocrScanResults : [])
    .filter((entry) => entry.status === 'In Stock' && entry.matchedPart)
    .map((entry) => entry.matchedPart);

  let loadedCount = 0;

  for (const part of inStockMatches) {
    const matchedCat = CATEGORIES.find(
      (cat) => normalizeText(cat) === normalizeText(part.category)
    );
    if (matchedCat) {
      next[matchedCat] = { ...part, stock_status: 'In Stock' };
      loadedCount += 1;
    }
  }

  return {
    build: next,
    loadedCount,
  };
}