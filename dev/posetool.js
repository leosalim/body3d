// Pose authoring tool (development only). Inject it into a page with `window.viewer` loaded
// (e.g. embed.html) and use it from the console:
//   posetool.surface('external-oblique', 'l', 1.02)        → most lateral point of a part at height y
//   posetool.solveArm('l', [x, y, z], rest, init, elbow)   → arm angles that bring the wrist to a target
// Angles come out in the format of src/poses.js.
;(() => {
  const v = window.viewer
  const V3 = v.camera.position.constructor
  const Q = v.camera.quaternion.constructor
  const AX = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) }

  function apply(spec) {
    const step = new Q()
    for (const [name, b] of Object.entries(v.bones)) {
      const q = new Q()
      for (const [axis, deg] of spec[name] ?? []) {
        step.setFromAxisAngle(AX[axis], (deg * Math.PI) / 180)
        q.premultiply(step)
      }
      b.quaternion.copy(q)
    }
    v.root.updateMatrixWorld(true)
  }

  function world(name) {
    return v.bones[name].getWorldPosition(new V3())
  }

  /** Most lateral vertex (largest |x|) of a part, with the body in its current pose. */
  function surface(base, side, y, band = 0.01) {
    let best = null
    for (const mesh of v.meshes) {
      const part = mesh.geometry.attributes._part
      const pos = mesh.geometry.attributes.position
      const p = new V3()
      for (let i = 0; i < pos.count; i++) {
        const info = v.parts[part.getX(i)]
        if (info.base !== base || info.side !== side) continue
        p.fromBufferAttribute(pos, i)
        mesh.applyBoneTransform(i, p)
        p.applyMatrix4(mesh.matrixWorld)
        if (Math.abs(p.y - y) > band) continue
        if (!best || Math.abs(p.x) > Math.abs(best.x)) best = p.clone()
      }
    }
    return best && best.toArray().map((x) => +x.toFixed(3))
  }

  /**
   * Solves [twist y, abduction z, flexion x] of the humerus and the elbow flexion x so that the
   * wrist (`hand_<side>`) reaches `target`, starting from `init`. `base` is the rest of the pose
   * (left alone). Coordinate descent with decreasing steps.
   */
  function solveArm(side, target, base = {}, init = [0, 20, -10, -90], elbow = null, limits = null) {
    const t = new V3(...target)
    const te = elbow && new V3(...elbow)
    const lim = limits ?? [[-100, 100], [-40, 120], [-120, 60], [-150, 0]]
    const spec = (p) => ({
      ...base,
      [`upperarm_${side}`]: [['y', p[0]], ['z', p[1]], ['x', p[2]]],
      [`forearm_${side}`]: [['x', p[3]]]
    })
    const cost = (p) => {
      apply(spec(p))
      const c = world(`hand_${side}`).distanceTo(t)
      return te ? c + 0.5 * world(`forearm_${side}`).distanceTo(te) : c
    }
    let p = [...init]
    let best = cost(p)
    for (const stepDeg of [16, 8, 4, 2, 1, 0.5]) {
      let improved = true
      while (improved) {
        improved = false
        for (let k = 0; k < 4; k++) {
          for (const dir of [-1, 1]) {
            const q = [...p]
            q[k] = Math.min(lim[k][1], Math.max(lim[k][0], q[k] + dir * stepDeg))
            const c = cost(q)
            if (c < best - 1e-5) { best = c; p = q; improved = true }
          }
        }
      }
    }
    apply(spec(p))
    return { angles: p.map((x) => Math.round(x)), error: +best.toFixed(3),
      hand: world(`hand_${side}`).toArray().map((x) => +x.toFixed(3)),
      elbow: world(`forearm_${side}`).toArray().map((x) => +x.toFixed(3)) }
  }

  window.posetool = { apply, world: (n) => world(n).toArray().map((x) => +x.toFixed(3)), surface, solveArm }
})()
