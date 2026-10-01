import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Writable } from 'node:stream'
import { CapabilityLevel } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import {
  createJsonRpcRemoteChannel,
  type IJsonRpcBridgeOptions
} from '../../../src/bridge/jsonrpc/index.js'
import type { IProcessPluginEstablish } from '../../../src/process/plugin/types.js'
import { nodeByteStream } from '../../../src/process/adapters/node-byte-stream.js'
import { createNodeProcessLauncher } from '../../../src/process/adapters/node-child-process.js'
import type { IProcessByteChannel } from '../../../src/process/types.js'
import type { IIpcLogRecord } from '../../../src/core/plugins/flow-control.js'
import { BRIDGE_CONTRACT, bridgeFixture } from '../fixture.js'

/** A short dedicated-fd peer tests actual Node pipes without changing the native launcher. */
export const childPath = resolve(import.meta.dirname, 'jsonrpc-child.mjs')
/** This fixture token is deliberately unrelated to source paths and ordinary error text. */
export const token = 'Q7X9Z3V5K8W2R6T4Y1N0'
/** The fixture adds only the explicitly supported fd carrier to Node's advertised capabilities. */
export type IFixtureHandle = IProcessHandle & { channel: IProcessByteChannel; child: ChildProcess }

/** Launch a real child with a private fd, while stdout/stdin contain only JSON-RPC frames. */
export function fdLauncher(): IProcessLauncher<IFixtureHandle> {
  return {
    capabilities: {
      ...createNodeProcessLauncher().capabilities,
      [ProcessCapability.bootstrapFd]: CapabilityLevel.enforced
    },
    async launch(spec, context) {
      const child = spawn(spec.command, [...spec.args], {
        env: {},
        stdio: ['pipe', 'pipe', 'pipe', 'pipe']
      })
      const exited = new Promise<{ code: number | null; signal: string | null }>((done) =>
        child.once('close', (code, signal) => done({ code, signal }))
      )
      child.stderr!.on('data', (chunk: Buffer) => context.output('stderr', chunk))
      await once(child, 'spawn')
      ;(child.stdio[3] as Writable).end(spec.bootstrap!.payload)
      return {
        identity: { fingerprint: randomUUID(), pid: child.pid },
        exited,
        child,
        channel: nodeByteStream(child.stdout!, child.stdin!, () => {
          child.stdout!.destroy()
          child.stdin!.destroy()
        }),
        terminate: (mode) => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM')
        }
      }
    }
  }
}

/** Bind the caller's generation identity, token and stderr into the bridge's canonical channel. */
export function establish(
  logs: IIpcLogRecord[],
  reports: unknown[],
  removals: number[],
  retained: Array<(chunk: Uint8Array) => void> = [],
  target: IJsonRpcBridgeOptions['target'] = { kind: 'plugin', contract: BRIDGE_CONTRACT }
): IProcessPluginEstablish {
  return (raw, options) => {
    if (raw.kind !== 'byte') throw new TypeError('fixture requires byte channel')
    return createJsonRpcRemoteChannel({
      byte: raw,
      peerId: 'peer',
      target,
      offer: bridgeFixture().options.offer,
      token: options.token!,
      scheduler: options.scheduler,
      wallClock: { timestamp: () => Date.now() },
      signal: options.signal as AbortSignal,
      ipc: {
        ...options.session,
        log: (entry) => {
          logs.push(entry)
        },
        stderr:
          options.stderr &&
          ((listener) => {
            retained.push(listener)
            const remove = options.stderr!(listener)
            return () => {
              removals.push(1)
              remove()
            }
          })
      },
      report: (error) => reports.push(error)
    })
  }
}
