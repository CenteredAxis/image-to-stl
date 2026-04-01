import { runPipeline } from './imagePipeline';
import { generateSTLWithMeshData, generatePerColorSTLs } from './meshBuilder';
import { buildZip } from './zip';
import type { Settings, RGB } from '../types';

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

(self as unknown as Worker).onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, id } = e.data;
  try {
    if (type === 'pipeline') {
      const { imgBuf, imgW, imgH, maxWidth, numColors, chamferWidth, removeBg,
              bgTolerance, smoothing, minRegion, isPick, manualPalette, hasAlpha, fileIsPng } = e.data;
      const imgData = makeImgData(imgBuf, imgW, imgH);
      const r = runPipeline(imgData, maxWidth, numColors, chamferWidth, removeBg,
                            bgTolerance, smoothing, minRegion, isPick, manualPalette, hasAlpha, fileIsPng);
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
      const r = generateSTLWithMeshData(imgData, settings, manualPalette, hasAlpha, fileIsPng);
      const stlBuf = await r.blob.arrayBuffer();
      const transfers: Transferable[] = [stlBuf, r.tris.buffer, r.heights.buffer, r.colorIndex.buffer];
      (self as unknown as Worker).postMessage(
        { type, id, stlBuf, tris: r.tris, colorIndex: r.colorIndex, palette: r.palette,
          BG_INDEX: r.BG_INDEX, gw: r.gw, gh: r.gh, modelW: r.modelW, modelH: r.modelH,
          heights: r.heights, dx: r.dx, dy: r.dy, mirrorX: r.mirrorX, triCount: r.triCount },
        transfers
      );

    } else if (type === 'bambu') {
      const { imgBuf, imgW, imgH, settings, manualPalette, hasAlpha, fileIsPng, fileName } = e.data;
      const imgData = makeImgData(imgBuf, imgW, imgH);
      const files = generatePerColorSTLs(imgData, settings, manualPalette, hasAlpha, fileIsPng, fileName);
      const zip = buildZip(files);
      const zipBuf = await zip.arrayBuffer();
      (self as unknown as Worker).postMessage({ type, id, zipBuf, fileCount: files.length }, [zipBuf]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type, id, error: (err as Error).message });
  }
};
