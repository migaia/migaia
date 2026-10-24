import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { describe, expect, it } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import type { IProcessPluginOptions } from '../../../rpc-plugin-process/dist/process/plugin.js'

/** This real child imports built native implementations without sharing the test runner's IPC. */
const childFixture = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  './fixtures/node-process-plugin-child.mjs'
)

/** Own one real stdio Host and its caller-owned native budget across both replacement orders. */
class NativePluginScenario {
  /** The actual ordinary Host owns installation, shared outlet publication and disposal. */
  readonly host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Bootstrap is private deployment input, never a remote feature or diagnostic field. */
  readonly #token = 'native-process-plugin-token'
  /** The OS launcher remains the sole process creation and termination owner. */
  readonly #launcher = createNodeProcessLauncher()
  /** A committed replacement must return all caller-owned units at final disposal. */
  readonly budget
  /** The same native source remains reusable and cold until actual Host installation. */
  readonly options
  /** One unit permits stop-first replacement; two permit a genuine overlapping candidate. */
  constructor(external: boolean) {
    this.budget = createUnitBudget({ kind: 'process', maxUnits: external ? 2 : 1 })
    this.options = {
      name: 'p',
      self: { name: 'parent', instanceId: 'parent' },
      report: () => undefined,
      spawn: {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token: this.#token,
        supervision: {
          id: 'native-child',
          budget: this.budget,
          launcher: this.#launcher,
          isolation: 'best-effort',
          report: () => undefined,
          spec: {
            command: process.execPath,
            args: [childFixture],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(this.#token) }
          }
        },
        rawChannel: async (handle) => {
          if (!('channel' in handle)) throw new TypeError('expected native byte channel')
          return handle.channel as IProcessByteChannel
        },
        establish: (raw, context) => {
          if (raw.kind !== 'byte' || context.role !== 'initiator')
            throw new TypeError('expected byte initiator')
          return createProcessTransport(raw, {
            role: context.role,
            offer: createNativeProcessOffer({
              peer: { id: 'parent', runtime: 'node' },
              auth: context.token,
              stream: true,
              capabilities: RUNTIME_API_BASE_CAPABILITIES
            }),
            peerId: 'child',
            scheduler: context.scheduler,
            ipc: { ...context.session, log: () => undefined },
            report: () => undefined
          })
        }
      }
    } satisfies IProcessPluginOptions
  }
  /** Verify the first dependent installation sees an already authenticated real remote provider. */
  async install(): Promise<void> {
    await this.host.use(processPlugin(this.options))
    /** This Promise is the actual request created during dependent feature installation. */
    let firstCall: Promise<unknown> | undefined
    await this.host.use(
      definePlugin({
        name: 'dependent',
        features: {
          use: defineFeature(() => {
            firstCall = this.host.process!.request('p', 'p.request', ['ready'])
            return {}
          })
        },
        install: () => ({})
      })
    )
    expect(await firstCall).toBe('child:ready')
  }
  /** Both orders use existing native owners: supervisor stop-first or ordinary Host candidate swap. */
  async replace(external: boolean): Promise<void> {
    /** Only the child behavior changes; native bootstrap authority remains the original token. */
    const spec = {
      ...this.options.spawn.supervision.spec,
      env: { inherit: [], set: { RPC_VALUE: 'new-child' } }
    }
    if (external) {
      /** Capture the actual retiring native Peer, never a removed getFeature proxy. */
      const old = readRuntimeOutletConnection(this.host.process!, 'p')!.peer
      await this.host.replace(
        'p',
        processPlugin({
          ...this.options,
          spawn: {
            ...this.options.spawn,
            supervision: { ...this.options.spawn.supervision, spec }
          }
        })
      )
      expect(() => old.request('p.request', ['old'])).toThrowError(
        expect.objectContaining({ code: 'REMOTE_CLOSED' })
      )
    } else {
      expect(await this.host.process!.replace('p', spec)).toMatchObject({
        kind: 'replaced',
        generation: 2
      })
    }
    expect(await this.host.process!.request('p', 'p.request', ['again'])).toBe('new-child:again')
  }
}

describe('native process plugin', () => {
  it.each(['default-stop', 'external-switch'] as const)(
    'serves and replaces a real Node child over native stdio (%s)',
    async (mode) => {
      /** Each case owns its real native process budget and ordinary Host. */
      const test = new NativePluginScenario(mode === 'external-switch')
      try {
        await test.install()
        expect(await test.host.process!.request('p', 'p.request', ['value'])).toBe('child:value')
        /** The original two yields prove actual generator routing on the same native pipe. */
        const iterator = test.host.process!.stream('p', 'p.generator', ['stream'])
        expect(await iterator.next()).toEqual({ done: false, value: 'stream:1' })
        expect(await iterator.next()).toEqual({ done: false, value: 'stream:2' })
        expect(await iterator.next()).toMatchObject({ done: true })
        await test.replace(mode === 'external-switch')
      } finally {
        await test.host.dispose()
      }
      expect(test.budget.inUse).toBe(0)
    }
  )
})
