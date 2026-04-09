/**
 * Removes degenerate triangles (near-zero area) from a flat triangle array.
 * Each triangle is 9 values: ax, ay, az, bx, by, bz, cx, cy, cz.
 * Returns the filtered array.
 */
export function filterDegenerateTris(tris: number[]): number[] {
  const EPSILON = 1e-10;
  let writeIdx = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
    const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz > EPSILON) {
      if (writeIdx !== t) {
        tris[writeIdx] = ax; tris[writeIdx+1] = ay; tris[writeIdx+2] = az;
        tris[writeIdx+3] = bx; tris[writeIdx+4] = by; tris[writeIdx+5] = bz;
        tris[writeIdx+6] = cx; tris[writeIdx+7] = cy; tris[writeIdx+8] = cz;
      }
      writeIdx += 9;
    }
  }
  tris.length = writeIdx;
  return tris;
}

/**
 * Checks if an STL binary buffer represents a manifold mesh.
 * Returns the number of open (boundary) edges and non-manifold edges.
 */
export function checkManifold(stlBuf: ArrayBuffer): {
  isManifold: boolean;
  openEdges: number;
  nonManifoldEdges: number;
} {
  const view = new DataView(stlBuf);
  const triCount = view.getUint32(80, true);
  const edgeCount = new Map<string, number>();

  const edgeKey = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): string => {
    // Canonical order: smaller vertex first
    if (x1 < x2 || (x1 === x2 && y1 < y2) || (x1 === x2 && y1 === y2 && z1 < z2)) {
      return `${x1.toFixed(4)},${y1.toFixed(4)},${z1.toFixed(4)}-${x2.toFixed(4)},${y2.toFixed(4)},${z2.toFixed(4)}`;
    }
    return `${x2.toFixed(4)},${y2.toFixed(4)},${z2.toFixed(4)}-${x1.toFixed(4)},${y1.toFixed(4)},${z1.toFixed(4)}`;
  };

  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50 + 12; // skip normal (12 bytes)
    const v: number[][] = [];
    for (let j = 0; j < 3; j++) {
      const off = base + j * 12;
      v.push([
        view.getFloat32(off, true),
        view.getFloat32(off + 4, true),
        view.getFloat32(off + 8, true),
      ]);
    }
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const key = edgeKey(a[0], a[1], a[2], b[0], b[1], b[2]);
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCount.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  return {
    isManifold: openEdges === 0 && nonManifoldEdges === 0,
    openEdges,
    nonManifoldEdges,
  };
}
