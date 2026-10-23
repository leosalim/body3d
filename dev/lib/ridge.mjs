// Ridge regression with the penalty chosen by cross-validation — the statistical baseline the
// tape-measure fit is compared with (dev/validate-ansur.mjs).
import { solve } from '../../src/linalg.js'

const LAMBDAS = [0, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100]

/** β for standardized columns: (XᵀX + λI) β = Xᵀy. */
function solveRidge(Z, y, lambda) {
  const p = Z[0].length
  const A = Array.from({ length: p }, () => new Array(p).fill(0))
  const b = new Array(p).fill(0)
  for (let i = 0; i < Z.length; i++) {
    const z = Z[i]
    for (let a = 0; a < p; a++) {
      b[a] += z[a] * y[i]
      for (let c = 0; c < p; c++) A[a][c] += z[a] * z[c]
    }
  }
  for (let a = 0; a < p; a++) A[a][a] += lambda
  return solve(A, b)
}

/** Linear model on standardized features with an unpenalized intercept. */
function train(X, y, lambda) {
  const p = X[0].length
  const mean = new Array(p).fill(0), sd = new Array(p).fill(0)
  for (const x of X) for (let j = 0; j < p; j++) mean[j] += x[j] / X.length
  for (const x of X) for (let j = 0; j < p; j++) sd[j] += (x[j] - mean[j]) ** 2 / X.length
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1
  const my = y.reduce((s, v) => s + v, 0) / y.length
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / sd[j]))
  const beta = solveRidge(Z, y.map((v) => v - my), lambda)
  return (x) => my + x.reduce((s, v, j) => s + beta[j] * (v - mean[j]) / sd[j], 0)
}

/**
 * Fits y ≈ f(X) by ridge regression; λ (on standardized features, per sample) is the one with
 * the lowest k-fold cross-validated error. Returns { predict, lambda }.
 */
export function fitRidge(X, y, { folds = 5, lambdas = LAMBDAS } = {}) {
  const n = X.length
  let best = { lambda: 0, mse: Infinity }
  for (const lambda of lambdas) {
    let se = 0
    for (let f = 0; f < folds; f++) {
      const tr = [], te = []
      for (let i = 0; i < n; i++) (i % folds === f ? te : tr).push(i)
      const model = train(tr.map((i) => X[i]), tr.map((i) => y[i]), lambda * tr.length)
      for (const i of te) se += (model(X[i]) - y[i]) ** 2
    }
    if (se / n < best.mse) best = { lambda, mse: se / n }
  }
  return { predict: train(X, y, best.lambda * n), lambda: best.lambda }
}
