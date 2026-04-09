import type { RGB } from '../types';

const NAMED_COLORS: Record<string, string> = {
  black:'#000000',white:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',
  yellow:'#ffff00',orange:'#ffa500',purple:'#800080',pink:'#ffc0cb',gray:'#808080',
  grey:'#808080',cyan:'#00ffff',magenta:'#ff00ff',brown:'#a52a2a',navy:'#000080',
  teal:'#008080',maroon:'#800000',olive:'#808000',lime:'#00ff00',aqua:'#00ffff',
  silver:'#c0c0c0',gold:'#ffd700',coral:'#ff7f50',salmon:'#fa8072',khaki:'#f0e68c',
  indigo:'#4b0082',violet:'#ee82ee',crimson:'#dc143c',tomato:'#ff6347',tan:'#d2b48c',
  sienna:'#a0522d',peru:'#cd853f',orchid:'#da70d6',plum:'#dda0dd',beige:'#f5f5dc',
  ivory:'#fffff0',lavender:'#e6e6fa',linen:'#faf0e6',wheat:'#f5deb3',steelblue:'#4682b4',
  darkblue:'#00008b',darkgreen:'#006400',darkred:'#8b0000',darkorange:'#ff8c00',
  darkcyan:'#008b8b',darkmagenta:'#8b008b',darkviolet:'#9400d3',deeppink:'#ff1493',
  deepskyblue:'#00bfff',dodgerblue:'#1e90ff',firebrick:'#b22222',forestgreen:'#228b22',
  hotpink:'#ff69b4',indianred:'#cd5c5c',lightblue:'#add8e6',lightcoral:'#f08080',
  lightgreen:'#90ee90',lightyellow:'#ffffe0',midnightblue:'#191970',royalblue:'#4169e1',
  saddlebrown:'#8b4513',slategray:'#708090',springgreen:'#00ff7f',turquoise:'#40e0d0',
};

function hexToRgb(hex: string): RGB | null {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length !== 6) return null;
  const n = parseInt(hex, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseColor(str: string): RGB | null {
  if (!str || str === 'none' || str === 'transparent' || str === 'currentColor') return null;
  str = str.trim().toLowerCase();
  if (str.startsWith('url(')) return null;
  if (str.startsWith('#')) return hexToRgb(str);
  const rgbMatch = str.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
  if (NAMED_COLORS[str]) return hexToRgb(NAMED_COLORS[str])!;
  return null;
}

export function parseSvgColors(svgText: string): RGB[] {
  const colors = new Map<string, RGB>();

  const add = (str: string) => {
    const rgb = parseColor(str);
    if (rgb) {
      const key = rgb.join(',');
      if (!colors.has(key)) colors.set(key, rgb);
    }
  };

  let match: RegExpExecArray | null;

  const attrRegex = /(?:fill|stroke)\s*=\s*"([^"]+)"/gi;
  while ((match = attrRegex.exec(svgText)) !== null) add(match[1]);

  const styleRegex = /(?:fill|stroke)\s*:\s*([^;}"]+)/gi;
  while ((match = styleRegex.exec(svgText)) !== null) add(match[1]);

  const cssRegex = /(?:fill|stroke|background(?:-color)?|color)\s*:\s*([^;}"]+)/gi;
  while ((match = cssRegex.exec(svgText)) !== null) add(match[1]);

  const stopRegex = /stop-color\s*[:=]\s*"?([^;"]+)/gi;
  while ((match = stopRegex.exec(svgText)) !== null) add(match[1]);

  return [...colors.values()];
}

export function consolidateSvgColors(
  svgColorList: RGB[],
  imageData: ImageData
): { palette: RGB[]; snappedCount: number } {
  if (!svgColorList || svgColorList.length === 0) return { palette: [], snappedCount: 0 };

  const pixels = imageData.data;
  const totalPx = imageData.width * imageData.height;
  const counts = new Uint32Array(svgColorList.length);

  for (let i = 0; i < totalPx; i++) {
    const si = i * 4;
    if (pixels[si + 3] < 128) continue;
    const pr = pixels[si], pg = pixels[si + 1], pb = pixels[si + 2];
    let bestD = Infinity, bestP = 0;
    for (let p = 0; p < svgColorList.length; p++) {
      const dr = pr - svgColorList[p][0];
      const dg = pg - svgColorList[p][1];
      const db = pb - svgColorList[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestP = p; }
    }
    counts[bestP]++;
  }

  const indexed = svgColorList.map((color, i) => ({ color, count: counts[i] }));
  indexed.sort((a, b) => b.count - a.count);

  const opaquePx = counts.reduce((a, b) => a + b, 0);
  const threshold = opaquePx * 0.005;
  const dominant: RGB[] = [];
  const artifacts: typeof indexed = [];

  for (const entry of indexed) {
    if (entry.count >= threshold && entry.count > 0) {
      dominant.push(entry.color);
    } else if (entry.count > 0) {
      artifacts.push(entry);
    }
  }

  // Merge perceptually similar dominant colors (e.g. multiple near-blacks → one black)
  const mergeDist = 15 * 15 * 3; // RGB Euclidean² threshold (~15 per channel)
  const merged: RGB[] = [];
  const used = new Uint8Array(dominant.length);
  for (let i = 0; i < dominant.length; i++) {
    if (used[i]) continue;
    let bestR = dominant[i][0], bestG = dominant[i][1], bestB = dominant[i][2];
    // Keep the darkest/most saturated representative (most distinct)
    for (let j = i + 1; j < dominant.length; j++) {
      if (used[j]) continue;
      const dr = dominant[i][0] - dominant[j][0];
      const dg = dominant[i][1] - dominant[j][1];
      const db = dominant[i][2] - dominant[j][2];
      if (dr * dr + dg * dg + db * db < mergeDist) {
        used[j] = 1;
        // Pick the more extreme (darker or more saturated) of the two
        const lumI = bestR * 0.299 + bestG * 0.587 + bestB * 0.114;
        const lumJ = dominant[j][0] * 0.299 + dominant[j][1] * 0.587 + dominant[j][2] * 0.114;
        if (lumJ < lumI) {
          // j is darker — use it as the representative
          bestR = dominant[j][0]; bestG = dominant[j][1]; bestB = dominant[j][2];
        }
      }
    }
    merged.push([bestR, bestG, bestB]);
  }

  return { palette: merged, snappedCount: artifacts.length + (dominant.length - merged.length) };
}
