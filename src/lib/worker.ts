import { runPipeline } from './imagePipeline';
import { generateSTLWithMeshData, generatePerColorSTLsFromMesh } from './meshBuilder';
import { buildZip } from './zip';
import type { Settings, RGB } from '../types';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ImageTracerRaw from 'imagetracerjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ImageTracer: any = (ImageTracerRaw as any).default ?? ImageTracerRaw;

export type WorkerRequest =
  | {
      type: 'pipeline'; id: number;
      imgBuf: ArrayBuffer; imgW: number; imgH: number;
      maxWidth: number; numColors: number; chamferWidth: number;
      removeBg: boolean; bgTolerance: number; smoothing: number; minRegion: number;
      isPick: boolean; manualPalette: RGB[]; hasAlpha: boolean; fileIsPng: boolean;
    }
  | {
      type: 'generate'; id: number;
      imgBuf: ArrayBuffer; imgW: number; imgH: number;
      settings: Settings; manualPalette: RGB[]; hasAlpha: boolean; fileIsPng: boolean;
    }
  | {
      type: 'bambu'; id: number;
      imgBuf: ArrayBuffer; imgW: number; imgH: number;
      settings: Settings; manualPalette: RGB[]; hasAlpha: boolean; fileIsPng: boolean; fileName: string;
    };

function makeImgData(buf: ArrayBuffer, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(buf), w, h);
}

// Nearest-neighbour scale-down — synchronous, no OffscreenCanvas required.
function scaleDownImageData(imgData: ImageData, maxSize: number): ImageData {
  const { width: sw, height: sh, data: src } = imgData;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  if (scale >= 1) return imgData;
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const out = new Uint8ClampedArray(tw * th * 4);
  const scX = sw / tw, scY = sh / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.round(x * scX));
      const sy = Math.min(sh - 1, Math.round(y * scY));
      const si = (sy * sw + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return new ImageData(out, tw, th);
}

// Use imagetracerjs to discover a clean palette from a raster image.
// Returns null on failure (graceful fallback to k-means).
function discoverPaletteViaVtracer(imgData: ImageData, numColors: number): RGB[] | null {
  try {
    // Scale to ≤512px so tracing is fast (~50 ms vs ~2 s for full resolution)
    const small = scaleDownImageData(imgData, 512);

    const traced = ImageTracer.imagedataToTracedata(small, {
      numberofcolors: numColors + 1, // +1 because imagetracerjs often reserves one slot for background
      colorsampling: 2,              // k-means colour quantisation
      colorquantcycles: 5,
      pathomit: 8,                   // skip paths smaller than 8px² — removes stray fragments
      linefilter: false,
    });

    if (!traced?.palette?.length) return null;

    // Convert to RGB[], skip near-transparent entries
    const palette: RGB[] = traced.palette
      .filter((c: { a: number }) => c.a > 64)
      .map((c: { r: number; g: number; b: number }) => [c.r, c.g, c.b] as RGB);

    return palette.length > 0 ? palette.slice(0, numColors) : null;
  } catch {
    return null; // Fall back to k-means silently
  }
}

(self as unknown as Worker).onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, id } = e.data;
  try {
    if (type === 'pipeline') {
      const { imgBuf, imgW, imgH, maxWidth, numColors, chamferWidth, removeBg,
              bgTolerance, smoothing, minRegion, isPick, manualPalette, hasAlpha, fileIsPng } = e.data;
      const imgData = makeImgData(imgBuf, imgW, imgH);

      // Tier 2: for raster inputs in auto-palette mode, use imagetracerjs for
      // vector-aware colour discovery instead of k-means.  This gives clean region
      // boundaries even for JPEG-compressed or previously-rasterised vector art.
      let effectivePalette = manualPalette;
      let effectiveIsPick  = isPick;
      if (!isPick) {
        const vtPalette = discoverPaletteViaVtracer(imgData, numColors);
        if (vtPalette) { effectivePalette = vtPalette; effectiveIsPick = true; }
      }

      const r = runPipeline(imgData, maxWidth, numColors, chamferWidth, removeBg,
                            bgTolerance, smoothing, minRegion, effectiveIsPick, effectivePalette, hasAlpha, fileIsPng);
      let bgCount = 0;
      if (r.bgMask) for (let i = 0; i < r.bgMask.length; i++) if (r.bgMask[i]) bgCount++;
      const transfers: Transferable[] = [r.colorIndex.buffer, r.dist.buffer];
      if (r.bgMask) transfers.push(r.bgMask.buffer);
      (self as unknown as Worker).postMessage(
        { type, id, colorIndex: r.colorIndex, palette: r.palette, dist: r.dist,
          BG_INDEX: r.BG_INDEX, tw: r.tw, th: r.th, bgMask: r.bgMask, bgCount },
        transfers
      );

    } else if (type === 'generate') {
      const { imgBuf, imgW, imgH, settings, manualPalette, hasAlpha, fileIsPng } = e.data;
      const imgData = makeImgData(imgBuf, imgW, imgH);

      // Mirror the same Tier-2 palette discovery used in the pipeline preview so
      // the STL geometry is quantised with the same colours the user approved.
      let effectivePalette = manualPalette;
      let effectiveSettings = settings;
      if (settings.paletteMode !== 'pick') {
        const vtPalette = discoverPaletteViaVtracer(imgData, settings.numColors);
        if (vtPalette) {
          effectivePalette = vtPalette;
          effectiveSettings = { ...settings, paletteMode: 'pick' };
        }
      }

      const r = generateSTLWithMeshData(imgData, effectiveSettings, effectivePalette, hasAlpha, fileIsPng);
      const stlBuf = await r.blob.arrayBuffer();
      const transfers: Transferable[] = [stlBuf, r.tris.buffer, r.heights.buffer, r.colorIndex.buffer, r.vtxX.buffer, r.vtxY.buffer];
      (self as unknown as Worker).postMessage(
        { type, id, stlBuf, tris: r.tris, colorIndex: r.colorIndex, palette: r.palette,
          BG_INDEX: r.BG_INDEX, gw: r.gw, gh: r.gh, modelW: r.modelW, modelH: r.modelH,
          heights: r.heights, vtxX: r.vtxX, vtxY: r.vtxY, dx: r.dx, dy: r.dy, mirrorX: r.mirrorX, triCount: r.triCount },
        transfers
      );

    } else if (type === 'bambu') {
      const { imgBuf, imgW, imgH, settings, manualPalette, hasAlpha, fileIsPng, fileName } = e.data;
      const imgData = makeImgData(imgBuf, imgW, imgH);

      let effectivePalette = manualPalette;
      let effectiveSettings = settings;
      if (settings.paletteMode !== 'pick') {
        const vtPalette = discoverPaletteViaVtracer(imgData, settings.numColors);
        if (vtPalette) {
          effectivePalette = vtPalette;
          effectiveSettings = { ...settings, paletteMode: 'pick' };
        }
      }

      const mesh = generateSTLWithMeshData(imgData, effectiveSettings, effectivePalette, hasAlpha, fileIsPng);
      const files = generatePerColorSTLsFromMesh(mesh, settings, fileName);
      const zip = buildZip(files);
      const zipBuf = await zip.arrayBuffer();
      (self as unknown as Worker).postMessage({ type, id, zipBuf, fileCount: files.length }, [zipBuf]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type, id, error: (err as Error).message });
  }
};
