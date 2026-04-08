import type { RGB } from '../types';

export function computeBgMask(
  srcData: ImageData,
  targetW: number,
  targetH: number,
  tolerance: number,
  hasAlpha: boolean,
  fileIsPng: boolean
): Uint8Array {
  const sw = srcData.width, sh = srcData.height;
  const pixels = srcData.data;
  const count = targetW * targetH;
  const mask = new Uint8Array(count);

  if (hasAlpha) {
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const sx = Math.round((x / (targetW - 1)) * (sw - 1));
        const sy = Math.round((y / (targetH - 1)) * (sh - 1));
        const si = (sy * sw + sx) * 4;
        if (pixels[si + 3] < 128) mask[y * targetW + x] = 1;
      }
    }
  } else {
    const edgeSamples: RGB[] = [];
    const step = Math.max(1, Math.floor(Math.max(sw, sh) / 200));
    for (let x = 0; x < sw; x += step) {
      for (const y of [0, sh - 1]) {
        const i = (y * sw + x) * 4;
        edgeSamples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }
    }
    for (let y = 0; y < sh; y += step) {
      for (const x of [0, sw - 1]) {
        const i = (y * sw + x) * 4;
        edgeSamples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }
    }

    const clusters: { r: number; g: number; b: number; count: number }[] = [];
    const clusterTol = 50 * 50 * 3;
    for (const [r, g, b] of edgeSamples) {
      let found = false;
      for (const cl of clusters) {
        const dr = r - cl.r / cl.count, dg = g - cl.g / cl.count, db = b - cl.b / cl.count;
        if (dr * dr + dg * dg + db * db < clusterTol) {
          cl.r += r; cl.g += g; cl.b += b; cl.count++;
          found = true; break;
        }
      }
      if (!found) clusters.push({ r, g, b, count: 1 });
    }

    clusters.sort((a, b) => b.count - a.count);
    const best = clusters[0];
    const bgR = best.r / best.count, bgG = best.g / best.count, bgB = best.b / best.count;

    const tol2 = tolerance * tolerance * 3;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const sx = Math.round((x / (targetW - 1)) * (sw - 1));
        const sy = Math.round((y / (targetH - 1)) * (sh - 1));
        const si = (sy * sw + sx) * 4;
        const dr = pixels[si] - bgR, dg = pixels[si + 1] - bgG, db = pixels[si + 2] - bgB;
        if (dr * dr + dg * dg + db * db <= tol2) mask[y * targetW + x] = 1;
      }
    }

    const visited = new Uint8Array(count);
    const queue: number[] = [];
    for (let x = 0; x < targetW; x++) {
      if (mask[x]) queue.push(x);
      const bottom = (targetH - 1) * targetW + x;
      if (mask[bottom]) queue.push(bottom);
    }
    for (let y = 0; y < targetH; y++) {
      const left = y * targetW;
      if (mask[left]) queue.push(left);
      const right = y * targetW + targetW - 1;
      if (mask[right]) queue.push(right);
    }

    const floodMask = new Uint8Array(count);
    for (const idx of queue) { visited[idx] = 1; floodMask[idx] = 1; }
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % targetW, y = (idx - x) / targetW;
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < targetW - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - targetW);
      if (y < targetH - 1) neighbors.push(idx + targetW);
      for (const ni of neighbors) {
        if (!visited[ni] && mask[ni]) { visited[ni] = 1; floodMask[ni] = 1; queue.push(ni); }
      }
    }
    mask.set(floodMask);
  }

  return mask;
}

export function quantizeColors(
  srcData: ImageData,
  targetW: number,
  targetH: number,
  numColors: number,
  bgMask: Uint8Array | null,
  forcePalette: RGB[] | null
): { colorIndex: Uint8Array; palette: RGB[]; BG_INDEX: number } {
  const sw = srcData.width, sh = srcData.height;
  const pixels = srcData.data;
  const count = targetW * targetH;
  const colors = new Uint8Array(count * 3);
  const scaleX = sw / targetW, scaleY = sh / targetH;
  const useMajorityVoting = !!(forcePalette && forcePalette.length > 0 && scaleX >= 2);
  const BG_INDEX = 255;
  // Allocate once, reuse per cell (avoids 1M+ GC-heavy allocations in the inner loop)
  const mvVotes = forcePalette ? new Uint32Array(forcePalette.length) : null;

  for (let y = 0; y < targetH; y++) {
    const sy0 = Math.floor(y * scaleY), sy1 = Math.min(sh - 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.floor(x * scaleX), sx1 = Math.min(sw - 1, Math.floor((x + 1) * scaleX));

      if (useMajorityVoting && forcePalette && mvVotes) {
        mvVotes.fill(0);
        const votes = mvVotes;
        let totalAlpha = 0;
        for (let sy = sy0; sy <= sy1; sy++) {
          for (let sx = sx0; sx <= sx1; sx++) {
            const si = (sy * sw + sx) * 4;
            const a = pixels[si + 3];
            totalAlpha += a;
            if (a < 128) continue;
            const pr = pixels[si], pg = pixels[si + 1], pb = pixels[si + 2];
            let bestD = Infinity, bestP = 0;
            for (let p = 0; p < forcePalette.length; p++) {
              const dr = pr - forcePalette[p][0], dg = pg - forcePalette[p][1], db = pb - forcePalette[p][2];
              const d = dr * dr + dg * dg + db * db;
              if (d < bestD) { bestD = d; bestP = p; }
            }
            // All pixels (including anti-aliased blends) vote for their nearest palette color.
            // Blended boundary pixels are a minority in any cell, so pure pixels still dominate.
            votes[bestP]++;
          }
        }
        let bestVotes = 0, bestColor = 0;
        for (let p = 0; p < votes.length; p++) {
          if (votes[p] > bestVotes) { bestVotes = votes[p]; bestColor = p; }
        }
        const di = (y * targetW + x) * 3;
        const blockSize = (sy1 - sy0 + 1) * (sx1 - sx0 + 1);
        if (totalAlpha < blockSize * 128) {
          colors[di] = 0; colors[di + 1] = 0; colors[di + 2] = 0;
        } else {
          colors[di] = forcePalette[bestColor][0];
          colors[di + 1] = forcePalette[bestColor][1];
          colors[di + 2] = forcePalette[bestColor][2];
        }
      } else {
        let rSum = 0, gSum = 0, bSum = 0, n = 0;
        for (let sy = sy0; sy <= sy1; sy++) {
          for (let sx = sx0; sx <= sx1; sx++) {
            const si = (sy * sw + sx) * 4;
            rSum += pixels[si]; gSum += pixels[si + 1]; bSum += pixels[si + 2]; n++;
          }
        }
        const di = (y * targetW + x) * 3;
        colors[di] = Math.round(rSum / n);
        colors[di + 1] = Math.round(gSum / n);
        colors[di + 2] = Math.round(bSum / n);
      }
    }
  }

  if (forcePalette && forcePalette.length > 0) {
    const colorIndex = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (bgMask && bgMask[i]) { colorIndex[i] = BG_INDEX; continue; }
      const pr = colors[i * 3], pg = colors[i * 3 + 1], pb = colors[i * 3 + 2];
      let bestD = Infinity, bestIdx = 0;
      for (let p = 0; p < forcePalette.length; p++) {
        const dr = pr - forcePalette[p][0], dg = pg - forcePalette[p][1], db = pb - forcePalette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestIdx = p; }
      }
      colorIndex[i] = bestIdx;
    }
    return { colorIndex, palette: forcePalette, BG_INDEX };
  }

  const fgIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!bgMask || !bgMask[i]) fgIndices.push(i);
  }

  if (fgIndices.length === 0) {
    return { colorIndex: new Uint8Array(count).fill(BG_INDEX), palette: [], BG_INDEX };
  }

  const overK = Math.min(numColors * 3, fgIndices.length);
  const centroids = new Float64Array(overK * 3);

  const seed0 = fgIndices[Math.floor(Math.random() * fgIndices.length)];
  centroids[0] = colors[seed0 * 3]; centroids[1] = colors[seed0 * 3 + 1]; centroids[2] = colors[seed0 * 3 + 2];
  for (let c = 1; c < overK; c++) {
    let totalDist = 0;
    const dists = new Float64Array(fgIndices.length);
    for (let j = 0; j < fgIndices.length; j++) {
      const idx = fgIndices[j];
      const pr = colors[idx * 3], pg = colors[idx * 3 + 1], pb = colors[idx * 3 + 2];
      let minD = Infinity;
      for (let p = 0; p < c; p++) {
        const dr = pr - centroids[p * 3], dg = pg - centroids[p * 3 + 1], db = pb - centroids[p * 3 + 2];
        minD = Math.min(minD, dr * dr + dg * dg + db * db);
      }
      dists[j] = minD; totalDist += minD;
    }
    let r = Math.random() * totalDist, pick = 0;
    for (let j = 0; j < dists.length; j++) { r -= dists[j]; if (r <= 0) { pick = j; break; } }
    const pidx = fgIndices[pick];
    centroids[c * 3] = colors[pidx * 3]; centroids[c * 3 + 1] = colors[pidx * 3 + 1]; centroids[c * 3 + 2] = colors[pidx * 3 + 2];
  }

  const assignments = new Uint8Array(count);
  for (let iter = 0; iter < 15; iter++) {
    let changed = 0;
    for (const idx of fgIndices) {
      const pr = colors[idx * 3], pg = colors[idx * 3 + 1], pb = colors[idx * 3 + 2];
      let bestD = Infinity, bestC = 0;
      for (let c = 0; c < overK; c++) {
        const dr = pr - centroids[c * 3], dg = pg - centroids[c * 3 + 1], db = pb - centroids[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      if (assignments[idx] !== bestC) { assignments[idx] = bestC; changed++; }
    }
    const sums = new Float64Array(overK * 3);
    const cnts = new Uint32Array(overK);
    for (const idx of fgIndices) {
      const c = assignments[idx];
      sums[c * 3] += colors[idx * 3]; sums[c * 3 + 1] += colors[idx * 3 + 1]; sums[c * 3 + 2] += colors[idx * 3 + 2];
      cnts[c]++;
    }
    for (let c = 0; c < overK; c++) {
      if (cnts[c] > 0) {
        centroids[c * 3] = sums[c * 3] / cnts[c];
        centroids[c * 3 + 1] = sums[c * 3 + 1] / cnts[c];
        centroids[c * 3 + 2] = sums[c * 3 + 2] / cnts[c];
      }
    }
    if (changed < fgIndices.length * 0.002) break;
  }

  let clusters: { r: number; g: number; b: number; count: number; id: number }[] = [];
  {
    const cnts = new Uint32Array(overK);
    for (const idx of fgIndices) cnts[assignments[idx]]++;
    for (let c = 0; c < overK; c++) {
      if (cnts[c] > 0) clusters.push({ r: centroids[c * 3], g: centroids[c * 3 + 1], b: centroids[c * 3 + 2], count: cnts[c], id: c });
    }
  }

  while (clusters.length > numColors) {
    let minDist = Infinity, mi = 0, mj = 1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dr = clusters[i].r - clusters[j].r, dg = clusters[i].g - clusters[j].g, db = clusters[i].b - clusters[j].b;
        const d = dr * dr + dg * dg + db * db;
        if (d < minDist) { minDist = d; mi = i; mj = j; }
      }
    }
    const a = clusters[mi], b = clusters[mj];
    const total = a.count + b.count;
    a.r = (a.r * a.count + b.r * b.count) / total;
    a.g = (a.g * a.count + b.g * b.count) / total;
    a.b = (a.b * a.count + b.b * b.count) / total;
    a.count = total;
    clusters.splice(mj, 1);
  }

  const palette: RGB[] = clusters.map(c => [Math.round(c.r), Math.round(c.g), Math.round(c.b)]);

  // Snap-majority-vote final assignment: each source pixel votes for its nearest palette color.
  // This eliminates blended-average artifacts that the average-then-nearest approach creates
  // at anti-aliased boundaries or JPEG-compressed edges.
  const colorIndex = new Uint8Array(count);
  const snapVotes = new Uint32Array(palette.length);
  for (let y = 0; y < targetH; y++) {
    const sy0 = Math.floor(y * scaleY), sy1 = Math.min(sh - 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < targetW; x++) {
      const i = y * targetW + x;
      if (bgMask && bgMask[i]) { colorIndex[i] = BG_INDEX; continue; }
      const sx0 = Math.floor(x * scaleX), sx1 = Math.min(sw - 1, Math.floor((x + 1) * scaleX));
      snapVotes.fill(0);
      let totalV = 0;
      for (let sy = sy0; sy <= sy1; sy++) {
        for (let sx = sx0; sx <= sx1; sx++) {
          const si = (sy * sw + sx) * 4;
          if (pixels[si + 3] < 128) continue;
          const pr = pixels[si], pg = pixels[si + 1], pb = pixels[si + 2];
          let bestD = Infinity, bestP = 0;
          for (let p = 0; p < palette.length; p++) {
            const dr = pr - palette[p][0], dg = pg - palette[p][1], db = pb - palette[p][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; bestP = p; }
          }
          snapVotes[bestP]++;
          totalV++;
        }
      }
      if (totalV === 0) {
        // No opaque source pixels — fall back to averaged-cell nearest-color
        const pr = colors[i * 3], pg = colors[i * 3 + 1], pb = colors[i * 3 + 2];
        let bestD = Infinity, bestIdx = 0;
        for (let p = 0; p < palette.length; p++) {
          const dr = pr - palette[p][0], dg = pg - palette[p][1], db = pb - palette[p][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; bestIdx = p; }
        }
        colorIndex[i] = bestIdx;
      } else {
        let bestV = 0, bestC = 0;
        for (let p = 0; p < palette.length; p++) {
          if (snapVotes[p] > bestV) { bestV = snapVotes[p]; bestC = p; }
        }
        colorIndex[i] = bestC;
      }
    }
  }

  return { colorIndex, palette, BG_INDEX };
}

export function extractBoundaryContours(
  colorIndex: Uint8Array,
  w: number,
  h: number,
  BG_INDEX: number
): { segments: number[]; offX: Float32Array; offY: Float32Array } {
  const offX = new Float32Array(w * h);
  const offY = new Float32Array(w * h);
  const segMidpoints: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const c = colorIndex[idx];
      if (x < w - 1 && colorIndex[idx + 1] !== c) segMidpoints.push(x + 0.5, y);
      if (y < h - 1 && colorIndex[idx + w] !== c) segMidpoints.push(x, y + 0.5);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const c = colorIndex[idx];
      const l = x > 0 && colorIndex[idx - 1] !== c;
      const r = x < w - 1 && colorIndex[idx + 1] !== c;
      const u = y > 0 && colorIndex[idx - w] !== c;
      const d = y < h - 1 && colorIndex[idx + w] !== c;
      if (!l && !r && !u && !d) continue;

      let sumDx = 0, sumDy = 0, wt = 0;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const ni = ny * w + nx;
          const nc = colorIndex[ni];
          if (nx < w - 1 && colorIndex[ni + 1] !== nc) {
            const mx = nx + 0.5, my = ny;
            const ddx = mx - x, ddy = my - y;
            const dist2 = ddx * ddx + ddy * ddy;
            if (dist2 < 2.25 && dist2 > 0.001) {
              const iw = 1 / Math.sqrt(dist2);
              sumDx += ddx * iw; sumDy += ddy * iw; wt += iw;
            }
          }
          if (ny < h - 1 && colorIndex[ni + w] !== nc) {
            const mx = nx, my = ny + 0.5;
            const ddx = mx - x, ddy = my - y;
            const dist2 = ddx * ddx + ddy * ddy;
            if (dist2 < 2.25 && dist2 > 0.001) {
              const iw = 1 / Math.sqrt(dist2);
              sumDx += ddx * iw; sumDy += ddy * iw; wt += iw;
            }
          }
        }
      }
      if (wt > 0) {
        let dx = sumDx / wt, dy = sumDy / wt;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0.45) { dx *= 0.45 / mag; dy *= 0.45 / mag; }
        offX[idx] = dx; offY[idx] = dy;
      }
    }
  }

  return { segments: segMidpoints, offX, offY };
}

export function computeBoundaryDist(
  colorIndex: Uint8Array,
  w: number,
  h: number,
  maxDist: number,
  contours?: { segments: number[]; offX: Float32Array; offY: Float32Array }
): Float32Array {
  const dist = new Float32Array(w * h);
  dist.fill(maxDist + 1);

  if (contours && contours.segments.length > 0) {
    const segs = contours.segments;
    for (let si = 0; si < segs.length; si += 2) {
      const mx = segs[si], my = segs[si + 1];
      const x0 = Math.max(0, Math.floor(mx - 2)), x1 = Math.min(w - 1, Math.ceil(mx + 2));
      const y0 = Math.max(0, Math.floor(my - 2)), y1 = Math.min(h - 1, Math.ceil(my + 2));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - mx, dy = y - my;
          const d = Math.sqrt(dx * dx + dy * dy);
          const idx = y * w + x;
          dist[idx] = Math.min(dist[idx], d);
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = colorIndex[idx];
        if (c !== 255 && (x === 0 || x === w - 1 || y === 0 || y === h - 1))
          dist[idx] = Math.min(dist[idx], 0.5);
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = colorIndex[idx];
        let minSeed = maxDist + 1;
        if (x > 0 && colorIndex[idx - 1] !== c) minSeed = Math.min(minSeed, 0.5);
        if (x < w - 1 && colorIndex[idx + 1] !== c) minSeed = Math.min(minSeed, 0.5);
        if (y > 0 && colorIndex[idx - w] !== c) minSeed = Math.min(minSeed, 0.5);
        if (y < h - 1 && colorIndex[idx + w] !== c) minSeed = Math.min(minSeed, 0.5);
        if (x > 0 && y > 0 && colorIndex[(y - 1) * w + x - 1] !== c) minSeed = Math.min(minSeed, 0.707);
        if (x < w - 1 && y > 0 && colorIndex[(y - 1) * w + x + 1] !== c) minSeed = Math.min(minSeed, 0.707);
        if (x > 0 && y < h - 1 && colorIndex[(y + 1) * w + x - 1] !== c) minSeed = Math.min(minSeed, 0.707);
        if (x < w - 1 && y < h - 1 && colorIndex[(y + 1) * w + x + 1] !== c) minSeed = Math.min(minSeed, 0.707);
        if (c !== 255 && (x === 0 || x === w - 1 || y === 0 || y === h - 1)) minSeed = Math.min(minSeed, 0.5);
        dist[idx] = minSeed;
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (x > 0) dist[idx] = Math.min(dist[idx], dist[idx - 1] + 1);
      if (y > 0) dist[idx] = Math.min(dist[idx], dist[(y - 1) * w + x] + 1);
      if (x > 0 && y > 0) dist[idx] = Math.min(dist[idx], dist[(y - 1) * w + x - 1] + 1.414);
      if (x < w - 1 && y > 0) dist[idx] = Math.min(dist[idx], dist[(y - 1) * w + x + 1] + 1.414);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      if (x < w - 1) dist[idx] = Math.min(dist[idx], dist[idx + 1] + 1);
      if (y < h - 1) dist[idx] = Math.min(dist[idx], dist[(y + 1) * w + x] + 1);
      if (x < w - 1 && y < h - 1) dist[idx] = Math.min(dist[idx], dist[(y + 1) * w + x + 1] + 1.414);
      if (x > 0 && y < h - 1) dist[idx] = Math.min(dist[idx], dist[(y + 1) * w + x - 1] + 1.414);
    }
  }

  return dist;
}

export function cleanColorIndex(
  colorIndex: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  BG_INDEX: number
): void {
  if (minSize <= 0) return;
  const count = w * h;
  const labels = new Int32Array(count).fill(-1);
  const components: { color: number; pixels: number[]; minX: number; maxX: number; minY: number; maxY: number }[] = [];

  for (let i = 0; i < count; i++) {
    if (labels[i] >= 0) continue;
    const color = colorIndex[i];
    const comp = { color, pixels: [] as number[], minX: w, maxX: 0, minY: h, maxY: 0 };
    const queue = [i];
    labels[i] = components.length;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      comp.pixels.push(idx);
      const x = idx % w, y = (idx - x) / w;
      if (x < comp.minX) comp.minX = x; if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y; if (y > comp.maxY) comp.maxY = y;
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < w - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - w);
      if (y < h - 1) neighbors.push(idx + w);
      for (const ni of neighbors) {
        if (labels[ni] < 0 && colorIndex[ni] === color) { labels[ni] = components.length; queue.push(ni); }
      }
    }
    components.push(comp);
  }

  for (const comp of components) {
    if (comp.color === BG_INDEX) continue;
    if (comp.pixels.length >= minSize) continue;
    const spanX = comp.maxX - comp.minX + 1, spanY = comp.maxY - comp.minY + 1;
    const maxSpan = Math.max(spanX, spanY);
    const area = comp.pixels.length;
    const avgThickness = area / maxSpan;
    if (maxSpan >= minSize * 0.4 && avgThickness <= 3) continue;

    const votes = new Map<number, number>();
    for (const idx of comp.pixels) {
      const x = idx % w, y = (idx - x) / w;
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < w - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - w);
      if (y < h - 1) neighbors.push(idx + w);
      for (const ni of neighbors) {
        const nc = colorIndex[ni];
        if (nc !== comp.color) votes.set(nc, (votes.get(nc) || 0) + 1);
      }
    }
    if (votes.size === 0) continue;
    let bestColor = comp.color, bestVotes = 0;
    for (const [c, v] of votes) { if (v > bestVotes) { bestVotes = v; bestColor = c; } }
    for (const idx of comp.pixels) colorIndex[idx] = bestColor;
  }
}

export function erodeThinStrips(
  colorIndex: Uint8Array,
  w: number,
  h: number,
  BG_INDEX: number
): void {
  const votes = new Uint16Array(256);
  const touched: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    const next = new Uint8Array(colorIndex);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = colorIndex[idx];
        if (c === BG_INDEX) continue;
        const l = x > 0 && colorIndex[idx - 1] === c;
        const r = x < w - 1 && colorIndex[idx + 1] === c;
        const u = y > 0 && colorIndex[idx - w] === c;
        const d = y < h - 1 && colorIndex[idx + w] === c;
        const sameCount = (l ? 1 : 0) + (r ? 1 : 0) + (u ? 1 : 0) + (d ? 1 : 0);
        if (sameCount >= 2) continue;
        touched.length = 0;
        let bestC = c, bestV = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nc = colorIndex[ny * w + nx];
            if (nc !== c && nc !== BG_INDEX) {
              if (votes[nc] === 0) touched.push(nc);
              votes[nc]++;
              if (votes[nc] > bestV) { bestV = votes[nc]; bestC = nc; }
            }
          }
        }
        for (const nc of touched) votes[nc] = 0;
        if (bestC !== c) { next[idx] = bestC; changed = true; }
      }
    }
    if (!changed) break;
    for (let i = 0; i < w * h; i++) colorIndex[i] = next[i];
  }
}

export function blurDistanceField(
  dist: Float32Array,
  colorIndex: Uint8Array,
  w: number,
  h: number,
  sigma: number,
  BG_INDEX: number
): void {
  if (sigma <= 0.05) return;
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-0.5 * (i / sigma) * (i / sigma));
    kernel.push(v); ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (colorIndex[idx] === BG_INDEX) { temp[idx] = dist[idx]; continue; }
      let sum = 0, wt = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const ni = y * w + xx;
        if (colorIndex[ni] === BG_INDEX) continue;
        const kw = kernel[k + radius];
        sum += dist[ni] * kw; wt += kw;
      }
      temp[idx] = wt > 0 ? sum / wt : dist[idx];
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (colorIndex[idx] === BG_INDEX) { dist[idx] = temp[idx]; continue; }
      let sum = 0, wt = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const ni = yy * w + x;
        if (colorIndex[ni] === BG_INDEX) continue;
        const kw = kernel[k + radius];
        sum += temp[ni] * kw; wt += kw;
      }
      dist[idx] = wt > 0 ? sum / wt : temp[idx];
    }
  }
}

/**
 * Computes per-pixel feature width (in pixels) for adaptive chamfer.
 * For each connected component, finds the max inscribed distance (from the
 * already-computed boundary distance field) and returns 2 * that value for
 * every pixel in the component.
 */
export function computeFeatureWidth(
  colorIndex: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  BG_INDEX: number
): Float32Array {
  const n = w * h;
  const componentId = new Int32Array(n).fill(-1);
  const componentMaxDist: number[] = [];
  let nextId = 0;

  // Flood-fill to label connected components
  for (let i = 0; i < n; i++) {
    if (componentId[i] >= 0 || colorIndex[i] === BG_INDEX) continue;
    const color = colorIndex[i];
    const id = nextId++;
    let maxD = 0;
    const stack = [i];
    componentId[i] = id;
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (dist[p] > maxD) maxD = dist[p];
      const px = p % w, py = (p - px) / w;
      const neighbors = [
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1,
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
      ];
      for (const ni of neighbors) {
        if (ni >= 0 && componentId[ni] < 0 && colorIndex[ni] === color) {
          componentId[ni] = id;
          stack.push(ni);
        }
      }
    }
    componentMaxDist.push(maxD);
  }

  // Assign feature width = 2 * component's max inscribed distance
  const featureWidth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (colorIndex[i] === BG_INDEX) {
      featureWidth[i] = 0;
    } else {
      featureWidth[i] = 2 * componentMaxDist[componentId[i]];
    }
  }
  return featureWidth;
}

/**
 * Identifies pixels where the feature width is below a minimum threshold.
 * Returns a bitmask and per-color warnings.
 */
export function findThinRegions(
  colorIndex: Uint8Array,
  featureWidth: Float32Array,
  w: number,
  h: number,
  BG_INDEX: number,
  minWidthPx: number
): { thinMask: Uint8Array; thinCount: number } {
  const n = w * h;
  const thinMask = new Uint8Array(n);
  let thinCount = 0;
  for (let i = 0; i < n; i++) {
    if (colorIndex[i] !== BG_INDEX && featureWidth[i] > 0 && featureWidth[i] < minWidthPx) {
      thinMask[i] = 1;
      thinCount++;
    }
  }
  return { thinMask, thinCount };
}

export function runPipeline(
  imgData: ImageData,
  maxWidth: number,
  numColors: number,
  chamferWidth: number,
  removeBg: boolean,
  bgTolerance: number,
  smoothing: number,
  minRegion: number,
  isPick: boolean,
  manualPalette: RGB[],
  hasAlpha: boolean,
  fileIsPng: boolean
) {
  const aspect = imgData.height / imgData.width;
  const tw = maxWidth;
  const th = Math.max(2, Math.round(maxWidth * aspect));

  const bgMask = removeBg ? computeBgMask(imgData, tw, th, bgTolerance, hasAlpha, fileIsPng) : null;
  const fp = (isPick && manualPalette.length > 0) ? manualPalette : null;
  const { colorIndex, palette, BG_INDEX } = quantizeColors(imgData, tw, th, numColors, bgMask, fp);

  cleanColorIndex(colorIndex, tw, th, minRegion, BG_INDEX);
  erodeThinStrips(colorIndex, tw, th, BG_INDEX);

  const dist = computeBoundaryDist(colorIndex, tw, th, chamferWidth);
  blurDistanceField(dist, colorIndex, tw, th, smoothing, BG_INDEX);
  const featureWidth = computeFeatureWidth(colorIndex, dist, tw, th, BG_INDEX);

  return { colorIndex, palette, dist, featureWidth, BG_INDEX, tw, th, bgMask };
}
