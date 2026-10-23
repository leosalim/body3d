/**
 * GPU picking: the scene drawn with the pick material, which writes each fragment's part index
 * (+1, 16 bits in red and green) instead of a colour. One pass answers "which part is under this
 * pixel" exactly, with skinning, morphs and poses applied, at the cost of a 1×1 render — no
 * raycast against hundreds of thousands of deformed triangles on the CPU.
 */
import { Color } from 'three'

/**
 * Renders `scene` from `camera` into `target` with every mesh drawn by `material`, then puts the
 * renderer and the scene back as they were.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {import('three').WebGLRenderTarget} target
 * @param {object} pass
 * @param {import('three').Material} pass.material  the pick material
 * @param {import('three').Object3D[]} [pass.hide]   objects without a part index (ground, tape rings)
 * @param {import('three').Object3D[]} [pass.show]   objects to draw even if hidden (bones occlude muscles)
 */
export function renderIds(renderer, scene, camera, target, { material, hide = [], show = [] }) {
  const saved = {
    background: scene.background,
    override: scene.overrideMaterial,
    target: renderer.getRenderTarget(),
    alpha: renderer.getClearAlpha(),
    color: renderer.getClearColor(new Color()),
    hidden: hide.map((o) => o.visible),
    shown: show.map((o) => o.visible)
  }
  scene.background = null
  scene.overrideMaterial = material
  for (const o of hide) o.visible = false
  for (const o of show) o.visible = true
  try {
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, camera)
  } finally {
    renderer.setRenderTarget(saved.target)
    renderer.setClearColor(saved.color, saved.alpha)
    scene.overrideMaterial = saved.override
    scene.background = saved.background
    hide.forEach((o, i) => { o.visible = saved.hidden[i] })
    show.forEach((o, i) => { o.visible = saved.shown[i] })
  }
}
