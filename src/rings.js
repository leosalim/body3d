/**
 * Tape rings: the tape of every measured site drawn around the body, so the person sees where
 * each measure was taken and how the fitted body matches it.
 *
 * A ring is the convex hull of the model's cross-section at the level the fit used, grown by the
 * estimated skin-and-fat thickness of that site (a Minkowski sum with a circle), as a thin tube.
 * It hangs from the bone of its segment, so it follows poses.
 */
import { CatmullRomCurve3, Mesh, MeshBasicMaterial, TubeGeometry, Vector3 } from 'three'
import { convexHull, siteGirth } from './fit.js'

const LIMB_BONES = { arm: 'upperarm', forearm: 'forearm', thigh: 'thigh', calf: 'shin' }

/** Bone that carries the ring of a fit site. */
export function ringBone(siteId) {
  const m = /^(arm|forearm|thigh|calf)_([lr])$/.exec(siteId)
  if (m) return `${LIMB_BONES[m[1]]}_${m[2]}`
  return { neck: 'neck', shoulders: 'chest', chest: 'chest', hips: 'pelvis' }[siteId]
}

/**
 * Ring mesh of one fitted site, in the local space of its bone, or null.
 * @param {object} fitModel  prepareFitModel(meta.body)
 * @param {object} site  an entry of `fit.sites` with status 'ok' or 'outlier'
 * @param {number} scale  `fit.scale` (person → model)
 * @param {Float64Array} weights  current region weights
 * @param {number[]} jointPosition  rest position of the bone's joint
 * @param {string} color
 */
export function createRing(fitModel, site, scale, weights, jointPosition, color) {
  const probe = fitModel.siteById[site.site]
  if (!probe) return null
  const g = siteGirth(fitModel, probe, weights)
  const lv = g.level
  const off = (site.fatMm / 2 / 1000) * scale // half the skinfold = the fat ring, in model space
  // outline of the tape: the hull grown by `off` (Minkowski sum with a 12-gon)
  const ring = []
  for (const i of g.hull) {
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2
      ring.push(g.pts[2 * i] + off * Math.cos(t), g.pts[2 * i + 1] + off * Math.sin(t))
    }
  }
  const hull = convexHull(ring, ring.length / 2)
  if (hull.length < 3) return null
  const [e1, e2] = lv.axes
  const jp = jointPosition ?? [0, 0, 0]
  const pts = hull.map((i) => {
    const x = ring[2 * i], y = ring[2 * i + 1]
    return new Vector3(
      lv.origin[0] + e1[0] * x + e2[0] * y - jp[0],
      lv.origin[1] + e1[1] * x + e2[1] * y - jp[1],
      lv.origin[2] + e1[2] * x + e2[2] * y - jp[2])
  })
  const curve = new CatmullRomCurve3(pts, true, 'centripetal')
  const geom = new TubeGeometry(curve, Math.max(64, pts.length * 2), 0.0022, 6, true)
  const mesh = new Mesh(geom, new MeshBasicMaterial({ color, toneMapped: false }))
  mesh.userData.b3dRing = site.site
  mesh.frustumCulled = false
  return mesh
}

export function disposeRing(mesh) {
  mesh.parent?.remove(mesh)
  mesh.geometry.dispose()
  mesh.material.dispose()
}
