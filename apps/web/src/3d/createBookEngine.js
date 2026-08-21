import {
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
} from '@babylonjs/core';
import { getPresentationPose, interpolatePresentationPose } from './bookPresentation.js';

const BOOK_PROFILES = Object.freeze({
  journal: Object.freeze({
    pageWidth: 4.9,
    pageDepth: 4.05,
    coverThickness: 0.16,
    pageBlockThickness: 0.42,
    closedCoverY: 0.68,
    openCoverY: 0.37,
    pageTopY: 0.55,
    turnBaseY: 0.58,
    coverTexture: 'scene/journal-cover-alchemy-v1.webp',
    coverColor: '#170906',
    coverEdgeColor: '#0d0504',
    paperColor: '#c9b98e',
    pageEdgeColor: '#c2b18a',
    brassColor: '#72501f',
  }),
  community: Object.freeze({
    pageWidth: 4.05,
    pageDepth: 4.86,
    coverThickness: 0.14,
    pageBlockThickness: 0.38,
    closedCoverY: 0.63,
    openCoverY: 0.34,
    pageTopY: 0.5,
    turnBaseY: 0.53,
    coverTexture: 'scene/community-cover-leather-v1.webp',
    coverColor: '#160c07',
    coverEdgeColor: '#0b0604',
    paperColor: '#bdae82',
    pageEdgeColor: '#a99870',
    brassColor: '#82612c',
  }),
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeInOutCubic = (value) => (
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
);
const smoothstep = (from, to, value) => {
  const t = clamp01((value - from) / Math.max(0.0001, to - from));
  return t * t * (3 - 2 * t);
};

function animate({ duration, update, midpoint }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let midpointCalled = false;

    function frame(now) {
      const raw = clamp01((now - startedAt) / duration);
      const eased = easeInOutCubic(raw);
      update(eased, raw);

      if (!midpointCalled && raw >= 0.5) {
        midpointCalled = true;
        midpoint?.();
      }

      if (raw < 1) requestAnimationFrame(frame);
      else resolve();
    }

    requestAnimationFrame(frame);
  });
}

function makePbr(scene, name, color, roughness = 0.8, metallic = 0) {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(color);
  material.roughness = roughness;
  material.metallic = metallic;
  return material;
}

function createLeatherTexture(scene) {
  const texture = new DynamicTexture('aged-leather-texture', { width: 1024, height: 768 }, scene, true);
  const context = texture.getContext();
  context.fillStyle = '#24100b';
  context.fillRect(0, 0, 1024, 768);

  let seed = 918273;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let index = 0; index < 1800; index += 1) {
    const x = random() * 1024;
    const y = random() * 768;
    const radius = 1 + random() * 4.5;
    context.fillStyle = random() > 0.48 ? 'rgba(113,67,43,.055)' : 'rgba(5,2,1,.08)';
    context.beginPath();
    context.ellipse(x, y, radius * 1.8, radius, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = 'round';
  for (let index = 0; index < 115; index += 1) {
    const x = random() * 1024;
    const y = random() * 768;
    context.strokeStyle = 'rgba(4,2,1,.14)';
    context.lineWidth = 0.5 + random() * 1.25;
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(
      x + random() * 24 - 12,
      y + random() * 18 - 9,
      x + random() * 42 - 21,
      y + random() * 25 - 12,
      x + random() * 58 - 29,
      y + random() * 34 - 17,
    );
    context.stroke();
  }

  texture.update();
  return texture;
}

function createPageEdgeTexture(scene) {
  const texture = new DynamicTexture('layered-page-edge-texture', { width: 1024, height: 256 }, scene, true);
  const context = texture.getContext();
  context.fillStyle = '#8d7b55';
  context.fillRect(0, 0, 1024, 256);

  let seed = 203407;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 3; y < 256; y += 3 + Math.floor(random() * 4)) {
    context.strokeStyle = random() > 0.2 ? 'rgba(35,24,16,.25)' : 'rgba(213,191,145,.16)';
    context.lineWidth = random() > 0.72 ? 2 : 1;
    context.beginPath();
    context.moveTo(0, y + random() * 2 - 1);
    context.bezierCurveTo(260, y + random() * 3 - 1.5, 760, y + random() * 3 - 1.5, 1024, y + random() * 2 - 1);
    context.stroke();
  }

  for (let index = 0; index < 90; index += 1) {
    context.fillStyle = 'rgba(38,24,15,.10)';
    context.fillRect(random() * 1024, random() * 256, 4 + random() * 22, 1);
  }
  texture.update();
  return texture;
}

function createCoverArtwork(scene, parent, book, variant) {
  const textureUrl = `${import.meta.env.BASE_URL}${book.coverTexture}`;
  const texture = new Texture(textureUrl, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  const artworkName = variant === 'community' ? 'current-community-cover-artwork' : 'current-journal-cover-artwork';
  texture.name = variant === 'community' ? 'current-community-cover-texture' : 'current-journal-cover-texture';
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;

  const material = new StandardMaterial(variant === 'community' ? 'current-community-cover-material' : 'current-journal-cover-material', scene);
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.055, 0.028, 0.012);
  material.specularColor = new Color3(0.14, 0.095, 0.045);
  material.specularPower = 22;
  material.backFaceCulling = false;

  const artwork = MeshBuilder.CreatePlane(artworkName, {
    width: book.pageWidth + 0.12,
    height: book.pageDepth + 0.12,
  }, scene);
  artwork.parent = parent;
  artwork.position = new Vector3(book.pageWidth / 2, 0.122, 0);
  artwork.rotation.x = Math.PI / 2;
  artwork.material = material;
  artwork.renderingGroupId = 2;
  artwork.isPickable = false;
  return artwork;
}

function configureCamera(camera, canvas, orthoHeight) {
  const aspect = Math.max(0.6, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  camera.orthoTop = orthoHeight / 2;
  camera.orthoBottom = -orthoHeight / 2;
  camera.orthoLeft = -(orthoHeight * aspect) / 2;
  camera.orthoRight = (orthoHeight * aspect) / 2;
}

function vectorFrom(values) {
  return new Vector3(values[0], values[1], values[2]);
}

function rectFromPoints(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function unionRects(...rects) {
  return rectFromPoints(rects.flatMap((rect) => ([
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.bottom },
  ])));
}

export function createBookEngine(canvas, {
  presentationMode = 'desktop',
  bookVariant = 'journal',
  onLayout,
} = {}) {
  const variant = bookVariant === 'community' ? 'community' : 'journal';
  const book = BOOK_PROFILES[variant];
  // The community notebook is a second idle WebGL surface. Keeping its last
  // completed frame prevents the browser compositor from revealing the room
  // through the projected DOM pages before the next physical page turn.
  const engine = new Engine(canvas, true, {
    alpha: true,
    stencil: true,
    preserveDrawingBuffer: variant === 'community',
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor = new Color3(0.075, 0.05, 0.032);

  let currentPresentationMode = presentationMode === 'mobile' ? 'mobile' : 'desktop';
  let currentPose = getPresentationPose(currentPresentationMode, 'closed', variant);

  const camera = new FreeCamera('book-camera', vectorFrom(currentPose.cameraPosition), scene);
  camera.setTarget(vectorFrom(currentPose.target));
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 100;
  configureCamera(camera, canvas, currentPose.orthoHeight);

  const fill = new HemisphericLight('book-fill', new Vector3(0.1, 1, -0.2), scene);
  fill.intensity = 0.42;
  fill.diffuse = new Color3(0.88, 0.76, 0.58);
  fill.groundColor = new Color3(0.11, 0.07, 0.045);

  const key = new DirectionalLight('book-key', new Vector3(-0.4, -1, 0.5), scene);
  key.position = new Vector3(5, 8, -5);
  key.intensity = 0.82;
  key.diffuse = new Color3(1, 0.82, 0.6);

  const coverMaterial = makePbr(scene, `${variant}-aged-leather`, book.coverColor, 0.78, 0.02);
  coverMaterial.albedoTexture = createLeatherTexture(scene);
  coverMaterial.albedoColor = new Color3(0.72, 0.62, 0.55);
  const coverEdgeMaterial = makePbr(scene, `${variant}-cover-edge`, book.coverEdgeColor, 0.89, 0.01);
  const paperMaterial = makePbr(scene, `${variant}-warm-paper`, book.paperColor, 0.97, 0);
  paperMaterial.backFaceCulling = false;
  const turnPaperMaterial = variant === 'community'
    ? makePbr(scene, 'community-turning-paper', '#dfc991', 0.91, 0)
    : paperMaterial;
  turnPaperMaterial.alpha = 1;
  turnPaperMaterial.backFaceCulling = false;
  if (variant === 'community') turnPaperMaterial.emissiveColor = new Color3(0.09, 0.064, 0.032);
  const turnPaperBackingMaterial = variant === 'community'
    ? makePbr(scene, 'community-turning-paper-backing', '#a98c5d', 0.94, 0)
    : null;
  if (turnPaperBackingMaterial) {
    turnPaperBackingMaterial.alpha = 1;
    turnPaperBackingMaterial.backFaceCulling = false;
    turnPaperBackingMaterial.emissiveColor = new Color3(0.035, 0.024, 0.012);
  }
  const pageEdgeMaterial = makePbr(scene, `${variant}-page-edges`, book.pageEdgeColor, 0.94, 0);
  pageEdgeMaterial.albedoTexture = createPageEdgeTexture(scene);
  const brassMaterial = makePbr(scene, `${variant}-aged-brass`, book.brassColor, 0.48, 0.68);

  const root = new TransformNode('book-root', scene);
  root.position = vectorFrom(currentPose.rootPosition);
  root.rotation.y = currentPose.rootRotationY;
  root.scaling = new Vector3(currentPose.rootScale, currentPose.rootScale, currentPose.rootScale);

  const backCover = MeshBuilder.CreateBox('back-cover', {
    width: book.pageWidth + 0.18,
    height: book.coverThickness,
    depth: book.pageDepth + 0.18,
  }, scene);
  backCover.parent = root;
  backCover.position = new Vector3(book.pageWidth / 2, 0.08, 0);
  backCover.material = coverMaterial;

  const rightPages = MeshBuilder.CreateBox('right-page-block', {
    width: book.pageWidth,
    height: book.pageBlockThickness,
    depth: book.pageDepth,
  }, scene);
  rightPages.parent = root;
  rightPages.position = new Vector3(book.pageWidth / 2, 0.31, 0);
  rightPages.material = pageEdgeMaterial;

  const rightPageTop = MeshBuilder.CreateBox('right-page-top', {
    width: book.pageWidth - 0.05,
    height: 0.035,
    depth: book.pageDepth - 0.05,
  }, scene);
  rightPageTop.parent = root;
  rightPageTop.position = new Vector3(book.pageWidth / 2, book.pageTopY, 0);
  rightPageTop.material = paperMaterial;

  const leftPages = MeshBuilder.CreateBox('left-page-block', {
    width: book.pageWidth,
    height: book.pageBlockThickness,
    depth: book.pageDepth,
  }, scene);
  leftPages.parent = root;
  leftPages.position = new Vector3(-book.pageWidth / 2, 0.31, 0);
  leftPages.material = pageEdgeMaterial;
  leftPages.isVisible = false;

  const leftPageTop = MeshBuilder.CreateBox('left-page-top', {
    width: book.pageWidth - 0.05,
    height: 0.035,
    depth: book.pageDepth - 0.05,
  }, scene);
  leftPageTop.parent = root;
  leftPageTop.position = new Vector3(-book.pageWidth / 2, book.pageTopY, 0);
  leftPageTop.material = paperMaterial;
  leftPageTop.isVisible = false;

  const spine = MeshBuilder.CreateBox('book-spine', {
    width: 0.2,
    height: 0.64,
    depth: book.pageDepth + 0.24,
  }, scene);
  spine.parent = root;
  spine.position = new Vector3(-0.06, 0.32, 0);
  spine.material = coverEdgeMaterial;

  const roundedSpine = MeshBuilder.CreateCylinder('rounded-book-spine', {
    diameter: 0.78,
    height: book.pageDepth + 0.25,
    tessellation: 32,
  }, scene);
  roundedSpine.parent = root;
  roundedSpine.position = new Vector3(-0.09, 0.35, 0);
  roundedSpine.rotation.x = Math.PI / 2;
  roundedSpine.scaling.x = 0.72;
  roundedSpine.material = coverMaterial;

  for (const [index, z] of [-0.4, -0.2, 0, 0.2, 0.4].map((position) => position * book.pageDepth).entries()) {
    const rib = MeshBuilder.CreateTorus(`spine-rib-${index}`, {
      diameter: 0.83,
      thickness: 0.085,
      tessellation: 24,
    }, scene);
    rib.parent = root;
    rib.position = new Vector3(-0.09, 0.35, z);
    rib.rotation.x = Math.PI / 2;
    rib.scaling.x = 0.72;
    rib.material = coverEdgeMaterial;
  }

  const coverPivot = new TransformNode('front-cover-pivot', scene);
  coverPivot.parent = root;
  coverPivot.position = new Vector3(0, book.closedCoverY, 0);

  const frontCover = MeshBuilder.CreateBox('front-cover', {
    width: book.pageWidth + 0.18,
    height: book.coverThickness,
    depth: book.pageDepth + 0.18,
  }, scene);
  frontCover.parent = coverPivot;
  frontCover.position = new Vector3(book.pageWidth / 2, 0, 0);
  frontCover.material = coverMaterial;

  const coverInset = MeshBuilder.CreateBox('front-cover-raised-panel', {
    width: book.pageWidth - 0.34,
    height: 0.035,
    depth: book.pageDepth - 0.34,
  }, scene);
  coverInset.parent = coverPivot;
  coverInset.position = new Vector3(book.pageWidth / 2, 0.095, 0);
  coverInset.material = coverMaterial;

  const clasp = MeshBuilder.CreateBox('book-clasp', { width: 0.22, height: 0.22, depth: 0.62 }, scene);
  clasp.parent = coverPivot;
  clasp.position = new Vector3(book.pageWidth + 0.06, 0, 0);
  clasp.material = brassMaterial;

  const coverArtwork = createCoverArtwork(scene, coverPivot, book, variant);

  const turnPivot = new TransformNode('turn-page-pivot', scene);
  turnPivot.parent = root;
  turnPivot.position = new Vector3(0, book.turnBaseY, 0);

  const turnLeaf = MeshBuilder.CreateBox('turn-page-leaf', {
    width: book.pageWidth - 0.08,
    height: variant === 'community' ? 0.04 : 0.026,
    depth: book.pageDepth - 0.08,
  }, scene);
  turnLeaf.parent = turnPivot;
  turnLeaf.material = turnPaperMaterial;
  turnLeaf.isVisible = false;
  turnLeaf.visibility = 0;
  turnLeaf.renderingGroupId = 3;
  let turnLeafBacking = null;
  if (turnPaperBackingMaterial) {
    turnLeafBacking = MeshBuilder.CreateBox('community-turn-page-backing', {
      width: book.pageWidth - 0.055,
      height: 0.014,
      depth: book.pageDepth - 0.055,
    }, scene);
    turnLeafBacking.parent = turnLeaf;
    turnLeafBacking.position.y = -0.029;
    turnLeafBacking.material = turnPaperBackingMaterial;
    turnLeafBacking.renderingGroupId = 3;
    turnLeafBacking.isPickable = false;
    turnLeafBacking.isVisible = false;
    turnLeafBacking.visibility = 0;
  }

  let opened = false;
  let busy = false;
  let layoutFrame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function applyPose(pose) {
    currentPose = pose;
    camera.position.copyFrom(vectorFrom(pose.cameraPosition));
    camera.setTarget(vectorFrom(pose.target));
    configureCamera(camera, canvas, pose.orthoHeight);
    root.position.copyFrom(vectorFrom(pose.rootPosition));
    root.rotation.y = pose.rootRotationY;
    root.scaling.setAll(pose.rootScale);
  }

  function projectLocal(mesh, point) {
    mesh.computeWorldMatrix(true);
    const viewport = new Viewport(0, 0, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    return Vector3.Project(point, mesh.getWorldMatrix(), scene.getTransformMatrix(), viewport);
  }

  function projectSurface(mesh, width, depth) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const projected = [
      projectLocal(mesh, new Vector3(-halfWidth, 0.04, -halfDepth)),
      projectLocal(mesh, new Vector3(halfWidth, 0.04, -halfDepth)),
      projectLocal(mesh, new Vector3(halfWidth, 0.04, halfDepth)),
      projectLocal(mesh, new Vector3(-halfWidth, 0.04, halfDepth)),
    ];
    return {
      ...rectFromPoints(projected),
      corners: {
        topLeft: projected[3],
        topRight: projected[2],
        bottomRight: projected[1],
        bottomLeft: projected[0],
      },
    };
  }

  function projectBox(mesh, width, height, depth) {
    const points = [];
    for (const x of [-width / 2, width / 2]) {
      for (const y of [-height / 2, height / 2]) {
        for (const z of [-depth / 2, depth / 2]) {
          points.push(projectLocal(mesh, new Vector3(x, y, z)));
        }
      }
    }
    return rectFromPoints(points);
  }

  function getPresentationLayout() {
    scene.render();
    const pageWidth = book.pageWidth - 0.72;
    const pageDepth = book.pageDepth - 0.52;
    const leftPage = projectSurface(leftPageTop, pageWidth, pageDepth);
    const rightPage = projectSurface(rightPageTop, pageWidth, pageDepth);
    const content = unionRects(leftPage, rightPage);
    const leafWidth = book.pageWidth - 0.05;
    const leafDepth = book.pageDepth - 0.05;
    const backPage = currentPresentationMode === 'mobile' ? rightPageTop : leftPageTop;
    const back = projectLocal(backPage, new Vector3(-leafWidth / 2, 0.05, -leafDepth * 0.28));
    const forward = projectLocal(rightPageTop, new Vector3(leafWidth / 2, 0.05, -leafDepth * 0.28));
    const category = projectLocal(rightPageTop, new Vector3(leafWidth / 2, 0.05, leafDepth * 0.23));
    const ribbon = projectLocal(rightPageTop, new Vector3(-leafWidth / 2 + 0.06, 0.055, leafDepth / 2 - 0.2));
    const claspRect = projectBox(clasp, 0.22, 0.22, 0.62);

    return {
      content,
      leftPage,
      rightPage,
      markers: { back: { x: back.x, y: back.y }, forward: { x: forward.x, y: forward.y } },
      category: { x: category.x, y: category.y },
      ribbon: { x: ribbon.x, y: ribbon.y },
      clasp: claspRect,
    };
  }

  function publishLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      onLayout?.(getPresentationLayout());
    });
  }

  function duration(value) {
    return reducedMotion.matches ? 1 : value;
  }

  async function open(onPagesReady) {
    if (busy || opened) return;
    busy = true;
    const closedPose = getPresentationPose(currentPresentationMode, 'closed', variant);
    const openPose = getPresentationPose(currentPresentationMode, 'open', variant);
    leftPages.isVisible = false;
    leftPageTop.isVisible = false;
    coverArtwork.isVisible = true;
    coverPivot.position.y = book.closedCoverY;
    applyPose(closedPose);

    await animate({
      duration: duration(1120),
      midpoint: () => {
        leftPages.isVisible = true;
        leftPageTop.isVisible = true;
      },
      update: (_value, raw) => {
        // Lift and enlarge the journal first, then let the cover follow. This
        // keeps the hand-off grounded instead of making it spring open in one
        // mechanically uniform motion.
        const poseProgress = smoothstep(0, 0.88, raw);
        const coverProgress = smoothstep(0.08, 0.92, raw);
        applyPose(interpolatePresentationPose(closedPose, openPose, poseProgress));
        coverPivot.rotation.z = Math.PI * coverProgress;
        const coverSettle = smoothstep(0.58, 1, raw);
        coverPivot.position.y = book.closedCoverY + (book.openCoverY - book.closedCoverY) * coverSettle;
        coverArtwork.isVisible = coverProgress < 0.48;
      },
    });

    applyPose(getPresentationPose(currentPresentationMode, 'open', variant));
    coverPivot.rotation.z = Math.PI;
    coverPivot.position.y = book.openCoverY;
    coverArtwork.isVisible = false;
    opened = true;
    busy = false;
    onPagesReady?.();
    publishLayout();
  }

  async function close(onPagesCovered) {
    if (busy || !opened) return;
    busy = true;
    const openPose = getPresentationPose(currentPresentationMode, 'open', variant);
    const closedPose = getPresentationPose(currentPresentationMode, 'closed', variant);
    coverPivot.position.y = book.openCoverY;

    await animate({
      duration: duration(1120),
      midpoint: () => {
        onPagesCovered?.();
        leftPages.isVisible = false;
        leftPageTop.isVisible = false;
      },
      update: (_value, raw) => {
        const poseProgress = smoothstep(0.12, 1, raw);
        const coverProgress = smoothstep(0.08, 0.92, raw);
        applyPose(interpolatePresentationPose(openPose, closedPose, poseProgress));
        coverPivot.rotation.z = Math.PI * (1 - coverProgress);
        const coverRise = smoothstep(0, 0.42, raw);
        coverPivot.position.y = book.openCoverY + (book.closedCoverY - book.openCoverY) * coverRise;
        coverArtwork.isVisible = coverProgress > 0.52;
      },
    });

    applyPose(getPresentationPose(currentPresentationMode, 'closed', variant));
    coverPivot.rotation.z = 0;
    coverPivot.position.y = book.closedCoverY;
    coverArtwork.isVisible = true;
    opened = false;
    busy = false;
  }

  async function turnPage(direction = 'forward', onMidpoint) {
    if (busy || !opened) return;
    busy = true;
    const backward = direction === 'backward';
    turnPivot.rotation.z = 0;
    turnPivot.position.y = book.turnBaseY;
    turnLeaf.position = new Vector3(backward ? -book.pageWidth / 2 : book.pageWidth / 2, 0, 0);
    turnLeaf.scaling = new Vector3(1, 1, 1);
    turnLeaf.visibility = 1;
    turnLeaf.isVisible = true;
    if (turnLeafBacking) {
      turnLeafBacking.visibility = 1;
      turnLeafBacking.isVisible = true;
    }

    await animate({
      duration: duration(860),
      midpoint: onMidpoint,
      update: (value) => {
        const angle = Math.PI * value * (backward ? -1 : 1);
        const lift = Math.sin(Math.PI * value);

        turnPivot.rotation.z = angle;
        turnPivot.position.y = book.turnBaseY + lift * 0.10;
        turnLeaf.scaling.z = 1 - lift * 0.022;
        turnLeaf.scaling.x = 1 - lift * 0.012;
        turnLeaf.rotation.x = (backward ? -1 : 1) * lift * 0.018;
      },
    });

    if (turnLeafBacking) {
      turnLeafBacking.visibility = 0;
      turnLeafBacking.isVisible = false;
    }
    turnLeaf.visibility = 0;
    turnLeaf.isVisible = false;
    turnPivot.rotation.z = 0;
    turnPivot.position.y = book.turnBaseY;
    turnLeaf.position = Vector3.Zero();
    turnLeaf.rotation.x = 0;
    turnLeaf.scaling = new Vector3(1, 1, 1);
    busy = false;
    applyPose(getPresentationPose(currentPresentationMode, 'open', variant));
    publishLayout();
  }

  function setPresentationMode(mode) {
    const nextMode = mode === 'mobile' ? 'mobile' : 'desktop';
    if (nextMode === currentPresentationMode) return;
    currentPresentationMode = nextMode;
    if (busy) return;
    applyPose(getPresentationPose(currentPresentationMode, opened ? 'open' : 'closed', variant));
    publishLayout();
  }

  function resize() {
    engine.resize();
    configureCamera(camera, canvas, currentPose.orthoHeight);
    publishLayout();
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  engine.runRenderLoop(() => scene.render());

  return {
    scene,
    engine,
    open,
    close,
    turnPage,
    setPresentationMode,
    getPresentationLayout,
    resize,
    isBusy: () => busy,
    dispose() {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(layoutFrame);
      scene.dispose();
      engine.dispose();
    },
  };
}
