import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { type IProcessByteChannel } from '../../dist/process/types.js'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../dist/process/adapters/node-child-process.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/public-host.js'

/** The child uses the public automatic bootstrap path, just as the documented example does. */
const entry = fileURLToPath(new URL('./fixtures/outlet-command-child.mjs', import.meta.url))

describe('process outlet command readiness', () => {
  it.each(['restart', 'replace'] as const)(
    '[DX3-process] %s resolves only after the new generation can receive an immediate request',
    async (command) => {
      /** Host owns all child cleanup and the original process outlet. */
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      /** Preserve full original diagnostics, including the documented best-effort warning. */
      const reported: unknown[] = []
      /** Native errors stay visible to the assertions without replacement. */
      const report = (error: unknown): void => {
        reported.push(error)
      }
      /** This launcher retains the actual child resource and minted runtime identity. */
      const launcher = createNodeProcessLauncher()
      /** The public spawn callbacks read the handle returned by this generation's launch. */
      let handle: INodeProcessHandle
      /** One unit bounds replacement to the existing stop-then-start policy. */
      const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: systemScheduler })
      /** Bootstrap token is fixture data and is never included in returned diagnostic metadata. */
      const token = 'dx-command-readiness-token'
      try {
        await host.use(
          processPlugin({
            name: 'service',
            spawn: {
              kind: 'spawn',
              channelKind: 'byte',
              wire: 'native',
              token,
              supervision: {
                id: 'dx-ready-child',
                isolation: 'best-effort',
                scheduler: systemScheduler,
                report,
                budget,
                launcher: {
                  ...launcher,
                  /** Retain each real child handle without altering native ownership. */
                  launch: async (spec, request) => {
                    handle = await launcher.launch(spec, request)
                    return handle
                  }
                },
                spec: {
                  command: process.execPath,
                  args: [entry],
                  env: { inherit: ['PATH'], set: {} },
                  stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                  bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
                }
              },
              rawChannel: async () => handle.channel!,
              establish: (raw, prepared) =>
                createProcessTransport(raw as IProcessByteChannel, {
                  role: 'initiator',
                  offer: prepared.offer!,
                  peerId: handle.runtimeApiIdentity!.instanceId,
                  scheduler: prepared.scheduler,
                  ipc: { ...prepared.session, log: () => undefined },
                  report
                })
            },
            report
          })
        )
        /** A changed admitted identity independently proves replacement isolation. */
        const previous = await host.process!.request('service', 'identity')
        /** No event wait or sleep occurs between native command completion and business routing. */
        const outcome = await host.process![command]('service')
        expect(outcome).toMatchObject(
          command === 'restart' ? { state: 'ready' } : { kind: 'replaced' }
        )
        expect(await host.process!.request('service', 'math.double', 4)).toBe(8)
        expect(await host.process!.request('service', 'identity')).not.toBe(previous)
        expect(() =>
          host.process!.request({ name: 'service', instanceId: previous as string }, 'identity')
        ).toThrow(expect.objectContaining({ source: 'rpc.endpoint', code: 'TARGET_UNKNOWN' }))
        /**
         * Best-effort admission warns once; physical retirement also rejects the observer's stale
         * generation-1 preparation while preserving both original process-channel causes.
         */
        expect(reported).toEqual([
          expect.objectContaining({
            name: 'Error',
            message: 'supervision capability is unsupported',
            source: 'supervision',
            code: 'CAPABILITY_UNSUPPORTED',
            detail: { capability: 'termination', level: 'unsupported', kind: 'process' },
            stack: expect.stringMatching(/\S/)
          }),
          expect.objectContaining({
            name: 'Error',
            message: 'Remote generation is closed',
            source: 'rpc.remote',
            code: 'REMOTE_CLOSED',
            detail: { generation: 1 },
            stack: expect.stringMatching(/\S/),
            cause: expect.objectContaining({
              name: 'Error',
              message: 'process channel is closed',
              source: 'rpc.transport.process',
              code: 'PROCESS_CHANNEL_CLOSED',
              stack: expect.stringMatching(/\S/),
              cause: expect.objectContaining({
                name: 'Error',
                message: 'process channel is closed',
                source: 'rpc.transport.process',
                code: 'PROCESS_CHANNEL_CLOSED',
                stack: expect.stringMatching(/\S/)
              })
            })
          })
        ])
      } finally {
        await host.dispose()
      }
      expect(budget.inUse).toBe(0)
    }
  )
})
