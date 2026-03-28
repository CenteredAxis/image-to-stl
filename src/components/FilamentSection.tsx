import type { RGB } from '../types';
import { findClosestFilament } from '../lib/colorUtils';

interface Props {
  palette: RGB[];
}

export function FilamentSection({ palette }: Props) {
  if (palette.length === 0) return null;

  return (
    <div className="controls" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '0.85rem', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Closest 3D Print Filaments
      </h3>
      <div className="filament-matches">
        {palette.map((c, i) => {
          const { filament, deltaE } = findClosestFilament(c[0], c[1], c[2]);
          const [fr, fg, fb, fName, fBrand, fMaterial, fUrl] = filament;
          const quality = deltaE < 5 ? '✅' : deltaE < 15 ? '🟡' : '🟠';
          return (
            <div key={i} className="filament-row">
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
