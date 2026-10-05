import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { it } from 'vitest'
import * as serialize from '../../src/index.js'

/** The pre-implementation namespace assertion fails as business RED, never as a missing import. */
function emit(value: unknown, format: 'json' | 'yaml' | 'toml'): string {
  /** Only the owning package's public emitter participates in these output contracts. */
  const output = (serialize as unknown as Record<string, unknown>).emitOutput
  assert.equal(typeof output, 'function', '[A28] serialize must provide portable text output')
  return (output as (value: unknown, format: string) => string)(value, format)
}

/** Independent standard-library parsing detects invalid TOML and silent structure changes. */
function toml(value: string): unknown {
  /** MacOS may keep Python 3.9 as python3; admit an installed interpreter with the standard parser. */
  const python = ['python3', 'python3.14', 'python3.13', 'python3.12', 'python3.11'].find(
    (command) => spawnSync(command, ['-c', 'import tomllib'], { encoding: 'utf8' }).status === 0
  )
  assert.ok(python, '[A28] independent TOML checks require an installed Python with tomllib')
  /** Python consumes output bytes on stdin; no fixture file or production parser is introduced. */
  const parsed = spawnSync(
    python,
    ['-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'],
    { input: value, encoding: 'utf8' }
  )
  assert.equal(
    parsed.status,
    0,
    `[A28] independent TOML parser must accept the complete output: ${parsed.stderr}`
  )
  return JSON.parse(parsed.stdout)
}

it('[A28] quoted keys, control characters and nested collections retain their values in all formats', () => {
  /** The same clean object reaches all formats; keys exercise quoting and dotted-key ownership. */
  const value = {
    '': {},
    'a.b': { 'quote"\\\n': 'line\n\t\u0000\u0085😀', list: [[], {}, ['a', false, 1.5]] },
    records: [{ 'x y': 'value' }, { 'x y': 'next' }],
    '123': 'literal',
    finite: [1e21, 1e-20, -2.5]
  }
  assert.deepEqual(JSON.parse(emit(value, 'json')), value)
  assert.deepEqual(parseYaml(emit(value, 'yaml')), value)
  assert.deepEqual(toml(emit(value, 'toml')), value)
})

it('[A28] JSON delegates to the existing json parser after safe data admission', () => {
  /** Native JSON semantics are preserved on already admitted portable data. */
  const value = { text: 'safe', nested: [null, { enabled: true }], number: 3.25 }
  assert.equal(
    emit(value, 'json'),
    (
      serialize.jsonParser().encode(value, {
        signal: new AbortController().signal,
        context: 'output fixture'
      }) as serialize.ISerializeChunk
    )[1]
  )
  assert.deepEqual(parseYaml(emit(value, 'yaml')), value)
})

it('[A30] TOML rejects a root array and null at every depth with the existing native coded error', () => {
  for (const value of [[], null, { absent: null }, { nested: [{ absent: null }] }]) {
    assert.throws(
      () => emit(value, 'toml'),
      { name: 'TypeError', source: '@migaia/serialize', code: 'INVALID_OPTION' },
      '[A30] TOML must reject rather than omit an unrepresentable value'
    )
  }
  assert.equal(emit(null, 'json'), 'null')
  assert.equal(parseYaml(emit(null, 'yaml')), null)
})

it('[A30] cycles, accessors and nonportable values reject without reading getters or revealing data', () => {
  /** This marker may occur in fixture inputs, but never in the emitter diagnostic. */
  const secret = 'a30-private-output-marker'
  /** A cycle exercises whole-input admission before any text can be returned. */
  const cycle: Record<string, unknown> = { secret }
  cycle.self = cycle
  /** Only this count proves the accessor was never evaluated. */
  let reads = 0
  /** A descriptor supplies no data value and therefore must be rejected before invocation. */
  const accessor = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: () => {
      reads += 1
      return secret
    }
  })
  for (const format of ['json', 'yaml', 'toml'] as const) {
    for (const value of [
      cycle,
      accessor,
      { value: Infinity },
      { value: NaN },
      { value: undefined },
      { value: () => secret },
      new Date(0)
    ]) {
      assert.throws(
        () => emit(value, format),
        (error: unknown) => {
          /** Diagnostics keep the native TypeError and canonical semantic identity. */
          const failure = error as TypeError & { source?: string; code?: string }
          assert.ok(failure instanceof TypeError)
          assert.equal(failure.source, '@migaia/serialize')
          assert.equal(failure.code, 'INVALID_OPTION')
          assert.equal(failure.message.includes(secret), false)
          return true
        }
      )
    }
  }
  assert.equal(reads, 0, '[A30] admission must never evaluate an enumerable getter')
})
