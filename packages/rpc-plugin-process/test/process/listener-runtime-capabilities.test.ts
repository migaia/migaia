import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Native calls and authentication remain after retiring v1 stream/empty-capability offers. */
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { processPlugin } from '@migaia/rpc-plugin-process'
import type { IProcessByteListener } from '../../dist/process/types.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../dist/process/adapters/node-socket.js'

/** The original credential must reach the real listener verifier before publication. */
const token = 'listener-capability-fixture'

it('retains public native listener calls and the original credential verification', async () => {
  /** The real native adapter alone supplies the bound loopback address. */
  let listener: IProcessByteListener | undefined
  /** All original background failures stay observable at the public diagnostic outlet. */
  const reports: unknown[] = []
  /** The original verifier assertion must actually execute, rather than becoming a dead callback. */
  const verify = vi.fn((auth: unknown) => {
    expect(auth).toBe(token)
    return 'fixture-client'
  })
  /** Current native Host owns the real listener and its accepted Sessions. */
  const server = await createRpcHost({
    self: { name: 'fixture-server', instanceId: 'fixture-server' },
    provide: { math: { double: (value: number) => value * 2 } },
    report: (error) => {
      reports.push(error)
    },
    plugins: [
      rpcFeaturesPlugin({
        features: {
          auth: authFeature({
            encodedType: 'string',
            sign: (value) => value,
            verify: (value) => value
          })
        }
      }),
      processPlugin({
        listen: {
          kind: 'listener',
          address: 'tcp://127.0.0.1:0',
          listen: async (options) => {
            listener = await listenProcessByteChannel(options)
            return listener
          },
          verify,
          createConnectionContext: () => ({
            peerId: 'fixture-client',
            ipc: {
              connectionId: 'listener-capability',
              sessionId: 'listener-capability',
              log: () => undefined
            }
          })
        }
      })
    ]
  })
  /** This actual client retains the original independent source and native close ownership. */
  let client: Awaited<ReturnType<typeof createRpcHost>> | undefined
  try {
    client = await createRpcHost({
      self: { name: 'fixture-client', instanceId: 'fixture-client' },
      report: (error) => {
        reports.push(error)
      },
      plugins: [
        rpcFeaturesPlugin({
          features: {
            auth: authFeature({
              encodedType: 'string',
              sign: (value) => value,
              verify: (value) => value
            })
          }
        }),
        processPlugin({
          connect: {
            target: {
              kind: 'connect',
              address: listener!.address,
              token,
              supervision: { restart: { mode: 'never' } },
              dial: (address, signal) =>
                dialProcessByteChannel({ address, signal: signal as AbortSignal })
            }
          }
        })
      ]
    })
    expect(await client.process.send('fixture-server', 'math.double', 21)).toBe(42)
    expect(reports).toEqual([])
    /** A never-invoked callback must not falsely prove the original auth-value assertion. */
    expect(verify).toHaveBeenCalled()
  } finally {
    await client?.close()
    await server.close()
  }
})
