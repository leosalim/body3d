/**
 * Shading of the body.
 *
 * One material draws every part. Per-part state lives in a 1 × N data texture (one texel per
 * part, indexed by the `_part` vertex attribute), so changing activations, the highlight or the
 * dimming rewrites a few bytes and never touches geometry or materials: the whole body stays a
 * handful of draw calls. The shader is three's MeshStandardMaterial with chunks replaced: colour
 * from the part kind and an activation heat ramp, a rim term, baked ambient occlusion, and
 * dual-quaternion skinning in place of linear blend skinning.
 */
import * as THREE from 'three'

/** Part kinds, in the order of the alpha channel of the part texture. */
export const KIND_CODE = { muscle: 0, tissue: 1, bone: 2, cartilage: 3 }

/** Default colours. Any of them can be replaced with `options.colors` or `viewer.setColors`. */
export const DEFAULT_COLORS = {
  muscle: '#b9a29c',     // at rest: a desaturated pink, so that activation stands out
  tissue: '#ddd6ca',     // tendons and fasciae
  bone: '#ebe4d2',
  cartilage: '#cfd9dd',
  low: '#f7c948',        // activation ramp: amber → orange → red
  mid: '#f0801a',
  high: '#d62839',
  highlight: '#3fa7ff',  // part under the pointer / selected
  rim: '#ffffff',
  tape: '#f2b134',       // tape rings (setMeasureRings)
  tapeOutlier: '#e5484d' // a measure inconsistent with the others
}

/** Colour uniform of each DEFAULT_COLORS key used by the shader. */
const COLOR_UNIFORMS = {
  muscle: 'cMuscle', tissue: 'cTissue', bone: 'cBone', cartilage: 'cCartilage', low: 'cLow', mid: 'cMid',
  high: 'cHigh', highlight: 'cHighlight', rim: 'cRim'
}

/**
 * 1 × N texture with one texel per model part:
 * R = activation (0–255), G = highlight (0 none, 128 hover, 255 selected),
 * B = dimmed (focus on other parts), A = kind × 64.
 */
export function createPartTexture(parts) {
  const data = new Uint8Array(parts.length * 4)
  parts.forEach((p, i) => { data[i * 4 + 3] = (KIND_CODE[p.kind] ?? 0) * 64 })
  const tex = new THREE.DataTexture(data, parts.length, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.magFilter = tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

const VERT_HEAD = /* glsl */`
attribute float _part;
attribute float _ao;
uniform sampler2D partTex;
varying vec4 vPart;
varying float vAo;
`
const VERT_BODY = /* glsl */`
vPart = texelFetch(partTex, ivec2(int(_part + 0.5), 0), 0);
vAo = _ao;
`

const FRAG_HEAD = /* glsl */`
uniform vec3 cMuscle, cTissue, cBone, cCartilage, cLow, cMid, cHigh, cHighlight, cRim;
uniform float rimStrength, dimAmount, aoStrength;
varying vec4 vPart;
varying float vAo;
vec3 heatRamp(float a) {
  return a < 0.5 ? mix(cLow, cMid, a * 2.0) : mix(cMid, cHigh, a * 2.0 - 1.0);
}
`
// replaces `vec4 diffuseColor = vec4( diffuse, opacity );`
const FRAG_COLOR = /* glsl */`
float kind = floor(vPart.a * 255.0 / 64.0 + 0.5);
float act = vPart.r;
vec3 baseCol = kind < 0.5 ? cMuscle : kind < 1.5 ? cTissue : kind < 2.5 ? cBone : cCartilage;
float shown = smoothstep(0.0, 0.06, act);
vec3 col = mix(baseCol, heatRamp(act), shown);
col = mix(col, col * 0.55 + vec3(0.12), vPart.b * dimAmount);
col = mix(col, cHighlight, vPart.g * 0.55);
float ao = mix(1.0, vAo, aoStrength);
col *= ao;
vec4 diffuseColor = vec4( col, opacity );
`
// after `#include <emissivemap_fragment>`
const FRAG_EMISSIVE = /* glsl */`
{
  vec3 vDir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), vDir)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += cRim * fres * rimStrength * (1.0 - vPart.b * dimAmount) * ao;
  totalEmissiveRadiance += heatRamp(act) * shown * 0.22 * act;
  totalEmissiveRadiance += cHighlight * vPart.g * 0.18;
}
`
// after `#include <roughnessmap_fragment>`
const FRAG_ROUGH = /* glsl */`
roughnessFactor = kind < 0.5 ? 0.5 : kind < 1.5 ? 0.38 : kind < 2.5 ? 0.62 : 0.4;
`

// ---------------------------------------------------------------------------
// Dual-quaternion skinning (DQS) in place of three's linear blend skinning
//
// Linear blending (LBS) averages matrices: under a twist (external rotation of the humerus in
// the double biceps) the shoulder and the elbow "collapse". DQS blends rotations as rotations
// and preserves volume (Kavan et al. 2008). The bone matrices of the GLB carry a uniform scale
// (the dequantization of the int16 positions lives in the inverseBindMatrices): it is split off
// (length of the first column) and applied before the rigid part.
// ---------------------------------------------------------------------------
const DQS_HEAD = /* glsl */`
vec4 dqsQuat(mat3 m) {
  float tr = m[0][0] + m[1][1] + m[2][2];
  vec4 q;
  if (tr > 0.0) {
    float s = sqrt(tr + 1.0) * 2.0;
    q = vec4((m[1][2] - m[2][1]) / s, (m[2][0] - m[0][2]) / s, (m[0][1] - m[1][0]) / s, 0.25 * s);
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    float s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
    q = vec4(0.25 * s, (m[1][0] + m[0][1]) / s, (m[2][0] + m[0][2]) / s, (m[1][2] - m[2][1]) / s);
  } else if (m[1][1] > m[2][2]) {
    float s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
    q = vec4((m[1][0] + m[0][1]) / s, 0.25 * s, (m[2][1] + m[1][2]) / s, (m[2][0] - m[0][2]) / s);
  } else {
    float s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
    q = vec4((m[2][0] + m[0][2]) / s, (m[2][1] + m[1][2]) / s, 0.25 * s, (m[0][1] - m[1][0]) / s);
  }
  return q;
}
void dqsAdd(mat4 b, float w, vec4 pivot, inout vec4 real, inout vec4 dual, inout float scale) {
  float s = length(b[0].xyz);
  vec4 q = dqsQuat(mat3(b) / s);
  if (dot(q, pivot) < 0.0) q = -q;
  vec3 t = b[3].xyz;
  vec4 d = 0.5 * vec4(q.w * t + cross(t, q.xyz), -dot(t, q.xyz));
  real += w * q;
  dual += w * d;
  scale += w * s;
}
vec3 dqsRotate(vec4 r, vec3 v) {
  return v + 2.0 * cross(r.xyz, cross(r.xyz, v) + r.w * v);
}
`
const DQS_BASE = /* glsl */`
#ifdef USE_SKINNING
  mat4 boneMatX = getBoneMatrix( skinIndex.x );
  mat4 boneMatY = getBoneMatrix( skinIndex.y );
  mat4 boneMatZ = getBoneMatrix( skinIndex.z );
  mat4 boneMatW = getBoneMatrix( skinIndex.w );
  vec4 dqReal = vec4(0.0);
  vec4 dqDual = vec4(0.0);
  float dqScale = 0.0;
  vec4 dqPivot = dqsQuat(mat3(boneMatX) / length(boneMatX[0].xyz));
  dqsAdd(boneMatX, skinWeight.x, dqPivot, dqReal, dqDual, dqScale);
  dqsAdd(boneMatY, skinWeight.y, dqPivot, dqReal, dqDual, dqScale);
  dqsAdd(boneMatZ, skinWeight.z, dqPivot, dqReal, dqDual, dqScale);
  dqsAdd(boneMatW, skinWeight.w, dqPivot, dqReal, dqDual, dqScale);
  float dqLen = length(dqReal);
  dqReal /= dqLen;
  dqDual /= dqLen;
#endif
`
const DQS_NORMAL = /* glsl */`
#ifdef USE_SKINNING
  objectNormal = mat3(bindMatrixInverse) * dqsRotate(dqReal, mat3(bindMatrix) * objectNormal);
#endif
`
const DQS_POSITION = /* glsl */`
#ifdef USE_SKINNING
  vec3 dqP = (bindMatrix * vec4(transformed, 1.0)).xyz * dqScale;
  dqP = dqsRotate(dqReal, dqP) + 2.0 * (dqReal.w * dqDual.xyz - dqDual.w * dqReal.xyz + cross(dqReal.xyz, dqDual.xyz));
  transformed = (bindMatrixInverse * vec4(dqP, 1.0)).xyz;
#endif
`

/**
 * Replaces three's linear blend skinning by dual-quaternion skinning in a shader being compiled
 * (`material.onBeforeCompile`). Exported for tools that draw the body with their own materials.
 */
export function useDualQuaternionSkinning(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${DQS_HEAD}`)
    .replace('#include <skinbase_vertex>', DQS_BASE)
    .replace('#include <skinnormal_vertex>', DQS_NORMAL)
    .replace('#include <skinning_vertex>', DQS_POSITION)
}

/**
 * three's PBR material with the shader extended to read the part texture, plus dual-quaternion
 * skinning. `material.userData.uniforms` holds the colour and effect uniforms.
 */
export function createBodyMaterial(partTex, colors = {}) {
  const c = { ...DEFAULT_COLORS, ...colors }
  const uniforms = {
    partTex: { value: partTex },
    cMuscle: { value: new THREE.Color(c.muscle) },
    cTissue: { value: new THREE.Color(c.tissue) },
    cBone: { value: new THREE.Color(c.bone) },
    cCartilage: { value: new THREE.Color(c.cartilage) },
    cLow: { value: new THREE.Color(c.low) },
    cMid: { value: new THREE.Color(c.mid) },
    cHigh: { value: new THREE.Color(c.high) },
    cHighlight: { value: new THREE.Color(c.highlight) },
    cRim: { value: new THREE.Color(c.rim) },
    rimStrength: { value: 0.12 },
    dimAmount: { value: 0 },
    aoStrength: { value: 0.85 }
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    useDualQuaternionSkinning(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
  }
  mat.customProgramCacheKey = () => 'body3d'
  mat.userData.uniforms = uniforms
  return mat
}

/** Picking material: writes the part index + 1 (16 bits) into red and green. */
export function createPickMaterial(partTex) {
  const mat = new THREE.MeshBasicMaterial()
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.partTex = { value: partTex }
    useDualQuaternionSkinning(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float _part;\nflat varying float vPartId;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPartId = _part + 1.0;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nflat varying float vPartId;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        `float pid = floor(vPartId + 0.5);
         vec4 diffuseColor = vec4(mod(pid, 256.0) / 255.0, floor(pid / 256.0) / 255.0, 0.0, 1.0);`)
  }
  mat.customProgramCacheKey = () => 'body3d-pick'
  mat.toneMapped = false
  return mat
}

/** Updates the colour uniforms of a body material (keys of DEFAULT_COLORS). */
export function setMaterialColors(material, colors) {
  const u = material.userData.uniforms
  for (const [key, uniform] of Object.entries(COLOR_UNIFORMS)) {
    if (colors[key] != null) u[uniform].value.set(colors[key])
  }
}
