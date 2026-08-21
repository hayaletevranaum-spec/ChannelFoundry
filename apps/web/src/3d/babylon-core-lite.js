import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture as BabylonDynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.pure.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.pure.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.pure.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.pure.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

class PBRMaterial extends StandardMaterial {
  constructor(name, scene) {
    super(name, scene);
    this._roughness = 0.8;
    this._metallic = 0;
    this._syncSurface();
  }

  get albedoColor() { return this.diffuseColor; }
  set albedoColor(value) { this.diffuseColor = value; }
  get albedoTexture() { return this.diffuseTexture; }
  set albedoTexture(value) { this.diffuseTexture = value; }
  get roughness() { return this._roughness; }
  set roughness(value) { this._roughness = clamp01(value); this._syncSurface(); }
  get metallic() { return this._metallic; }
  set metallic(value) { this._metallic = clamp01(value); this._syncSurface(); }

  _syncSurface() {
    const roughness = this._roughness ?? 0.8;
    const metallic = this._metallic ?? 0;
    const level = Math.min(0.72, 0.07 + ((1 - roughness) * 0.22) + (metallic * 0.42));
    this.specularColor = new Color3(level, level * (0.88 + metallic * 0.08), level * (0.72 + metallic * 0.18));
    this.specularPower = 8 + ((1 - roughness) * 56) + (metallic * 44);
  }
}

function textureScale() { return 0.5; }

function scaledTextureSize(size, scale) {
  if (typeof size === 'number') return Math.max(1, Math.round(size * scale));
  if (!size || typeof size !== 'object') return size;
  return {
    ...size,
    width: Math.max(1, Math.round(Number(size.width || 1) * scale)),
    height: Math.max(1, Math.round(Number(size.height || 1) * scale)),
  };
}

class DynamicTexture extends BabylonDynamicTexture {
  constructor(name, size, scene, _generateMipMaps, samplingMode, format, invertY) {
    const scale = textureScale(name);
    super(name, scaledTextureSize(size, scale), scene, false, samplingMode, format, invertY);
    if (scale !== 1) this.getContext().scale(scale, scale);
  }
}

const MeshBuilder = Object.freeze({
  CreateBox,
  CreateCylinder,
  CreatePlane,
  CreateTorus,
});

export {
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  Viewport,
};
