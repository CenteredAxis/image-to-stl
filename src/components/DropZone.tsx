import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
}

export function DropZone({ onFile }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div
      className={`drop-zone${dragOver ? ' drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <p><strong>Click or drop</strong> an image here</p>
      <p style={{ marginTop: 8, fontSize: '0.8rem' }}>PNG, JPG, BMP, WebP, <strong>SVG</strong></p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}
