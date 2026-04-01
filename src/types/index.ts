export type RGB = [number, number, number];

// [r, g, b, name, brand, material, searchUrl]
export type FilamentEntry = [number, number, number, string, string, string, string];

export interface FilamentMatch {
  filament: FilamentEntry;
  deltaE: number;
}

export interface PipelineResult {
  colorIndex: Uint8Array;
  palette: RGB[];
  dist: Float32Array;
  BG_INDEX: number;
  tw: number;
  th: number;
}

export interface MeshResult {
  blob: Blob;
  triCount: number;
  tris: Float32Array;
  colorIndex: Uint8Array;
  palette: RGB[];
  BG_INDEX: number;
  gw: number;
  gh: number;
  modelW: number;
  modelH: number;
  heights: Float32Array;
  dx: number;
  dy: number;
  mirrorX: boolean;
}

export interface Settings {
  maxWidth: number;
  numColors: number;
  surfaceHeight: number;
  baseHeight: number;
  chamferDepth: number;
  chamferWidth: number;
  smoothing: number;
  minRegion: number;
  modelWidth: number;
  bgTolerance: number;
  removeBg: boolean;
  cutThrough: boolean;
  hollow: boolean;
  mirrorX: boolean;
  faceDown: boolean;
  highlightSmall: boolean;
  paletteMode: 'pick' | 'auto';
}

export interface ImageState {
  imgData: ImageData | null;
  fileName: string;
  fileIsPng: boolean;
  fileIsSvg: boolean;
  hasAlpha: boolean;
  manualPalette: RGB[];
}

export interface ZoomLensInfo {
  visible: boolean;
  screenX: number;
  screenY: number;
  colorLabel: string;
  borderColor: string;
  drawFn: ((ctx: CanvasRenderingContext2D) => void) | null;
}

export type StatusVariant = 'working' | 'done' | 'error' | '';

export interface StatusState {
  message: string;
  variant: StatusVariant;
}
