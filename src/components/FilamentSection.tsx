import type { RGB } from '../types';
import { findClosestFilament } from '../lib/colorUtils';

interface Props {
  palette: RGB[];
  amsSlots?: number;
}

export function FilamentSection({ palette, amsSlots = 0 }: Props) {
  if (palette.length === 0) return null;

  const showSlots = amsSlots > 0;
  const overLimit = showSlots && palette.length > amsSlots;

  return (
    <div className="controls" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '0.85rem', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {showSlots ? `AMS Slot Assignments (${palette.length}/${amsSlots})` : 'Closest 3D Print Filaments'}
      </h3>
      {overLimit && (
        <div style={{ fontSize: '0.75rem', color: '#f44336', marginBottom: 8, padding: '4px 8px', background: '#2a1a1a', borderRadius: 4 }}>
          {palette.length} colors exceed {amsSlots} AMS slots. Use auto-merge or remove colors.
        </div>
      )}
      <div className="filament-matches">
        {palette.map((c, i) => {
          const { filament, deltaE } = findClosestFilament(c[0], c[1], c[2]);
          const [fr, fg, fb, fName, fBrand, fMaterial, fUrl] = filament;
          const quality = deltaE < 5 ? '✅' : deltaE < 15 ? '🟡' : '🟠';
          return (
            <div key={i} className="filament-row">
              {showSlots && (
                <span style={{ fontSize: '0.7rem', color: '#4a9eff', minWidth: 36, fontWeight: 600 }}>
                  Slot {i + 1}
                </span>
              )}
              <div className="f-swatch" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
              <span className="f-arrow">→</span>
              <div className="f-match" style={{ background: `rgb(${fr},${fg},${fb})` }} />
              <span className="f-name">{fName}</span>
              <span className="f-brand">{fBrand} {fMaterial}</span>
              <span className="f-delta">{quality} ΔE {deltaE.toFixed(1)}</span>
              {fUrl && (
                <a href={fUrl} target="_blank" rel="noreferrer" title={`Search for ${fBrand} ${fName}`}>
                  Find
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
