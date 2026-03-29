import { useEffect, useRef, useCallback } from 'react';
import type { PipelineResult, ZoomLensInfo } from '../types';

const ZOOM_LEVEL = 8;
const LENS_SIZE = 140;

interface Props {
  result: PipelineResult | null;
  highlightSmall: boolean;
  onZoom: (info: ZoomLensInfo) => void;
  onZoomHide: () => void;
}

export function BoundaryCanvas({ result, highlightSmall, onZoom, onZoomHide }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const { colorIndex, palette, dist, BG_INDEX, tw, th } = result;

    const canvas = canvasRef.current;
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const out = ctx.createImageData(tw, th);

    // Determine effective chamferW from dist range
    let maxDist = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] < 1e6) maxDist = Math.max(maxDist, dist[i]);
    const effectiveChamferW = maxDist;

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
    ctx.putImageData(out, 0, 0);

    if (highlightSmall) {
      const visited = new Uint8Array(tw * th);
      const smallPixels = new Uint8Array(tw * th);
      const threshold = 10;
      for (let i = 0; i < tw * th; i++) {
        if (visited[i] || colorIndex[i] === BG_INDEX) continue;
        const color = colorIndex[i];
        const comp = [i];
        visited[i] = 1;
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
  }, [result, highlightSmall]);

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
      style={{ width: '100%' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={onZoomHide}
    />
  );
}
