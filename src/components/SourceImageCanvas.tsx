import { useEffect, useRef, useCallback } from 'react';
import type { ZoomLensInfo } from '../types';

const ZOOM_LEVEL = 8;
const LENS_SIZE = 140;

interface Props {
  imgData: ImageData | null;
  isPick: boolean;
  onColorPick: (r: number, g: number, b: number) => void;
  onZoom: (info: ZoomLensInfo) => void;
  onZoomHide: () => void;
}

export function SourceImageCanvas({ imgData, isPick, onColorPick, onZoom, onZoomHide }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!imgData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(imgData, 0, 0);
  }, [imgData]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPick || !imgData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = imgData.width / rect.width;
    const scaleY = imgData.height / rect.height;
    const px = Math.round((e.clientX - rect.left) * scaleX);
    const py = Math.round((e.clientY - rect.top) * scaleY);
    const i = (py * imgData.width + px) * 4;
    onColorPick(imgData.data[i], imgData.data[i + 1], imgData.data[i + 2]);
  }, [isPick, imgData, onColorPick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imgData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = imgData.width / rect.width;
    const scaleY = imgData.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const halfPx = LENS_SIZE / ZOOM_LEVEL / 2;

    const ix = Math.round(px), iy = Math.round(py);
    let colorLabel = '';
    let borderColor = '#4a9eff';
    if (ix >= 0 && ix < imgData.width && iy >= 0 && iy < imgData.height) {
      const i = (iy * imgData.width + ix) * 4;
      const r = imgData.data[i], g = imgData.data[i + 1], b = imgData.data[i + 2];
      colorLabel = `rgb(${r},${g},${b})`;
      borderColor = `rgb(${r},${g},${b})`;
    }

    onZoom({
      visible: true,
      screenX: e.clientX,
      screenY: e.clientY,
      colorLabel,
      borderColor,
      drawFn: (ctx) => {
        ctx.drawImage(
          canvas,
          px - halfPx * scaleX, py - halfPx * scaleY,
          (LENS_SIZE / ZOOM_LEVEL) * scaleX, (LENS_SIZE / ZOOM_LEVEL) * scaleY,
          0, 0, LENS_SIZE, LENS_SIZE
        );
      },
    });
  }, [imgData, onZoom]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', cursor: isPick ? 'crosshair' : 'default' }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={onZoomHide}
    />
  );
}
