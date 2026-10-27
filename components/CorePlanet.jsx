'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyCorePlanetMaterials } from './corePlanetMaterials';
import styles from './CorePlanet.module.css';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';


let cachedCorePlanetPromise = null;

export function preloadCorePlanet() {
  if (!cachedCorePlanetPromise) {
    cachedCorePlanetPromise = new GLTFLoader()
      .loadAsync('/models/CorePlanet2.glb?v=restored-heart-sparkle-1')
      .catch((error) => {
        cachedCorePlanetPromise = null;
        throw error;
      });
  }

  return cachedCorePlanetPromise;
}



// The website heart PNG may be a two-heart atlas. The NEW geometry uses
// one heart per UV square, so crop the left half only when the atlas is detected.
// The original image file itself remains untouched.
function prepareSingleHeartTexture(input) {
  const img = input.image;
  if (!img?.width || !img?.height) return input;

  const w = img.width;
  const h = img.height;
  if (Math.abs(w - h) > Math.max(w, h) * 0.04) return input;

  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  if (!probeCtx) return input;
  probeCtx.drawImage(img, 0, 0);

  function pixel(u, v) {
    const data = probeCtx.getImageData(
      Math.max(0, Math.min(w - 1, Math.floor(u * w))),
      Math.max(0, Math.min(h - 1, Math.floor(v * h))),
      1, 1
    ).data;
    return [...data];
  }
  const mid = pixel(0.5, 0.5);
  const left = pixel(0.25, 0.5);
  const right = pixel(0.75, 0.5);
  const dark = (p) => p[3] < 16 || (p[0] < 50 && p[1] < 50 && p[2] < 50);
  const pink = (p) => p[3] > 100 && p[0] > 90 && p[0] > p[1] + 10;
  if (!(dark(mid) && pink(left) && pink(right))) return input;

  const half = Math.floor(Math.min(w, h) / 2);
  const size = Math.min(512, half);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return input;
  ctx.drawImage(img, 0, Math.floor((h - half) / 2), half, half, 0, 0, size, size);

  // Extend the heart's edge color into transparent pixels. This prevents
  // transparent/black parts of the PNG atlas from showing on the 3D surface.
  const image = ctx.getImageData(0, 0, size, size);
  const px = image.data;
  const count = size * size;
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < count; i++) {
    const j = i * 4;
    if (px[j + 3] > 30 && (px[j] > 75 || px[j + 1] > 75 || px[j + 2] > 75)) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    const y = Math.floor(i / size);
    const n = [x ? i - 1 : -1, x + 1 < size ? i + 1 : -1,
      y ? i - size : -1, y + 1 < size ? i + size : -1];
    for (const k of n) {
      if (k < 0 || seen[k]) continue;
      seen[k] = 1;
      const a = i * 4;
      const b = k * 4;
      px[b] = px[a]; px[b + 1] = px[a + 1];
      px[b + 2] = px[a + 2]; px[b + 3] = 255;
      queue[tail++] = k;
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

function disposeModel(root) {
  const materials = new Set();

  root.traverse((object) => {
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    objectMaterials.forEach((material) => {
      if (material) materials.add(material);
    });
  });

  materials.forEach((material) => material.dispose());

  // Geometry and textures belong to the shared cached GLTF.
  // Do not destroy them when one CorePlanet closes.
}


// This site already uses independent canvases for its modal illustrations.
// One reusable, transparent canvas replaces both duplicated modal renderers.
export default function CorePlanet({
  viewport = false,
  href,
  onBackgroundClick,
}) {
  const host = useRef(null);
  const dragged = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    let disposed = false;
    let model, mixer, renderer;
    let customHeartTexture = null;
    let customSphereTexture = null;
    let visible = true;
    let previousTime;
    let elapsed = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 150);
  camera.position.set(0.85, 0.7, 5.8);
camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xf4d4fa, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(7, 10, 12); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffb4d9, 0.5);
    fill.position.set(-8, 4, -8); scene.add(fill);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.error('CorePlanet renderer:', error);
      // Schedule the fallback after setup, just like asynchronous loading failures.
      queueMicrotask(() => { if (!disposed) setFailed(true); });
      return () => { disposed = true; customHeartTexture?.dispose(); };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    element.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.65;
    controls.update();
    const start = new THREE.Vector2();
    let pointerId = null;
    const pointerDown = (event) => {
      if (pointerId !== null) { dragged.current = true; return; }
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      start.set(event.clientX, event.clientY);
      dragged.current = false;
      element.dataset.dragging = 'true';
    };
    const pointerMove = (event) => {
      if (event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) dragged.current = true;
    };
    const pointerUp = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerMove(event); pointerId = null; element.dataset.dragging = 'false';
    };
    const pointerCancel = () => {
      pointerId = null; dragged.current = true; element.dataset.dragging = 'false';
    };
    const keyDown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
      if (event.key === 'ArrowRight') spherical.theta += 0.12;
      if (event.key === 'ArrowUp') spherical.phi -= 0.12;
      if (event.key === 'ArrowDown') spherical.phi += 0.12;
      spherical.makeSafe();
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      controls.update();
    };
    canvas.addEventListener('pointerdown', pointerDown, true);
    canvas.addEventListener('pointermove', pointerMove, true);
    canvas.addEventListener('pointerup', pointerUp, true);
    canvas.addEventListener('pointercancel', pointerCancel, true);
    element.addEventListener('keydown', keyDown);

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
 const halfFov = 22 * Math.PI / 180;
const aspectFit = Math.max(1, 1 / camera.aspect);

camera.fov = Math.min(
  100,
  2 * Math.atan(Math.tan(halfFov) * aspectFit)
    * 180 / Math.PI
);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element); resize();
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(element);


preloadCorePlanet()
  .then((gltf) => {
    if (disposed) return;

    // Each CorePlanet receives its own scene and materials.
    // The parsed geometry and textures remain cached.
    model = cloneSkeleton(gltf.scene);

    model.traverse((object) => {
      if (!object.isMesh || !object.material) return;

      object.material = Array.isArray(object.material)
        ? object.material.map((material) =>
            material ? material.clone() : material
          )
        : object.material.clone();
    });

    
// Only apply the old shaders to the legacy GLB.
const legacySphere = model.getObjectByName('Sphere');
const legacyOrbit = model.getObjectByName('Torus');

if (legacySphere && legacyOrbit) {
  // Keep the ORIGINAL Sphere shader and Torus rendering exactly as before.
if (model.getObjectByName('Sphere') && model.getObjectByName('Torus')) {
  applyCorePlanetMaterials(model);
} else {
  console.error('Expected Sphere/Torus missing. Check which CorePlanet2.glb is deployed.');
}
}

// Load a custom texture for the heart only.
const heart = model.getObjectByName('Heart');

if (heart) {
  const textureLoader = new THREE.TextureLoader();

  textureLoader.load(
    '/images/coreplanet-heart.png',

    (loadedTexture) => {
      if (disposed) {
        loadedTexture.dispose();
        return;
      }

      const texture = prepareSingleHeartTexture(loadedTexture);
      if (texture !== loadedTexture) loadedTexture.dispose();
      texture.colorSpace = THREE.SRGBColorSpace;

      // Required for textures applied to glTF UV mapping.
      texture.flipY = false;

      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.needsUpdate = true;

      heart.traverse((object) => {
        if (!object.isMesh) return;

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach((material) => {
          if (!material?.isMeshStandardMaterial) return;

          material.map = texture;
          if (material.emissiveMap) material.emissiveMap = texture;
          material.color.set('#ffffff');
          material.needsUpdate = true;
        });
      });

      customHeartTexture = texture;
    },

    undefined,

    (error) => {
      console.error('Heart texture failed to load:', error);
    }
  );
} else {
  console.warn('CorePlanet: Heart object was not found.');
}

// A SEPARATE transparent orbiting sphere, not another layer over Sphere.
// The repaired GLB contains this mesh and its own 12-second orbit animation.
// An external PNG overrides its fallback texture only if the PNG is available.
const sparkleSphere = model.getObjectByName('Sphere.Sparkle');
if (sparkleSphere?.isMesh) {
  new THREE.TextureLoader().load(
    '/images/sphere-sparkle.png',
    (texture) => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;

      // Materials were cloned above, so this only changes this instance.
      const mat = sparkleSphere.material;
      if (mat?.isMeshStandardMaterial || mat?.isMeshPhysicalMaterial) {
        mat.map = texture;
        mat.color.set('#ffffff');
        mat.transparent = true;
        mat.opacity = 1; // PNG alpha determines transparency.
        mat.depthWrite = false;
        mat.alphaTest = 0.01;
        mat.side = THREE.FrontSide;
        mat.needsUpdate = true;
        customSphereTexture = texture;
      } else {
        console.warn('Unexpected Sphere.Sparkle material type');
        texture.dispose();
      }
    },
    undefined,
    () => console.info('Optional sphere-sparkle.png not present; using embedded sparkle texture.')
  );
} else {
  console.info('Sphere.Sparkle not found: original planet still renders unchanged.');
}

scene.add(model);


    mixer = new THREE.AnimationMixer(model);

    for (const clip of gltf.animations) {
      mixer
        .clipAction(clip)
        .setLoop(THREE.LoopRepeat, Infinity)
        .play();
    }

    // Preserve the original baked orbit speed.
    mixer.setTime(0);
  })
  .catch((error) => {
    if (!disposed) {
      console.error('CorePlanet model:', error);
      setFailed(true);
    }
  });


    renderer.setAnimationLoop((time) => {
      const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      if (!visible || document.hidden) return;
      if (!reducedMotion.matches) elapsed += delta;
      mixer?.setTime(reducedMotion.matches ? 0 : elapsed);
      controls.update();
      renderer.render(scene, camera);
      if (model && element.dataset.loaded !== 'true') {
      element.dataset.loaded = 'true';
      }
    });
    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect(); intersection.disconnect();
      mixer?.stopAllAction();
      if (model) { mixer?.uncacheRoot(model); disposeModel(model); }
      customHeartTexture?.dispose();
      customSphereTexture?.dispose();
      controls.dispose();
      canvas.removeEventListener('pointerdown', pointerDown, true);
      canvas.removeEventListener('pointermove', pointerMove, true);
      canvas.removeEventListener('pointerup', pointerUp, true);
      canvas.removeEventListener('pointercancel', pointerCancel, true);
      element.removeEventListener('keydown', keyDown);
      renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [viewport]);

  const content = <div ref={host} className={styles.canvasHost} data-core-planet
    role={href ? undefined : 'group'} tabIndex={href ? undefined : 0}
    aria-label={href ? undefined : 'Heart planet. Drag or use arrow keys to rotate the view.'}>
    

  </div>;
  if (!href) return content;
  return <a href={href} className={styles.planetLink} draggable={false}
    aria-label="Explore all collections. Drag to rotate the planet; click or press Enter to visit the shop."
    onDragStart={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.target === event.currentTarget && event.key.startsWith('Arrow')) {
        event.preventDefault();
        host.current?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key }));
      }
    }}

onClickCapture={(event) => {
  // Never open the shop while rotating the planet.
  if (event.detail !== 0 && dragged.current) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  // Preserve keyboard activation with Enter.
  if (event.detail === 0) return;

  // Only apply this behavior in the full-screen planet view.
  if (!viewport) return;

  const rect = event.currentTarget.getBoundingClientRect();

  // The planet is centered in the viewport.
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Clickable circular area around the planet.
  const radius = Math.min(rect.width, rect.height) * 0.30;

  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;

  const clickedPlanet =
    dx * dx + dy * dy <= radius * radius;

  if (!clickedPlanet) {
    // Do not follow the shop link.
    event.preventDefault();
    event.stopPropagation();

    // Close the popup and return to the water scene.
    onBackgroundClick?.();
  }
}}
>{content}</a>;
}
