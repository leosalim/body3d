// Camera views and the automatic default view (src/views.js, src/best-view.js), with a fake renderer.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { VIEWS, FRONT_VIEW, toViewSpec, viewPose, viewFromCamera, fitDistance } from '../src/views.js'
import {
  activationWeights, groupPixels, scoreViews, keyBox, framingZoom, computeBestView, BEST_VIEW_DEFAULTS
} from '../src/best-view.js'

const FRAME = { center: new Vector3(0, 0.9, 0), size: new Vector3(0.6, 1.8, 0.35), fov: 28 }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

describe('views', () => {
  test('presets become specs: front is yaw 0, back 180, the body\'s left 90', () => {
    assert.ok(close(toViewSpec('front').yaw, 0))
    assert.ok(close(Math.abs(toViewSpec('back').yaw), 180))
    assert.ok(close(toViewSpec('left').yaw, 90))
    assert.ok(close(toViewSpec('right').yaw, -90))
    assert.ok(toViewSpec('top').pitch > 80)
    assert.deepEqual(toViewSpec('nonsense'), toViewSpec('front'))
    for (const name of Object.keys(VIEWS)) assert.equal(toViewSpec(name).zoom, 1)
  })

  test('a spec passes through; a direction is normalized', () => {
    const spec = { yaw: 10, pitch: 5, zoom: 2, focus: [0, 0.1, 0] }
    assert.equal(toViewSpec(spec), spec)
    assert.deepEqual(toViewSpec([0, 0, 5]), toViewSpec([0, 0, 1]))
  })

  test('viewPose and viewFromCamera are inverse (up to storage rounding)', () => {
    for (const spec of [FRONT_VIEW, { yaw: -120, pitch: 12, zoom: 1.4, focus: [0.05, 0.2, 0] }, { yaw: 45, pitch: -10, zoom: 0.8, focus: [0, -0.1, 0.02] }]) {
      const { target, position } = viewPose(spec, FRAME, 0.7)
      const back = viewFromCamera(position, target, FRAME, 0.7)
      assert.ok(close(back.yaw, spec.yaw, 0.051), `yaw ${back.yaw} vs ${spec.yaw}`)
      assert.ok(close(back.pitch, spec.pitch, 0.051))
      assert.ok(close(back.zoom, spec.zoom, 0.0051))
      back.focus.forEach((f, i) => assert.ok(close(f, spec.focus[i], 0.00051)))
    }
  })

  test('zoom 2 halves the distance; focus is in body heights', () => {
    const a = viewPose({ yaw: 0, pitch: 0, zoom: 1, focus: [0, 0, 0] }, FRAME, 1)
    const b = viewPose({ yaw: 0, pitch: 0, zoom: 2, focus: [0, 0.5, 0] }, FRAME, 1)
    assert.ok(close(a.position.distanceTo(a.target) / b.position.distanceTo(b.target), 2))
    assert.ok(close(b.target.y - a.target.y, 0.9))
  })

  test('a narrow viewport moves the camera back to keep the width', () => {
    assert.ok(fitDistance(FRAME, 0.2) > fitDistance(FRAME, 1))
  })

  test('pitch and zoom are clamped', () => {
    const { target, position } = viewPose({ yaw: 0, pitch: 120, zoom: 100 }, FRAME, 1)
    const v = viewFromCamera(position, target, FRAME, 1)
    assert.ok(v.pitch <= 85 && v.zoom <= 5)
  })
})

describe('best view', () => {
  const parts = [
    { kind: 'muscle', group: 'traps', base: 'trapezius' },     // large, on the back
    { kind: 'muscle', group: 'delt-side', base: 'deltoid' },   // small, on the side
    { kind: 'muscle', group: 'abs', base: 'rectus' },          // front
    { kind: 'bone', base: 'humerus' }
  ]

  test('weights are activation squared, muscles only, grouped', () => {
    const w = activationWeights(parts, [1, 0.45, 0, 1])
    assert.ok(close(w.weights[0], 1) && close(w.weights[1], 0.2025) && w.weights[3] === 0)
    assert.equal(w.groupWeight.length, 2)
    assert.equal(w.groupOf[2], -1)
    assert.ok(close(w.max, 1))
  })

  test('a group counts by how well a view shows it, not by its size', () => {
    // trapezius: 900 px from the back, 300 from the side; deltoid: 10 px from the side, 2 from the back
    const groupWeight = [1, 1]
    const candidates = [
      { yaw: 180, pitch: 4.6, px: [900, 2] },
      { yaw: 90, pitch: 4.6, px: [300, 10] }
    ]
    // raw pixel counts would pick the back (902 vs 310); per-group fractions: back 1 + 0.2, side 0.33 + 1
    const best = scoreViews(candidates, groupWeight, { ...BEST_VIEW_DEFAULTS, backBonus: 1 })
    assert.equal(best.yaw, 90)
  })

  test('front and back bonuses break near-ties; a raised camera loses', () => {
    const groupWeight = [1]
    const tie = [{ yaw: 45, pitch: 4.6, px: [100] }, { yaw: 0, pitch: 4.6, px: [96] }]
    assert.equal(scoreViews(tie, groupWeight).yaw, 0)
    const raised = [{ yaw: 45, pitch: 16, px: [100] }, { yaw: 45, pitch: 4.6, px: [97] }]
    assert.equal(scoreViews(raised, groupWeight).pitch, 4.6)
  })

  // a fake picking buffer: part 0 fills a rectangle
  function buffer(W, H, x0, x1, y0, y1, id = 0) {
    const buf = new Uint8Array(W * H * 4)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buf[(y * W + x) * 4] = id + 1
    return buf
  }

  test('key box and zoom: small key muscles zoom in, tall ones keep the whole body', () => {
    const W = 90, H = 150
    const weights = Float32Array.of(1)
    const small = keyBox(buffer(W, H, 40, 49, 90, 104), W, H, weights, 0.5)
    assert.deepEqual(small, { x0: 40, x1: 49, y0: 90, y1: 104 })
    assert.equal(framingZoom(small, W, H), BEST_VIEW_DEFAULTS.maxZoom)
    const tall = keyBox(buffer(W, H, 30, 60, 10, 120), W, H, weights, 0.5)
    assert.equal(framingZoom(tall, W, H), 1)
    assert.equal(keyBox(new Uint8Array(W * H * 4), W, H, weights, 0.5), null)
    assert.equal(groupPixels(buffer(W, H, 0, 9, 0, 9), W * H, Int32Array.of(0), 1)[0], 100)
  })

  test('computeBestView renders 16 candidates plus one framing pass and returns a spec', () => {
    let calls = 0
    // part 0 (a small back muscle) is seen only from behind
    const renderIds = (spec, W, H) => {
      calls++
      return Math.abs(spec.yaw) === 180 ? buffer(W, H, 42, 47, 95, 100) : new Uint8Array(W * H * 4)
    }
    const spec = computeBestView({ parts: [parts[0]], activation: [1], frame: FRAME, renderIds })
    assert.equal(calls, 17)
    assert.equal(spec.yaw, 180)
    assert.ok(spec.zoom > 1 && spec.focus.some((f) => f !== 0))
  })

  test('no activation: the front view, without rendering', () => {
    const spec = computeBestView({ parts, activation: [0, 0, 0, 0], frame: FRAME, renderIds: () => { throw new Error('rendered') } })
    assert.deepEqual(spec, FRONT_VIEW)
  })
})
