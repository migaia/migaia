import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectElectronProcessType, detectGlobalScope, detectServerRuntime } from '@migaia/utils'

/** Preserve Vitest's process services while replacing only the host identification fields. */
const originalProcess = globalThis.process

/** Start every case without runtime or browser markers, including the native Node version. */
function clearRuntimeMarkers(): void {
  vi.stubGlobal('process', { ...originalProcess, versions: {} })
  for (const key of [
    'Deno',
    'Bun',
    'Window',
    'DedicatedWorkerGlobalScope',
    'SharedWorkerGlobalScope',
    'ServiceWorkerGlobalScope'
  ])
    vi.stubGlobal(key, undefined)
}

/** Provide the same instance relation used by native global-scope constructors. */
class MatchingScope {
  static [Symbol.hasInstance](value: unknown): boolean {
    return value === globalThis
  }
}

beforeEach(clearRuntimeMarkers)
afterEach(() => vi.unstubAllGlobals())

describe('runtime detection through the package entry', () => {
  it('identifies Electron process types only when the Electron marker exists', () => {
    for (const [type, expected] of [
      ['browser', 'main'],
      ['renderer', 'renderer'],
      ['utility', 'utility'],
      ['worker', undefined]
    ] as const) {
      vi.stubGlobal('process', { ...originalProcess, versions: { electron: '1' }, type })
      expect(detectElectronProcessType()).toBe(expected)
    }
    vi.stubGlobal('process', { ...originalProcess, versions: {}, type: 'browser' })
    expect(detectElectronProcessType()).toBeUndefined()
  })

  it('identifies four global scopes and excludes every server runtime for each scope', () => {
    for (const [constructorName, expected] of [
      ['Window', 'window'],
      ['DedicatedWorkerGlobalScope', 'dedicated-worker'],
      ['SharedWorkerGlobalScope', 'shared-worker'],
      ['ServiceWorkerGlobalScope', 'service-worker']
    ] as const) {
      clearRuntimeMarkers()
      vi.stubGlobal(constructorName, MatchingScope)
      expect(detectGlobalScope()).toBe(expected)
      for (const runtime of ['deno', 'bun', 'node'] as const) {
        vi.stubGlobal('Deno', runtime === 'deno' ? { version: { deno: '1' } } : undefined)
        vi.stubGlobal('Bun', runtime === 'bun' ? {} : undefined)
        vi.stubGlobal('process', {
          ...originalProcess,
          versions: runtime === 'node' ? { node: '1' } : {}
        })
        expect(detectGlobalScope()).toBeUndefined()
      }
    }
  })

  it('requires a matching global instance rather than constructor presence', () => {
    for (const constructorName of [
      'Window',
      'DedicatedWorkerGlobalScope',
      'SharedWorkerGlobalScope',
      'ServiceWorkerGlobalScope'
    ]) {
      vi.stubGlobal(constructorName, class UnrelatedScope {})
      expect(detectGlobalScope()).toBeUndefined()
    }
  })

  it('returns undefined when the supported runtime and scope markers are absent', () => {
    expect(detectServerRuntime()).toBeUndefined()
    expect(detectElectronProcessType()).toBeUndefined()
    expect(detectGlobalScope()).toBeUndefined()
    vi.stubGlobal('Deno', { version: { deno: '' } })
    vi.stubGlobal('Bun', null)
    vi.stubGlobal('process', { ...originalProcess, versions: { bun: '', node: '' } })
    expect(detectServerRuntime()).toBeUndefined()
  })

  it('reads current markers on every call for all three detection functions', () => {
    expect(detectServerRuntime()).toBeUndefined()
    vi.stubGlobal('process', { ...originalProcess, versions: { node: '1' } })
    expect(detectServerRuntime()).toBe('node')
    vi.stubGlobal('process', {
      ...originalProcess,
      versions: { electron: '1' },
      type: 'browser'
    })
    expect(detectElectronProcessType()).toBe('main')
    vi.stubGlobal('process', {
      ...originalProcess,
      versions: { electron: '1' },
      type: 'renderer'
    })
    expect(detectElectronProcessType()).toBe('renderer')
    expect(detectGlobalScope()).toBeUndefined()
    vi.stubGlobal('Window', MatchingScope)
    expect(detectGlobalScope()).toBe('window')
    vi.stubGlobal('Window', undefined)
    vi.stubGlobal('DedicatedWorkerGlobalScope', MatchingScope)
    expect(detectGlobalScope()).toBe('dedicated-worker')
  })

  it('prioritizes Deno over either Bun marker and then Node across every marker combination', () => {
    for (const deno of [false, true])
      for (const bunObject of [false, true])
        for (const bunVersion of [false, true])
          for (const node of [false, true]) {
            vi.stubGlobal('Deno', deno ? { version: { deno: '1' } } : undefined)
            vi.stubGlobal('Bun', bunObject ? {} : undefined)
            vi.stubGlobal('process', {
              ...originalProcess,
              versions: {
                ...(bunVersion ? { bun: '1' } : {}),
                ...(node ? { node: '1' } : {})
              }
            })
            expect(detectServerRuntime()).toBe(
              deno ? 'deno' : bunObject || bunVersion ? 'bun' : node ? 'node' : undefined
            )
          }
  })
})
