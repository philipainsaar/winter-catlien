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
      .loadAsync('/models/CorePlanet2.glb')
      .catch((error) => {
        cachedCorePlanetPromise = null;
        throw error;
      });
  }

  return cachedCorePlanetPromise;
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
      return () => {
        disposed = true;
        customHeartTexture?.dispose();
        customSphereTexture?.dispose();
      };
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
        2 * Math.atan(Math.tan(halfFov) * aspectFit) * 180 / Math.PI
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

    
    // Preserve the ORIGINAL Sphere and Torus materials/behavior.
    // The legacy shader is applied ONLY when both original objects exist.
    const legacySphere = model.getObjectByName('Sphere');
    const legacyOrbit = model.getObjectByName('Torus');
    if (legacySphere?.isMesh && legacyOrbit?.isMesh) {
      applyCorePlanetMaterials(model);
    }

    // The heart can be named "Heart" or "Heart • heartbeat animation".
    // Keep the separate PNG override, even if the GLB has embedded textures.
    const heart = model.getObjectByName('Heart') ||
      model.children.find((object) => /^Heart(?:\s|$|[•._-])/i.test(object.name));

    const textureLoader = new THREE.TextureLoader();

    if (heart) {
      textureLoader.load(
        '/images/coreplanet-heart.png',
        (texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }

          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false; // glTF UV convention
          texture.magFilter = THREE.LinearFilter;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.needsUpdate = true;

          // Do NOT apply the heart texture to the glint meshes underneath Heart.
          const heartMeshes = [];
          heart.traverse((object) => {
            if (object.isMesh && !/glint|sparkle/i.test(object.name)) {
              heartMeshes.push(object);
            }
          });

          heartMeshes.forEach((mesh) => {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            materials.forEach((material) => {
              if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) return;
              material.map = texture;
              material.color.set('#ffffff');
              material.needsUpdate = true;
            });
          });
          customHeartTexture = texture;
        },
        undefined,
        (error) => console.error('Heart texture failed to load:', error)
      );
    } else {
      console.warn('CorePlanet: Heart object was not found.');
    }

    // Find the original INNER sphere without touching its material.
    // Supports both legacy "Sphere" and the newer "Sphere • spin" node.
    let innerSphere = model.getObjectByName('Sphere');
    if (!innerSphere?.isMesh) {
      model.traverse((object) => {
        if (
          !innerSphere?.isMesh &&
          object.isMesh &&
          /^sphere(?:$|[ .•_-])/i.test(object.name) &&
          !/sparkle|glint/i.test(object.name)
        ) {
          innerSphere = object;
        }
      });
    }

    // A separate OUTER mesh is preferred if the GLB already has one.
    // Also support a mesh whose material (rather than object) is named Sphere.Sparkle.
    let sparkleShell = model.getObjectByName('Sphere.Sparkle');
    if (!sparkleShell) {
      model.traverse((object) => {
        if (sparkleShell || !object.isMesh) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        if (materials.some((material) => material?.name === 'Sphere.Sparkle')) {
          sparkleShell = object;
        }
      });
    }

    // The currently exported CorePlanet2.glb may contain only one sphere.
    // Create the OUTER shell using the inner sphere's geometry and UVs in that case.
    // Parenting to the inner sphere makes it follow its baked orbit/spin animation.
    if (!sparkleShell && innerSphere?.isMesh) {
      sparkleShell = new THREE.Mesh(innerSphere.geometry);
      sparkleShell.name = 'Sphere.Sparkle';
      sparkleShell.scale.setScalar(1.045);
      sparkleShell.visible = false; // Show it only after its texture loads.
      innerSphere.add(sparkleShell);
    }

    if (sparkleShell) {
      const sparkleMeshes = [];
      sparkleShell.traverse((object) => {
        // Absolutely never replace the INNER Sphere's material.
        if (object.isMesh && object !== innerSphere) sparkleMeshes.push(object);
      });

      textureLoader.load(
        '/images/sphere-sparkle.png',
        (texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }

          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false; // glTF UV convention
          texture.magFilter = THREE.LinearFilter;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.needsUpdate = true;

          sparkleMeshes.forEach((mesh) => {
            if (!mesh.geometry?.getAttribute('uv')) {
              console.warn('Sphere.Sparkle needs UVs to display its PNG:', mesh.name);
              return;
            }
            // The old materials belong to this instance, not the cached GLB.
            const oldMaterials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            oldMaterials.forEach((material) => material?.dispose());

            // A PNG with alpha creates a sheer sparkly shell, not another opaque globe.
            mesh.material = new THREE.MeshBasicMaterial({
              name: 'Sphere.Sparkle',
              map: texture,
              color: 0xffffff,
              transparent: true,
              opacity: 0.72,
              depthTest: true,
              depthWrite: false,
              side: THREE.FrontSide,
              toneMapped: false,
            });
            mesh.renderOrder = 11;
            mesh.visible = true;
          });

          customSphereTexture = texture;
        },
        undefined,
        (error) => console.error('Sphere.Sparkle texture failed to load:', error)
      );
    } else {
      console.warn('CorePlanet: No sphere geometry found for Sphere.Sparkle.');
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
