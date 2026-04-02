import type { RGB, MeshResult, Settings } from '../types';
import { findClosestFilament } from './colorUtils';
import {
  computeBgMask, quantizeColors, cleanColorIndex, erodeThinStrips,
  extractBoundaryContours, computeBoundaryDist, blurDistanceField
} from './imagePipeline';

export function generateSTLWithMeshData(
  imgData: ImageData,
  settings: Settings,
  manualPalette: RGB[],
  hasAlpha: boolean,
  fileIsPng: boolean
): MeshResult {
  const {
    maxWidth, numColors, surfaceHeight: surfaceH, baseHeight: baseH,
    chamferDepth: chamferD, chamferWidth: chamferW, modelWidth: modelW,
    hollow, removeBg, cutThrough, bgTolerance: bgTol,
    smoothing: smoothSigma, minRegion, paletteMode, mirrorX, faceDown
  } = settings;
  const isPick = paletteMode === 'pick';

  const aspect = imgData.height / imgData.width;
  const gw = maxWidth;
  const gh = Math.max(2, Math.round(maxWidth * aspect));

  const bgMask = removeBg ? computeBgMask(imgData, gw, gh, bgTol, hasAlpha, fileIsPng) : null;
  const fp = (isPick && manualPalette.length > 0) ? manualPalette : null;
  const { colorIndex, palette, BG_INDEX } = quantizeColors(imgData, gw, gh, numColors, bgMask, fp);

  cleanColorIndex(colorIndex, gw, gh, minRegion, BG_INDEX);
  erodeThinStrips(colorIndex, gw, gh, BG_INDEX);
  const dist = computeBoundaryDist(colorIndex, gw, gh, chamferW);
  blurDistanceField(dist, colorIndex, gw, gh, smoothSigma, BG_INDEX);

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
    if (d >= chamferW) heights[i] = baseH + surfaceH;
    else heights[i] = baseH + surfaceH - chamferD * (1 - d / chamferW);
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

  const totalTris = tris.length / 9;
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
  for (let t = 0; t < tris.length; t += 9) {
    let ax=tris[t],ay=tris[t+1],az=tris[t+2];
    let bx=tris[t+3],by=tris[t+4],bz=tris[t+5];
    let cx=tris[t+6],cy=tris[t+7],cz=tris[t+8];
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
  return { blob, triCount: totalTris, tris: new Float32Array(tris), colorIndex, palette, BG_INDEX, gw, gh, modelW, modelH, heights, dx, dy, mirrorX };
}

export function generatePerColorSTLs(
  imgData: ImageData,
  settings: Settings,
  manualPalette: RGB[],
  hasAlpha: boolean,
  fileIsPng: boolean,
  fileName: string
): { name: string; data: Uint8Array }[] {
  const {
    maxWidth, numColors, surfaceHeight: surfaceH, baseHeight: baseH,
    chamferDepth: chamferD, chamferWidth: chamferW, modelWidth: modelW,
    removeBg, bgTolerance: bgTol, smoothing: smoothSigma,
    minRegion, paletteMode, mirrorX, faceDown
  } = settings;
  const isPick = paletteMode === 'pick';

  const aspect = imgData.height / imgData.width;
  const gw = maxWidth, gh = Math.max(2, Math.round(maxWidth * aspect));

  const bgMask = removeBg ? computeBgMask(imgData, gw, gh, bgTol, hasAlpha, fileIsPng) : null;
  const fp = (isPick && manualPalette.length > 0) ? manualPalette : null;
  const { colorIndex, palette, BG_INDEX } = quantizeColors(imgData, gw, gh, numColors, bgMask, fp);

  cleanColorIndex(colorIndex, gw, gh, minRegion, BG_INDEX);
  cleanColorIndex(colorIndex, gw, gh, Math.max(5, Math.floor(minRegion / 2)), BG_INDEX);
  erodeThinStrips(colorIndex, gw, gh, BG_INDEX);

  const contours = extractBoundaryContours(colorIndex, gw, gh, BG_INDEX);
  const dist = computeBoundaryDist(colorIndex, gw, gh, chamferW, contours);
  blurDistanceField(dist, colorIndex, gw, gh, smoothSigma, BG_INDEX);

  const modelH = modelW * aspect;
  const dx = modelW / (gw - 1), dy = modelH / (gh - 1);

  const vtxX = new Float32Array(gw * gh);
  const vtxY = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      const rawX = (gx + contours.offX[idx]) * dx;
      vtxX[idx] = mirrorX ? (modelW - rawX) : rawX;
      vtxY[idx] = (gy + contours.offY[idx]) * dy;
    }
  }

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
        const neighbors: number[] = [];
        if (cx > 0) neighbors.push(idx - 1);
        if (cx < gw - 1) neighbors.push(idx + 1);
        if (cy > 0) neighbors.push(idx - gw);
        if (cy < gh - 1) neighbors.push(idx + gw);
        for (const ni of neighbors) {
          if (!visited[ni] && colorIndex[ni] === color) { visited[ni] = 1; comp.push(ni); }
        }
      }
      const threshold = Math.max(minRegion, 10);
      if (comp.length >= threshold) for (const idx of comp) cellColorMask[idx] = 1;
    }
  }

  const cellOwner = new Int16Array((gw - 1) * (gh - 1)).fill(-1);
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const i00=y*gw+x, i10=y*gw+x+1, i01=(y+1)*gw+x, i11=(y+1)*gw+x+1;
      const v = [colorIndex[i00], colorIndex[i10], colorIndex[i01], colorIndex[i11]];
      const votes = new Map<number, number>();
      for (const ci of v) { if (ci !== BG_INDEX) votes.set(ci, (votes.get(ci) || 0) + 1); }
      if (votes.size === 0) continue;
      let bestC = -1, bestV = 0;
      for (const [c, count] of votes) { if (count > bestV) { bestV = count; bestC = c; } }
      if (bestV < 2) continue; // require ≥2 corners to agree — 1-corner cells create tiny spike fragments
      cellOwner[y * (gw - 1) + x] = bestC;
    }
  }

  const getCellOwner = (x: number, y: number): number => {
    if (x < 0 || x >= gw - 1 || y < 0 || y >= gh - 1) return -1;
    return cellOwner[y * (gw - 1) + x];
  };

  const results: { name: string; data: Uint8Array }[] = [];

  // Reused across colors to avoid repeated allocations
  const visitedTop = new Uint8Array((gw - 1) * (gh - 1));
  const visitedBot = new Uint8Array((gw - 1) * (gh - 1));

  // faceDown flips Z so chamfered face presses against the print bed.
  // Z-flip reverses winding; X-mirror also reverses winding — they cancel when both active.
  const totalH = baseH + surfaceH;
  const doWindingSwap = mirrorX !== faceDown;

  for (let ci = 0; ci < palette.length; ci++) {
    const c = palette[ci];
    const colorName = findClosestFilament(c[0], c[1], c[2]).filament[3];

    // Accumulate triangle floats dynamically — avoids giant upfront allocation.
    // Each triangle = 12 floats (normal xyz + 3 vertices xyz).
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

    const zAt = (x: number, y: number): number => {
      const idx = y * gw + x;
      if (colorIndex[idx] !== ci) return baseH;
      const d = dist[idx];
      if (d >= chamferW) return baseH + surfaceH;
      return baseH + surfaceH - chamferD * (1 - d / chamferW);
    };

    // ── Top face: greedy rectangle merging for flat interior cells ────────────
    // Interior cells are all at baseH+surfaceH and merge into large rectangles,
    // collapsing millions of quads into a handful of tris.
    visitedTop.fill(0);
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const qi = y * (gw - 1) + x;
        if (visitedTop[qi] || getCellOwner(x, y) !== ci) continue;

        const z00=zAt(x,y), z10=zAt(x+1,y), z01=zAt(x,y+1), z11=zAt(x+1,y+1);

        if (z00 !== z10 || z00 !== z01 || z00 !== z11) {
          // Non-flat boundary cell — emit two individual tris
          visitedTop[qi] = 1;
          addTri(vtxX[y*gw+x],vtxY[y*gw+x],z00, vtxX[y*gw+x+1],vtxY[y*gw+x+1],z10, vtxX[(y+1)*gw+x+1],vtxY[(y+1)*gw+x+1],z11);
          addTri(vtxX[y*gw+x],vtxY[y*gw+x],z00, vtxX[(y+1)*gw+x+1],vtxY[(y+1)*gw+x+1],z11, vtxX[(y+1)*gw+x],vtxY[(y+1)*gw+x],z01);
          continue;
        }

        const h = z00;
        // Greedy expand right
        let maxX = x;
        while (maxX + 1 < gw - 1 && !visitedTop[y*(gw-1)+maxX+1] && getCellOwner(maxX+1,y)===ci) {
          if (zAt(maxX+1,y)!==h || zAt(maxX+2,y)!==h || zAt(maxX+1,y+1)!==h || zAt(maxX+2,y+1)!==h) break;
          maxX++;
        }
        // Greedy expand down
        let maxY = y;
        outerTop: while (maxY + 1 < gh - 1) {
          for (let xx = x; xx <= maxX; xx++) {
            if (visitedTop[(maxY+1)*(gw-1)+xx] || getCellOwner(xx,maxY+1)!==ci) break outerTop;
            if (zAt(xx,maxY+1)!==h || zAt(xx+1,maxY+1)!==h || zAt(xx,maxY+2)!==h || zAt(xx+1,maxY+2)!==h) break outerTop;
          }
          maxY++;
        }
        for (let yy=y; yy<=maxY; yy++) for (let xx=x; xx<=maxX; xx++) visitedTop[yy*(gw-1)+xx] = 1;

        addTri(vtxX[y*gw+x],vtxY[y*gw+x],h, vtxX[y*gw+maxX+1],vtxY[y*gw+maxX+1],h, vtxX[(maxY+1)*gw+maxX+1],vtxY[(maxY+1)*gw+maxX+1],h);
        addTri(vtxX[y*gw+x],vtxY[y*gw+x],h, vtxX[(maxY+1)*gw+maxX+1],vtxY[(maxY+1)*gw+maxX+1],h, vtxX[(maxY+1)*gw+x],vtxY[(maxY+1)*gw+x],h);
      }
    }

    // ── Bottom face: always flat at z=0 — merge aggressively ─────────────────
    visitedBot.fill(0);
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const qi = y * (gw - 1) + x;
        if (visitedBot[qi] || getCellOwner(x, y) !== ci) continue;
        let maxX = x;
        while (maxX+1 < gw-1 && !visitedBot[y*(gw-1)+maxX+1] && getCellOwner(maxX+1,y)===ci) maxX++;
        let maxY = y;
        outerBot: while (maxY + 1 < gh - 1) {
          for (let xx = x; xx <= maxX; xx++) {
            if (visitedBot[(maxY+1)*(gw-1)+xx] || getCellOwner(xx,maxY+1)!==ci) break outerBot;
          }
          maxY++;
        }
        for (let yy=y; yy<=maxY; yy++) for (let xx=x; xx<=maxX; xx++) visitedBot[yy*(gw-1)+xx] = 1;

        addTri(vtxX[y*gw+x],vtxY[y*gw+x],0, vtxX[(maxY+1)*gw+maxX+1],vtxY[(maxY+1)*gw+maxX+1],0, vtxX[y*gw+maxX+1],vtxY[y*gw+maxX+1],0);
        addTri(vtxX[y*gw+x],vtxY[y*gw+x],0, vtxX[(maxY+1)*gw+x],vtxY[(maxY+1)*gw+x],0, vtxX[(maxY+1)*gw+maxX+1],vtxY[(maxY+1)*gw+maxX+1],0);
      }
    }

    // ── Side faces (per-cell, unchanged) ─────────────────────────────────────
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        if (getCellOwner(x, y) !== ci) continue;
        const vx0=vtxX[y*gw+x],vy0=vtxY[y*gw+x];
        const vx1=vtxX[y*gw+x+1],vy1=vtxY[y*gw+x+1];
        const vx2=vtxX[(y+1)*gw+x],vy2=vtxY[(y+1)*gw+x];
        const vx3=vtxX[(y+1)*gw+x+1],vy3=vtxY[(y+1)*gw+x+1];
        const z00=zAt(x,y), z10=zAt(x+1,y), z01=zAt(x,y+1), z11=zAt(x+1,y+1);
        if (getCellOwner(x-1,y) !== ci) {
          addTri(vx0,vy0,0, vx2,vy2,z01, vx2,vy2,0);
          addTri(vx0,vy0,0, vx0,vy0,z00, vx2,vy2,z01);
        }
        if (getCellOwner(x+1,y) !== ci) {
          addTri(vx1,vy1,0, vx3,vy3,0, vx3,vy3,z11);
          addTri(vx1,vy1,0, vx3,vy3,z11, vx1,vy1,z10);
        }
        if (getCellOwner(x,y-1) !== ci) {
          addTri(vx0,vy0,0, vx1,vy1,0, vx1,vy1,z10);
          addTri(vx0,vy0,0, vx1,vy1,z10, vx0,vy0,z00);
        }
        if (getCellOwner(x,y+1) !== ci) {
          addTri(vx2,vy2,0, vx3,vy3,z11, vx3,vy3,0);
          addTri(vx2,vy2,0, vx2,vy2,z01, vx3,vy3,z11);
        }
      }
    }

    if (triCount === 0) continue;

    // Build final STL buffer now that we know the exact triangle count
    const bufSize = 84 + triCount * 50;
    if (bufSize > 500 * 1024 * 1024) {
      throw new Error(`Per-color STL too large (~${(bufSize / 1024 / 1024).toFixed(0)} MB) — lower the Resolution setting`);
    }
    const buf = new ArrayBuffer(bufSize);
    const view = new DataView(buf);

    const headerStr = `Color ${ci}: ${colorName}`;
    for (let i = 0; i < 80; i++) view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 0);
    view.setUint32(80, triCount, true);

    let offset = 84;
    for (let t = 0; t < triCount; t++) {
      const base = t * 12;
      for (let k = 0; k < 12; k++) { view.setFloat32(offset, triFloats[base + k], true); offset += 4; }
      view.setUint16(offset, 0, true); offset += 2;
    }

    const safeName = colorName.replace(/[^a-zA-Z0-9]/g, '_');
    results.push({ name: `${fileName}_${ci}_${safeName}.stl`, data: new Uint8Array(buf) });
  }

  return results;
}
