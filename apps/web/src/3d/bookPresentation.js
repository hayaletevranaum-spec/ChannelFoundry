export const PRESENTATION_POSES = Object.freeze({
  desktop: Object.freeze({
    closed: Object.freeze({
      // Match the photographed journal resting on the desk. The former pose
      // belonged to the old, larger launcher and made the 3D book jump upward
      // and almost double in size as soon as the opening animation started.
      cameraPosition: Object.freeze([0, 6.2, -7.8]),
      target: Object.freeze([0, 0.15, 0]),
      orthoHeight: 13.7,
      rootPosition: Object.freeze([-2.003, 0, -5.11]),
      rootScale: 1.04,
      rootRotationY: -0.025,
    }),
    open: Object.freeze({
      cameraPosition: Object.freeze([0, 10.0, -1.95]),
      target: Object.freeze([0, 0.22, 0.08]),
      orthoHeight: 6.0,
      rootPosition: Object.freeze([0, 0, 0.06]),
      rootScale: 1.04,
      rootRotationY: -0.035,
    }),
  }),
  mobile: Object.freeze({
    closed: Object.freeze({
      cameraPosition: Object.freeze([0, 6.2, -7.8]),
      target: Object.freeze([0, 0.15, 0]),
      orthoHeight: 17.15,
      rootPosition: Object.freeze([-2.364, 0, -5.91]),
      rootScale: 1.02,
      rootRotationY: -0.02,
    }),
    open: Object.freeze({
      cameraPosition: Object.freeze([2.42, 9.45, -3.05]),
      target: Object.freeze([2.42, 0.22, 0.08]),
      orthoHeight: 7.25,
      rootPosition: Object.freeze([0, 0, 0.06]),
      rootScale: 1.04,
      rootRotationY: 0,
    }),
  }),
});

export const COMMUNITY_PRESENTATION_POSES = Object.freeze({
  desktop: Object.freeze({
    closed: Object.freeze({
      cameraPosition: Object.freeze([0, 6.2, -7.8]),
      target: Object.freeze([0, 0.15, 0]),
      orthoHeight: 15.35,
      rootPosition: Object.freeze([-8.62, 0, -5.72]),
      rootScale: 1.02,
      rootRotationY: -0.06,
    }),
    open: Object.freeze({
      cameraPosition: Object.freeze([0, 10.0, -1.95]),
      target: Object.freeze([0, 0.22, 0.08]),
      orthoHeight: 6.75,
      rootPosition: Object.freeze([0, 0, 0.06]),
      rootScale: 1.04,
      rootRotationY: -0.025,
    }),
  }),
  mobile: Object.freeze({
    closed: Object.freeze({
      cameraPosition: Object.freeze([0, 6.2, -7.8]),
      target: Object.freeze([0, 0.15, 0]),
      orthoHeight: 21.6,
      rootPosition: Object.freeze([-4.72, 0, -8.28]),
      rootScale: 1.01,
      rootRotationY: -0.055,
    }),
    open: Object.freeze({
      cameraPosition: Object.freeze([2.03, 9.45, -3.05]),
      target: Object.freeze([2.03, 0.22, 0.08]),
      orthoHeight: 5.2,
      rootPosition: Object.freeze([0, 0, 0.06]),
      rootScale: 1.04,
      rootRotationY: 0,
    }),
  }),
});

export function getPresentationPose(mode = 'desktop', state = 'closed', variant = 'journal') {
  const resolvedMode = mode === 'mobile' ? 'mobile' : 'desktop';
  const resolvedState = state === 'open' ? 'open' : 'closed';
  const poses = variant === 'community' ? COMMUNITY_PRESENTATION_POSES : PRESENTATION_POSES;
  return poses[resolvedMode][resolvedState];
}

const mix = (from, to, amount) => from + (to - from) * amount;
const mixVector = (from, to, amount) => from.map((value, index) => mix(value, to[index], amount));

export function interpolatePresentationPose(from, to, amount) {
  return {
    cameraPosition: mixVector(from.cameraPosition, to.cameraPosition, amount),
    target: mixVector(from.target, to.target, amount),
    orthoHeight: mix(from.orthoHeight, to.orthoHeight, amount),
    rootPosition: mixVector(from.rootPosition, to.rootPosition, amount),
    rootScale: mix(from.rootScale, to.rootScale, amount),
    rootRotationY: mix(from.rootRotationY, to.rootRotationY, amount),
  };
}
