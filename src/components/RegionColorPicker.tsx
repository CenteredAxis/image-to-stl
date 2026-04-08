import type { RGB } from '../types';

interface Props {
  currentColor: RGB;
  palette: RGB[];
  onReassign: (newColorIndex: number) => void;
  onClose: () => void;
}

export function RegionColorPicker({ currentColor, palette, onReassign, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#1a1a1a', borderRadius: 12, padding: 20, minWidth: 240,
        border: '1px solid #333', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>
        <h4 style={{ margin: '0 0 12px', color: '#e0e0e0', fontSize: '0.9rem' }}>
          Reassign Region Color
        </h4>

        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: '0.75rem', color: '#888' }}>Current:</span>
          <div style={{
            display: 'inline-block', width: 24, height: 24, borderRadius: 4,
            background: `rgb(${currentColor[0]},${currentColor[1]},${currentColor[2]})`,
            border: '2px solid #555', verticalAlign: 'middle', marginLeft: 8,
          }} />
        </div>

        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>Select new color:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {palette.map((c, i) => {
            const isCurrent = c[0] === currentColor[0] && c[1] === currentColor[1] && c[2] === currentColor[2];
            return (
              <div
                key={i}
                title={`rgb(${c[0]}, ${c[1]}, ${c[2]})`}
                style={{
                  width: 32, height: 32, borderRadius: 6, cursor: isCurrent ? 'default' : 'pointer',
                  background: `rgb(${c[0]},${c[1]},${c[2]})`,
                  border: isCurrent ? '3px solid #4a9eff' : '2px solid #555',
                  opacity: isCurrent ? 0.5 : 1,
                  transition: 'transform 0.1s',
                }}
                onClick={() => { if (!isCurrent) onReassign(i); }}
                onMouseEnter={e => { if (!isCurrent) (e.target as HTMLElement).style.transform = 'scale(1.15)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.transform = ''; }}
              />
            );
          })}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '6px 12px',
            background: '#333', color: '#aaa', border: '1px solid #555',
            borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
