export function computeTargetDimensions(width, height, maxSide = 2000) {
  const w = Math.max(1, Number(width || 1));
  const h = Math.max(1, Number(height || 1));
  const longest = Math.max(w, h);
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

export function pixelsToGrayscale(rgba) {
  const arr = rgba instanceof Uint8ClampedArray || Array.isArray(rgba) ? rgba : [];
  const gray = new Uint8ClampedArray(Math.floor(arr.length / 4));
  for (let i = 0, g = 0; i + 3 < arr.length; i += 4, g += 1) {
    gray[g] = Math.round(0.299 * arr[i] + 0.587 * arr[i + 1] + 0.114 * arr[i + 2]);
  }
  return gray;
}

export function stretchContrast(gray) {
  if (!gray || gray.length === 0) return new Uint8ClampedArray(0);
  let minVal = 255;
  let maxVal = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const out = new Uint8ClampedArray(gray.length);
  const span = maxVal - minVal;
  if (span <= 0) {
    out.set(gray);
    return out;
  }
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = Math.min(255, Math.max(0, Math.round(((gray[i] - minVal) * 255) / span)));
  }
  return out;
}

export function otsuThreshold(gray) {
  if (!gray || gray.length === 0) return 128;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) {
    hist[gray[i]] += 1;
  }
  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * hist[t];

  let sumBg = 0;
  let weightBg = 0;
  let maxVar = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const betweenVar = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = t;
    }
  }
  return threshold;
}

export function applyThreshold(gray, threshold = null) {
  if (!gray || gray.length === 0) return new Uint8ClampedArray(0);
  const t = threshold === null || threshold === undefined ? otsuThreshold(gray) : threshold;
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = gray[i] >= t ? 255 : 0;
  }
  return out;
}

export function sharpenGrayscale(gray, width, height, strength = 0.5) {
  if (!gray || gray.length === 0 || width < 3 || height < 3) {
    return gray ? new Uint8ClampedArray(gray) : new Uint8ClampedArray(0);
  }
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        out[idx] = gray[idx];
        continue;
      }
      const center = gray[idx];
      const neighbors =
        gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width];
      const laplacian = 4 * center - neighbors;
      out[idx] = Math.min(255, Math.max(0, Math.round(center + strength * laplacian)));
    }
  }
  return out;
}

export function grayToRgba(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    const v = gray[i];
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

export async function prepareOcrImagePasses(file, maxSide = 2000) {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const gray = pixelsToGrayscale(imgData.data);
    const stretched = stretchContrast(gray);
    const sharpened = sharpenGrayscale(stretched, width, height, 0.4);
    const thresholded = applyThreshold(sharpened);

    const enhancedCanvas = document.createElement('canvas');
    enhancedCanvas.width = width;
    enhancedCanvas.height = height;
    enhancedCanvas.getContext('2d').putImageData(new ImageData(grayToRgba(sharpened), width, height), 0, 0);

    const thresholdCanvas = document.createElement('canvas');
    thresholdCanvas.width = width;
    thresholdCanvas.height = height;
    thresholdCanvas.getContext('2d').putImageData(new ImageData(grayToRgba(thresholded), width, height), 0, 0);

    return {
      enhancedUrl: enhancedCanvas.toDataURL('image/png'),
      thresholdUrl: thresholdCanvas.toDataURL('image/png'),
      width,
      height,
    };
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}