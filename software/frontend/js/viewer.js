/**
 * ============================================================================
 * F1 Lamp — 3D Viewer & Realtime Diffuser Shader
 * ============================================================================
 * Uses Three.js to render real mesh from F1_Logo_Led_Lamp.3mf (23,506 triangles)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.querySelector('#viewer');
const status = document.querySelector('#modelStatus');

export async function initViewer() {
  if (!container) return;

  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'โมเดลจริง F1 ลากหมุนและซูมได้');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 160;
    controls.maxDistance = 800;
    controls.maxPolarAngle = Math.PI * 0.93;
    controls.autoRotateSpeed = 1.5;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Ambient & Directional Lighting
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x292127, 2.8));
    const lightConfigs = [
      [0xffe3d8, 3.0, [100, 160, 180]],
      [0x719bd8, 2.0, [-180, 110, -80]],
      [0xffffff, 1.5, [0, 220, -120]]
    ];
    for (const [color, intensity, xyz] of lightConfigs) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(...xyz);
      scene.add(light);
    }

    const group = new THREE.Group();
    scene.add(group);

    // Fetch or read model data
    let data;
    const embeddedEl = document.querySelector('#embeddedModel');
    if (embeddedEl && embeddedEl.textContent.trim().length > 0) {
      data = JSON.parse(embeddedEl.textContent);
    } else {
      const resp = await fetch('js/model.json');
      if (!resp.ok) throw new Error('Cannot load model.json');
      data = await resp.json();
    }

    const parts = [];
    const counts = [4, 6, 9];

    for (const m of data.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
      geometry.setIndex(m.indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      const diffuser = m.name.includes('diffuser');
      const material = diffuser
        ? new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({
            color: m.zone < 0 ? 0x18191c : 0x55211c,
            roughness: 0.78,
            metalness: 0.0,
            side: THREE.DoubleSide
          });

      const uniforms = {
        values: { value: new Float32Array(9) },
        lightColor: { value: new THREE.Color('#ff382a') },
        minX: { value: geometry.boundingBox.min.x },
        span: { value: Math.max(1.0, geometry.boundingBox.max.x - geometry.boundingBox.min.x) },
        pixelCount: { value: counts[m.zone] || 1 }
      };

      if (diffuser) {
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader =
            'varying float lampX;\n' +
            shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nlampX=position.x;');

          shader.fragmentShader =
            'varying float lampX; uniform float values[9]; uniform vec3 lightColor; uniform float minX; uniform float span; uniform float pixelCount;\n' +
            shader.fragmentShader.replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               float p = clamp((lampX - minX) / span, 0.0, 1.0) * (pixelCount - 1.0);
               float illumination = 0.0;
               for (int k = 0; k < 9; k++) {
                 float w = max(0.0, 1.0 - abs(p - float(k)));
                 illumination += values[k] * w;
               }
               diffuseColor.rgb = mix(vec3(0.018, 0.014, 0.013), lightColor * illumination, smoothstep(0.0, 0.03, illumination));`
            );
        };
        material.customProgramCacheKey = () => 'f1-diffuser-v2';
      }

      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      parts.push({ mesh, zone: m.zone, diffuser, uniforms });
    }

    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.sub(center);
    group.position.y += 4;

    // Floor platform with subtle reflections
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(240, 80),
      new THREE.MeshStandardMaterial({
        color: 0x131416,
        roughness: 0.48,
        metalness: 0.2,
        transparent: true,
        opacity: 0.8
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -center.y + 2;
    scene.add(floor);

    const reset = () => {
      camera.position.set(-95, 55, 330);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    reset();

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    };
    new ResizeObserver(resize).observe(container);
    resize();

    let exploded = false;
    const resetBtn = document.querySelector('#resetView');
    if (resetBtn) resetBtn.onclick = reset;

    const autoRotateBtn = document.querySelector('#autoRotate');
    if (autoRotateBtn) {
      autoRotateBtn.onclick = (e) => {
        controls.autoRotate = !controls.autoRotate;
        e.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
      };
    }

    const explodeBtn = document.querySelector('#explode');
    if (explodeBtn) {
      explodeBtn.onclick = (e) => {
        exploded = !exploded;
        e.currentTarget.setAttribute('aria-pressed', String(exploded));
      };
    }

    if (status) status.style.display = 'none';

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (status) {
        status.style.display = 'grid';
        status.textContent = 'การแสดงผล 3D หยุดชั่วคราว กรุณารีเฟรชหน้าเว็บ';
      }
    });

    // Main animation loop
    function render(now) {
      const preview = window.lampPreview;
      if (preview) {
        const s = preview.getState();
        const levels = preview.levels(now);
        const color = new THREE.Color(s.color || '#ff0000');

        for (const p of parts) {
          const target = exploded ? (p.zone < 0 ? -13 : p.diffuser ? 32 : 0) : 0;
          p.mesh.position.z += (target - p.mesh.position.z) * (reduced ? 1.0 : 0.12);

          if (p.zone >= 0) {
            const v = levels[p.zone];
            const avg = v.reduce((a, b) => a + b, 0) / v.length;
            if (p.diffuser) {
              p.uniforms.values.value.fill(0);
              p.uniforms.values.value.set(v);
              p.uniforms.lightColor.value.copy(color);
            } else {
              p.mesh.material.color.copy(color).multiplyScalar(0.18 + avg * 0.2);
              p.mesh.material.emissive.copy(color).multiplyScalar(avg * 0.12);
            }
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  } catch (error) {
    if (status) {
      status.textContent = 'เปิดโมเดล 3D ไม่ได้: ' + error.message + ' · ลองเปิดผ่าน Chrome / Edge ที่รองรับ WebGL';
    }
    console.error(error);
  }
}

