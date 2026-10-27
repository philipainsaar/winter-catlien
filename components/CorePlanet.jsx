'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyCorePlanetMaterials } from './corePlanetMaterials';
import styles from './CorePlanet.module.css';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';


// Keep the working planet as the base. The newer GLB supplies ONLY heart geometry;
// its extra sphere, orbital ring and animation are never added to the scene.
let cachedCorePlanetPromise = null;
let cachedNewHeartPromise = null;

export function preloadCorePlanet() {
  if (!cachedCorePlanetPromise) {
    cachedCorePlanetPromise = new GLTFLoader()
      .loadAsync('/models/CorePlanet2Old.glb')
      .catch((error) => {
        cachedCorePlanetPromise = null;
        throw error;
      });
  }
  return cachedCorePlanetPromise;
}

function preloadNewHeartShape() {
  if (!cachedNewHeartPromise) {
    cachedNewHeartPromise = new GLTFLoader()
      .loadAsync('/models/CorePlanet2.glb')
      .catch((error) => {
        cachedNewHeartPromise = null;
        throw error;
      });
  }
  return cachedNewHeartPromise;
}

function findNamedMesh(root, name) {
  const direct = root.getObjectByName(name);
  if (direct?.isMesh) return direct;
  if (direct) {
    let nested = null;
    direct.traverse((obj) => {
      if (!nested && obj.isMesh && !/glint|sparkle/i.test(obj.name)) nested = obj;
    });
    if (nested) return nested;
  }
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isMesh && obj.name.toLowerCase() === name.toLowerCase()) found = obj;
  });
  return found;
}

// The user's heart PNG may be a TWO-heart atlas (two hearts side by side).
// A full atlas mapped onto one 3D mesh creates two hearts and a dark rectangle.
// Crop the left heart to a square ONLY when the image is detected as an atlas,
// and bleed edge colors outward so black atlas pixels don't appear on the 3D edge.
function prepareHeartTexture(input) {
  const img = input.image;
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h) return input;

  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  if (!probeCtx) return input;
  probeCtx.drawImage(img, 0, 0);
  const sample = (x, y) => {
    const p = probeCtx.getImageData(Math.floor(x * (w - 1)), Math.floor(y * (h - 1)), 1, 1).data;
    return [p[0], p[1], p[2], p[3]];
  };
  const mid = sample(0.5, 0.5);
  const left = sample(0.25, 0.5);
  const right = sample(0.75, 0.5);
  const isDark = p => p[3] < 12 || (p[0] < 55 && p[1] < 55 && p[2] < 55);
  const isBright = p => p[3] > 30 && p[0] > 95 && p[0] > p[1] + 12;
  const twoHeartAtlas = Math.abs(w - h) < Math.max(w, h) * 0.03 &&
    isDark(mid) && isBright(left) && isBright(right);

  if (!twoHeartAtlas) return input;

  const half = Math.floor(w / 2);
  const size = Math.min(1024, half);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return input;
  ctx.drawImage(img, 0, Math.floor((h - half) / 2), half, half, 0, 0, size, size);

  // Fill only the atlas's black/transparent background with its nearest
  // original colored pixel. The heart mesh itself still defines the silhouette.
  const image = ctx.getImageData(0, 0, size, size);
  const pixels = image.data;
  const count = size * size;
  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    const k = i * 4;
    const valid = pixels[k + 3] > 12 &&
      (pixels[k] >= 55 || pixels[k + 1] >= 55 || pixels[k + 2] >= 55);
    if (valid) { visited[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    const y = Math.floor(i / size);
    const neighbours = [
      x > 0 ? i - 1 : -1,
      x < size - 1 ? i + 1 : -1,
      y > 0 ? i - size : -1,
      y < size - 1 ? i + size : -1,
    ];
    for (const j of neighbours) {
      if (j < 0 || visited[j]) continue;
      visited[j] = 1;
      const a = i * 4;
      const b = j * 4;
      pixels[b] = pixels[a];
      pixels[b + 1] = pixels[a + 1];
      pixels[b + 2] = pixels[a + 2];
      pixels[b + 3] = 255;
      queue[tail++] = j;
    }
  }
  ctx.putImageData(image, 0, 0);
  const output = new THREE.CanvasTexture(canvas);
  output.name = 'Cropped heart from /images/coreplanet-heart.png';
  return output;
}

// Fit the NEW heart geometry into the original heart's envelope, rather than
// adding the entire new GLB (which would duplicate the sphere and orbit).
function replaceHeartShape(oldHeart, newHeart) {
  const existing = oldHeart.geometry;
  const replacement = newHeart.geometry.clone();
  existing.computeBoundingBox();
  replacement.computeBoundingBox();

  const oldSize = existing.boundingBox.getSize(new THREE.Vector3());
  const dims = [oldSize.x, oldSize.y, oldSize.z];
  // A 3D heart can be oriented toward +X rather than +Z. Match the thin
  // depth axis of the ORIGINAL mesh so the replacement isn't edge-on.
  const depthAxis = dims.indexOf(Math.min(...dims));
  if (depthAxis === 0) replacement.rotateY(Math.PI / 2);
  if (depthAxis === 1) replacement.rotateX(-Math.PI / 2);
  replacement.computeBoundingBox();

  const newSize = replacement.boundingBox.getSize(new THREE.Vector3());
  const oldCenter = existing.boundingBox.getCenter(new THREE.Vector3());
  const newCenter = replacement.boundingBox.getCenter(new THREE.Vector3());
  const original = [oldSize.x, oldSize.y, oldSize.z];
  const updated = [newSize.x, newSize.y, newSize.z];
  const planeAxes = [0, 1, 2].filter(axis => axis !== depthAxis);
  const flatScale = Math.min(...planeAxes.map(axis =>
    original[axis] / Math.max(0.0001, updated[axis])
  ));
  const scales = [flatScale, flatScale, flatScale];
  scales[depthAxis] = original[depthAxis] > 0.001
    ? original[depthAxis] / Math.max(0.0001, updated[depthAxis])
    : flatScale;

  replacement.translate(-newCenter.x, -newCenter.y, -newCenter.z);
  replacement.scale(scales[0], scales[1], scales[2]);
  replacement.translate(oldCenter.x, oldCenter.y, oldCenter.z);
  replacement.computeBoundingSphere();
  oldHeart.geometry = replacement;

  // Keep the original Heart object, material and GLB animation bindings.
  return replacement;
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
    let ownedHeartGeometry = null;
    let satellitePivot = null;
    let satelliteBody = null;
    let visible = true;
    let previousTime;
    let elapsed = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 150);
    // Use the original camera for the original large-scale GLB.
    camera.position.set(17.9, 0.9, 0.6);
    camera.lookAt(0, 0.15, 0);
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
      return () => { disposed = true; customHeartTexture?.dispose(); customSphereTexture?.dispose(); };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    element.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.15, 0);
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
      // Original GLB uses a larger scale than the experimental replacement.
      const halfFov = viewport
        ? Math.asin(6.3 / camera.position.distanceTo(controls.target))
        : 19 * Math.PI / 180;
      const aspectFit = viewport
        ? Math.max(1, 1 / camera.aspect)
        : Math.max(1, 1.4 / camera.aspect);
      camera.fov = 2 * Math.atan(Math.tan(halfFov) * aspectFit) * 180 / Math.PI;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element); resize();
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection.observe(element);


    // The original GLB is required. The new GLB is used ONLY as a donor
    // for the heart geometry; if it fails, the original planet still renders.
    preloadCorePlanet()
      .then((gltf) => {
        if (disposed) return;

        model = cloneSkeleton(gltf.scene);
        model.traverse((object) => {
          if (!object.isMesh || !object.material) return;
          object.material = Array.isArray(object.material)
            ? object.material.map(material => material?.clone())
            : object.material.clone();
        });

        // Restore the ORIGINAL sphere shader and its original orbit exactly.
        const sphere = findNamedMesh(model, 'Sphere');
        const torus = findNamedMesh(model, 'Torus');
        if (sphere && torus) {
          applyCorePlanetMaterials(model);
        } else {
          console.warn('Original planet has no Sphere/Torus mesh; preserving its built-in materials.');
        }

        // Preserve the original Heart object (including its animation bindings),
        // but replace only its geometry with the NEW heart silhouette.
        const heart = findNamedMesh(model, 'Heart');
        if (heart) {
          // Upgrade the shape independently. The ORIGINAL planet renders right
          // away even if loading the donor GLB is slow or fails altogether.
          preloadNewHeartShape()
            .then((donor) => {
              if (disposed) return;
              const newHeart = donor.scene.getObjectByName('Heart • heartbeat animation');
              if (!newHeart?.isMesh) {
                console.warn('New GLB does not contain its heart mesh.');
                return;
              }
              ownedHeartGeometry = replaceHeartShape(heart, newHeart);

              // Import the NEW small sphere as a separate satellite, NOT as
              // a shell wrapped around the original Sphere. Ignore the donor
              // GLB's Torus, heart glints and baked orbit scene entirely.
              const donorSphere = donor.scene.getObjectByName('Sphere • spin');
              if (!sphere?.isMesh || !donorSphere?.isMesh) {
                console.warn('Sphere.Sparkle satellite geometry was not found.');
                return;
              }

              sphere.geometry.computeBoundingSphere();
              donorSphere.geometry.computeBoundingSphere();
              const originalRadius = sphere.geometry.boundingSphere.radius;
              const donorRadius = donorSphere.geometry.boundingSphere.radius;

              satellitePivot = new THREE.Group();
              satellitePivot.name = 'Sphere.Sparkle orbit';
              satellitePivot.position.copy(sphere.geometry.boundingSphere.center);
              sphere.add(satellitePivot);

              satelliteBody = donorSphere.clone(true);
              satelliteBody.name = 'Sphere.Sparkle';
              satelliteBody.scale.setScalar(
                originalRadius * 0.29 / Math.max(0.001, donorRadius)
              );
              // Start just outside and below the original sphere as viewed
              // from the original camera at +X (screen-right is -Z).
              satelliteBody.position.set(
                0,
                -0.30 * originalRadius,
                -1.45 * originalRadius
              );
              satelliteBody.visible = false;
              satelliteBody.traverse((object) => {
                if (!object.isMesh) return;
                object.material = Array.isArray(object.material)
                  ? object.material.map((material) => material?.clone())
                  : object.material?.clone();
              });
              satellitePivot.add(satelliteBody);

              textureLoader.load('/images/sphere-sparkle.png', (texture) => {
                if (disposed) { texture.dispose(); return; }
                if (!satelliteBody?.geometry?.getAttribute('uv')) {
                  console.warn('Sphere.Sparkle satellite has no UV coordinates.');
                  texture.dispose();
                  return;
                }
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.flipY = false;
                texture.wrapS = THREE.RepeatWrapping;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.needsUpdate = true;

                satelliteBody.material?.dispose();
                satelliteBody.material = new THREE.MeshBasicMaterial({
                  name: 'Sphere.Sparkle',
                  map: texture,
                  transparent: true,
                  opacity: 1,   // The PNG controls the actual alpha.
                  alphaTest: 0.015,
                  depthWrite: false,
                  depthTest: true,
                  side: THREE.FrontSide,
                  toneMapped: false,
                });
                satelliteBody.renderOrder = 12;
                satelliteBody.visible = true;
                customSphereTexture = texture;
              }, undefined, (error) => {
                console.error('Sphere.Sparkle PNG failed to load:', error);
              });
            })
            .catch((error) => {
              console.warn('New heart geometry unavailable; keeping original shape:', error);
            });
        } else {
          console.warn('CorePlanet: Heart mesh not found in original model.');
        }

        const textureLoader = new THREE.TextureLoader();

        // Keep /images/coreplanet-heart.png. Auto-crop its two-heart atlas
        // to ONE heart when necessary, preventing the double-heart artifact.
        if (heart) {
          textureLoader.load('/images/coreplanet-heart.png', (rawTexture) => {
            if (disposed) { rawTexture.dispose(); return; }
            const texture = prepareHeartTexture(rawTexture);
            if (texture !== rawTexture) rawTexture.dispose();
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = false;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.needsUpdate = true;

            const mats = Array.isArray(heart.material)
              ? heart.material : [heart.material];
            for (const material of mats) {
              if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) continue;
              material.map = texture;
              material.color.set('#ffffff');
              material.needsUpdate = true;
            }
            customHeartTexture = texture;
          }, undefined, (error) => {
            console.error('Heart PNG failed to load:', error);
          });
        }

        scene.add(model);
        mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations) {
          mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
        }
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
      // Animate ONLY the new satellite. Original Sphere/Torus remain untouched.
      if (satellitePivot && satelliteBody) {
        const t = reducedMotion.matches ? 0 : elapsed;
        satellitePivot.rotation.x = t * 0.22;
        satelliteBody.rotation.y = t * 0.60;
      }
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
      ownedHeartGeometry?.dispose();
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
