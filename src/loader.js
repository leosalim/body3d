/**
 * Model files: where they live, which resolution to load, and a cache shared by every viewer
 * on the page (the GLB is parsed once; each viewer gets its own clone of the scene).
 */
import { Skeleton } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Default folder of the .glb files. It is not derived from `import.meta.url` on purpose: Vite
 * (dev and build) rewrites that pattern inside dependencies and the path breaks. Applications
 * publish the models at this path (the Vite plugin does it) or pass `modelBaseUrl`.
 */
export const DEFAULT_MODEL_BASE_URL = '/body3d/models/'

const cache = new Map()

/**
 * Resolution for `lod: 'auto'`: the lite model on small touch screens (phones), the full one
 * elsewhere. 'high' and 'lite' pass through.
 */
export function pickLod(lod) {
  if (lod !== 'auto') return lod
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const screen = globalThis.screen
  const small = Math.min(screen?.width ?? 1200, screen?.height ?? 1200) < 820
  return coarse && small ? 'lite' : 'high'
}

/** URL of a model: `<base>/<model>[-lite].glb`, relative to the page. */
export function modelUrl(model, lod, base) {
  const b = base || DEFAULT_MODEL_BASE_URL
  return new URL(`${model}${lod === 'lite' ? '-lite' : ''}.glb`, new URL(b.endsWith('/') ? b : `${b}/`, location.href)).href
}

/** Loads (once) and parses a GLB. A failed load leaves the cache, so a retry fetches again. */
export function loadModel(url) {
  if (!cache.has(url)) {
    const p = new GLTFLoader().loadAsync(url)
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return cache.get(url)
}

/** Drops the parsed models (they stay in memory while any page code holds them). */
export function clearModelCache() {
  cache.clear()
}

/**
 * A deep copy of the model's scene for one viewer. After `clone(true)` the skinned meshes still
 * point at the original bones; they are bound again to the cloned ones.
 */
export function cloneModel(gltf) {
  const root = gltf.scene.clone(true)
  const byName = {}
  root.traverse((o) => { if (o.isBone) byName[o.name] = o })
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return
    const bones = o.skeleton.bones.map((b) => byName[b.name])
    o.bind(new Skeleton(bones, o.skeleton.boneInverses.map((m) => m.clone())), o.bindMatrix.clone())
  })
  return root
}
