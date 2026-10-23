// The statistical helpers of the validation scripts (dev/lib): the baselines the fit is compared
// with must themselves be right.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitRidge } from '../dev/lib/ridge.mjs'
import { deurenbergBodyFat } from '../dev/lib/ansur.mjs'

// deterministic pseudo-random numbers
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('ridge regression recovers a linear relation and picks no penalty when there is no noise', () => {
  const r = rng(7)
  const X = Array.from({ length: 200 }, () => [r() * 10, r() * 5, r() * 2])
  const y = X.map(([a, b, c]) => 3 + 2 * a - 1.5 * b + 0.5 * c)
  const { predict, lambda } = fitRidge(X, y)
  assert.equal(lambda, 0)
  assert.ok(Math.abs(predict([1, 2, 3]) - (3 + 2 - 3 + 1.5)) < 1e-9)
})

test('ridge regression shrinks towards the mean when the features are noise', () => {
  const r = rng(11)
  const X = Array.from({ length: 120 }, () => Array.from({ length: 8 }, () => r()))
  const y = X.map(() => 50 + 4 * (r() - 0.5))
  const { predict, lambda } = fitRidge(X, y)
  assert.ok(lambda > 0)
  const spread = Math.max(...X.map(predict)) - Math.min(...X.map(predict))
  assert.ok(spread < 2, `predictions spread ${spread}`)
})

test('Deurenberg body fat from BMI, age and sex', () => {
  // BMI 24.7, 30 years: 1.2 × 24.69 + 6.9 − 10.8 − 5.4 = 20.3 % (men), 31.1 % (women)
  assert.ok(Math.abs(deurenbergBodyFat({ sex: 'male', heightCm: 180, weightKg: 80, age: 30 }) - 20.33) < 0.01)
  assert.ok(Math.abs(deurenbergBodyFat({ sex: 'female', heightCm: 180, weightKg: 80, age: 30 }) - 31.13) < 0.01)
})
