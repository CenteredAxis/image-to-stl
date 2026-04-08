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
 * Builds a Bambu-compatible 3MF file from the combined mesh result.
 * Each color becomes a separate object with material assignment.
 * Small pieces (below mergeSmallPieces threshold) are grouped with
 * their largest neighboring color for multi-color AMS printing.
 */
export function build3MF(
  mesh: MeshResult,
  settings: Settings,
  fileName: string
): Blob {
  const { colorIndex, palette, BG_INDEX, gw, gh, heights } = mesh;
  const eff = getEffectiveDimensions(settings);
  const baseH = eff.baseHeight, surfaceH = eff.surfaceHeight;
  const { hollow, mirrorX, faceDown, fitClearance, mergeSmallPieces } = settings;
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

  // Connected component analysis for grouping
  const componentLabel = new Int32Array(gw * gh).fill(-1);
  const componentColor: number[] = [];
  const componentSize: number[] = [];
  let nextLabel = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (componentLabel[i] >= 0 || colorIndex[i] === BG_INDEX) continue;
    const color = colorIndex[i];
    const label = nextLabel++;
    const comp = [i];
    componentLabel[i] = label;
    let head = 0;
    while (head < comp.length) {
      const idx = comp[head++];
      const cx = idx % gw, cy = (idx - cx) / gw;
      for (const ni of [cx > 0 ? idx-1 : -1, cx < gw-1 ? idx+1 : -1,
                        cy > 0 ? idx-gw : -1, cy < gh-1 ? idx+gw : -1]) {
        if (ni >= 0 && componentLabel[ni] < 0 && colorIndex[ni] === color) {
          componentLabel[ni] = label;
          comp.push(ni);
        }
      }
    }
    componentColor.push(color);
    componentSize.push(comp.length);
  }

  // Determine grouping: small components get grouped with their largest neighbor
  // groupId maps each component label to a "print group" id
  const groupId = new Int32Array(nextLabel);
  let nextGroup = 0;
  // First pass: assign groups to large components
  const compGroupMap = new Map<number, number>(); // component label -> group
  for (let l = 0; l < nextLabel; l++) {
    if (componentSize[l] >= mergeSmallPieces || mergeSmallPieces === 0) {
      const g = nextGroup++;
      groupId[l] = g;
      compGroupMap.set(l, g);
    } else {
      groupId[l] = -1; // unassigned
    }
  }

  // Second pass: assign small components to their largest neighbor's group
  if (mergeSmallPieces > 0) {
    for (let l = 0; l < nextLabel; l++) {
      if (groupId[l] >= 0) continue;
      // Find the largest neighboring component
      const neighborVotes = new Map<number, number>();
      for (let i = 0; i < gw * gh; i++) {
        if (componentLabel[i] !== l) continue;
        const cx = i % gw, cy = (i - cx) / gw;
        for (const ni of [cx > 0 ? i-1 : -1, cx < gw-1 ? i+1 : -1,
                          cy > 0 ? i-gw : -1, cy < gh-1 ? i+gw : -1]) {
          if (ni >= 0 && componentLabel[ni] !== l && componentLabel[ni] >= 0) {
            const nl = componentLabel[ni];
            neighborVotes.set(nl, (neighborVotes.get(nl) || 0) + 1);
          }
        }
      }
      let bestNeighbor = -1, bestCount = 0;
      for (const [nl, count] of neighborVotes) {
        if (count > bestCount) { bestCount = count; bestNeighbor = nl; }
      }
      if (bestNeighbor >= 0 && groupId[bestNeighbor] >= 0) {
        groupId[l] = groupId[bestNeighbor];
      } else {
        // No large neighbor found, give it its own group
        groupId[l] = nextGroup++;
      }
    }
  }

  // Build per-color meshes (using cell ownership like per-color STL)
  const cellOwner = new Int16Array((gw-1) * (gh-1)).fill(-1);
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

  // Build pieces - one per color
  const pieces: ColorPiece[] = [];
  const hv = (x: number, y: number) => heights[y * gw + x];

  for (let ci = 0; ci < palette.length; ci++) {
    if (ci === BG_INDEX) continue;
    const vertMap = new Map<string, number>();
    const verts: number[] = [];
    const tris: number[] = [];

    const addVert = (x: number, y: number, z: number): number => {
      // Apply faceDown
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

    // Top faces
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (cellOwner[y*(gw-1)+x] !== ci) continue;
        addTri(vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1));
        addTri(vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1), vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1));
      }
    }
    // Bottom faces
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (cellOwner[y*(gw-1)+x] !== ci) continue;
        addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],bottomZ);
        addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ);
      }
    }
    // Side walls (simplified - emit where this color borders a different owner)
    const getCO = (x: number, y: number) => (x < 0 || x >= gw-1 || y < 0 || y >= gh-1) ? -1 : cellOwner[y*(gw-1)+x];
    for (let y = 0; y < gh-1; y++) {
      for (let x = 0; x < gw-1; x++) {
        if (getCO(x,y) !== ci) continue;
        // Left wall
        if (getCO(x-1,y) !== ci) {
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x],vy[y*gw+x],hv(x,y), vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1));
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[(y+1)*gw+x],vy[(y+1)*gw+x],hv(x,y+1), vx[(y+1)*gw+x],vy[(y+1)*gw+x],bottomZ);
        }
        // Right wall
        if (getCO(x+1,y) !== ci) {
          addTri(vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1), vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y));
          addTri(vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],bottomZ, vx[(y+1)*gw+x+1],vy[(y+1)*gw+x+1],hv(x+1,y+1));
        }
        // Front wall
        if (getCO(x,y-1) !== ci) {
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y), vx[y*gw+x],vy[y*gw+x],hv(x,y));
          addTri(vx[y*gw+x],vy[y*gw+x],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],bottomZ, vx[y*gw+x+1],vy[y*gw+x+1],hv(x+1,y));
        }
        // Back wall
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

  // Build 3MF XML
  const materials = pieces.map((p, i) => {
    const [r, g, b] = p.color;
    const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    return `      <base name="${escapeXml(p.name)}" displaycolor="${hex}" />`;
  }).join('\n');

  let objectsXml = '';
  let buildXml = '';
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const objId = i + 2; // id=1 is basematerials
    const vertXml = [];
    for (let v = 0; v < p.vertices.length; v += 3) {
      vertXml.push(`          <vertex x="${p.vertices[v].toFixed(4)}" y="${p.vertices[v+1].toFixed(4)}" z="${p.vertices[v+2].toFixed(4)}" />`);
    }
    const triXml = [];
    for (let t = 0; t < p.triangles.length; t += 3) {
      triXml.push(`          <triangle v1="${p.triangles[t]}" v2="${p.triangles[t+1]}" v3="${p.triangles[t+2]}" />`);
    }
    objectsXml += `    <object id="${objId}" type="model" pid="1" pindex="${i}">
      <mesh>
        <vertices>
${vertXml.join('\n')}
        </vertices>
        <triangles>
${triXml.join('\n')}
        </triangles>
      </mesh>
    </object>\n`;
    buildXml += `    <item objectid="${objId}" />\n`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">Image-to-STL</metadata>
  <metadata name="Title">${escapeXml(fileName)}</metadata>
  <resources>
    <basematerials id="1">
${materials}
    </basematerials>
${objectsXml}  </resources>
  <build>
${buildXml}  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const enc = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml) },
  ];

  return buildZip(files);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
