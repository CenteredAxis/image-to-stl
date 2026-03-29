import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { MeshResult } from '../types';

interface Props {
  result: MeshResult | null;
}

export function Preview3D({ result }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    animId: number;
    ro: ResizeObserver;
  } | null>(null);

  useEffect(() => {
    if (!result || !containerRef.current) return;
    const container = containerRef.current;

    // Dispose previous
    if (stateRef.current) {
      cancelAnimationFrame(stateRef.current.animId);
      stateRef.current.renderer.dispose();
      stateRef.current.ro.disconnect();
      container.querySelector('canvas')?.remove();
    }

    const rect = container.getBoundingClientRect();
    const W = rect.width || 800, H = rect.height || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const maxDim = Math.max(result.modelW, result.modelH);
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, maxDim * 10);
    camera.position.set(result.modelW * 0.5, -result.modelH * 0.8, maxDim * 0.8);
    camera.lookAt(result.modelW / 2, result.modelH / 2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(result.modelW / 2, result.modelH / 2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.update();

    const { tris, colorIndex, palette, BG_INDEX, gw, gh, modelW, dx, dy, mirrorX } = result;
    const triCount = tris.length / 9;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(tris.length);
    const colors = new Float32Array(tris.length);

    for (let t = 0; t < triCount; t++) {
      const i = t * 9;
      for (let j = 0; j < 9; j++) positions[i + j] = tris[i + j];
      const cx = (tris[i] + tris[i + 3] + tris[i + 6]) / 3;
      const cy = (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3;
      // When mirrorX, vertex X = modelW - col*dx, so col = (modelW - cx) / dx
      const rawCx = mirrorX ? (modelW - cx) : cx;
      const gx = Math.min(gw - 1, Math.max(0, Math.round(rawCx / dx)));
      const gy = Math.min(gh - 1, Math.max(0, Math.round(cy / dy)));
      const ci = colorIndex[gy * gw + gx];
      let r = 0.15, g = 0.15, b = 0.15;
      if (ci !== BG_INDEX && ci < palette.length) {
        r = palette[ci][0] / 255;
        g = palette[ci][1] / 255;
        b = palette[ci][2] / 255;
      }
      for (let v = 0; v < 3; v++) {
        colors[i + v * 3] = r;
        colors[i + v * 3 + 1] = g;
        colors[i + v * 3 + 2] = b;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      flatShading: false,
      shininess: 30,
      specular: new THREE.Color(0x222222),
    });
    scene.add(new THREE.Mesh(geometry, material));

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(result.modelW, -result.modelH, maxDim * 2);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-result.modelW, result.modelH, maxDim);
    scene.add(dir2);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      renderer.setSize(r.width, r.height);
    });
    ro.observe(container);

    stateRef.current = { renderer, animId, ro };

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      ro.disconnect();
      container.querySelector('canvas')?.remove();
      stateRef.current = null;
    };
  }, [result]);

  if (!result) return null;

  return (
    <div ref={containerRef} id="preview3d" style={{ display: 'block' }}>
      <span className="preview3d-hint">Drag to rotate · Scroll to zoom · Right-drag to pan</span>
    </div>
  );
}
