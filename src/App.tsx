import { useState, useCallback, useEffect, useRef } from 'react';
import type { RGB, PipelineResult, MeshResult, ZoomLensInfo, StatusState } from './types';
import { useSettings } from './hooks/useSettings';
import { useWorker } from './hooks/useWorker';
import { parseSvgColors, consolidateSvgColors } from './lib/svgParser';
import { DropZone } from './components/DropZone';
import { SourceImageCanvas } from './components/SourceImageCanvas';
import { BoundaryCanvas } from './components/BoundaryCanvas';
import { ColorSwatches } from './components/ColorSwatches';
import { FilamentSection } from './components/FilamentSection';
import { SettingsPanel } from './components/SettingsPanel';
import { Preview3D } from './components/Preview3D';
import { ZoomLens } from './components/ZoomLens';
import { StatusBar } from './components/StatusBar';

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

    if (isSvg) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const svgText = e.target!.result as string;
        const svgColors = parseSvgColors(svgText);

        const img = new Image();
        img.onload = () => {
          const meshMax = settings.maxWidth;
          // 2x oversample is enough for majority-voting in quantizeColors (scaleX >= 2)
          const renderW = Math.min(2048, Math.max(meshMax * 2, img.width || meshMax * 2));
          const renderH = img.height ? Math.round(renderW * (img.height / img.width)) : renderW;
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = renderW; srcCanvas.height = renderH;
          const ctx = srcCanvas.getContext('2d')!;
          ctx.clearRect(0, 0, renderW, renderH);
          ctx.drawImage(img, 0, 0, renderW, renderH);
          const data = ctx.getImageData(0, 0, renderW, renderH);

          // Downsample to ~512px for color counting — full-res isn't needed here
          const countW = Math.min(512, renderW);
          const countH = Math.round(countW * renderH / renderW);
          const countCanvas = document.createElement('canvas');
          countCanvas.width = countW; countCanvas.height = countH;
          countCanvas.getContext('2d')!.drawImage(srcCanvas, 0, 0, countW, countH);
          const countData = countCanvas.getContext('2d')!.getImageData(0, 0, countW, countH);

          const { palette: dominant, snappedCount } = consolidateSvgColors(svgColors, countData);
          setImgData(data);
          setHasAlpha(true);
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
          colorIndex: Uint8Array; palette: RGB[]; dist: Float32Array;
          BG_INDEX: number; tw: number; th: number; bgMask?: Uint8Array; bgCount: number;
        }>({
          type: 'pipeline', imgBuf, imgW: imgData.width, imgH: imgData.height,
          maxWidth: settings.maxWidth, numColors: settings.numColors,
          chamferWidth: settings.chamferWidth, removeBg: settings.removeBg,
          bgTolerance: settings.bgTolerance, smoothing: settings.smoothing,
          minRegion: settings.minRegion, isPick, manualPalette, hasAlpha, fileIsPng,
        }, [imgBuf]);
        if (pipelineSeqRef.current !== seq) return; // stale — newer request in flight
        setPipelineResult({ colorIndex: r.colorIndex, palette: r.palette, dist: r.dist, BG_INDEX: r.BG_INDEX, tw: r.tw, th: r.th });
        setBgPercent(r.bgMask ? (r.bgCount / r.bgMask.length) * 100 : 0);
      } catch (e: unknown) {
        if (pipelineSeqRef.current !== seq) return;
        setStatus(`Pipeline error: ${(e as Error).message}`, 'error');
        console.error('Pipeline error:', e);
      }
    }, 150);
    return () => { if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current); };
  }, [imgData, settings, manualPalette, hasAlpha, fileIsPng, setStatus, post]);

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
        heights: Float32Array; dx: number; dy: number; mirrorX: boolean; triCount: number;
      }>({ type: 'generate', imgBuf, imgW: imgData.width, imgH: imgData.height, settings, manualPalette, hasAlpha, fileIsPng }, [imgBuf]);
      const blob = new Blob([r.stlBuf], { type: 'application/octet-stream' });
      setStlBlob(blob);
      setMeshResult({ blob, triCount: r.triCount, tris: r.tris, colorIndex: r.colorIndex, palette: r.palette, BG_INDEX: r.BG_INDEX, gw: r.gw, gh: r.gh, modelW: r.modelW, modelH: r.modelH, heights: r.heights, dx: r.dx, dy: r.dy, mirrorX: r.mirrorX });
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
            <ColorSwatches
              palette={displayPalette}
              isPick={isPick}
              bgPercent={bgPercent}
              onRemove={handleRemovePalette}
            />
          </div>
        </div>
      )}

      <FilamentSection palette={displayPalette} />

      <SettingsPanel
        settings={settings}
        onChange={updateSetting}
        hasImage={!!imgData}
        aspectRatio={aspectRatio}
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
      </div>

      <StatusBar status={status} />

      <ZoomLens info={zoomLens} />
    </div>
  );
}
