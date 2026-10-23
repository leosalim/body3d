/**
 * Posing the rig: joint rotations from a pose description, ground contact and interpolation.
 *
 * A pose (src/poses.js) lists, per joint, rotations `[axis, degrees]` applied in order about the
 * body axes of the rest pose (every bone has identity rotation standing up). After posing, the
 * body moves up or down until it touches the floor: by default the lowest foot (sampled on the
 * skeleton mesh), or — `ground: 'body'`, for poses that rest on hands, knees, the back — the
 * lowest point of the whole skin.
 */
import { Box3, MathUtils, Quaternion, Vector3 } from 'three'

const IDENTITY = new Quaternion()
const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }

/**
 * Quaternion of every bone for a pose description. Each new rotation is applied outside the
 * previous ones (premultiplied), i.e. about the fixed body axes.
 * @param {Record<string, [('x'|'y'|'z'), number][]>} spec
 * @param {string[]} boneNames
 */
export function poseQuaternions(spec, boneNames) {
  const quats = {}
  const step = new Quaternion()
  for (const name of boneNames) {
    const q = new Quaternion()
    for (const [axis, deg] of spec[name] ?? []) {
      step.setFromAxisAngle(AXES[axis], MathUtils.degToRad(deg))
      q.premultiply(step)
    }
    quats[name] = q
  }
  return quats
}

/** A pose state between two others (slerp per bone, linear height offset). */
export function blendPoses(from, to, k) {
  const quats = {}
  for (const name of Object.keys(to.quats)) quats[name] = (from.quats[name] ?? IDENTITY).clone().slerp(to.quats[name], k)
  return { quats, offset: from.offset + (to.offset - from.offset) * k }
}

/** Largest turn of any bone between two states (radians): how far a transition goes. */
export function poseDistance(from, to) {
  let max = 0
  for (const name of Object.keys(to.quats)) max = Math.max(max, (from.quats[name] ?? IDENTITY).angleTo(to.quats[name]))
  return max
}

/** The bones of one loaded model and what posing them needs. */
export class PoseRig {
  /**
   * @param {Record<string, import('three').Bone>} bones  by name
   * @param {import('three').SkinnedMesh[]} skeletonMeshes  meshes of the bones (feet are sampled on them)
   * @param {import('three').Object3D} root  updated after every change
   */
  constructor(bones, skeletonMeshes, root, bodyMeshes = skeletonMeshes) {
    this.bones = bones
    this.skeletonMeshes = skeletonMeshes
    this.bodyMeshes = bodyMeshes
    this.root = root
    this.restPelvis = bones.pelvis.position.clone()
    // vertices of the skeleton bound to the feet and toes (every 7th is enough to find the floor)
    this.footSamples = []
    for (const mesh of skeletonMeshes) {
      const feet = new Set()
      mesh.skeleton.bones.forEach((b, i) => { if (/^(foot|toes)_/.test(b.name)) feet.add(i) })
      const idx = mesh.geometry.attributes.skinIndex
      for (let i = 0; i < idx.count; i += 7) if (feet.has(idx.getX(i))) this.footSamples.push({ mesh, i })
    }
    this.floor = this.lowestFoot()
    // about 3000 skin vertices spread over every mesh, for `ground: 'body'`
    const total = bodyMeshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0)
    const stride = Math.max(1, Math.round(total / 3000))
    this.bodySamples = []
    for (const mesh of bodyMeshes) {
      const n = mesh.geometry.attributes.position.count
      for (let i = 0; i < n; i += stride) this.bodySamples.push({ mesh, i })
    }
    this.bodyFloor = this.lowestBody()
  }

  /** Lowest point of the skin in the current pose (world y), morphs included. */
  lowestBody() {
    const v = new Vector3()
    let min = Infinity
    for (const m of this.bodyMeshes) { m.updateMatrixWorld(true); m.skeleton.update() }
    for (const { mesh, i } of this.bodySamples) {
      mesh.getVertexPosition(i, v)
      v.applyMatrix4(mesh.matrixWorld)
      if (v.y < min) min = v.y
    }
    return min
  }

  /** Height offset that grounds the current rotations (`ground`: 'feet' or 'body'). */
  groundOffset(ground = 'feet') {
    const offset = this.bones.pelvis.position.y - this.restPelvis.y
    return ground === 'body' ? offset + this.bodyFloor - this.lowestBody() : offset + this.floor - this.lowestFoot()
  }

  /** Box of the skeleton in a pose state (world), restoring the current state after. */
  boxOf(state) {
    const saved = this.state()
    this.apply(state)
    const box = new Box3()
    for (const mesh of this.skeletonMeshes) {
      mesh.updateMatrixWorld(true)
      mesh.skeleton.update()
      mesh.computeBoundingBox()
      box.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    }
    this.apply(saved)
    return box
  }

  /** Lowest point of the feet in the current pose (world y). */
  lowestFoot() {
    const v = new Vector3()
    let min = Infinity
    for (const m of this.skeletonMeshes) { m.updateMatrixWorld(true); m.skeleton.update() }
    for (const { mesh, i } of this.footSamples) {
      v.fromBufferAttribute(mesh.geometry.attributes.position, i)
      mesh.applyBoneTransform(i, v)
      v.applyMatrix4(mesh.matrixWorld)
      if (v.y < min) min = v.y
    }
    return min
  }

  /** Current state: every bone's rotation and the pelvis height offset. */
  state() {
    const quats = {}
    for (const [name, b] of Object.entries(this.bones)) quats[name] = b.quaternion.clone()
    return { quats, offset: this.bones.pelvis.position.y - this.restPelvis.y }
  }

  apply(state) {
    for (const [name, b] of Object.entries(this.bones)) b.quaternion.copy(state.quats[name] ?? IDENTITY)
    this.bones.pelvis.position.copy(this.restPelvis)
    this.bones.pelvis.position.y += state.offset
    this.root.updateMatrixWorld(true)
  }

  /**
   * Target state of a pose description: its rotations and the offset that grounds it — on the
   * lowest foot, or (`ground: 'body'`) on the lowest point of the skin.
   */
  target(spec, { ground = 'feet' } = {}) {
    const saved = this.state()
    const quats = poseQuaternions(spec, Object.keys(this.bones))
    this.apply({ quats, offset: 0 })
    const offset = this.groundOffset(ground)
    this.apply(saved)
    return { quats, offset, ground }
  }
}
