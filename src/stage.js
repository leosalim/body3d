/**
 * Renderer, lights and ground. A neutral "studio": image-based lighting from three's
 * RoomEnvironment for soft fill, a warm key light from the front right, a cool fill from the
 * left, a back light for the silhouette and a hemisphere light; ACES tone mapping. The ground is
 * a radial contact shadow, not a plane — the body stands on nothing the page has to match.
 */
import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  PMREMGenerator, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Scene, WebGLRenderer
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/** Vertical field of view (degrees): long enough to keep the body's proportions undistorted. */
export const CAMERA_FOV = 28

export function createRenderer(canvas, pixelRatio) {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false })
  r.setPixelRatio(pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, 2))
  r.toneMapping = ACESFilmicToneMapping
  r.toneMappingExposure = 1.05
  r.outputColorSpace = SRGBColorSpace
  return r
}

export function createScene(renderer, background) {
  const scene = new Scene()
  if (background) scene.background = new Color(background)
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()

  const key = new DirectionalLight(0xffffff, 1.6)
  key.position.set(1.2, 2.4, 2.2)
  const fill = new DirectionalLight(0xdfe8ff, 0.55)
  fill.position.set(-2, 1.2, 1.2)
  const back = new DirectionalLight(0xffffff, 0.9)
  back.position.set(-0.6, 1.8, -2.4)
  scene.add(key, fill, back, new HemisphereLight(0xffffff, 0x3a3432, 0.35))
  return scene
}

export function createCamera() {
  return new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 30)
}

/** Soft radial shadow under the feet. Scale it with `fitGround` once the body size is known. */
export function createGround() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.32)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new CanvasTexture(cv)
  const m = new Mesh(new PlaneGeometry(0.9, 0.6),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.001
  m.renderOrder = -1
  return m
}

/** Scales the ground shadow to the body (the plane was sized for a 1.75 m body 0.6 m wide). */
export function fitGround(ground, bodySize) {
  ground.scale.setScalar(Math.max(bodySize.x / 0.6, 1) * (bodySize.y / 1.75))
  ground.position.x = ground.position.z = 0
}

/** Lays the ground shadow under a posed body's box (a body lying down, on all fours). */
export function fitGroundToBox(ground, box) {
  // the plane is 0.9 × 0.6 m, turned flat: its local y runs along the world's −z
  ground.scale.set(Math.max(0.6, box.max.x - box.min.x + 0.3) / 0.9, Math.max(0.4, box.max.z - box.min.z + 0.3) / 0.6, 1)
  ground.position.x = (box.min.x + box.max.x) / 2
  ground.position.z = (box.min.z + box.max.z) / 2
}

export function disposeGround(ground) {
  ground.geometry.dispose()
  ground.material.map?.dispose()
  ground.material.dispose()
}
