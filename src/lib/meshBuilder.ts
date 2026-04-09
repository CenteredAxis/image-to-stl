import type { RGB, MeshResult, Settings } from '../types';
import { findClosestFilament } from './colorUtils';
import {
  computeBgMask, quantizeColors, cleanColorIndex, erodeThinStrips,
  extractBoundaryContours, computeBoundaryDist, blurDistanceField,
  computeFeatureWidth
} from './imagePipeline';
import { getEffectiveDimensions } from './printerProfile';
import { filterDegenerateTris } from './meshValidation';

export function generateSTLWithMeshData(
  imgData: ImageData,
  settings: Settings,
  manualPalette: RGB[],
  hasAlpha: boolean,
  fileIsPng: boolean
): MeshResult {
  const eff = getEffectiveDimensions(settings);
  const {
    maxWidth, numColors, chamferWidth: chamferW, modelWidth: modelW,
    hollow, removeBg, cutThrough, bgTolerance: bgTol,
    smoothing: smoothSigma, minRegion, paletteMode, mirrorX, faceDown,
    minFeatureRetention
  } = settings;
  const surfaceH = eff.surfaceHeight;
  const baseH = eff.baseHeight;
  const chamferD = eff.chamferDepth;
  const isPick = paletteMode === 'pick';

  const aspect = imgData.height / imgData.width;
  const gw = maxWidth;
  const gh = Math.max(2, Math.round(maxWidth * aspect));

  // Snap pixels to palette to eliminate anti-aliasing blends (same as SVG path)
  if (isPick && manualPalette.length > 0) {
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      let bestD = Infinity, bestIdx = 0;
      for (let p = 0; p < manualPalette.length; p++) {
        const dr = r - manualPalette[p][0], dg = g - manualPalette[p][1], db = b - manualPalette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestIdx = p; }
      }
      px[i] = manualPalette[bestIdx][0];
      px[i + 1] = manualPalette[bestIdx][1];
      px[i + 2] = manualPalette[bestIdx][2];
    }
  }

  const bgMask = removeBg ? computeBgMask(imgData, gw, gh, bgTol, hasAlpha, fileIsPng) : null;
  const fp = (isPick && manualPalette.length > 0) ? manualPalette : null;
  const { colorIndex, palette, BG_INDEX } = quantizeColors(imgData, gw, gh, numColors, bgMask, fp);

  cleanColorIndex(colorIndex, gw, gh, minRegion, BG_INDEX);
  erodeThinStrips(colorIndex, gw, gh, BG_INDEX);
  const dist = computeBoundaryDist(colorIndex, gw, gh, chamferW);
  blurDistanceField(dist, colorIndex, gw, gh, smoothSigma, BG_INDEX);
  const featureWidth = computeFeatureWidth(colorIndex, dist, gw, gh, BG_INDEX);

  const modelH = modelW * aspect;
  const dx = modelW / (gw - 1);
  const dy = modelH / (gh - 1);

  const isBg = (x: number, y: number) => colorIndex[y * gw + x] === BG_INDEX;

  const vx = new Float32Array(gw * gh);
  const vy = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const rawX = x * dx;
      vx[y * gw + x] = mirrorX ? (modelW - rawX) : rawX;
      vy[y * gw + x] = y * dy;
    }
  }

  const isBoundaryVtx = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = y * gw + x;
      const c = colorIndex[idx];
      if (x > 0 && colorIndex[idx - 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (x < gw - 1 && colorIndex[idx + 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (y > 0 && colorIndex[idx - gw] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (y < gh - 1 && colorIndex[idx + gw] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (x > 0 && y > 0 && colorIndex[(y - 1) * gw + x - 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (x < gw - 1 && y > 0 && colorIndex[(y - 1) * gw + x + 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (x > 0 && y < gh - 1 && colorIndex[(y + 1) * gw + x - 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
      if (x < gw - 1 && y < gh - 1 && colorIndex[(y + 1) * gw + x + 1] !== c) { isBoundaryVtx[idx] = 1; continue; }
    }
  }

  const smoothPasses = Math.round(smoothSigma * 3);
  const lambda = 0.4;
  const maxDisplacement = dx * 1.5;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const newVx = new Float32Array(vx);
    const newVy = new Float32Array(vy);
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const idx = y * gw + x;
        if (!isBoundaryVtx[idx]) continue;
        const myColor = colorIndex[idx];
        let sx = 0, sy = 0, n = 0;
        for (let dy2 = -1; dy2 <= 1; dy2++) {
          for (let dx2 = -1; dx2 <= 1; dx2++) {
            if (dx2 === 0 && dy2 === 0) continue;
            const ni = (y + dy2) * gw + (x + dx2);
            if (colorIndex[ni] === myColor) { sx += vx[ni]; sy += vy[ni]; n++; }
          }
        }
        if (n < 2) continue;
        let nx = vx[idx] + lambda * (sx / n - vx[idx]);
        let ny = vy[idx] + lambda * (sy / n - vy[idx]);
        const origX = x * dx, origY = y * dy;
        const ddx = nx - origX, ddy = ny - origY;
        const dist2 = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist2 > maxDisplacement) {
          const scale = maxDisplacement / dist2;
          nx = origX + ddx * scale; ny = origY + ddy * scale;
        }
        newVx[idx] = nx; newVy[idx] = ny;
      }
    }
    vx.set(newVx); vy.set(newVy);
  }

  const heights = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    if (colorIndex[i] === BG_INDEX) { heights[i] = cutThrough ? 0 : baseH; continue; }
    const d = dist[i];
    // Adaptive chamfer: cap effective chamfer width for thin features
    const fw = featureWidth[i];
    const maxChamferForFeature = (fw / 2) * (1 - minFeatureRetention);
    const effChamferW = Math.min(chamferW, Math.max(0.5, maxChamferForFeature));
    const effChamferD = chamferD * (effChamferW / chamferW);
    if (d >= effChamferW) heights[i] = baseH + surfaceH;
    else heights[i] = baseH + surfaceH - effChamferD * (1 - d / effChamferW);
    heights[i] = Math.round(heights[i] * 100) / 100;
  }

  const vtxX = (x: number, y: number) => vx[y * gw + x];
  const vtxY = (x: number, y: number) => vy[y * gw + x];
  const z = (x: number, y: number) => heights[y * gw + x];
  const bottomZ = hollow ? baseH * 0.5 : 0;

  const tris: number[] = [];
  const pushTri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const visited = new Uint8Array((gw - 1) * (gh - 1));

  const cellFlat = (x: number, y: number) => {
    const h00 = z(x, y), h10 = z(x + 1, y), h01 = z(x, y + 1), h11 = z(x + 1, y + 1);
    return h00 === h10 && h00 === h01 && h00 === h11;
  };
  const cellHeight = (x: number, y: number) => z(x, y);
  const cellSkip = (x: number, y: number) =>
    cutThrough && isBg(x, y) && isBg(x + 1, y) && isBg(x, y + 1) && isBg(x + 1, y + 1);

  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const ci = y * (gw - 1) + x;
      if (visited[ci] || cellSkip(x, y)) continue;
      if (!cellFlat(x, y)) {
        visited[ci] = 1;
        pushTri(vtxX(x,y),vtxY(x,y),z(x,y), vtxX(x+1,y),vtxY(x+1,y),z(x+1,y), vtxX(x+1,y+1),vtxY(x+1,y+1),z(x+1,y+1));
        pushTri(vtxX(x,y),vtxY(x,y),z(x,y), vtxX(x+1,y+1),vtxY(x+1,y+1),z(x+1,y+1), vtxX(x,y+1),vtxY(x,y+1),z(x,y+1));
        continue;
      }
      const h = cellHeight(x, y);
      let maxX = x;
      while (maxX + 1 < gw - 1 && !visited[y * (gw - 1) + maxX + 1] &&
             !cellSkip(maxX + 1, y) && cellFlat(maxX + 1, y) && cellHeight(maxX + 1, y) === h) maxX++;
      let maxY = y;
      outer: while (maxY + 1 < gh - 1) {
        for (let xx = x; xx <= maxX; xx++) {
          const ci2 = (maxY + 1) * (gw - 1) + xx;
          if (visited[ci2] || cellSkip(xx, maxY + 1) || !cellFlat(xx, maxY + 1) || cellHeight(xx, maxY + 1) !== h) break outer;
        }
        maxY++;
      }
      for (let yy = y; yy <= maxY; yy++) for (let xx = x; xx <= maxX; xx++) visited[yy * (gw - 1) + xx] = 1;
      const px0=vtxX(x,y),py0=vtxY(x,y), px1=vtxX(maxX+1,y),py1=vtxY(maxX+1,y);
      const px2=vtxX(maxX+1,maxY+1),py2=vtxY(maxX+1,maxY+1), px3=vtxX(x,maxY+1),py3=vtxY(x,maxY+1);
      pushTri(px0,py0,h, px1,py1,h, px2,py2,h);
      pushTri(px0,py0,h, px2,py2,h, px3,py3,h);
    }
  }

  visited.fill(0);
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const ci = y * (gw - 1) + x;
      if (visited[ci] || cellSkip(x, y)) continue;
      let maxX = x;
      while (maxX + 1 < gw - 1 && !visited[y * (gw - 1) + maxX + 1] && !cellSkip(maxX + 1, y)) maxX++;
      let maxY = y;
      outer2: while (maxY + 1 < gh - 1) {
        for (let xx = x; xx <= maxX; xx++) {
          if (visited[(maxY + 1) * (gw - 1) + xx] || cellSkip(xx, maxY + 1)) break outer2;
        }
        maxY++;
      }
      for (let yy = y; yy <= maxY; yy++) for (let xx = x; xx <= maxX; xx++) visited[yy * (gw - 1) + xx] = 1;
      const bx0=vtxX(x,y),by0=vtxY(x,y), bx1=vtxX(maxX+1,y),by1=vtxY(maxX+1,y);
      const bx2=vtxX(maxX+1,maxY+1),by2=vtxY(maxX+1,maxY+1), bx3=vtxX(x,maxY+1),by3=vtxY(x,maxY+1);
      pushTri(bx0,by0,bottomZ, bx2,by2,bottomZ, bx1,by1,bottomZ);
      pushTri(bx0,by0,bottomZ, bx3,by3,bottomZ, bx2,by2,bottomZ);
    }
  }

  for (let x = 0; x < gw - 1; x++) {
    const sx0=vtxX(x,0),sy0=vtxY(x,0), sx1=vtxX(x+1,0),sy1=vtxY(x+1,0);
    pushTri(sx0,sy0,bottomZ, sx1,sy1,bottomZ, sx1,sy1,z(x+1,0));
    pushTri(sx0,sy0,bottomZ, sx1,sy1,z(x+1,0), sx0,sy0,z(x,0));
  }
  for (let x = 0; x < gw - 1; x++) {
    const sx0=vtxX(x,gh-1),sy0=vtxY(x,gh-1), sx1=vtxX(x+1,gh-1),sy1=vtxY(x+1,gh-1);
    pushTri(sx0,sy0,bottomZ, sx1,sy1,z(x+1,gh-1), sx1,sy1,bottomZ);
    pushTri(sx0,sy0,bottomZ, sx0,sy0,z(x,gh-1), sx1,sy1,z(x+1,gh-1));
  }
  for (let y = 0; y < gh - 1; y++) {
    const sx0=vtxX(0,y),sy0=vtxY(0,y), sx1=vtxX(0,y+1),sy1=vtxY(0,y+1);
    pushTri(sx0,sy0,bottomZ, sx1,sy1,z(0,y+1), sx1,sy1,bottomZ);
    pushTri(sx0,sy0,bottomZ, sx0,sy0,z(0,y), sx1,sy1,z(0,y+1));
  }
  for (let y = 0; y < gh - 1; y++) {
    const sx0=vtxX(gw-1,y),sy0=vtxY(gw-1,y), sx1=vtxX(gw-1,y+1),sy1=vtxY(gw-1,y+1);
    pushTri(sx0,sy0,bottomZ, sx1,sy1,bottomZ, sx1,sy1,z(gw-1,y+1));
    pushTri(sx0,sy0,bottomZ, sx1,sy1,z(gw-1,y+1), sx0,sy0,z(gw-1,y));
  }

  // Internal side walls: close holes where non-BG cells border BG cells (cutThrough manifold)
  if (cutThrough) {
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        // Check right edge: x+1 boundary
        if (x + 1 < gw - 1) {
          const leftBg = isBg(x, y) && isBg(x, y + 1);
          const rightBg = isBg(x + 1, y) && isBg(x + 1, y + 1);
          if (leftBg !== rightBg) {
            const wx = x + 1;
            const x0 = vtxX(wx, y), y0 = vtxY(wx, y), z0 = z(wx, y);
            const x1 = vtxX(wx, y + 1), y1 = vtxY(wx, y + 1), z1 = z(wx, y + 1);
            if (leftBg) {
              // Wall faces left (toward non-BG on right)
              pushTri(x0, y0, bottomZ, x1, y1, z1, x1, y1, bottomZ);
              pushTri(x0, y0, bottomZ, x0, y0, z0, x1, y1, z1);
            } else {
              // Wall faces right (toward non-BG on left)
              pushTri(x0, y0, bottomZ, x1, y1, bottomZ, x1, y1, z1);
              pushTri(x0, y0, bottomZ, x1, y1, z1, x0, y0, z0);
            }
          }
        }
        // Check bottom edge: y+1 boundary
        if (y + 1 < gh - 1) {
          const topBg = isBg(x, y) && isBg(x + 1, y);
          const botBg = isBg(x, y + 1) && isBg(x + 1, y + 1);
          if (topBg !== botBg) {
            const wy = y + 1;
            const x0 = vtxX(x, wy), y0 = vtxY(x, wy), z0 = z(x, wy);
            const x1 = vtxX(x + 1, wy), y1 = vtxY(x + 1, wy), z1 = z(x + 1, wy);
            if (topBg) {
              // Wall faces up (toward non-BG below)
              pushTri(x0, y0, bottomZ, x1, y1, bottomZ, x1, y1, z1);
              pushTri(x0, y0, bottomZ, x1, y1, z1, x0, y0, z0);
            } else {
              // Wall faces down (toward non-BG above)
              pushTri(x0, y0, bottomZ, x1, y1, z1, x1, y1, bottomZ);
              pushTri(x0, y0, bottomZ, x0, y0, z0, x1, y1, z1);
            }
          }
        }
      }
    }
  }

  // Filter degenerate triangles for manifold safety
  const filteredTris = filterDegenerateTris(tris);

  const totalTris = filteredTris.length / 9;
  const bufSize = 84 + totalTris * 50;
  if (bufSize > 500 * 1024 * 1024) {
    throw new Error(`STL too large (~${(bufSize / 1024 / 1024).toFixed(0)} MB) — lower the Resolution setting`);
  }
  const buf = new ArrayBuffer(bufSize);
  const view = new DataView(buf);
  const header = 'Image-to-STL Color Chamfer (optimized)';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, totalTris, true);

  // faceDown flips Z so the chamfered face presses against the bed (best surface quality).
  // Z-flip reverses winding; X-mirror also reverses winding — they cancel when both active.
  const totalH = baseH + surfaceH;
  const doWindingSwap = mirrorX !== faceDown;

  let offset = 84;
  for (let t = 0; t < filteredTris.length; t += 9) {
    let ax=filteredTris[t],ay=filteredTris[t+1],az=filteredTris[t+2];
    let bx=filteredTris[t+3],by=filteredTris[t+4],bz=filteredTris[t+5];
    let cx=filteredTris[t+6],cy=filteredTris[t+7],cz=filteredTris[t+8];
    if (faceDown) { az=totalH-az; bz=totalH-bz; cz=totalH-cz; }
    if (doWindingSwap) {
      let tmp: number;
      tmp=bx; bx=cx; cx=tmp;
      tmp=by; by=cy; cy=tmp;
      tmp=bz; bz=cz; cz=tmp;
    }
    const ux=bx-ax,uy=by-ay,uz=bz-az, wx=cx-ax,wy=cy-ay,wz=cz-az;
    let nx=uy*wz-uz*wy, ny=uz*wx-ux*wz, nz=ux*wy-uy*wx;
    const len=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    view.setFloat32(offset,nx/len,true); offset+=4;
    view.setFloat32(offset,ny/len,true); offset+=4;
    view.setFloat32(offset,nz/len,true); offset+=4;
    view.setFloat32(offset,ax,true); offset+=4;
    view.setFloat32(offset,ay,true); offset+=4;
    view.setFloat32(offset,az,true); offset+=4;
    view.setFloat32(offset,bx,true); offset+=4;
    view.setFloat32(offset,by,true); offset+=4;
    view.setFloat32(offset,bz,true); offset+=4;
    view.setFloat32(offset,cx,true); offset+=4;
    view.setFloat32(offset,cy,true); offset+=4;
    view.setFloat32(offset,cz,true); offset+=4;
    view.setUint16(offset,0,true); offset+=2;
  }

  const blob = new Blob([buf], { type: 'application/octet-stream' });
  return { blob, triCount: totalTris, tris: new Float32Array(filteredTris), colorIndex, palette, BG_INDEX, gw, gh, modelW, modelH, heights, vtxX: vx, vtxY: vy, dx, dy, mirrorX };
}

// Derives per-color STLs directly from the combined mesh result so that vertex
// positions, heights, and chamfer profiles are identical to the single combined STL.
// No independent re-computation — the assembled per-color result matches the preview exactly.
export function generatePerColorSTLsFromMesh(
  mesh: MeshResult,
  settings: Settings,
  fileName: string
): { name: string; data: Uint8Array }[] {
  const { colorIndex, palette, BG_INDEX, gw, gh, heights, vtxX: vx, vtxY: vy, dx, dy } = mesh;
  const eff2 = getEffectiveDimensions(settings);
  const baseH = eff2.baseHeight, surfaceH = eff2.surfaceHeight;
  const { hollow, mirrorX, faceDown, minRegion, fitClearance, mergeSmallPieces } = settings;
  const bottomZ = hollow ? baseH * 0.5 : 0;

  // Mark vertices belonging to large-enough connected components (filters tiny isolated blobs)
  const cellColorMask = new Uint8Array(gw * gh);
  {
    const visited = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      if (visited[i] || colorIndex[i] === BG_INDEX) continue;
      const color = colorIndex[i];
      const comp = [i];
      visited[i] = 1;
      let head = 0;
      while (head < comp.length) {
        const idx = comp[head++];
        const cx = idx % gw, cy = (idx - cx) / gw;
        if (cx > 0 && !visited[idx-1] && colorIndex[idx-1] === color) { visited[idx-1]=1; comp.push(idx-1); }
        if (cx < gw-1 && !visited[idx+1] && colorIndex[idx+1] === color) { visited[idx+1]=1; comp.push(idx+1); }
        if (cy > 0 && !visited[idx-gw] && colorIndex[idx-gw] === color) { visited[idx-gw]=1; comp.push(idx-gw); }
        if (cy < gh-1 && !visited[idx+gw] && colorIndex[idx+gw] === color) { visited[idx+gw]=1; comp.push(idx+gw); }
      }
      const threshold = Math.max(minRegion, 10);
      if (comp.length >= threshold) for (const idx of comp) cellColorMask[idx] = 1;
    }
  }

  // Assign each cell to the majority color of its 4 corners (≥2 required)
  const cellOwner = new Int16Array((gw-1) * (gh-1)).fill(-1);
  for (let y = 0; y < gh-1; y++) {
    for (let x = 0; x < gw-1; x++) {
      const i00=y*gw+x, i10=y*gw+x+1, i01=(y+1)*gw+x, i11=(y+1)*gw+x+1;
      const votes = new Map<number, number>();
      for (const v of [colorIndex[i00], colorIndex[i10], colorIndex[i01], colorIndex[i11]]) {
        if (v !== BG_INDEX) votes.set(v, (votes.get(v)||0)+1);
      }
      if (votes.size === 0) continue;
      let bestC = -1, bestV = 0;
      for (const [c, count] of votes) { if (count > bestV) { bestV = count; bestC = c; } }
      if (bestV < 2) continue;
      if (![i00,i10,i01,i11].some(v => colorIndex[v] === bestC && cellColorMask[v])) continue;
      cellOwner[y*(gw-1)+x] = bestC;
    }
  }

  const getCellOwner = (x: number, y: number): number => {
    if (x < 0 || x >= gw-1 || y < 0 || y >= gh-1) return -1;
    return cellOwner[y*(gw-1)+x];
  };

  // Merge small color components into their largest neighbor
  if (mergeSmallPieces > 0) {
    const visited = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      if (visited[i] || colorIndex[i] === BG_INDEX) continue;
      const color = colorIndex[i];
      const comp = [i];
      visited[i] = 1;
      let head = 0;
      while (head < comp.length) {
        const idx = comp[head++];
        const cx = idx % gw, cy = (idx - cx) / gw;
        if (cx > 0 && !visited[idx-1] && colorIndex[idx-1] === color) { visited[idx-1]=1; comp.push(idx-1); }
        if (cx < gw-1 && !visited[idx+1] && colorIndex[idx+1] === color) { visited[idx+1]=1; comp.push(idx+1); }
        if (cy > 0 && !visited[idx-gw] && colorIndex[idx-gw] === color) { visited[idx-gw]=1; comp.push(idx-gw); }
        if (cy < gh-1 && !visited[idx+gw] && colorIndex[idx+gw] === color) { visited[idx+gw]=1; comp.push(idx+gw); }
      }
      if (comp.length < mergeSmallPieces) {
        // Find the most common neighbor color
        const neighborVotes = new Map<number, number>();
        for (const idx of comp) {
          const cx = idx % gw, cy = (idx - cx) / gw;
          for (const ni of [cx > 0 ? idx-1 : -1, cx < gw-1 ? idx+1 : -1,
                            cy > 0 ? idx-gw : -1, cy < gh-1 ? idx+gw : -1]) {
            if (ni >= 0 && colorIndex[ni] !== color && colorIndex[ni] !== BG_INDEX) {
              neighborVotes.set(colorIndex[ni], (neighborVotes.get(colorIndex[ni]) || 0) + 1);
            }
          }
        }
        if (neighborVotes.size > 0) {
          let bestNeighbor = -1, bestCount = 0;
          for (const [nc, count] of neighborVotes) if (count > bestCount) { bestCount = count; bestNeighbor = nc; }
          // Reassign: merge into largest neighbor for per-color export
          // (cellOwner will pick up the new color)
          for (const idx of comp) cellColorMask[idx] = 0; // exclude from per-color export
        }
      }
    }
  }

  // Pre-compute per-color boundary offset positions for fit clearance
  const offsetVx = fitClearance > 0 ? new Float32Array(vx) : vx;
  const offsetVy = fitClearance > 0 ? new Float32Array(vy) : vy;
  if (fitClearance > 0) {
    // For each vertex, compute inward offset if it's on a color boundary
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        const c = colorIndex[idx];
        if (c === BG_INDEX) continue;
        // Check if this vertex is on a boundary (neighbor has different color)
        let isBoundary = false;
        let nx = 0, ny = 0; // normal pointing inward (toward same-color)
        for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const ax = x + ddx, ay = y + ddy;
          if (ax < 0 || ax >= gw || ay < 0 || ay >= gh) { isBoundary = true; continue; }
          const nc = colorIndex[ay * gw + ax];
          if (nc !== c) {
            isBoundary = true;
            nx -= ddx; ny -= ddy; // point away from the different-color neighbor
          }
        }
        if (!isBoundary) continue;
        const len = Math.sqrt(nx * nx + ny * ny);
        if (len < 0.01) continue;
        // Offset vertex inward by fitClearance in world coordinates
        offsetVx[idx] += (nx / len) * fitClearance;
        offsetVy[idx] += (ny / len) * fitClearance;
      }
    }
  }

  const results: { name: string; data: Uint8Array; pixelCount: number }[] = [];
  const visitedTop = new Uint8Array((gw-1) * (gh-1));
  const visitedBot = new Uint8Array((gw-1) * (gh-1));

  const totalH = baseH + surfaceH;
  const doWindingSwap = mirrorX !== faceDown;

  for (let ci = 0; ci < palette.length; ci++) {
    const c = palette[ci];
    const colorName = findClosestFilament(c[0], c[1], c[2]).filament[3];

    const triFloats: number[] = [];
    let triCount = 0;

    const emitTri = (nx: number, ny: number, nz: number,
                     ax: number, ay: number, az: number,
                     bx: number, by: number, bz: number,
                     cx: number, cy: number, cz: number) => {
      triFloats.push(nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz);
      triCount++;
    };

    const addTri = (ax: number, ay: number, az: number,
                    bx: number, by: number, bz: number,
                    cx: number, cy: number, cz: number) => {
      if (faceDown) { az=totalH-az; bz=totalH-bz; cz=totalH-cz; }
      let rbx=bx, rby=by, rbz=bz, rcx=cx, rcy=cy, rcz=cz;
      if (doWindingSwap) { rbx=cx; rby=cy; rbz=cz; rcx=bx; rcy=by; rcz=bz; }
      const ux=rbx-ax,uy=rby-ay,uz=rbz-az, wx=rcx-ax,wy=rcy-ay,wz=rcz-az;
      let nnx=uy*wz-uz*wy, nny=uz*wx-ux*wz, nnz=ux*wy-uy*wx;
      const len=Math.sqrt(nnx*nnx+nny*nny+nnz*nnz)||1;
      emitTri(nnx/len,nny/len,nnz/len, ax,ay,az, rbx,rby,rbz, rcx,rcy,rcz);
    };

    // Use offset vertices for per-color pieces (fit clearance applied at boundaries)
    const pvx = fitClearance > 0 ? offsetVx : vx;
    const pvy = fitClearance > 0 ? offsetVy : vy;

    // Height from shared combined-mesh array — already rounded, identical to preview
    const hv = (x: number, y: number) => heights[y * gw + x];

    const cellFlat = (x: number, y: number) => {
      const h00=hv(x,y), h10=hv(x+1,y), h01=hv(x,y+1), h11=hv(x+1,y+1);
      return h00===h10 && h00===h01 && h00===h11;
    };

    // Count pixels for this color (for assembly ordering)
    let pixelCount = 0;
    for (let i = 0; i < gw * gh; i++) {
      if (colorIndex[i] === ci && cellColorMask[i]) pixelCount++;
    }

    // ── Top face: greedy rectangle merge filtered by color ────────────────────
    visitedTop.fill(0);
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        const qi = y*(gw-1)+x;
        if (visitedTop[qi] || getCellOwner(x,y) !== ci) continue;
        if (!cellFlat(x,y)) {
          visitedTop[qi] = 1;
          addTri(pvx[y*gw+x],pvy[y*gw+x],hv(x,y), pvx[y*gw+x+1],pvy[y*gw+x+1],hv(x+1,y), pvx[(y+1)*gw+x+1],pvy[(y+1)*gw+x+1],hv(x+1,y+1));
          addTri(pvx[y*gw+x],pvy[y*gw+x],hv(x,y), pvx[(y+1)*gw+x+1],pvy[(y+1)*gw+x+1],hv(x+1,y+1), pvx[(y+1)*gw+x],pvy[(y+1)*gw+x],hv(x,y+1));
          continue;
        }
        const h = hv(x,y);
        let maxX = x;
        while (maxX+1 < gw-1 && !visitedTop[y*(gw-1)+maxX+1] && getCellOwner(maxX+1,y)===ci &&
               cellFlat(maxX+1,y) && hv(maxX+1,y)===h) maxX++;
        let maxY = y;
        outerTop: while (maxY+1 < gh-1) {
          for (let xx=x; xx<=maxX; xx++) {
            if (visitedTop[(maxY+1)*(gw-1)+xx] || getCellOwner(xx,maxY+1)!==ci ||
                !cellFlat(xx,maxY+1) || hv(xx,maxY+1)!==h) break outerTop;
          }
          maxY++;
        }
        for (let yy=y; yy<=maxY; yy++) for (let xx=x; xx<=maxX; xx++) visitedTop[yy*(gw-1)+xx]=1;
        addTri(pvx[y*gw+x],pvy[y*gw+x],h, pvx[y*gw+maxX+1],pvy[y*gw+maxX+1],h, pvx[(maxY+1)*gw+maxX+1],pvy[(maxY+1)*gw+maxX+1],h);
        addTri(pvx[y*gw+x],pvy[y*gw+x],h, pvx[(maxY+1)*gw+maxX+1],pvy[(maxY+1)*gw+maxX+1],h, pvx[(maxY+1)*gw+x],pvy[(maxY+1)*gw+x],h);
      }
    }

    // ── Bottom face: greedy merge ─────────────────────────────────────────────
    visitedBot.fill(0);
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        const qi = y*(gw-1)+x;
        if (visitedBot[qi] || getCellOwner(x,y) !== ci) continue;
        let maxX = x;
        while (maxX+1 < gw-1 && !visitedBot[y*(gw-1)+maxX+1] && getCellOwner(maxX+1,y)===ci) maxX++;
        let maxY = y;
        outerBot: while (maxY+1 < gh-1) {
          for (let xx=x; xx<=maxX; xx++) {
            if (visitedBot[(maxY+1)*(gw-1)+xx] || getCellOwner(xx,maxY+1)!==ci) break outerBot;
          }
          maxY++;
        }
        for (let yy=y; yy<=maxY; yy++) for (let xx=x; xx<=maxX; xx++) visitedBot[yy*(gw-1)+xx]=1;
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[(maxY+1)*gw+maxX+1],pvy[(maxY+1)*gw+maxX+1],bottomZ, pvx[y*gw+maxX+1],pvy[y*gw+maxX+1],bottomZ);
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[(maxY+1)*gw+x],pvy[(maxY+1)*gw+x],bottomZ, pvx[(maxY+1)*gw+maxX+1],pvy[(maxY+1)*gw+maxX+1],bottomZ);
      }
    }

    // ── Side faces: greedy-merge equal-height runs ────────────────────────────
    // LEFT side
    for (let x = 0; x < gw-1; x++) {
      let y = 0;
      while (y < gh-1) {
        if (getCellOwner(x,y) !== ci || getCellOwner(x-1,y) === ci) { y++; continue; }
        const z0 = hv(x,y);
        let maxY = y;
        while (maxY+1 < gh-1) {
          const next = maxY+1;
          if (getCellOwner(x,next) !== ci || getCellOwner(x-1,next) === ci) break;
          if (hv(x,next) !== z0 || hv(x,next+1) !== z0) break;
          maxY = next;
        }
        const z1 = hv(x,maxY+1);
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[(maxY+1)*gw+x],pvy[(maxY+1)*gw+x],z1, pvx[(maxY+1)*gw+x],pvy[(maxY+1)*gw+x],bottomZ);
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[y*gw+x],pvy[y*gw+x],z0, pvx[(maxY+1)*gw+x],pvy[(maxY+1)*gw+x],z1);
        y = maxY+1;
      }
    }
    // RIGHT side
    for (let x = 0; x < gw-1; x++) {
      let y = 0;
      while (y < gh-1) {
        if (getCellOwner(x,y) !== ci || getCellOwner(x+1,y) === ci) { y++; continue; }
        const z0 = hv(x+1,y);
        let maxY = y;
        while (maxY+1 < gh-1) {
          const next = maxY+1;
          if (getCellOwner(x,next) !== ci || getCellOwner(x+1,next) === ci) break;
          if (hv(x+1,next) !== z0 || hv(x+1,next+1) !== z0) break;
          maxY = next;
        }
        const z1 = hv(x+1,maxY+1);
        addTri(pvx[y*gw+x+1],pvy[y*gw+x+1],bottomZ, pvx[(maxY+1)*gw+x+1],pvy[(maxY+1)*gw+x+1],bottomZ, pvx[(maxY+1)*gw+x+1],pvy[(maxY+1)*gw+x+1],z1);
        addTri(pvx[y*gw+x+1],pvy[y*gw+x+1],bottomZ, pvx[(maxY+1)*gw+x+1],pvy[(maxY+1)*gw+x+1],z1, pvx[y*gw+x+1],pvy[y*gw+x+1],z0);
        y = maxY+1;
      }
    }
    // FRONT side (y-1 neighbor not ci)
    for (let y = 0; y < gh-1; y++) {
      let x = 0;
      while (x < gw-1) {
        if (getCellOwner(x,y) !== ci || getCellOwner(x,y-1) === ci) { x++; continue; }
        const z0 = hv(x,y);
        let maxX = x;
        while (maxX+1 < gw-1) {
          const next = maxX+1;
          if (getCellOwner(next,y) !== ci || getCellOwner(next,y-1) === ci) break;
          if (hv(next,y) !== z0 || hv(next+1,y) !== z0) break;
          maxX = next;
        }
        const z1 = hv(maxX+1,y);
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[y*gw+maxX+1],pvy[y*gw+maxX+1],bottomZ, pvx[y*gw+maxX+1],pvy[y*gw+maxX+1],z1);
        addTri(pvx[y*gw+x],pvy[y*gw+x],bottomZ, pvx[y*gw+maxX+1],pvy[y*gw+maxX+1],z1, pvx[y*gw+x],pvy[y*gw+x],z0);
        x = maxX+1;
      }
    }
    // BACK side (y+1 neighbor not ci)
    for (let y = 0; y < gh-1; y++) {
      let x = 0;
      while (x < gw-1) {
        if (getCellOwner(x,y) !== ci || getCellOwner(x,y+1) === ci) { x++; continue; }
        const z0 = hv(x,y+1);
        let maxX = x;
        while (maxX+1 < gw-1) {
          const next = maxX+1;
          if (getCellOwner(next,y) !== ci || getCellOwner(next,y+1) === ci) break;
          if (hv(next,y+1) !== z0 || hv(next+1,y+1) !== z0) break;
          maxX = next;
        }
        const z1 = hv(maxX+1,y+1);
        addTri(pvx[(y+1)*gw+x],pvy[(y+1)*gw+x],bottomZ, pvx[(y+1)*gw+maxX+1],pvy[(y+1)*gw+maxX+1],z1, pvx[(y+1)*gw+maxX+1],pvy[(y+1)*gw+maxX+1],bottomZ);
        addTri(pvx[(y+1)*gw+x],pvy[(y+1)*gw+x],bottomZ, pvx[(y+1)*gw+x],pvy[(y+1)*gw+x],z0, pvx[(y+1)*gw+maxX+1],pvy[(y+1)*gw+maxX+1],z1);
        x = maxX+1;
      }
    }

    if (triCount === 0) continue;

    const bufSize = 84 + triCount * 50;
    if (bufSize > 500 * 1024 * 1024) {
      throw new Error(`Per-color STL too large (~${(bufSize/1024/1024).toFixed(0)} MB) — lower the Resolution setting`);
    }
    const buf = new ArrayBuffer(bufSize);
    const view = new DataView(buf);
    const headerStr = `Color ${ci}: ${colorName}`;
    for (let i = 0; i < 80; i++) view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 0);
    view.setUint32(80, triCount, true);
    let offset = 84;
    for (let t = 0; t < triCount; t++) {
      const base = t * 12;
      for (let k = 0; k < 12; k++) { view.setFloat32(offset, triFloats[base+k], true); offset += 4; }
      view.setUint16(offset, 0, true); offset += 2;
    }
    const safeName = colorName.replace(/[^a-zA-Z0-9]/g, '_');
    results.push({ name: `${fileName}_${ci}_${safeName}.stl`, data: new Uint8Array(buf), pixelCount });
  }

  // Sort by size descending — assembly order: largest pieces first
  results.sort((a, b) => b.pixelCount - a.pixelCount);

  // Rename with assembly order prefix
  return results.map((r, i) => ({
    name: `${String(i + 1).padStart(2, '0')}_${r.name}`,
    data: r.data,
  }));
}
