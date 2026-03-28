import { useEffect, useRef } from 'react';
import type { ZoomLensInfo } from '../types';

const LENS_SIZE = 140;

interface Props {
  info: ZoomLensInfo;
}

export function ZoomLens({ info }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !info.drawFn) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LENS_SIZE, LENS_SIZE);
    info.drawFn(ctx);
  }, [info]);

  if (!info.visible) return null;

  return (
    <div
      id="zoomLens"
      style={{
        display: 'block',
        left: info.screenX + 20,
        top: info.screenY - LENS_SIZE - 10,
        borderColor: info.borderColor,
      }}
    >
      <canvas ref={canvasRef} width={LENS_SIZE} height={LENS_SIZE} />
      <div id="zoomDot" />
      <div id="zoomColor">{info.colorLabel}</div>
    </div>
  );
}
