/**
 * Split view: the current view on the left half, the diametrically opposite side on the right.
 *
 * The right camera sits opposite the left one — rotated 180° about the vertical axis through the
 * target, same height and distance — and the two move together: turning one half to one side
 * turns the other to the opposite side, so they keep showing opposite sides; zoom and pan are
 * shared. Each half has its own OrbitControls on a transparent pane; inertia is off while split,
 * or the two cameras would drift apart between frames.
 */
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createDivider, createPaneLabel, createSplitPanes } from './dom.js'

export class SplitView {
  /** @param {import('./viewer.js').BodyViewer} viewer */
  constructor(viewer) {
    this.viewer = viewer
    this.syncing = false
    const v = viewer
    const c = v.container
    this.camera = v.camera.clone()
    this.panes = createSplitPanes(c)
    this.labels = [createPaneLabel(c, v.strings.yourView, 'left'), createPaneLabel(c, v.strings.oppositeSide, 'right')]
    this.divider = createDivider(c)

    this.damping = v.controls.enableDamping
    v.controls.enableDamping = false
    v.controls.disconnect()
    v.controls.connect(this.panes[0])
    const b = new OrbitControls(this.camera, this.panes[1])
    v._configureControls(b)
    b.enableDamping = false
    b.addEventListener('start', () => { v._cancelViewAnim(); v._userMoved = true; v.controls.autoRotate = false })
    b.addEventListener('end', () => v._emitViewChange())
    b.addEventListener('change', () => { this.follow(b, v.controls); v._dirty = true })
    this.controls = b
  }

  /** Moves `dst` to the point diametrically opposite `src` (unless this call is itself a sync). */
  follow(src, dst = this.controls) {
    if (this.syncing || !src || !dst) return
    this.syncing = true
    const off = src.object.position.clone().sub(src.target)
    dst.target.copy(src.target)
    dst.object.position.set(src.target.x - off.x, src.target.y + off.y, src.target.z - off.z)
    dst.object.up.copy(src.object.up)
    dst.object.lookAt(dst.target)
    dst.update()
    this.syncing = false
  }

  setStrings(strings) {
    this.labels[0].textContent = strings.yourView
    this.labels[1].textContent = strings.oppositeSide
  }

  /** Removes the second camera and the panes, and gives the canvas back to the main controls. */
  dispose() {
    const v = this.viewer
    this.controls.dispose()
    for (const e of [...this.panes, ...this.labels, this.divider]) e.remove()
    v.controls.disconnect()
    v.controls.connect(v.canvas)
    v.controls.enableDamping = this.damping ?? true
  }
}
