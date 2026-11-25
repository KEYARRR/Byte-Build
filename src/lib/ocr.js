import { CATEGORIES } from './config.js';

const norm = (v) => String(v || '').trim().toLowerCase();

export function levenshteinDistance(a = '', b = '') {
  const s = String(a).toUpperCase();
  const t = String(b).toUpperCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function fixAlphanumericToken(token) {
  // Only alter tokens that already contain digits (leaves words like "COOLER MASTER" untouched)
  if (!/\d/.test(token)) return token;
  let out = token;
  out = out.replace(/O/g, '0').replace(/o/g, '0');
  out = out.replace(/(?<=\d)[lI]|[lI](?=\d)/g, '1');
  out = out.replace(/S(?=\d)|(?<=\d)S/g, '5');
  out = out.replace(/B(?=\d)|(?<=\d)B/g, '8');
  out = out.replace(/([A-Za-z]{2,})(\d{3,})/g, '$1 $2');
  return out;
}

export function cleanOcrText(rawText = '') {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => {
      let s = line.trim();
      if (!s) return '';
      // Strip numbered list prefixes ("1. ", "2) "), bullets, prices, and quantities
      s = s.replace(/^\d+[.)]\s+/, '');
      s = s.replace(/^[\s•\-*▪▸►·]+/, '');
      s = s.replace(/(?:PHP|₱|P)\s*[\d,]+(?:\.\d{1,2})?/gi, ' ');
      s = s.replace(/\b\d+\s*[xX]\b/g, ' ');

      const tokens = s.split(/\s+/).filter(Boolean).map(fixAlphanumericToken);
      return tokens.join(' ').trim();
    })
    .filter(Boolean)
    .join('\n');
}

function extractModelTokens(text = '') {
  const upper = String(text || '').toUpperCase();
  const matches = upper.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || [];
  return matches.filter((tok) => /\d/.test(tok) && tok.length >= 3);
}

function extractAlphaTokens(text = '') {
  const upper = String(text || '').toUpperCase();
  const matches = upper.match(/[A-Z]{2,}(?:-[A-Z]{2,})*/g) || [];
  return matches.filter((tok) => !['GB', 'TB', 'MHZ', 'DDR', 'WIFI', 'DUAL', 'PRO'].includes(tok));
}

function scoreCatalogMatch(line, item) {
  const cleanedLine = cleanOcrText(line).toUpperCase();
  if (!cleanedLine) return { score: 0, reason: 'Empty line' };

  const itemName = String(item.name || '').toUpperCase();
  const itemSpecs = String(item.specs || '').toUpperCase();
  const itemBrand = String(item.brand || '').toUpperCase();
  const combined = `${itemName} ${itemSpecs}`;

  const lineModels = extractModelTokens(cleanedLine);
  const itemModels = extractModelTokens(combined);

  let modelScore = 0;
  let exactModelHits = 0;
  let fuzzyModelHits = 0;

  for (const lMod of lineModels) {
    const compactL = lMod.replace(/[^A-Z0-9]/g, '');
    if (itemModels.includes(lMod) || combined.includes(lMod)) {
      modelScore += 0.78;
      exactModelHits += 1;
      continue;
    }
    if (compactL.length >= 4) {
      const matchedFuzzy = itemModels.some(
        (iMod) =>
          Math.abs(iMod.length - lMod.length) <= 1 &&
          levenshteinDistance(lMod, iMod) <= 1
      );
      if (matchedFuzzy) {
        modelScore += 0.75;
        fuzzyModelHits += 1;
      }
    }
  }

  // Secondary/tie-breaker alignment on brand & non-numeric model series tokens (e.g., RYZEN, PRO-VDH, RTX)
  let contextBonus = 0;
  if (itemBrand && cleanedLine.includes(itemBrand)) {
    contextBonus += 0.08;
  }
  const lineAlpha = extractAlphaTokens(cleanedLine);
  const itemAlpha = new Set(extractAlphaTokens(combined));
  let alphaHits = 0;
  for (const tok of lineAlpha) {
    if (itemAlpha.has(tok) || combined.includes(tok)) {
      alphaHits += 1;
    }
  }
  if (alphaHits > 0) {
    contextBonus += Math.min(0.14, alphaHits * 0.07);
  }

  const totalScore = Math.min(1, Number((modelScore + contextBonus).toFixed(3)));
  let reason = 'No model match';
  if (exactModelHits > 0) reason = `Exact model match (${lineModels.slice(0, 2).join(', ')})`;
  else if (fuzzyModelHits > 0) reason = 'Fuzzy model match within edit distance 1';
  else if (contextBonus > 0) reason = 'Brand/series hint only';

  return { score: totalScore, reason };
}

export function classifyMatchStatus(confidence, matchedPart) {
  if (!matchedPart) return 'Unavailable';
  if (confidence >= 0.75) return 'Matched';
  if (confidence >= 0.45) return 'Needs confirmation';
  return 'Unavailable';
}

export function matchOcrTextToCatalog(rawText, activeProducts = [], preorderProducts = []) {
  const cleanedBlock = cleanOcrText(rawText);
  const lines = cleanedBlock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2);

  const activeList = Array.isArray(activeProducts) ? activeProducts : [];
  const preorderList = Array.isArray(preorderProducts) ? preorderProducts : [];
  const pool = [...activeList, ...preorderList];

  return lines.map((rawLine) => {
    let bestItem = null;
    let bestScore = 0;
    let bestReason = 'No catalog match';
    let bestSource = 'active';

    for (const item of pool) {
      const { score, reason } = scoreCatalogMatch(rawLine, item);
      if (score <= 0) continue;
      const isInStock = norm(item.stock_status) === 'in stock';
      const betterScore = score > bestScore + 0.005;
      const tiePreferInStock =
        Math.abs(score - bestScore) <= 0.005 &&
        isInStock &&
        norm(bestItem?.stock_status) !== 'in stock';

      if (betterScore || tiePreferInStock) {
        bestScore = Math.min(1, Number(score.toFixed(2)));
        bestItem = item;
        bestReason = reason;
        bestSource = preorderList.some((p) => p === item || (p.id && p.id === item.id))
          ? 'preorder'
          : 'active';
      }
    }

    const confidenceTier = classifyMatchStatus(bestScore, bestItem);
    const hasMatch = Boolean(bestItem && bestScore >= 0.45);
    const stockStatus = hasMatch
      ? bestItem.stock_status || (bestSource === 'preorder' ? 'Pre-Order' : 'In Stock')
      : 'Unavailable';

    return {
      rawLine,
      matchedPart: hasMatch ? bestItem : null,
      confidence: bestScore,
      matchConfidence: confidenceTier,
      needsConfirmation: confidenceTier === 'Needs confirmation',
      reason: bestReason,
      status: stockStatus,
      stockStatus,
      confirmed: confidenceTier === 'Matched' && norm(stockStatus) === 'in stock',
    };
  });
}

export function applyInStockOcrMatches(currentBuild = {}, scanResults = []) {
  const nextBuild = { ...currentBuild };
  let loadedCount = 0;

  for (const entry of Array.isArray(scanResults) ? scanResults : []) {
    if (entry?.confirmed === false || entry?.needsConfirmation === true) continue;
    if (entry?.matchConfidence === 'Needs confirmation' || entry?.matchConfidence === 'Unavailable') {
      continue;
    }

    const part = entry?.matchedPart || entry?.part;
    if (!part) continue;

    const effectiveStock = norm(part.stock_status ?? entry?.stockStatus ?? entry?.status ?? '');
    if (effectiveStock !== 'in stock') continue;

    const matchedCat = CATEGORIES.find((cat) => norm(cat) === norm(part.category));
    if (matchedCat) {
      nextBuild[matchedCat] = part;
      loadedCount += 1;
    }
  }

  return {
    build: nextBuild,
    nextBuild,
    appliedCount: loadedCount,
    loadedCount,
  };
}