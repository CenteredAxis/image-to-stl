import type { RGB } from '../types';

interface Props {
  palette: RGB[];
  isPick: boolean;
  bgPercent: number;
  onRemove: (index: number) => void;
}

export function ColorSwatches({ palette, isPick, bgPercent, onRemove }: Props) {
  return (
    <div className="color-swatches">
      {palette.map((c, i) => (
        <div
          key={i}
          className="swatch"
          style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
          onClick={() => isPick && onRemove(i)}
          title={`rgb(${c[0]},${c[1]},${c[2]})`}
        >
          {isPick && <span className="remove-x">×</span>}
        </div>
      ))}
      {bgPercent > 0 && (
        <span className="bg-badge">{bgPercent.toFixed(0)}% BG removed</span>
      )}
    </div>
  );
}
