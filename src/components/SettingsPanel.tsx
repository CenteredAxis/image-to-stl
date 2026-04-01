import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  hasImage: boolean;
  aspectRatio: number;
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

export function SettingsPanel({ settings, onChange, hasImage, aspectRatio }: Props) {
  const { maxWidth, numColors, surfaceHeight, baseHeight, chamferDepth, chamferWidth,
    smoothing, minRegion, modelWidth, bgTolerance, removeBg, cutThrough, hollow,
    mirrorX, faceDown, paletteMode } = settings;

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
    const warn = mb > 300 ? ' ⚠️ may be slow' : '';
    return (
      <div style={{ fontSize: '0.7rem', color: mb > 300 ? '#f0a030' : '#666', marginTop: 4 }}>
        ~{mb.toFixed(0)} MB est. ({noMergeMB.toFixed(0)} MB without merging){warn}
      </div>
    );
  };

  return (
    <div className="controls">
      <div className="controls-grid">
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

        <Slider label="Surface Height (mm)" id="surfaceHeight" min={1} max={30} step={0.5}
          value={surfaceHeight} onChange={v => onChange('surfaceHeight', v)} />
        <Slider label="Base Thickness (mm)" id="baseHeight" min={0.5} max={10} step={0.5}
          value={baseHeight} onChange={v => onChange('baseHeight', v)} />
        <Slider label="Chamfer Depth (mm)" id="chamferDepth" min={0.5} max={10} step={0.25}
          value={chamferDepth} onChange={v => onChange('chamferDepth', v)} />
        <Slider label="Chamfer Width (px)" id="chamferWidth" min={1} max={16} step={1}
          value={chamferWidth} onChange={v => onChange('chamferWidth', v)} />
        <Slider label="Smoothing" id="smoothing" min={0} max={3} step={0.1}
          value={smoothing} onChange={v => onChange('smoothing', v)} />
        <Slider label="Min Region (px)" id="minRegion" min={0} max={200} step={5}
          value={minRegion} onChange={v => onChange('minRegion', v)} />
        <Slider label="Model Width (mm)" id="modelWidth" min={20} max={300} step={5}
          value={modelWidth} onChange={v => onChange('modelWidth', v)} />
        <Slider label="BG Tolerance" id="bgTolerance" min={0} max={120} step={2}
          value={bgTolerance} onChange={v => onChange('bgTolerance', v)} />

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
