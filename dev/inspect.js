// Pipeline inspection page (not part of the build). Loads any GLB and exposes helpers on window
// for automated screenshots: inspect.html?glb=/models/male.glb (or /dev/debug.glb from
// pipeline/debug_export.py), optional &lines=/dev/fibres.json to overlay polylines.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const params = new URLSearchParams(location.search)
const canvas = document.getElementById('c')
const hud = document.getElementById('hud')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1d1f24)
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50)
const controls = new OrbitControls(camera, canvas)
scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.6))
const key = new THREE.DirectionalLight(0xffffff, 2.2)
key.position.set(1.5, 3, 2.5)
scene.add(key)
const rim = new THREE.DirectionalLight(0xffffff, 1.2)
rim.position.set(-2, 1.5, -2.5)
scene.add(rim)

let root = null
const nodes = []

function resize() {
  const w = innerWidth, h = innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

function frame(box) {
  const c = box.getCenter(new THREE.Vector3())
  const s = box.getSize(new THREE.Vector3())
  controls.target.copy(c)
  const d = Math.max(s.y, s.x) / 2 / Math.tan((camera.fov * Math.PI) / 360) * 1.1
  camera.position.set(c.x, c.y, c.z + d)
  controls.update()
}

const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0],
  top: [0, 1, 0.001], quarter: [0.7, 0.15, 0.7], backquarter: [-0.7, 0.15, -0.7]
}

window.setView = (name, zoomBox) => {
  const box = zoomBox
    ? new THREE.Box3(new THREE.Vector3(...zoomBox[0]), new THREE.Vector3(...zoomBox[1]))
    : new THREE.Box3().setFromObject(root)
  const c = box.getCenter(new THREE.Vector3())
  const s = box.getSize(new THREE.Vector3())
  const dir = new THREE.Vector3(...VIEWS[name]).normalize()
  const d = Math.max(s.x, s.y, s.z) / 2 / Math.tan((camera.fov * Math.PI) / 360) * 1.05
  controls.target.copy(c)
  camera.position.copy(c).addScaledVector(dir, d + Math.max(s.x, s.z) / 2)
  controls.update()
  renderer.render(scene, camera)
}

/** Shows only the nodes whose name matches `show` (regex); highlights those matching `hl`. */
window.filter = (show, hl) => {
  const rs = show ? new RegExp(show, 'i') : null
  const rh = hl ? new RegExp(hl, 'i') : null
  for (const n of nodes) {
    n.visible = !rs || rs.test(n.name)
    if (n.material) {
      if (!n.userData.baseMat) n.userData.baseMat = n.material
      n.material = rh && rh.test(n.name) ? hlMat : n.userData.baseMat
    }
  }
  renderer.render(scene, camera)
}
const hlMat = new THREE.MeshStandardMaterial({ color: 0x33c3ff, roughness: 0.5 })

window.names = () => nodes.map((n) => n.name)
/** Names of the meshes under the given pixels (window coordinates), front to back. */
window.pick = (points) => {
  const ray = new THREE.Raycaster()
  return points.map(([px, py]) => {
    ray.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera)
    const hits = ray.intersectObjects(nodes.filter((n) => n.visible), false)
    const seen = []
    for (const h of hits) if (!seen.includes(h.object.name)) seen.push(h.object.name)
    return `${px},${py}: ${seen.slice(0, 4).join('  >  ')}`
  })
}
window.boxOf = (re) => {
  const r = new RegExp(re, 'i')
  const box = new THREE.Box3()
  for (const n of nodes) if (r.test(n.name)) box.expandByObject(n)
  return [box.min.toArray(), box.max.toArray()]
}

// ?lines=/dev/x.json → { fibers: [[[x,y,z],...], ...] } drawn on top, coloured by index
if (params.get('lines')) {
  fetch(params.get('lines')).then((r) => r.json()).then(({ fibers }) => {
    fibers.forEach((f, k) => {
      const g = new THREE.BufferGeometry().setFromPoints(f.map((p) => new THREE.Vector3(...p)))
      const c = new THREE.Color().setHSL((k / fibers.length) * 0.8, 1, 0.45)
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, depthTest: false }))
      line.renderOrder = 10
      scene.add(line)
    })
  })
}

const url = params.get('glb') ?? '/dev/debug.glb'
new GLTFLoader().load(url, (gltf) => {
  root = gltf.scene
  scene.add(root)
  root.traverse((o) => { if (o.isMesh) nodes.push(o) })
  frame(new THREE.Box3().setFromObject(root))
  hud.textContent = `${nodes.length} meshes`
  window.ready = true
})

function loop() {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
loop()
