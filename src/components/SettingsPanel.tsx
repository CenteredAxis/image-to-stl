import type { Settings } from '../types';
import {
  NOZZLE_SIZES, getLayerHeightOptions, getEffectiveDimensions,
  computeChamferAngle, maxChamferDepthForAngle
} from '../lib/printerProfile';

interface Props {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  hasImage: boolean;
  aspectRatio: number;
  thinWallCount?: number;
  paletteCount?: number;
  onAutoMerge?: () => void;
}

function Slider({
  label, id, min, max, step, value, onChange, extra
}: {
  label: string; id: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; extra?: React.ReactNode;
}) {
  return (
    <div className="control-group">
      <label>
        {label} <span className="value">{value}</span>
      </label>
      <input
        type="range" id={id} min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      {extra}
    </div>
  );
}

function Checkbox({ id, label, checked, onChange }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="checkbox-group" style={{ marginTop: 4 }}>
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, hasImage, aspectRatio, thinWallCount, paletteCount, onAutoMerge }: Props) {
  const { maxWidth, numColors, surfaceHeight, baseHeight, chamferDepth, chamferWidth,
    smoothing, minRegion, modelWidth, bgTolerance, removeBg, cutThrough, hollow,
    mirrorX, faceDown, paletteMode, nozzleDiameter, layerHeight, snapToLayer,
    minFeatureRetention, amsSlots, fitClearance, mergeSmallPieces, detailSize } = settings;

  const eff = getEffectiveDimensions(settings);
  const layerOpts = getLayerHeightOptions(nozzleDiameter);
  const pixelSize = hasImage && maxWidth > 0 ? modelWidth / maxWidth : 0;
  const chamferAngle = pixelSize > 0 ? computeChamferAngle(eff.chamferDepth, chamferWidth, pixelSize) : 0;

  const angleColor = chamferAngle <= 45 ? '#4caf50' : chamferAngle <= 55 ? '#ff9800' : '#f44336';

  const sizeEstimate = () => {
    if (!hasImage || aspectRatio <= 0) return null;
    const w = maxWidth, h = Math.max(2, Math.round(w * aspectRatio));
    const totalCells = (w - 1) * (h - 1);
    const perimeter = 2 * (w + h);
    const boundaryBand = perimeter * chamferWidth * 2;
    const boundaryFrac = Math.min(0.5, boundaryBand / totalCells + 0.05);
    const boundaryCells = Math.round(totalCells * boundaryFrac);
    const mergedQuads = Math.round(totalCells * (1 - boundaryFrac) / 50);
    const topTris = (boundaryCells + mergedQuads) * 2;
    const bottomTris = Math.round(totalCells / 200) * 2;
    const sideTris = 2 * ((w - 1) + (h - 1)) * 2;
    const tris = topTris + bottomTris + sideTris;
    const mb = (84 + tris * 50) / (1024 * 1024);
    const noMergeMB = (84 + totalCells * 4 * 50 + sideTris * 50) / (1024 * 1024);
    const warn = mb > 300 ? ' -- may be slow' : '';
    return (
      <div style={{ fontSize: '0.7rem', color: mb > 300 ? '#f0a030' : '#666', marginTop: 4 }}>
        ~{mb.toFixed(0)} MB est. ({noMergeMB.toFixed(0)} MB without merging){warn}
      </div>
    );
  };

  const effLabel = (orig: number, snapped: number) => {
    if (!snapToLayer || orig === snapped) return null;
    return <span style={{ fontSize: '0.7rem', color: '#4a9eff', marginLeft: 4 }}>(eff: {snapped}mm)</span>;
  };

  return (
    <div className="controls">
      <div className="controls-grid">

        {/* ── Printer Profile ─────────────────────────────────── */}
        <div className="control-group" style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#4a9eff', marginBottom: 4 }}>Printer Profile</label>
        </div>

        <div className="control-group">
          <label>Nozzle Diameter (mm)</label>
          <select value={nozzleDiameter} onChange={e => {
            const nozzle = parseFloat(e.target.value);
            onChange('nozzleDiameter', nozzle);
            const opts = getLayerHeightOptions(nozzle);
            if (!opts.includes(layerHeight)) onChange('layerHeight', opts[Math.floor(opts.length / 2)]);
          }}>
            {NOZZLE_SIZES.map(n => <option key={n} value={n}>{n}mm</option>)}
          </select>
        </div>

        <div className="control-group">
          <label>Layer Height (mm)</label>
          <select value={layerHeight} onChange={e => onChange('layerHeight', parseFloat(e.target.value))}>
            {layerOpts.map(h => <option key={h} value={h}>{h}mm</option>)}
          </select>
        </div>

        <Checkbox id="snapToLayer" label="Snap Z dimensions to layer height" checked={snapToLayer} onChange={v => onChange('snapToLayer', v)} />

        <div className="control-group">
          <label>AMS Configuration</label>
          <select value={amsSlots} onChange={e => onChange('amsSlots', parseInt(e.target.value))}>
            <option value={0}>No limit</option>
            <option value={4}>Bambu AMS (4 slots)</option>
            <option value={8}>Bambu AMS x2 (8 slots)</option>
            <option value={16}>Bambu AMS x4 (16 slots)</option>
          </select>
        </div>

        {amsSlots > 0 && paletteCount !== undefined && paletteCount > amsSlots && onAutoMerge && (
          <div className="control-group" style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '0.75rem', color: '#ff9800', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{paletteCount} colors exceed {amsSlots} AMS slots</span>
              <button
                style={{ fontSize: '0.7rem', padding: '2px 10px', background: '#333', color: '#4a9eff', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
                onClick={onAutoMerge}
              >
                Auto-merge to {amsSlots}
              </button>
            </div>
          </div>
        )}

        {thinWallCount !== undefined && thinWallCount > 0 && (
          <div style={{ gridColumn: '1 / -1', fontSize: '0.75rem', color: '#ff9800', padding: '4px 0' }}>
            Wall thickness warning: {thinWallCount.toLocaleString()} pixels thinner than {(nozzleDiameter * 1.5).toFixed(1)}mm
          </div>
        )}

        {/* ── Resolution & Palette ──────────────────────────── */}
        <div className="control-group" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#4a9eff', marginBottom: 4 }}>Resolution & Palette</label>
        </div>

        <Slider label="Resolution (vertices)" id="maxWidth" min={64} max={4096} step={32}
          value={maxWidth} onChange={v => onChange('maxWidth', v)} extra={sizeEstimate()} />

        <div className="control-group">
          <label>Palette Mode</label>
          <select
            value={paletteMode}
            onChange={e => onChange('paletteMode', e.target.value as 'pick' | 'auto')}
          >
            <option value="pick">Click to pick from image</option>
            <option value="auto">Auto-detect</option>
          </select>
        </div>

        {paletteMode === 'auto' && (
          <Slider label="Colors" id="numColors" min={2} max={24} step={1}
            value={numColors} onChange={v => onChange('numColors', v)} />
        )}

        {/* ── Geometry ──────────────────────────────────────── */}
        <div className="control-group" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#4a9eff', marginBottom: 4 }}>Geometry</label>
        </div>

        <Slider label="Surface Height (mm)" id="surfaceHeight" min={1} max={30} step={0.5}
          value={surfaceHeight} onChange={v => onChange('surfaceHeight', v)}
          extra={effLabel(surfaceHeight, eff.surfaceHeight)} />
        <Slider label="Base Thickness (mm)" id="baseHeight" min={0.5} max={10} step={0.5}
          value={baseHeight} onChange={v => onChange('baseHeight', v)}
          extra={effLabel(baseHeight, eff.baseHeight)} />
        <Slider label="Chamfer Depth (mm)" id="chamferDepth" min={0.1} max={10} step={0.1}
          value={chamferDepth} onChange={v => onChange('chamferDepth', v)}
          extra={effLabel(chamferDepth, eff.chamferDepth)} />
        <Slider label="Chamfer Width (px)" id="chamferWidth" min={1} max={16} step={1}
          value={chamferWidth} onChange={v => onChange('chamferWidth', v)} />

        {hasImage && pixelSize > 0 && (
          <div className="control-group" style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '0.75rem', color: angleColor, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Chamfer angle: {chamferAngle.toFixed(1)} deg</span>
              {chamferAngle > 45 && (
                <>
                  <span style={{ color: '#ff9800' }}>-- supports may be needed</span>
                  <button
                    style={{ fontSize: '0.7rem', padding: '2px 8px', background: '#333', color: '#4a9eff', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
                    onClick={() => {
                      const maxD = maxChamferDepthForAngle(chamferWidth, pixelSize, 45);
                      onChange('chamferDepth', Math.max(0.1, Math.round(maxD * 10) / 10));
                    }}
                  >
                    Auto-clamp to 45 deg
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <Slider label="Feature Retention (%)" id="minFeatureRetention" min={0} max={100} step={5}
          value={Math.round(minFeatureRetention * 100)}
          onChange={v => onChange('minFeatureRetention', v / 100)}
          extra={<span style={{ fontSize: '0.65rem', color: '#888' }}>Preserves thin features from chamfer erosion</span>} />

        <Slider label="Smoothing" id="smoothing" min={0} max={3} step={0.1}
          value={smoothing} onChange={v => onChange('smoothing', v)} />
        <Slider label="Min Region (px)" id="minRegion" min={0} max={200} step={5}
          value={minRegion} onChange={v => onChange('minRegion', v)} />
        <Slider label="Model Width (mm)" id="modelWidth" min={20} max={300} step={5}
          value={modelWidth} onChange={v => onChange('modelWidth', v)} />
        <Slider label="BG Tolerance" id="bgTolerance" min={0} max={120} step={2}
          value={bgTolerance} onChange={v => onChange('bgTolerance', v)} />

        {/* ── Assembly (Per-Color Export) ─────────────────── */}
        <div className="control-group" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#4a9eff', marginBottom: 4 }}>Assembly (Per-Color Export)</label>
        </div>

        <Slider label="Fit Clearance (mm)" id="fitClearance" min={0} max={0.3} step={0.01}
          value={fitClearance} onChange={v => onChange('fitClearance', v)}
          extra={<span style={{ fontSize: '0.65rem', color: '#888' }}>Gap between pieces for easier snap-together assembly. Set to 0 for AMS multi-color (no gap needed).</span>} />
        <Slider label="Min Manual Piece (px)" id="mergeSmallPieces" min={0} max={500} step={10}
          value={mergeSmallPieces} onChange={v => onChange('mergeSmallPieces', v)}
          extra={<span style={{ fontSize: '0.65rem', color: '#888' }}>For manual assembly only: regions below this size are merged into neighbors. Leave at 0 for AMS multi-color printing.</span>} />

        {/* ── Options ──────────────────────────────────────── */}
        <div className="control-group">
          <Checkbox id="removeBg" label="Remove background" checked={removeBg} onChange={v => onChange('removeBg', v)} />
          <Checkbox id="cutThrough" label="Cut through base (no floor under BG)" checked={cutThrough} onChange={v => onChange('cutThrough', v)} />
          <Checkbox id="hollow" label="Hollow base (save material)" checked={hollow} onChange={v => onChange('hollow', v)} />
          <Checkbox id="mirrorX" label="Mirror X (flip left-right)" checked={mirrorX} onChange={v => onChange('mirrorX', v)} />
          <Checkbox id="faceDown" label="Print face-down (chamfer on bed side — best surface quality)" checked={faceDown} onChange={v => onChange('faceDown', v)} />
        </div>
      </div>
    </div>
  );
}
