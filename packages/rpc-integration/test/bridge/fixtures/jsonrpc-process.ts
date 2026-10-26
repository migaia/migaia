import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'
import { CapabilityLevel } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { nodeByteStream } from '../../../../rpc-plugin-process/dist/process/node-byte-stream.js'
import { createNodeProcessLauncher } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import type { IProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/types.js'

/** The retained FD benchmark lends this actual native child and byte channel. */
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
