// Small matrix helpers for the calibration (arrays of rows).
import { invert } from '../../src/linalg.js'

export const zeros = (n, m) => Array.from({ length: n }, () => new Array(m).fill(0))
export const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]))
export const multiply = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, x, k) => s + x * B[k][j], 0)))
export const identity = (n) => zeros(n, n).map((r, i) => r.map((_, j) => (i === j ? 1 : 0)))

/**
 * Damped least-squares step: solves (JᵀJ + λ·diag(JᵀJ) + 1e-6·I) δ = −Jᵀr. The tiny floor keeps
 * regions that no residual touches (held fixed by the caller) from making the system singular.
 */
export function leastSquaresStep(rowsJ, residuals, n, damping) {
  const H = zeros(n, n), g = new Array(n).fill(0)
  rowsJ.forEach((J, i) => {
    for (let a = 0; a < n; a++) {
      if (!J[a]) continue
      g[a] += J[a] * residuals[i]
      for (let b = 0; b < n; b++) H[a][b] += J[a] * J[b]
    }
  })
  for (let a = 0; a < n; a++) H[a][a] += damping * H[a][a] + 1e-6
  const Hi = invert(H)
  return Hi.map((row) => -row.reduce((s, x, k) => s + x * g[k], 0))
}

/**
 * Nearest positive-definite matrix: eigen-decomposition by cyclic Jacobi rotations, eigenvalues
 * floored at `eps`. Used after subtracting the modelled noise from an observed covariance.
 */
export function nearestPositiveDefinite(A, eps) {
  const n = A.length
  const a = A.map((r) => [...r])
  const V = identity(n)
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const ev = a.map((r, i) => Math.max(eps, r[i]))
  return V.map((row) => V.map((row2) => row.reduce((s, x, k) => s + x * ev[k] * row2[k], 0)))
}
