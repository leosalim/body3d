/**
 * Small dense linear algebra for the fit (n ≈ 15): Gaussian elimination with partial pivoting.
 * Matrices are arrays of rows.
 */

/** Solves A x = b; null when A is singular. */
export function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-14) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/** Inverse of A (column by column); null when A is singular. */
export function invert(A) {
  const n = A.length
  const cols = []
  for (let c = 0; c < n; c++) {
    const e = new Array(n).fill(0)
    e[c] = 1
    const x = solve(A, e)
    if (!x) return null
    cols.push(x)
  }
  return A.map((_, i) => cols.map((col) => col[i]))
}
