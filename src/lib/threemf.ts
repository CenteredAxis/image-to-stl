import type { RGB, MeshResult, Settings } from '../types';
import { findClosestFilament } from './colorUtils';
import { getEffectiveDimensions } from './printerProfile';
import { buildZip } from './zip';

interface ColorPiece {
  colorIndex: number;
  color: RGB;
  name: string;
  vertices: number[];  // flat: x,y,z, x,y,z, ...
  triangles: number[]; // flat: v0,v1,v2, v0,v1,v2, ...
  pixelCount: number;
}

/**
 * Encode a string to UTF-8 bytes and push to a chunks array.
 * Avoids building one giant string for the entire XML.
 */
const enc = new TextEncoder();
function pushStr(chunks: Uint8Array[], s: string) {
  chunks.push(enc.encode(s));
}
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Builds a Bambu-compatible 3MF file from the combined mesh result.
 * Each color becomes a separate object with material assignment.
 * Uses chunked encoding to avoid string length limits on large meshes.
 */
export function build3MF(
  mesh: MeshResult,
  settings: Settings,
  fileName: string
): Blob {
  const { colorIndex, palette, BG_INDEX, gw, gh, heights } = mesh;
  const eff = getEffectiveDimensions(settings);
  const baseH = eff.baseHeight, surfaceH = eff.surfaceHeight;
  const { hollow, mirrorX, faceDown, fitClearance } = settings;
  const bottomZ = hollow ? baseH * 0.5 : 0;
  const totalH = baseH + surfaceH;
  const doWindingSwap = mirrorX !== faceDown;

  // Use offset vertices for fit clearance
  const vx = new Float32Array(mesh.vtxX);
  const vy = new Float32Array(mesh.vtxY);

  if (fitClearance > 0) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        const c = colorIndex[idx];
        if (c === BG_INDEX) continue;
        let isBoundary = false;
        let nx = 0, ny = 0;
        for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
          const ax = x + ddx, ay = y + ddy;
          if (ax < 0 || ax >= gw || ay < 0 || ay >= gh) { isBoundary = true; continue; }
          if (colorIndex[ay * gw + ax] !== c) { isBoundary = true; nx -= ddx; ny -= ddy; }
        }
        if (!isBoundary) continue;
        const len = Math.sqrt(nx * nx + ny * ny);
        if (len < 0.01) continue;
        vx[idx] += (nx / len) * fitClearance;
        vy[idx] += (ny / len) * fitClearance;
      }
    }
  }

  // Build cell ownership (same as per-color STL)
  const cellColorMask = new Uint8Array(gw * gh);
  {
    const visited = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      if (visited[i] || colorIndex[i] === BG_INDEX) continue;
      const color = colorIndex[i];
      const comp = [i]; visited[i] = 1;
      let head = 0;
      while (head < comp.length) {
        const idx = comp[head++];
        const cx = idx % gw, cy = (idx - cx) / gw;
        if (cx > 0 && !visited[idx-1] && colorIndex[idx-1] === color) { visited[idx-1]=1; comp.push(idx-1); }
        if (cx < gw-1 && !visited[idx+1] && colorIndex[idx+1] === color) { visited[idx+1]=1; comp.push(idx+1); }
        if (cy > 0 && !visited[idx-gw] && colorIndex[idx-gw] === color) { visited[idx-gw]=1; comp.push(idx-gw); }
        if (cy < gh-1 && !visited[idx+gw] && colorIndex[idx+gw] === color) { visited[idx+gw]=1; comp.push(idx+gw); }
      }
      if (comp.length >= Math.max(settings.minRegion, 10)) for (const idx of comp) cellColorMask[idx] = 1;
    }
  }

  const cellOwner = new Int16Array((gw-1) * (gh-1)).fill(-1);
  for (let y = 0; y < gh-1; y++) {
    for (let x = 0; x < gw-1; x++) {
      const i00=y*gw+x, i10=y*gw+x+1, i01=(y+1)*gw+x, i11=(y+1)*gw+x+1;
      const votes = new Map<number, number>();
      for (const v of [colorIndex[i00], colorIndex[i10], colorIndex[i01], colorIndex[i11]]) {
        if (v !== BG_INDEX) votes.set(v, (votes.get(v)||0)+1);
      }
      if (votes.size === 0) continue;
      let bestC = -1, bestV = 0;
      for (const [c, count] of votes) if (count > bestV) { bestV = count; bestC = c; }
      if (bestV < 2) continue;
      if (![i00,i10,i01,i11].some(v => colorIndex[v] === bestC && cellColorMask[v])) continue;
      cellOwner[y*(gw-1)+x] = bestC;
    }
  }

  // Build per-color mesh pieces
  const pieces: ColorPiece[] = [];
  const hv = (x: number, y: number) => heights[y * gw + x];

  for (let ci = 0; ci < palette.length; ci++) {
    if (ci === BG_INDEX) continue;
    const vertMap = new Map<string, number>();
    const verts: number[] = [];
    const tris: number[] = [];

    const addVert = (x: number, y: number, z: number): number => {
      const fz = faceDown ? totalH - z : z;
      const key = `${x.toFixed(4)},${y.toFixed(4)},${fz.toFixed(4)}`;
      let idx = vertMap.get(key);
      if (idx === undefined) { idx = verts.length / 3; vertMap.set(key, idx); verts.push(x, y, fz); }
      return idx;
    };

    const addTri = (ax: number, ay: number, az: number,
                    bx: number, by: number, bz: number,
                    cx: number, cy: number, cz: number) => {
      const a = addVert(ax, ay, az);
      const b = addVert(bx, by, bz);
      const c = addVert(cx, cy, cz);
      if (doWindingSwap) tris.push(a, c, b);
      else tris.push(a, b, c);
    };

    let pixelCount = 0;
    for (let i = 0; i < gw * gh; i++) if (colorIndex[i] === ci && cellColorMask[i]) pixelCount++;

    // Top + bottom + side faces (same as before)
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (cellOwner[y*(gw-1)+x] !== ci) continue;
        addTri(vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1));
        addTri(vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1), vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1));
      }
    }
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (cellOwner[y*(gw-1)+x] !== ci) continue;
        addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],bottomZ);
        addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ);
      }
    }
    const getCO = (x: number, y: number) => (x < 0 || x >= gw-1 || y < 0 || y >= gh-1) ? -1 : cellOwner[y*(gw-1)+x];
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (getCO(x,y) !== ci) continue;
        if (getCO(x-1,y) !== ci) {
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1));
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1), vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ);
        }
        if (getCO(x+1,y) !== ci) {
          addTri(vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1), vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y));
          addTri(vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1));
        }
        if (getCO(x,y-1) !== ci) {
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y), vx[y*gw+x],vy[y*gw+x],hv(x,y));
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y));
        }
        if (getCO(x,y+1) !== ci) {
          addTri(vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ, vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1));
          addTri(vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ);
        }
      }
    }

    if (tris.length === 0) continue;
    const name = findClosestFilament(palette[ci][0], palette[ci][1], palette[ci][2]).filament[3];
    pieces.push({ colorIndex: ci, color: palette[ci], name, vertices: verts, triangles: tris, pixelCount });
  }

  // Build 3MF XML as chunked Uint8Array to avoid string length limits
  const modelChunks: Uint8Array[] = [];

  // Header + materials (Bambu Studio compatible namespaces)
  pushStr(modelChunks, `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
  xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">BambuStudio</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="Title">${escapeXml(fileName)}</metadata>
  <resources>
    <basematerials id="1">
`);
  for (let i = 0; i < pieces.length; i++) {
    const [r, g, b] = pieces[i].color;
    const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    pushStr(modelChunks, `      <base name="${escapeXml(pieces[i].name)}" displaycolor="${hex}" />\n`);
  }
  pushStr(modelChunks, '    </basematerials>\n');

  // Objects — write vertices and triangles in small batches
  const BATCH = 5000;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const objId = i + 2;
    pushStr(modelChunks, `    <object id="${objId}" type="model" pid="1" pindex="${i}">\n      <mesh>\n        <vertices>\n`);

    // Write vertices in batches
    const vertCount = p.vertices.length / 3;
    for (let start = 0; start < vertCount; start += BATCH) {
      const end = Math.min(start + BATCH, vertCount);
      let batch = '';
      for (let v = start; v < end; v++) {
        const vi = v * 3;
        batch += `          <vertex x="${p.vertices[vi].toFixed(4)}" y="${p.vertices[vi+1].toFixed(4)}" z="${p.vertices[vi+2].toFixed(4)}" />\n`;
      }
      pushStr(modelChunks, batch);
    }

    pushStr(modelChunks, '        </vertices>\n        <triangles>\n');

    // Write triangles in batches
    const triCount = p.triangles.length / 3;
    for (let start = 0; start < triCount; start += BATCH) {
      const end = Math.min(start + BATCH, triCount);
      let batch = '';
      for (let t = start; t < end; t++) {
        const ti = t * 3;
        batch += `          <triangle v1="${p.triangles[ti]}" v2="${p.triangles[ti+1]}" v3="${p.triangles[ti+2]}" />\n`;
      }
      pushStr(modelChunks, batch);
    }

    pushStr(modelChunks, '        </triangles>\n      </mesh>\n    </object>\n');
  }

  pushStr(modelChunks, '  </resources>\n  <build>\n');
  for (let i = 0; i < pieces.length; i++) {
    pushStr(modelChunks, `    <item objectid="${i + 2}" />\n`);
  }
  pushStr(modelChunks, '  </build>\n</model>');

  // Concatenate model chunks into single Uint8Array
  const modelData = concatChunks(modelChunks);

  // Bambu model_settings.config — per-object settings with extruder assignments
  const modelSettingsChunks: Uint8Array[] = [];
  pushStr(modelSettingsChunks, `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n`);
  for (let i = 0; i < pieces.length; i++) {
    const objId = i + 2;
    pushStr(modelSettingsChunks, `  <object id="${objId}">\n`);
    pushStr(modelSettingsChunks, `    <metadata key="name" value="${escapeXml(pieces[i].name)}" />\n`);
    pushStr(modelSettingsChunks, `    <part id="${objId}" subtype="normal_part">\n`);
    pushStr(modelSettingsChunks, `      <metadata key="name" value="${escapeXml(pieces[i].name)}" />\n`);
    pushStr(modelSettingsChunks, `      <metadata key="extruder" value="${(i % 16) + 1}" />\n`);
    pushStr(modelSettingsChunks, `    </part>\n`);
    pushStr(modelSettingsChunks, `  </object>\n`);
  }
  // Plate config within model_settings
  pushStr(modelSettingsChunks, `  <plate>\n`);
  pushStr(modelSettingsChunks, `    <metadata key="plater_id" value="1" />\n`);
  pushStr(modelSettingsChunks, `    <metadata key="plater_name" value="" />\n`);
  for (let i = 0; i < pieces.length; i++) {
    pushStr(modelSettingsChunks, `    <metadata key="instance" value="${i + 2} 0" />\n`);
  }
  pushStr(modelSettingsChunks, `  </plate>\n`);
  pushStr(modelSettingsChunks, `</config>`);
  const modelSettingsData = concatChunks(modelSettingsChunks);

  // Bambu project_settings.config — minimal but required for native detection
  const projectSettings = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n</config>`);

  // Bambu slice_info.config — empty but expected
  const sliceInfo = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n</config>`);

  const contentTypes = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/xml" />
</Types>`);

  const rels = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`);

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: modelData },
    { name: 'Metadata/model_settings.config', data: modelSettingsData },
    { name: 'Metadata/project_settings.config', data: projectSettings },
    { name: 'Metadata/slice_info.config', data: sliceInfo },
  ]);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
