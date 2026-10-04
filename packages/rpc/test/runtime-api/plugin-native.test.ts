import assert from 'node:assert/strict'
import { it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget } from '@migaia/supervision'
import { createThreadPlugin } from '../../src/threads/index.js'
import { createProcessPlugin } from '../../src/process/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IRuntimePeerSourceContext } from '../../src/remote/runtime-api/peer.js'
import type { IRuntimePluginOptions } from '../../src/remote/runtime-api/plugin.js'
import type { ISpawnProcessPluginDeployment } from '../../src/process/plugin/types.js'

/** A real child loads built public factories independently from the source-side parent Host. */
const entry = fileURLToPath(new URL('./fixtures/automatic-plugin.mjs', import.meta.url))

for (const kind of ['process', 'thread'] as const) {
  for (const source of ['callback', 'deployment'] as const) {
    it(`[A1][A11][A17][A33] two true Hosts use the symmetric ${kind} Plugin over a genuine native carrier (${source})`, async () => {
      /** Actual local Feature dispatch proves the reverse result independently of child metadata. */
      let reverseCalls = 0
      /** Endpoint readiness precedes the child's separate original Host install commit. */
      let committed!: () => void
      /** The child's actual post-use notification proves its Feature authority is published. */
      const childCommitted = new Promise<void>((resolve) => {
        committed = resolve
      })
      /** This managed Host owns the Plugin resource scope and shared publication. */
      const host = defineHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      /** Original launcher handles retain native termination and the only real exit observation. */
      let thread:
        | Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>>
        | undefined
      /** Process execution likewise stays with the original platform owner. */
      let processHandle:
        | Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>
        | undefined
      /** Fixture token is confined to actual bootstrap/authentication, never business projection. */
      const token = 'c4-native-fixture-token'
      /** The exact shared scheduler is retained from bootstrap to transport and endpoint. */
      const signal = new AbortController().signal
      /** Existing platform specs, budget and original launcher are the complete deployment input. */
      const processBudget = createUnitBudget({ kind: 'process', maxUnits: 1 })
      /** Thread leases stay in their actual distinct platform budget domain. */
      const threadBudget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
      /**
       * The supervised process deployment preserves its actual original bootstrap and
       * authentication.
       */
      const processSpec = {
        command: process.execPath,
        args: [entry],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      } as const
      /**
       * Parent source assembles genuine original owners, while the child discovers its trusted
       * source.
       */
      const spawn = async (context: IRuntimePeerSourceContext) => {
        if (kind === 'thread') {
          thread = await createNodeThreadLauncher({ runtimeApi: context }).launch(
            { entry, name: 'native-child' },
            { signal }
          )
          return createNodeThreadChannelFactory({ scheduler: systemScheduler }).open(thread, signal)
        }
        processHandle = await createNodeProcessLauncher({
          runtimeApiBootstrap: { name: 'native-child', parentInstanceId: context.self.instanceId }
        }).launch(
          {
            command: process.execPath,
            args: [entry],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          { signal, output: () => undefined }
        )
        /** Actual child identity is minted only by this trusted launcher/bootstrap owner. */
        const peerId = processHandle.runtimeApiIdentity!.instanceId
        /** The independent child offer is intersected by the canonical native handshake. */
        const offer = createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime: 'node' },
          auth: token
        })
        return createProcessTransport(processHandle.channel!, {
          role: 'initiator',
          peerId,
          offer: { ...offer, capabilities: context.capabilities },
          ipc: {
            connectionId: 'c4-native-parent',
            sessionId: 'c4-native-parent',
            log: () => undefined
          },
          report: () => undefined
        })
      }
      try {
        const [parent] = await host.use(
          definePlugin({
            name: 'parent',
            features: {
              data: defineFeature(() => ({
                ready: () => committed(),
                read: (payload: unknown) => {
                  reverseCalls += 1
                  return `${payload}:parent`
                }
              }))
            },
            install: () => ({})
          })
        )
        assert.equal(parent.getFeature('data').read('ordinary'), 'ordinary:parent')
        reverseCalls = 0
        /**
         * This caller-selected launcher remains genuine while exposing its actual handle for
         * cleanup.
         */
        const threadLauncher = createNodeThreadLauncher()
        /**
         * Likewise the process wrapper records the true handle without replacing execution
         * behavior.
         */
        const processLauncher = createNodeProcessLauncher()
        /** Reused native deployment grammar supplies auth, budgets and real established channels. */
        const processDeployment: ISpawnProcessPluginDeployment = {
          kind: 'spawn',
          channelKind: 'byte',
          wire: 'native',
          token,
          supervision: {
            id: 'c4-native-child',
            spec: processSpec,
            budget: processBudget,
            isolation: 'best-effort',
            report: () => undefined,
            launcher: {
              ...processLauncher,
              launch: async (spec, context) =>
                (processHandle = await processLauncher.launch(spec, context))
            }
          },
          rawChannel: async () => processHandle!.channel!,
          establish: async (raw, prepared) => {
            assert.equal(raw.kind, 'byte')
            assert.equal(prepared.role, 'initiator')
            assert.ok(
              prepared.offer,
              '[A1] the original handshake receives the actual compiled offer'
            )
            return createProcessTransport(
              raw as NonNullable<typeof processHandle>['channel'] & object,
              {
                role: 'initiator',
                offer: prepared.offer!,
                peerId: processHandle!.runtimeApiIdentity!.instanceId,
                scheduler: prepared.scheduler,
                ipc: { ...prepared.session, log: () => undefined },
                report: () => undefined
              }
            )
          }
        }
        /** Thread source specs use the existing supervisor/launcher/channel-factory owner unchanged. */
        const threadDeployment = {
          spec: { entry, name: 'native-child' },
          budget: threadBudget,
          scheduler: systemScheduler,
          launcher: {
            ...threadLauncher,
            launch: async (...args: Parameters<typeof threadLauncher.launch>) =>
              (thread = await threadLauncher.launch(...args))
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          report: () => undefined
        }
        /**
         * Both sides enter true host.use with the same public factory and explicit Feature
         * exposure.
         */
        const options = {
          name: 'bridge',
          self: { name: 'native-parent', instanceId: `c4-${kind}-parent` },
          spawn:
            source === 'callback'
              ? spawn
              : kind === 'thread'
                ? threadDeployment
                : processDeployment,
          expose: ['parent'],
          ...(source === 'deployment'
            ? {
                contract: {
                  schemaVersion: 1 as const,
                  plugin: 'parent',
                  features: {
                    data: {
                      methods: {
                        read: { mode: 'request' as const, idempotent: false },
                        ready: { mode: 'request' as const, idempotent: false }
                      }
                    }
                  }
                }
              }
            : {}),
          report: () => undefined
        }
        /**
         * The temporary cast admits the intended source grammar before its RED-first
         * implementation.
         */
        const installed = await host
          .use(
            kind === 'thread'
              ? createThreadPlugin(options as unknown as IRuntimePluginOptions)
              : createProcessPlugin(options as unknown as IRuntimePluginOptions)
          )
          .then(
            () => undefined,
            (error: unknown) => error
          )
        assert.equal(
          installed,
          undefined,
          '[A1] full original deployment input must prepare after ordinary Feature business'
        )
        /** The route is the genuine same-family Host publication, not a structural demo outlet. */
        const outlet = host[kind]!
        await childCommitted
        assert.deepEqual(await outlet.request('bridge', 'service.probe', 'native'), [
          42,
          'native:parent'
        ])
        assert.equal(
          reverseCalls,
          1,
          '[A11] native child actually executed the reverse exposed Feature'
        )
        /** Iteration keeps the original stream owner over the same physical channel. */
        const values: unknown[] = []
        for await (const value of outlet.stream('bridge', 'service.values')) values.push(value)
        assert.deepEqual(values, [1, 2])
        assert.throws(() => outlet.request('bridge', 'service.data.probe'), {
          code: 'PROVIDER_NOT_FOUND'
        })
        assert.equal(outlet.get('bridge').host, undefined)
      } finally {
        await host.dispose()
        thread?.terminate()
        await thread?.exited
        processHandle?.terminate('force')
        await processHandle?.exited
      }
    })
  }
}
