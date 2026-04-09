import { useState, useCallback, useEffect, useRef } from 'react';
import type { RGB, PipelineResult, MeshResult, ZoomLensInfo, StatusState } from './types';
import { useSettings } from './hooks/useSettings';
import { useWorker } from './hooks/useWorker';
import { parseSvgColors, consolidateSvgColors } from './lib/svgParser';
import { findThinRegions, computeBoundaryDist, computeFeatureWidth } from './lib/imagePipeline';
import { getMinWallThickness } from './lib/printerProfile';
import { mergePaletteToLimit } from './lib/colorUtils';
import { DropZone } from './components/DropZone';
import { SourceImageCanvas } from './components/SourceImageCanvas';
import { BoundaryCanvas } from './components/BoundaryCanvas';
import { ColorSwatches } from './components/ColorSwatches';
import { FilamentSection } from './components/FilamentSection';
import { SettingsPanel } from './components/SettingsPanel';
import { Preview3D } from './components/Preview3D';
import { ZoomLens } from './components/ZoomLens';
import { StatusBar } from './components/StatusBar';
import { RegionColorPicker } from './components/RegionColorPicker';

// Snap every pixel in-place to its nearest palette color.
// Eliminates anti-aliasing blends so the pipeline only sees pure palette colors.
function snapPixelsToNearestColor(pixels: Uint8ClampedArray, palette: RGB[]): void {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    let bestD = Infinity, bestIdx = 0;
    for (let p = 0; p < palette.length; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestIdx = p; }
    }
    pixels[i]     = palette[bestIdx][0];
    pixels[i + 1] = palette[bestIdx][1];
    pixels[i + 2] = palette[bestIdx][2];
    pixels[i + 3] = 255;
  }
}

export default function App() {
  const { settings, updateSetting } = useSettings();
  const post = useWorker();

  const [imgData, setImgData] = useState<ImageData | null>(null);
  const [fileName, setFileName] = useState('model');
  const [fileIsPng, setFileIsPng] = useState(false);
  const [fileIsSvg, setFileIsSvg] = useState(false);
  const [hasAlpha, setHasAlpha] = useState(false);
  const [manualPalette, setManualPalette] = useState<RGB[]>([]);

  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [bgPercent, setBgPercent] = useState(0);
  const [meshResult, setMeshResult] = useState<MeshResult | null>(null);
  const [stlBlob, setStlBlob] = useState<Blob | null>(null);

  const [svgPreview, setSvgPreview] = useState<ImageData | null>(null);
  const [svgRawData, setSvgRawData] = useState<ImageData | null>(null);
  const [thinWallCount, setThinWallCount] = useState(0);
  const [thinMask, setThinMask] = useState<Uint8Array | null>(null);
  const [regionEdit, setRegionEdit] = useState<{ pixels: number[]; colorIdx: number } | null>(null);
  const [status, setStatusState] = useState<StatusState>({ message: '', variant: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoomLens, setZoomLens] = useState<ZoomLensInfo>({
    visible: false, screenX: 0, screenY: 0, colorLabel: '', borderColor: '#4a9eff', drawFn: null
  });

  const setStatus = useCallback((message: string, variant: StatusState['variant']) => {
    setStatusState({ message, variant });
  }, []);

  // ── Load image ───────────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

    setFileName(baseName);
    setFileIsPng(isPng);
    setFileIsSvg(isSvg);
    setManualPalette([]);
    setMeshResult(null);
    setStlBlob(null);
    if (!isSvg) { setSvgPreview(null); setSvgRawData(null); }

    if (isSvg) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const svgText = e.target!.result as string;
        const svgColors = parseSvgColors(svgText);

        const img = new Image();
        img.onload = () => {
          const meshMax = settings.maxWidth;
          // Render at least 2x the mesh resolution for clean majority-voting,
          // and never below the mesh resolution to avoid upsampling artifacts
          const renderW = Math.min(8192, Math.max(meshMax * 2, img.width || meshMax * 2));
          const renderH = img.height ? Math.round(renderW * (img.height / img.width)) : renderW;
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = renderW; srcCanvas.height = renderH;
          const ctx = srcCanvas.getContext('2d')!;
          ctx.clearRect(0, 0, renderW, renderH);
          ctx.drawImage(img, 0, 0, renderW, renderH);

          // Snap every pixel to its nearest SVG palette color before anything else.
          // This eliminates anti-aliased blends at color boundaries so the worker
          // only ever sees pure palette colors — no scattered fragment artifacts.
          const data = ctx.getImageData(0, 0, renderW, renderH);

          // Check if the SVG actually has transparent regions before snapping
          let svgHasAlpha = false;
          for (let pi = 3; pi < data.data.length; pi += 4) {
            if (data.data[pi] < 128) { svgHasAlpha = true; break; }
          }

          // Save raw (un-snapped) pixels so we can re-snap when palette changes
          setSvgRawData(new ImageData(new Uint8ClampedArray(data.data), renderW, renderH));

          snapPixelsToNearestColor(data.data, svgColors);
          ctx.putImageData(data, 0, 0); // write snapped pixels back so the downsample uses them too

          // Downsample to ~512px for color counting — full-res isn't needed here
          const countW = Math.min(512, renderW);
          const countH = Math.round(countW * renderH / renderW);
          const countCanvas = document.createElement('canvas');
          countCanvas.width = countW; countCanvas.height = countH;
          countCanvas.getContext('2d')!.drawImage(srcCanvas, 0, 0, countW, countH);
          const countData = countCanvas.getContext('2d')!.getImageData(0, 0, countW, countH);

          const { palette: dominant, snappedCount } = consolidateSvgColors(svgColors, countData);
          // Store the high-res snapped image for vector-quality boundary preview
          setSvgPreview(new ImageData(new Uint8ClampedArray(data.data), renderW, renderH));
          setImgData(data);
          setHasAlpha(svgHasAlpha);
          setManualPalette(dominant.map(c => [c[0], c[1], c[2]]));
          updateSetting('paletteMode', 'pick');

          const snapMsg = snappedCount > 0 ? ` — ${snappedCount} artifact colors auto-snapped` : '';
          setStatus(`SVG loaded: ${renderW}×${renderH} — ${dominant.length} dominant colors${snapMsg}`, '');
        };
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
        img.src = URL.createObjectURL(svgBlob);
      };
      reader.readAsText(file);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const maxDim = 2048;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = w; srcCanvas.height = h;
      const ctx = srcCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);

      let alpha = false;
      if (isPng) {
        for (let i = 3; i < data.data.length; i += 4) {
          if (data.data[i] < 240) { alpha = true; break; }
        }
      }
      setImgData(data);
      setHasAlpha(alpha);
      const alphaNote = alpha ? ' (has alpha)' : isPng ? ' (PNG, no alpha)' : '';
      setStatus(`Image loaded: ${img.width}×${img.height}${alphaNote}`, '');
    };
    img.src = URL.createObjectURL(file);
  }, [settings.maxWidth, updateSetting, setStatus]);

  // ── Re-snap SVG preview when palette changes ────────────────────────────────
  useEffect(() => {
    if (!svgRawData || manualPalette.length === 0) return;
    const copy = new ImageData(new Uint8ClampedArray(svgRawData.data), svgRawData.width, svgRawData.height);
    snapPixelsToNearestColor(copy.data, manualPalette);
    setSvgPreview(copy);
  }, [svgRawData, manualPalette]);

  // ── Pipeline (debounced, runs in worker) ─────────────────────────────────────
  const pipelineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineSeqRef = useRef(0);

  useEffect(() => {
    if (!imgData) return;
    if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
    pipelineTimerRef.current = setTimeout(async () => {
      const seq = ++pipelineSeqRef.current;
      const isPick = settings.paletteMode === 'pick';
      // Copy pixel buffer so the original ImageData stays intact in main thread
      const imgBuf = imgData.data.slice().buffer;
      try {
        const r = await post<{
          colorIndex: Uint8Array; palette: RGB[]; dist: Float32Array; featureWidth: Float32Array;
          BG_INDEX: number; tw: number; th: number; bgMask?: Uint8Array; bgCount: number;
        }>({
          type: 'pipeline', imgBuf, imgW: imgData.width, imgH: imgData.height,
          maxWidth: settings.maxWidth, numColors: settings.numColors,
          chamferWidth: settings.chamferWidth, removeBg: settings.removeBg,
          bgTolerance: settings.bgTolerance, smoothing: settings.smoothing,
          minRegion: settings.minRegion, isPick, manualPalette, hasAlpha, fileIsPng,
        }, [imgBuf]);
        if (pipelineSeqRef.current !== seq) return; // stale — newer request in flight
        setPipelineResult({ colorIndex: r.colorIndex, palette: r.palette, dist: r.dist, featureWidth: r.featureWidth, BG_INDEX: r.BG_INDEX, tw: r.tw, th: r.th });
        setBgPercent(r.bgMask ? (r.bgCount / r.bgMask.length) * 100 : 0);
      } catch (e: unknown) {
        if (pipelineSeqRef.current !== seq) return;
        setStatus(`Pipeline error: ${(e as Error).message}`, 'error');
        console.error('Pipeline error:', e);
      }
    }, 150);
    return () => { if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current); };
  }, [imgData, settings, manualPalette, hasAlpha, fileIsPng, setStatus, post]);

  // ── Wall thickness validation ────────────────────────────────────────────────
  useEffect(() => {
    if (!pipelineResult) { setThinWallCount(0); setThinMask(null); return; }
    const pixelSizeMm = settings.modelWidth / settings.maxWidth;
    const minWall = getMinWallThickness(settings.nozzleDiameter);
    const minWidthPx = minWall / pixelSizeMm;
    const { thinMask: mask, thinCount } = findThinRegions(
      pipelineResult.colorIndex, pipelineResult.featureWidth,
      pipelineResult.tw, pipelineResult.th, pipelineResult.BG_INDEX, minWidthPx
    );
    setThinWallCount(thinCount);
    setThinMask(mask);
  }, [pipelineResult, settings.modelWidth, settings.maxWidth, settings.nozzleDiameter]);

  // ── Color pick ───────────────────────────────────────────────────────────────
  const handleColorPick = useCallback((r: number, g: number, b: number) => {
    const isDup = manualPalette.some(c => {
      const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      return dr * dr + dg * dg + db * db < 900;
    });
    if (!isDup) setManualPalette(prev => [...prev, [r, g, b]]);
  }, [manualPalette]);

  const handleRemovePalette = useCallback((i: number) => {
    setManualPalette(prev => prev.filter((_, idx) => idx !== i));
  }, []);

  // ── Region color editing ────────────────────────────────────────────────────
  const handleRegionClick = useCallback((pixels: number[], currentColorIdx: number) => {
    setRegionEdit({ pixels, colorIdx: currentColorIdx });
  }, []);

  const handleRegionReassign = useCallback((newColorIdx: number) => {
    if (!pipelineResult || !regionEdit) return;
    const { tw, th, BG_INDEX, palette, dist } = pipelineResult;
    const newColorIndex = new Uint8Array(pipelineResult.colorIndex);
    for (const px of regionEdit.pixels) newColorIndex[px] = newColorIdx;
    // Recompute boundary distance and feature width for updated regions
    const newDist = computeBoundaryDist(newColorIndex, tw, th, settings.chamferWidth);
    const newFeatureWidth = computeFeatureWidth(newColorIndex, newDist, tw, th, BG_INDEX);
    setPipelineResult({ colorIndex: newColorIndex, palette, dist: newDist, featureWidth: newFeatureWidth, BG_INDEX, tw, th });
    setMeshResult(null);
    setStlBlob(null);
    setRegionEdit(null);
  }, [pipelineResult, regionEdit, settings.chamferWidth]);

  // ── AMS auto-merge ───────────────────────────────────────────────────────────
  const handleAutoMerge = useCallback(() => {
    if (settings.amsSlots <= 0 || manualPalette.length <= settings.amsSlots) return;
    const { merged } = mergePaletteToLimit([...manualPalette], settings.amsSlots);
    setManualPalette(merged);
  }, [manualPalette, settings.amsSlots]);

  // ── Generate ─────────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!imgData) return;
    setIsGenerating(true);
    setStatus('Generating mesh...', 'working');
    const imgBuf = imgData.data.slice().buffer;
    try {
      const r = await post<{
        stlBuf: ArrayBuffer; tris: Float32Array; colorIndex: Uint8Array; palette: RGB[];
        BG_INDEX: number; gw: number; gh: number; modelW: number; modelH: number;
        heights: Float32Array; vtxX: Float32Array; vtxY: Float32Array; dx: number; dy: number; mirrorX: boolean; triCount: number;
      }>({ type: 'generate', imgBuf, imgW: imgData.width, imgH: imgData.height, settings, manualPalette, hasAlpha, fileIsPng }, [imgBuf]);
      const blob = new Blob([r.stlBuf], { type: 'application/octet-stream' });
      setStlBlob(blob);
      setMeshResult({ blob, triCount: r.triCount, tris: r.tris, colorIndex: r.colorIndex, palette: r.palette, BG_INDEX: r.BG_INDEX, gw: r.gw, gh: r.gh, modelW: r.modelW, modelH: r.modelH, heights: r.heights, vtxX: r.vtxX, vtxY: r.vtxY, dx: r.dx, dy: r.dy, mirrorX: r.mirrorX });
      setStatus(`Done! ${(r.stlBuf.byteLength / (1024 * 1024)).toFixed(2)} MB, ${(r.triCount / 1000).toFixed(1)}K triangles`, 'done');
    } catch (e: unknown) {
      setStatus(`Error: ${(e as Error).message}`, 'error');
      console.error(e);
    }
    setIsGenerating(false);
  }, [imgData, settings, manualPalette, hasAlpha, fileIsPng, post, setStatus]);

  const handleDownloadSingle = useCallback(() => {
    if (!stlBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(stlBlob);
    a.download = `${fileName}.stl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [stlBlob, fileName]);

  const handleDownload3MF = useCallback(async () => {
    if (!imgData) return;
    setStatus('Generating 3MF project...', 'working');
    const imgBuf = imgData.data.slice().buffer;
    try {
      const r = await post<{ threemfBuf: ArrayBuffer }>(
        { type: 'threemf', imgBuf, imgW: imgData.width, imgH: imgData.height, settings, manualPalette, hasAlpha, fileIsPng, fileName },
        [imgBuf]
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.threemfBuf], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
      a.download = `${fileName}.3mf`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Done! 3MF project exported.', 'done');
    } catch (e: unknown) {
      setStatus(`Error: ${(e as Error).message}`, 'error');
      console.error(e);
    }
  }, [imgData, settings, manualPalette, hasAlpha, fileIsPng, fileName, post, setStatus]);

  const handleDownloadBambu = useCallback(async () => {
    if (!imgData) return;
    setStatus('Generating per-color STLs...', 'working');
    const imgBuf = imgData.data.slice().buffer;
    try {
      const r = await post<{ zipBuf: ArrayBuffer; fileCount: number }>(
        { type: 'bambu', imgBuf, imgW: imgData.width, imgH: imgData.height, settings, manualPalette, hasAlpha, fileIsPng, fileName },
        [imgBuf]
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.zipBuf], { type: 'application/zip' }));
      a.download = `${fileName}_bambu.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`Done! ${r.fileCount} color STLs zipped.`, 'done');
    } catch (e: unknown) {
      setStatus(`Error: ${(e as Error).message}`, 'error');
      console.error(e);
    }
  }, [imgData, settings, manualPalette, hasAlpha, fileIsPng, fileName, post, setStatus]);

  const hideZoom = useCallback(() => {
    setZoomLens(prev => ({ ...prev, visible: false, drawFn: null }));
  }, []);

  const isPick = settings.paletteMode === 'pick';
  const displayPalette = isPick ? manualPalette : (pipelineResult?.palette ?? []);
  const aspectRatio = imgData ? imgData.height / imgData.width : 0;

  return (
    <div className="container">
      <h1>Image to STL</h1>
      <p className="subtitle">Flat color regions separated by chamfered grooves</p>

      <DropZone onFile={handleFile} />

      {imgData && (
        <div className="preview-row">
          <div className="preview-box">
            <h3>Source Image</h3>
            <SourceImageCanvas
              imgData={imgData}
              isPick={isPick}
              onColorPick={handleColorPick}
              onZoom={setZoomLens}
              onZoomHide={hideZoom}
            />
            {isPick && (
              <p className="pick-hint">Click on the image to pick colors. Click a swatch to remove it.</p>
            )}
          </div>

          <div className="preview-box">
            <h3>Quantized Colors &amp; Boundaries</h3>
            <BoundaryCanvas
              result={pipelineResult}
              highlightSmall={settings.highlightSmall}
              thinMask={settings.highlightThinWalls ? thinMask : null}
              svgPreview={svgPreview}
              onRegionClick={handleRegionClick}
              onZoom={setZoomLens}
              onZoomHide={hideZoom}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: '0.8rem', color: '#aaa', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.highlightSmall}
                onChange={e => updateSetting('highlightSmall', e.target.checked)}
              />
              Highlight non-contiguous regions
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.8rem', color: '#aaa', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.highlightThinWalls}
                onChange={e => updateSetting('highlightThinWalls', e.target.checked)}
              />
              Highlight thin walls (&lt;{(settings.nozzleDiameter * 1.5).toFixed(1)}mm)
            </label>
            <ColorSwatches
              palette={displayPalette}
              isPick={isPick}
              bgPercent={bgPercent}
              onRemove={handleRemovePalette}
            />
          </div>
        </div>
      )}

      <FilamentSection palette={displayPalette} amsSlots={settings.amsSlots} />

      <SettingsPanel
        settings={settings}
        onChange={updateSetting}
        hasImage={!!imgData}
        aspectRatio={aspectRatio}
        thinWallCount={thinWallCount}
        paletteCount={displayPalette.length}
        onAutoMerge={handleAutoMerge}
      />

      <Preview3D result={meshResult} />

      <div className="btn-row">
        <button
          className="btn-primary"
          disabled={!imgData || isGenerating}
          onClick={handleGenerate}
        >
          Generate &amp; Preview 3D
        </button>
        <button
          className="btn-secondary"
          disabled={!stlBlob || isGenerating}
          onClick={handleDownloadSingle}
        >
          Download STL (single)
        </button>
        <button
          className="btn-secondary"
          disabled={!imgData || isGenerating}
          onClick={handleDownloadBambu}
        >
          Download for Bambu (per-color STLs)
        </button>
        <button
          className="btn-secondary"
          disabled={!imgData || isGenerating}
          onClick={handleDownload3MF}
        >
          Download 3MF (Bambu project)
        </button>
      </div>

      <StatusBar status={status} />

      <ZoomLens info={zoomLens} />

      {regionEdit && pipelineResult && (
        <RegionColorPicker
          currentColor={pipelineResult.palette[regionEdit.colorIdx]}
          palette={pipelineResult.palette.filter((_, i) => i !== pipelineResult.BG_INDEX)}
          onReassign={(idx) => {
            // Map filtered index back to original palette index (skipping BG_INDEX)
            let origIdx = idx;
            if (pipelineResult.BG_INDEX <= idx) origIdx = idx + 1;
            handleRegionReassign(origIdx);
          }}
          onClose={() => setRegionEdit(null)}
        />
      )}
    </div>
  );
}
