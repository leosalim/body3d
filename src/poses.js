/**
 * Classic bodybuilding poses, per sex.
 *
 * Every joint takes a list of rotations [axis, degrees], applied in order about the body axes of
 * the rest pose (the rig has identity rotation standing up): x = the body's left, y = up,
 * z = forward. Useful conventions:
 *   left shoulder/arm: z+ abducts, x− flexes forward, x+ extends backwards,
 *                      y+ rotates externally, y− internally;
 *   elbow and fingers: x− flexes;  knee: x+ flexes;  hip: x− flexes;
 *   ankle: x+ points the foot (plantar flexion);  trunk: y+ turns to the left.
 * Poses are written for the left side and `mirror` builds the right one (x stays, y and z change
 * sign). After posing, the body moves up or down until the lowest foot touches the floor.
 *
 * `activations`: what is contracted in the pose (percent, training-group names or group ids);
 * `view`: suggested camera view; `label`: English and Brazilian Portuguese.
 */

const FINGERS = ['index', 'middle', 'ring', 'pinky']

/** Swaps left ↔ right, mirroring the rotations. */
function mirror(spec) {
  const out = {}
  for (const [name, rots] of Object.entries(spec)) {
    const m = name.match(/^(.*)_(l|r)$/)
    const target = m ? `${m[1]}_${m[2] === 'l' ? 'r' : 'l'}` : name
    out[target] = rots.map(([axis, deg]) => [axis, axis === 'x' ? deg : -deg])
  }
  return out
}

/** Both sides alike (the spec is the left side's). */
function both(spec) {
  return { ...spec, ...mirror(spec) }
}

/** Closed fist (left side by default). */
function fist(side = 'l') {
  const s = {}
  for (const f of FINGERS) {
    s[`${f}1_${side}`] = [['x', -85]]
    s[`${f}2_${side}`] = [['x', -95]]
    s[`${f}3_${side}`] = [['x', -60]]
  }
  s[`thumb2_${side}`] = [['x', -35]]
  s[`thumb3_${side}`] = [['x', -45]]
  return s
}

/** Open hand, fingers together and slightly curled. */
function openHand(side = 'l') {
  const s = {}
  for (const f of FINGERS) {
    s[`${f}1_${side}`] = [['x', -8]]
    s[`${f}2_${side}`] = [['x', -12]]
    s[`${f}3_${side}`] = [['x', -8]]
  }
  return s
}

/** Relaxed hand, fingers half flexed. */
function relaxedHand(side = 'l') {
  const s = {}
  for (const f of FINGERS) {
    s[`${f}1_${side}`] = [['x', -20]]
    s[`${f}2_${side}`] = [['x', -30]]
    s[`${f}3_${side}`] = [['x', -15]]
  }
  return s
}

// ---------------------------------------------------------------- arms
/** Double biceps: shoulder abducted and externally rotated, elbow closed, wrist curled in. */
const doubleBicepsArm = (hand) => ({
  shoulder_l: [['z', 18]],
  upperarm_l: [['y', 90], ['z', 64]],
  forearm_l: [['x', -112]],
  hand_l: [['x', hand === 'open' ? 20 : -20]],
  ...(hand === 'open' ? openHand('l') : fist('l'))
})

/** Front lat spread: fists at the sides of the waist, elbows open forward and out, scapulae
 *  protracted. Angles solved with dev/posetool.js (wrist at (0.21, 1.06, 0.11) m, elbow at
 *  (0.36, 1.25, 0.09) m on the male model). */
const latSpreadArm = {
  shoulder_l: [['y', -14], ['z', 6]],
  upperarm_l: [['y', -71], ['z', 35], ['x', 14]],
  forearm_l: [['x', -69]],
  ...fist('l')
}

/** Hands behind the head. */
const behindHeadArm = {
  shoulder_l: [['z', 22]],
  upperarm_l: [['y', 90], ['z', 92], ['y', 18]],
  forearm_l: [['x', -140]],
  hand_l: [['x', -10]],
  ...openHand('l')
}

/** Relaxed arm, a little away from the body. */
const relaxedArm = (abduct = 12, elbow = -12) => ({
  upperarm_l: [['z', abduct]],
  forearm_l: [['x', elbow]],
  ...relaxedHand('l')
})

// ---------------------------------------------------------------- legs
/** Rear leg on the toes (back poses): shows the calf and the hamstrings. */
const backLegOnToes = { thigh_l: [['x', 10], ['z', 4]], shin_l: [['x', 22]], foot_l: [['x', 32]] }
/** Front leg bent, knee in, on the toes (side poses). */
const frontLegBent = { thigh_l: [['x', -16], ['z', -9]], shin_l: [['x', 34]], foot_l: [['x', 28]] }
/** Leg forward, quadriceps flexed (abdominals and thigh). */
const legForward = { thigh_l: [['x', -14], ['z', 4]], foot_l: [['x', -6]] }
/** Feet a little apart. */
const stance = { thigh_l: [['z', 5]], shin_l: [['z', -5]] }

// ---------------------------------------------------------------- poses
const male = [
  {
    id: 'front-double-biceps', label: { en: 'Front double biceps', 'pt-BR': 'Duplo bíceps de frente' }, view: 'front',
    joints: { ...both(doubleBicepsArm('fist')), ...both(stance), chest: [['x', -4]] },
    activations: { Biceps: 100, Brachialis: 80, 'Anterior Deltoids': 70, 'Lateral Deltoids': 70, Lats: 60,
      Forearms: 70, Trapezius: 50, Quadriceps: 60, Abs: 50, Chest: 40 }
  },
  {
    id: 'front-lat-spread', label: { en: 'Front lat spread', 'pt-BR': 'Dorsal de frente' }, view: 'front',
    joints: { ...both(latSpreadArm), ...both(stance), chest: [['x', -6]] },
    activations: { Lats: 100, 'Lateral Deltoids': 60, Trapezius: 50, Chest: 50, Forearms: 50,
      'Upper Back': 50, Quadriceps: 60, Abs: 40, Obliques: 40 }
  },
  {
    id: 'side-chest', label: { en: 'Side chest', 'pt-BR': 'Peitoral de lado' }, view: 'left',
    joints: {
      // near (left) arm bent with the fist in front of the sternum; the far one crosses over and
      // holds that wrist (angles solved with dev/posetool.js)
      upperarm_l: [['y', -77], ['z', -7], ['x', -24]], forearm_l: [['x', -70]], ...fist('l'),
      upperarm_r: [['y', 46], ['z', -36], ['x', 17]], forearm_r: [['x', -107]], ...fist('r'),
      shoulder_l: [['y', -8]], shoulder_r: [['y', 12]],
      chest: [['y', 16], ['x', -4]], spine_upper: [['y', 8]],
      head: [['y', 26]],
      ...frontLegBent, thigh_r: [['z', -3]]
    },
    activations: { Chest: 100, 'Upper Chest': 100, Biceps: 70, 'Anterior Deltoids': 70, Triceps: 50,
      Forearms: 50, Quadriceps: 70, Calves: 70, Hamstrings: 40 }
  },
  {
    id: 'back-double-biceps', label: { en: 'Back double biceps', 'pt-BR': 'Duplo bíceps de costas' }, view: 'back',
    joints: { ...both(doubleBicepsArm('fist')), ...backLegOnToes, thigh_r: [['z', -4]], chest: [['x', -5]] },
    activations: { Biceps: 100, Lats: 80, Trapezius: 90, 'Upper Back': 90, 'Posterior Deltoids': 80,
      'Rotator Cuff': 60, Triceps: 50, 'Lower Back': 70, Glutes: 60, Hamstrings: 70, Calves: 90 }
  },
  {
    id: 'side-triceps', label: { en: 'Side triceps', 'pt-BR': 'Tríceps de lado' }, view: 'right',
    joints: {
      // near (right) arm straight and locked behind; the far one holds its wrist behind the back
      upperarm_r: [['x', 14], ['z', -4]], forearm_r: [['x', -2]], hand_r: [['x', 10]], ...openHand('r'),
      upperarm_l: [['y', -90], ['x', 36], ['z', 4]], forearm_l: [['x', -88]], ...fist('l'),
      shoulder_r: [['y', -6]],
      chest: [['y', -16]], spine_upper: [['y', -8]],
      head: [['y', -24]],
      ...mirror(frontLegBent), thigh_l: [['z', 3]]
    },
    activations: { Triceps: 100, 'Posterior Deltoids': 60, 'Lateral Deltoids': 60, Chest: 50, Forearms: 40,
      Obliques: 50, Abs: 40, Quadriceps: 70, Calves: 70, Hamstrings: 50 }
  },
  {
    id: 'abs-and-thigh', label: { en: 'Abdominals and thigh', 'pt-BR': 'Abdominal e coxa' }, view: 'front-left',
    joints: { ...both(behindHeadArm), ...legForward, thigh_r: [['z', -3]], chest: [['x', 10]], spine_upper: [['x', 6]],
      head: [['x', 8]] },
    activations: { Abs: 100, Obliques: 90, serratus: 80, Quadriceps: 90, Adductors: 60, 'Hip Flexors': 40,
      Triceps: 30, Lats: 30 }
  }
]

const female = [
  {
    id: 'front-pose', label: { en: 'Front pose (bikini)', 'pt-BR': 'Frente (bikini)' }, view: 'front',
    joints: {
      // left hand on the iliac crest (elbow out), hip shifted, right leg forward (arm angles
      // solved with dev/posetool.js)
      upperarm_l: [['y', -74], ['z', 50], ['x', 16]], forearm_l: [['x', -73]], hand_l: [['x', 12]], ...openHand('l'),
      ...mirror(relaxedArm(14, -14)),
      pelvis: [['z', 5]], spine_lower: [['z', -3]], chest: [['z', -3], ['y', 4]], head: [['z', 4]],
      thigh_l: [['z', -3]], thigh_r: [['z', -7], ['x', -10], ['y', -8]], shin_r: [['x', 16]], foot_r: [['x', 22]]
    },
    activations: { Glutes: 40, Quadriceps: 50, Abs: 50, Obliques: 30, 'Lateral Deltoids': 40, Adductors: 30 }
  },
  {
    id: 'back-pose', label: { en: 'Back pose (bikini)', 'pt-BR': 'Costas (bikini)' }, view: 'back',
    joints: {
      // anterior pelvic tilt and lumbar extension: the glutes stand out
      pelvis: [['x', 10]], spine_lower: [['x', -12]], chest: [['x', 2]], head: [['y', 20]],
      ...both(relaxedArm(10, -14)),
      thigh_l: [['x', -10], ['z', 6]], shin_l: [['x', 12]], foot_l: [['x', 26]],
      thigh_r: [['x', -10], ['z', -2]]
    },
    activations: { Glutes: 100, Abductors: 60, Hamstrings: 60, 'Lower Back': 50, Calves: 50,
      Lats: 30, 'Posterior Deltoids': 30 }
  },
  {
    id: 'side-pose', label: { en: 'Side pose', 'pt-BR': 'Lateral' }, view: 'left',
    joints: {
      // a quarter turn: trunk turned slightly to the front, near leg bent
      ...relaxedArm(10, -18), upperarm_l: [['z', 10], ['x', -8]],
      ...mirror(relaxedArm(10, -14)),
      pelvis: [['x', 6]], spine_lower: [['x', -6]], chest: [['y', 14]], head: [['y', 22]],
      thigh_l: [['x', -12], ['z', -8]], shin_l: [['x', 24]], foot_l: [['x', 24]],
      thigh_r: [['x', -6]]
    },
    activations: { Glutes: 70, Quadriceps: 50, Hamstrings: 50, Calves: 50, 'Lateral Deltoids': 40,
      Abs: 40 }
  },
  {
    id: 'front-double-biceps', label: { en: 'Front double biceps', 'pt-BR': 'Duplo bíceps de frente' }, view: 'front',
    joints: { ...both(doubleBicepsArm('open')), thigh_l: [['z', 7], ['y', 10]], shin_l: [['x', 8]],
      thigh_r: [['z', -4]], chest: [['x', -4]] },
    activations: { Biceps: 100, 'Anterior Deltoids': 60, 'Lateral Deltoids': 70, Lats: 50, Forearms: 40,
      Quadriceps: 60, Abs: 50, Adductors: 30 }
  },
  {
    id: 'back-double-biceps', label: { en: 'Back double biceps', 'pt-BR': 'Duplo bíceps de costas' }, view: 'back',
    joints: { ...both(doubleBicepsArm('open')), ...backLegOnToes, thigh_r: [['z', -4]], chest: [['x', -5]] },
    activations: { Biceps: 90, Lats: 80, Trapezius: 70, 'Upper Back': 80, 'Posterior Deltoids': 70,
      Glutes: 70, Hamstrings: 70, Calves: 80, 'Lower Back': 50 }
  },
  {
    id: 'side-triceps', label: { en: 'Side triceps', 'pt-BR': 'Tríceps de lado' }, view: 'right',
    joints: {
      upperarm_r: [['x', 14], ['z', -4]], forearm_r: [['x', -2]], hand_r: [['x', 10]], ...openHand('r'),
      upperarm_l: [['y', -90], ['x', 36], ['z', 4]], forearm_l: [['x', -88]], ...openHand('l'),
      chest: [['y', -14]], spine_upper: [['y', -6]], head: [['y', -22]],
      ...mirror(frontLegBent), thigh_l: [['z', 3]]
    },
    activations: { Triceps: 100, 'Posterior Deltoids': 50, 'Lateral Deltoids': 60, Glutes: 50, Quadriceps: 60,
      Calves: 60, Obliques: 40 }
  }
]

/** Poses by model sex. */
export const POSES = { male, female }

/** A pose's activations as a list for `setActivations`. */
export function poseActivations(pose) {
  return Object.entries(pose?.activations ?? {}).map(([muscle, activation]) => ({ muscle, activation }))
}
