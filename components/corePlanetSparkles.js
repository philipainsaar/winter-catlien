import * as THREE from 'three';

// Material.001 from CorePlanetSparkle.blend: UV Mapping scale 5, linear RGB
// Color Ramp feeding Base Color, original image Alpha feeding Alpha directly.
export function createSparkleMaterial(texture) {
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
    texture.needsUpdate = true;
  }
  const material = new THREE.MeshStandardMaterial({
    name: 'Blender sparkle / 5x UV / cyan-yellow-white ramp',
    map: texture,
    color: 0xffffff,
    metalness: 0,
    roughness: 0.5,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      // sRGB image samples are decoded to linear RGB before the Blender ramp.
      float factor = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 cyan = vec3(0.309468985, 0.896269619, 1.0);
      vec3 yellow = vec3(1.0, 0.882864833, 0.142579168);
      diffuseColor.rgb = factor < 0.816061974
        ? mix(cyan, yellow, clamp((factor - 0.5) / (0.816061974 - 0.5), 0.0, 1.0))
        : mix(yellow, vec3(1.0), clamp((factor - 0.816061974) / (1.0 - 0.816061974), 0.0, 1.0));
      // Leave diffuseColor.a untouched: ramp alpha is not connected in Blender.
    `);
  };
  material.customProgramCacheKey = () => 'core-planet-blender-sparkle-ramp-v1';
  return material;
}
