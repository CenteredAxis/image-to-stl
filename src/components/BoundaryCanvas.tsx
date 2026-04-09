import { useEffect, useRef, useCallback } from 'react';
import type { PipelineResult, ZoomLensInfo } from '../types';

const ZOOM_LEVEL = 8;
const LENS_SIZE = 140;

interface Props {
  result: PipelineResult | null;
  highlightSmall: boolean;
  thinMask?: Uint8Array | null;
  svgPreview?: ImageData | null;
  onRegionClick?: (pixels: number[], currentColorIdx: number) => void;
  onZoom: (info: ZoomLensInfo) => void;
  onZoomHide: () => void;
}

export function BoundaryCanvas({ result, highlightSmall, thinMask, svgPreview, onRegionClick, onZoom, onZoomHide }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const { colorIndex, palette, dist, BG_INDEX, tw, th } = result;
    const canvas = canvasRef.current;

    // Determine effective chamferW from dist range
    let maxDist = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] < 1e6) maxDist = Math.max(maxDist, dist[i]);
    const effectiveChamferW = maxDist;

    if (svgPreview) {
      // ── SVG path: render the high-res snapped image with chamfer darkening ──
      // Cap display canvas to 2048px to avoid excessive memory usage
      const srcW = svgPreview.width, srcH = svgPreview.height;
      const maxDisplay = 2048;
      const displayScale2 = Math.min(1, maxDisplay / Math.max(srcW, srcH));
      const dw = Math.round(srcW * displayScale2);
      const dh = Math.round(srcH * displayScale2);
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const out = ctx.createImageData(dw, dh);
      const src = svgPreview.data;

      for (let dy = 0; dy < dh; dy++) {
        // Map display Y to pipeline grid Y and source Y
        const gy = Math.min(th - 1, Math.floor(dy * th / dh));
        const sy = Math.min(srcH - 1, Math.floor(dy * srcH / dh));
        for (let dx = 0; dx < dw; dx++) {
          const si = (dy * dw + dx) * 4;
          const sx = Math.min(srcW - 1, Math.floor(dx * srcW / dw));
          const srcI = (sy * srcW + sx) * 4;
          const gx = Math.min(tw - 1, Math.floor(dx * tw / dw));
          const gi = gy * tw + gx;
          const ci = colorIndex[gi];

          if (ci === BG_INDEX || src[srcI + 3] < 128) {
            // Checkerboard for background
            const checker = ((dx >> 3) + (dy >> 3)) & 1;
            const v = checker ? 40 : 25;
            out.data[si] = v; out.data[si + 1] = v; out.data[si + 2] = v; out.data[si + 3] = 255;
            continue;
          }

          // Use the actual SVG pixel color (already snapped to palette)
          let r = src[srcI], g = src[srcI + 1], b = src[srcI + 2];

          // Apply chamfer darkening from the pipeline distance field
          const d = dist[gi];
          if (d < 0.8) {
            r = r * 0.35; g = g * 0.35; b = b * 0.35;
          } else if (d < effectiveChamferW) {
            const t = (d - 0.8) / (effectiveChamferW - 0.8);
            const factor = 0.7 + 0.3 * t;
            r *= factor; g *= factor; b *= factor;
          }

          out.data[si] = Math.round(r);
          out.data[si + 1] = Math.round(g);
          out.data[si + 2] = Math.round(b);
          out.data[si + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);

      // Overlays (highlight small, thin walls) — upscale from pipeline grid
      if (highlightSmall) {
        drawSmallRegionOverlay(ctx, colorIndex, BG_INDEX, tw, th, dw, dh);
      }
      if (thinMask) {
        drawThinWallOverlay(ctx, thinMask, tw, th, dw, dh);
      }
    } else {
      // ── Raster path: render from pipeline colorIndex with nearest-neighbor upscale ──
      const displayScale = Math.max(1, Math.min(4, Math.ceil(512 / Math.max(tw, th))));
      const displayW = tw * displayScale;
      const displayH = th * displayScale;

      const offscreen = document.createElement('canvas');
      offscreen.width = tw;
      offscreen.height = th;
      const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!;
      const out = offCtx.createImageData(tw, th);

      canvas.width = displayW;
      canvas.height = displayH;

      for (let i = 0; i < tw * th; i++) {
        const ci = colorIndex[i];
        if (ci === BG_INDEX) {
          const x = i % tw, y = (i - x) / tw;
          const checker = ((x >> 2) + (y >> 2)) & 1;
          const v = checker ? 40 : 25;
          out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
          continue;
        }
        const c = palette[ci];
        const d = dist[i];
        let r = c[0], g = c[1], b = c[2];
        if (d < 0.8) {
          r = r * 0.35; g = g * 0.35; b = b * 0.35;
        } else if (d < effectiveChamferW) {
          const t = (d - 0.8) / (effectiveChamferW - 0.8);
          const factor = 0.7 + 0.3 * t;
          r *= factor; g *= factor; b *= factor;
        }
        out.data[i * 4] = Math.round(r);
        out.data[i * 4 + 1] = Math.round(g);
        out.data[i * 4 + 2] = Math.round(b);
        out.data[i * 4 + 3] = 255;
      }
      offCtx.putImageData(out, 0, 0);

      if (highlightSmall) {
        drawSmallRegionOverlayDirect(offCtx, colorIndex, BG_INDEX, tw, th);
      }
      if (thinMask) {
        drawThinWallOverlayDirect(offCtx, thinMask, tw, th);
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, displayW, displayH);
    }
  }, [result, highlightSmall, thinMask, svgPreview]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!result || !canvasRef.current || !onRegionClick) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const { colorIndex, BG_INDEX, tw, th } = result;
    // Map display coordinates back to pipeline grid
    const ix = Math.floor((e.clientX - rect.left) / rect.width * tw);
    const iy = Math.floor((e.clientY - rect.top) / rect.height * th);
    if (ix < 0 || ix >= tw || iy < 0 || iy >= th) return;
    const startIdx = iy * tw + ix;
    const color = colorIndex[startIdx];
    if (color === BG_INDEX) return;

    // Flood-fill to find the connected component
    const visited = new Uint8Array(tw * th);
    const pixels: number[] = [startIdx];
    visited[startIdx] = 1;
    let head = 0;
    while (head < pixels.length) {
      const idx = pixels[head++];
      const cx = idx % tw, cy = (idx - cx) / tw;
      const neighbors = [
        cx > 0 ? idx - 1 : -1,
        cx < tw - 1 ? idx + 1 : -1,
        cy > 0 ? idx - tw : -1,
        cy < th - 1 ? idx + tw : -1,
      ];
      for (const ni of neighbors) {
        if (ni >= 0 && !visited[ni] && colorIndex[ni] === color) {
          visited[ni] = 1;
          pixels.push(ni);
        }
      }
    }
    onRegionClick(pixels, color);
  }, [result, onRegionClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas.width) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const halfPx = LENS_SIZE / ZOOM_LEVEL / 2;

    const ix = Math.floor(px), iy = Math.floor(py);
    let colorLabel = '', borderColor = '#4a9eff';
    if (ix >= 0 && ix < canvas.width && iy >= 0 && iy < canvas.height) {
      const pxData = canvas.getContext('2d')!.getImageData(ix, iy, 1, 1).data;
      colorLabel = `rgb(${pxData[0]},${pxData[1]},${pxData[2]})`;
      borderColor = `rgb(${pxData[0]},${pxData[1]},${pxData[2]})`;
    }

    onZoom({
      visible: true,
      screenX: e.clientX,
      screenY: e.clientY,
      colorLabel,
      borderColor,
      drawFn: (ctx) => {
        ctx.drawImage(canvas, px - halfPx, py - halfPx, LENS_SIZE / ZOOM_LEVEL, LENS_SIZE / ZOOM_LEVEL, 0, 0, LENS_SIZE, LENS_SIZE);
      },
    });
  }, [onZoom]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', cursor: onRegionClick ? 'pointer' : undefined }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={onZoomHide}
    />
  );
}

// ── Overlay helpers ──────────────────────────────────────────────────────────

/** Small region highlight — rendered at pipeline grid resolution */
function drawSmallRegionOverlayDirect(
  ctx: CanvasRenderingContext2D, colorIndex: Uint8Array, BG_INDEX: number, tw: number, th: number
) {
  const visited = new Uint8Array(tw * th);
  const smallPixels = new Uint8Array(tw * th);
  const threshold = 10;
  for (let i = 0; i < tw * th; i++) {
    if (visited[i] || colorIndex[i] === BG_INDEX) continue;
    const color = colorIndex[i];
    const comp = [i]; visited[i] = 1;
    let head = 0;
    while (head < comp.length) {
      const idx = comp[head++];
      const cx = idx % tw, cy = (idx - cx) / tw;
      if (cx > 0 && !visited[idx - 1] && colorIndex[idx - 1] === color) { visited[idx - 1] = 1; comp.push(idx - 1); }
      if (cx < tw - 1 && !visited[idx + 1] && colorIndex[idx + 1] === color) { visited[idx + 1] = 1; comp.push(idx + 1); }
      if (cy > 0 && !visited[idx - tw] && colorIndex[idx - tw] === color) { visited[idx - tw] = 1; comp.push(idx - tw); }
      if (cy < th - 1 && !visited[idx + tw] && colorIndex[idx + tw] === color) { visited[idx + tw] = 1; comp.push(idx + tw); }
    }
    if (comp.length < threshold) for (const idx of comp) smallPixels[idx] = 1;
  }
  const overlayData = ctx.createImageData(tw, th);
  let hasSmall = false;
  for (let i = 0; i < tw * th; i++) {
    if (!smallPixels[i]) continue;
    hasSmall = true;
    const x = i % tw, y = (i - x) / tw;
    const hatch = ((x + y) & 1) === 0;
    overlayData.data[i * 4] = 255;
    overlayData.data[i * 4 + 1] = 0;
    overlayData.data[i * 4 + 2] = hatch ? 255 : 0;
    overlayData.data[i * 4 + 3] = 200;
  }
  if (hasSmall) {
    const tmpC = document.createElement('canvas');
    tmpC.width = tw; tmpC.height = th;
    tmpC.getContext('2d')!.putImageData(overlayData, 0, 0);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(tmpC, 0, 0);
    ctx.globalAlpha = 1.0;
  }
}

/** Small region highlight — upscaled from pipeline grid to display resolution */
function drawSmallRegionOverlay(
  ctx: CanvasRenderingContext2D, colorIndex: Uint8Array, BG_INDEX: number,
  tw: number, th: number, dw: number, dh: number
) {
  const offscreen = document.createElement('canvas');
  offscreen.width = tw; offscreen.height = th;
  const offCtx = offscreen.getContext('2d')!;
  drawSmallRegionOverlayDirect(offCtx, colorIndex, BG_INDEX, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1.0;
  ctx.drawImage(offscreen, 0, 0, dw, dh);
}

/** Thin wall overlay — rendered at pipeline grid resolution */
function drawThinWallOverlayDirect(
  ctx: CanvasRenderingContext2D, thinMask: Uint8Array, tw: number, th: number
) {
  const overlayData = ctx.createImageData(tw, th);
  let hasThin = false;
  for (let i = 0; i < tw * th; i++) {
    if (!thinMask[i]) continue;
    hasThin = true;
    const x = i % tw, y = (i - x) / tw;
    const stripe = ((x + y) % 4) < 2;
    overlayData.data[i * 4] = 255;
    overlayData.data[i * 4 + 1] = stripe ? 165 : 0;
    overlayData.data[i * 4 + 2] = 0;
    overlayData.data[i * 4 + 3] = 160;
  }
  if (hasThin) {
    const tmpC = document.createElement('canvas');
    tmpC.width = tw; tmpC.height = th;
    tmpC.getContext('2d')!.putImageData(overlayData, 0, 0);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(tmpC, 0, 0);
    ctx.globalAlpha = 1.0;
  }
}

/** Thin wall overlay — upscaled from pipeline grid to display resolution */
function drawThinWallOverlay(
  ctx: CanvasRenderingContext2D, thinMask: Uint8Array,
  tw: number, th: number, dw: number, dh: number
) {
  const offscreen = document.createElement('canvas');
  offscreen.width = tw; offscreen.height = th;
  const offCtx = offscreen.getContext('2d')!;
  drawThinWallOverlayDirect(offCtx, thinMask, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, dw, dh);
}
