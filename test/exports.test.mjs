// The public API: what src/index.js exports is exactly what src/index.d.ts declares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as body3d from '../src/index.js'

test('runtime exports and type declarations match', () => {
  const dts = readFileSync(new URL('../src/index.d.ts', import.meta.url), 'utf8')
  const declared = new Set([...dts.matchAll(/export declare (?:const|function|class) (\w+)/g)].map((m) => m[1]))
  const runtime = new Set(Object.keys(body3d))
  assert.deepEqual([...runtime].filter((k) => !declared.has(k)), [], 'exported but not declared')
  assert.deepEqual([...declared].filter((k) => !runtime.has(k)), [], 'declared but not exported')
})

test('the documented defaults are frozen', () => {
  assert.ok(Object.isFrozen(body3d.DEFAULTS))
  assert.equal(body3d.DEFAULTS.locale, 'en')
  assert.equal(body3d.DEFAULTS.model, 'male')
})
