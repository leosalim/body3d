// Posing (src/posing.js) on a small synthetic rig, and the breathing timing (src/breath.js).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { PoseRig, blendPoses, poseDistance, poseQuaternions } from '../src/posing.js'
import { breathAt, breathPeriod, normalizeBreath, BREATH_PHASES } from '../src/breath.js'

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

/**
 * A stick body: pelvis at 1 m, a trunk bone up to a head at 1.7 m, one leg down to a foot on the
 * floor. Skeleton mesh: one vertex per bone (the foot's at y = 0); skin mesh: the same points
 * pushed 5 cm out along z (the back of the body is at z = −0.05).
 */
function rig() {
  const pelvis = new Bone(); pelvis.name = 'pelvis'; pelvis.position.set(0, 1, 0)
  const chest = new Bone(); chest.name = 'chest'; chest.position.set(0, 0.4, 0)
  const head = new Bone(); head.name = 'head'; head.position.set(0, 0.3, 0)
  const thigh = new Bone(); thigh.name = 'thigh_l'; thigh.position.set(0.1, 0, 0)
  const foot = new Bone(); foot.name = 'foot_l'; foot.position.set(0, -1, 0)
  pelvis.add(chest, thigh); chest.add(head); thigh.add(foot)
  const bones = [pelvis, chest, head, thigh, foot]
  const root = new Group()
  root.add(pelvis)
  root.updateMatrixWorld(true)
  const mesh = (name, dz) => {
    // the foot's vertex first: PoseRig samples every 7th vertex for the feet
    const pts = [[0.1, 0, dz], [0, 1, dz], [0, 1.4, dz], [0, 1.7, dz], [0.1, 1, dz], [0, 1.2, -dz]]
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3))
    const idx = [4, 0, 1, 2, 3, 1]
    g.setAttribute('skinIndex', new Uint16BufferAttribute(idx.flatMap((i) => [i, 0, 0, 0]), 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(idx.flatMap(() => [1, 0, 0, 0]), 4))
    const m = new SkinnedMesh(g, new MeshBasicMaterial())
    m.name = name
    root.add(m)
    m.bind(new Skeleton(bones))
    return m
  }
  const skeleton = mesh('skeleton', 0)
  const skin = mesh('skin', 0.05)
  const named = Object.fromEntries(bones.map((b) => [b.name, b]))
  return { rig: new PoseRig(named, [skeleton], root, [skeleton, skin]), bones: named }
}

describe('posing', () => {
  test('standing, both groundings agree; turns compose about the body axes, in order', () => {
    const { rig: r } = rig()
    assert.ok(close(r.target({}, { ground: 'body' }).offset, 0))
    assert.ok(close(r.target({}).offset, 0))
    // x first (up turns to forward), then y about the fixed vertical (forward turns to the left)
    const q = poseQuaternions({ chest: [['x', 90], ['y', 90]] }, ['chest']).chest
    const v = new Vector3(0, 1, 0).applyQuaternion(q)
    assert.ok(v.distanceTo(new Vector3(1, 0, 0)) < 1e-9)
  })

  test('lying down: ground on the body puts the skin on the floor, ground on the feet does not', () => {
    const { rig: r } = rig()
    // face up: the body turns back 90° about x, the head goes to −z
    const spec = { pelvis: [['x', -90]] }
    const body = r.target(spec, { ground: 'body' })
    r.apply(body)
    assert.ok(close(r.lowestBody(), r.bodyFloor, 1e-4), `skin rests on the floor (${r.lowestBody()})`)
    const feet = r.target(spec, { ground: 'feet' })
    r.apply(feet)
    assert.ok(r.lowestBody() < r.bodyFloor - 0.04, 'grounded on the foot, the back sinks into the floor')
  })

  test('the box of a posed state, and the state restored after measuring it', () => {
    const { rig: r } = rig()
    const before = r.state()
    const box = r.boxOf(r.target({ pelvis: [['x', -90]] }, { ground: 'body' }))
    assert.ok(box.max.z - box.min.z > 0.9 && box.max.y - box.min.y < 0.2, 'a lying body is long in z, low in y')
    const after = r.state()
    for (const k of Object.keys(before.quats)) assert.ok(before.quats[k].angleTo(after.quats[k]) < 1e-9)
    assert.equal(after.offset, before.offset)
  })

  test('blend and distance between poses', () => {
    const { rig: r } = rig()
    const a = r.target({})
    const b = r.target({ pelvis: [['x', 90]] }, { ground: 'body' })
    assert.ok(close(poseDistance(a, b), Math.PI / 2, 1e-6))
    const mid = blendPoses(a, b, 0.5)
    assert.ok(close(mid.quats.pelvis.angleTo(a.quats.pelvis), Math.PI / 4, 1e-6))
    assert.ok(close(mid.offset, (a.offset + b.offset) / 2))
  })
})

describe('breath', () => {
  const box = { inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 }

  test('phases follow each other with their durations; fill rises, holds, falls', () => {
    assert.deepEqual(BREATH_PHASES, ['inhale', 'holdIn', 'exhale', 'holdOut'])
    assert.equal(breathPeriod(box), 16)
    const at = (s) => breathAt(s, box)
    assert.equal(at(0).phase, 'inhale')
    assert.ok(close(at(0).fill, 0))
    assert.ok(close(at(2).fill, 0.5))
    assert.equal(at(5).phase, 'holdIn')
    assert.ok(close(at(5).fill, 1))
    assert.equal(at(9).phase, 'exhale')
    assert.ok(close(at(10).fill, 0.5))
    assert.equal(at(13).phase, 'holdOut')
    assert.ok(close(at(13).remaining, 3))
    assert.equal(at(17).cycle, 1)
    assert.equal(at(17).phase, 'inhale')
  })

  test('phases of zero length are skipped', () => {
    const s = { inhale: 4, holdIn: 0, exhale: 6, holdOut: 0 }
    assert.equal(breathPeriod(s), 10)
    assert.equal(breathAt(4.5, s).phase, 'exhale')
    assert.equal(breathAt(9.9, s).phase, 'exhale')
    assert.equal(breathAt(10.1, s).phase, 'inhale')
  })

  test('specs are clamped: no breath shorter than a second, no negative phase', () => {
    const n = normalizeBreath({ inhale: -3, exhale: 0, radius: 9 })
    assert.equal(n.holdIn, 0)
    assert.ok(n.inhale + n.exhale >= 1)
    assert.equal(n.radius, 0.4)
    assert.equal(normalizeBreath({}).center.bone, 'chest')
  })
})
