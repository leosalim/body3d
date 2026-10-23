// Reads the JSON chunk of a body3d .glb (the scene extras) — for scripts and tests in Node.
import { readFileSync } from 'node:fs'

const GLB_MAGIC = 0x46546c67 // "glTF"

export function readGlbJson(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB file`)
  const len = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'))
}

/** `extras.body` of a model (what the viewer gets as `meta.body`). */
export function readBody(path) {
  return readGlbJson(path).extras.body
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }

/** JSON and binary chunks of a GLB. */
export function readGlb(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB file`)
  const len = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'))
  const binAt = 20 + len
  return { json, bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)) }
}

/** `count` elements of `k` components from a buffer view, honouring its byte stride. */
function view(glb, viewIndex, Type, offset, count, k = 1) {
  const bv = glb.json.bufferViews[viewIndex]
  const size = Type.BYTES_PER_ELEMENT
  const stride = bv.byteStride ?? k * size
  const start = glb.bin.byteOffset + (bv.byteOffset ?? 0) + (offset ?? 0)
  const out = new Type(count * k)
  for (let i = 0; i < count; i++) {
    // copy element by element: the views are padded (int16 × 3 in 8 bytes) and not always aligned
    const at = start + i * stride
    out.set(new Type(glb.bin.buffer.slice(at, at + k * size)), i * k)
  }
  return out
}

/** An accessor as a Float64Array of components (normalized values divided out, sparse applied). */
export function readAccessor(glb, index) {
  const a = glb.json.accessors[index]
  const k = COMPONENTS[a.type]
  const out = new Float64Array(a.count * k)
  const scale = a.normalized ? NORM[a.componentType] : 1
  if (a.bufferView != null) {
    const src = view(glb, a.bufferView, ARRAYS[a.componentType], a.byteOffset, a.count, k)
    for (let i = 0; i < src.length; i++) out[i] = src[i] / scale
  }
  if (a.sparse) {
    const { count, indices, values } = a.sparse
    const idx = view(glb, indices.bufferView, ARRAYS[indices.componentType], indices.byteOffset, count)
    const val = view(glb, values.bufferView, ARRAYS[a.componentType], values.byteOffset, count, k)
    for (let i = 0; i < count; i++) for (let c = 0; c < k; c++) out[idx[i] * k + c] = val[i * k + c] / scale
  }
  return out
}

/**
 * The soft meshes of a body3d model in metres: positions at the minimum FFMI, triangle indices,
 * the part of every vertex and one displacement per region (`targets[region id]`). A vertex at
 * region weights w is `position + Σ w_r · targets[r]` (docs/model-format.md).
 */
export function readSoftMeshes(path) {
  const glb = readGlb(path)
  const { json } = glb
  // dequantization, folded into every inverse bind matrix: IBM_j = T(−joint_j) · D
  const ibm = readAccessor(glb, json.skins[0].inverseBindMatrices)
  const joint0 = json.extras.joints[0].position
  const half = ibm[0]
  const center = [0, 1, 2].map((c) => ibm[12 + c] + joint0[c])
  const meshes = []
  for (const mesh of json.meshes) {
    if (!mesh.name.startsWith('soft')) continue
    const prim = mesh.primitives[0]
    const q = readAccessor(glb, prim.attributes.POSITION)
    const position = q.map((x, i) => x * half + center[i % 3])
    const targets = {}
    ;(prim.targets ?? []).forEach((t, i) => {
      targets[mesh.extras.targetNames[i]] = readAccessor(glb, t.POSITION).map((x) => x * half)
    })
    meshes.push({ name: mesh.name, position, index: readAccessor(glb, prim.indices), part: readAccessor(glb, prim.attributes._PART), targets })
  }
  return { meshes, parts: json.extras.parts, regions: json.extras.body.regions }
}

/**
 * Signed volume (m³) of every part (indexed like `parts`) at region weights `w` (one per region id
 * of `regions`), relative to `origin`. Meaningful for closed parts only: moving the origin changes
 * the volume of an open one (the cut rectus abdominis and abdominal wall are closed together).
 */
export function partVolumes({ meshes, parts, regions }, w, origin = [0, 0, 0]) {
  const vol = new Float64Array(parts.length)
  const [ox, oy, oz] = origin
  for (const m of meshes) {
    const p = Float64Array.from(m.position)
    for (const [rid, d] of Object.entries(m.targets)) {
      const wr = w[regions.indexOf(rid)]
      for (let i = 0; i < p.length; i++) p[i] += wr * d[i]
    }
    const idx = m.index
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ax = p[a] - ox, ay = p[a + 1] - oy, az = p[a + 2] - oz
      const bx = p[b] - ox, by = p[b + 1] - oy, bz = p[b + 2] - oz
      const cx = p[c] - ox, cy = p[c + 1] - oy, cz = p[c + 2] - oz
      vol[m.part[idx[t]]] += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    }
  }
  return vol
}
