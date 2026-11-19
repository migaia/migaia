import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineFeature } from '@migaia/plugin-host/features'
import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineDerive,
  defineEffect,
  defineEnhancer,
  definePart,
  definePartPlugin,
  partCorePlugin,
  type IDiagnosticInfo,
  type IPartHost
} from '../src/index.ts'

/** Trace Feature surface read by the test. */
type ITrace = {
  steps(address: string): readonly { stage: string; enhancer?: string }[]
  events(key: string): readonly { kind: string; name: string; detail?: unknown }[]
  addresses(): readonly string[]
  resolved(address: string): unknown
}

/** Plugin with an enhancer, a derive, a writing effect and a failing effect. */
const app = definePartPlugin({
  name: 'app',
  parts: [definePart({ id: 'page@1' }), definePart({ id: 'button@1' })],
  enhancers: [
    defineEnhancer({
      id: 'label@1',
      targets: ['button'],
      transform: (config) => ({ ...config, aria: { ...config.aria, label: 'Go' } })
    })
  ],
  derives: [defineDerive({ id: 'total@1', compute: (state) => Number(state.read('page.a')) + 1 })],
  effects: [
    defineEffect({ id: 'save@1', run: (_event, ctx) => ctx.state.write('page.a', 2) }),
    defineEffect({
      id: 'boom@1',
      run: () => {
        throw new Error('boom')
      }
    })
  ]
})

/** First blueprint: button with enhancer and derive binding. */
const first = {
  id: 'one',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'p1',
    children: [
      {
        tag: 'button@1',
        id: 'go',
        facets: {
          props: { total: { $derive: 'total@1' } },
          events: { click: { handler: 'save@1' }, focus: { handler: 'boom@1' } }
        }
      }
    ]
  }
}

/** Second blueprint: another node bound to the same derive. */
const second = {
  id: 'two',
  version: 1,
  root: { tag: 'page@1', id: 'p2', facets: { props: { total: { $derive: 'total@1' } } } }
}

/** Installs a probe plugin and returns the trace Feature of a host. */
async function traceOf(host: IPartHost): Promise<ITrace> {
  /** Captured Feature. */
  let trace: ITrace | undefined
  await host.use(
    definePartPlugin({
      name: 'probe',
      features: {
        trace: defineFeature((_core, deps: { readonly trace: object }) => deps.trace, {
          trace: partCorePlugin.getFeature('trace')
        } as never)
      },
      onInstall: (features) => void (trace = features.trace as ITrace)
    })
  )
  return trace as ITrace
}

describe('development trace', () => {
  it('records enhancement steps, events and shared derive recomputations', async () => {
    /** Reports with their info. */
    const reports: { error: unknown; info: IDiagnosticInfo }[] = []
    /** Host under the development condition (vitest resolves `#trace` to the recorder). */
    const host = await createPartHost({
      plugins: [app],
      onError: (error, info) => reports.push({ error, info })
    })
    /** Trace Feature. */
    const trace = await traceOf(host)
    await host.blueprint.load(first)
    await host.blueprint.load(second)
    expect(trace.steps('p1/go').map((step) => [step.stage, step.enhancer])).toEqual([
      ['authored', undefined],
      ['enhancer', 'label@1'],
      ['resolved', undefined]
    ])
    expect(trace.addresses()).toEqual(['p1', 'p1/go', 'p2'])
    expect(trace.resolved('p1/go')).toMatchObject({ aria: { label: 'Go' } })
    host.state.write('page.a', 1)
    expect(host.state.resolve({} as never, { $derive: 'total@1' })).toBe(2)
    await host.dispatch('p1/go', 'click', undefined)
    expect(trace.events('p1/go').map((event) => [event.kind, event.name])).toEqual([
      ['dispatch', 'click'],
      ['effect', 'save@1'],
      ['state-write', 'page.a']
    ])
    expect(host.state.resolve({} as never, { $derive: 'total@1' })).toBe(3)
    /** Derive events. */
    const derives = trace.events('$derive:total@1')
    expect(derives).toHaveLength(2)
    expect(derives[1]?.detail).toEqual({ reads: ['page.a'] })

    host.diagnostics.setContext({ version: 'v2', lock: 'sha256-x' })
    await host.dispatch('p1/go', 'focus', undefined).catch(() => undefined)
    /** The failure report. */
    const failure = reports.find(
      (report) => (report.error as { code?: string }).code === 'EFFECT_FAILED'
    )
    expect(failure?.info).toEqual({
      address: 'p1/go',
      context: { version: 'v2', lock: 'sha256-x' }
    })
    expect(Object.keys(failure?.error as object)).not.toContain('context')
  })

  it('bundles the no-op recorder in a production build', () => {
    /** Temporary entry inside the package, importing its built entry. */
    const dir = mkdtempSync(join(import.meta.dirname, '..', '.trace-bundle-'))
    try {
      /** Entry file. */
      const entry = join(dir, 'entry.ts')
      writeFileSync(entry, "export { createPartHost } from '../dist/index.js'\n")
      /** Bundle text for a condition list. */
      const bundle = (flags: string[], mode: string): string =>
        spawnSync('bun', ['build', entry, '--target=browser', ...flags], {
          encoding: 'utf8',
          env: { ...process.env, NODE_ENV: mode }
        }).stdout
      // Bun picks the `development` condition from NODE_ENV unless the build is a production build.
      expect(bundle(['--production'], 'production')).not.toContain('trace-recorder')
      expect(bundle(['--conditions=development'], 'development')).toContain('trace-recorder')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
