import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { connect } from '../../src/core/middleware/connect.js'
import { framer } from '../../src/core/middleware/framer.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IIpcLogRecord } from '../../src/core/plugins/flow-control.js'

/** The real child fixture imports built ESM and has no test-runner transport. */
const fixture = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/node-endpoint-child.mjs'
)

describe('Node child endpoint channel', () => {
  it('[A1/A2] serves a 128 KiB request across real stdio and the channel pipeline', async () => {
    const token = 'child-endpoint-token'
    const launcher = createNodeProcessLauncher()
    /** Retain only a short diagnostic tail for a failing child fixture. */
    let stderrTail = ''
    const handle = await launcher.launch(
      {
        command: process.execPath,
        args: [fixture],
        env: { inherit: [], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      },
      {
        signal: new AbortController().signal,
        output: (stream, chunk) => {
          if (stream === 'stderr')
            stderrTail = (stderrTail + new TextDecoder().decode(chunk)).slice(-4096)
        }
      }
    )
    expect(handle.channel).toBeDefined()
    /** Backlog records are emitted by the same per-connection IPC gate. */
    const records: IIpcLogRecord[] = []
    const channel = await createProcessTransport(handle.channel!, {
      role: 'initiator',
      offer: createNativeProcessOffer({ peer: { id: 'parent', runtime: 'node' }, auth: token }),
      peerId: 'child',
      report: () => undefined,
      ipc: {
        connectionId: 'parent',
        sessionId: 'parent',
        maxPendingData: 1,
        log(record) {
          records.push(record)
        }
      }
    })
    expect(channel.pipeline.codec.id).toBe('json')
    expect(channel.pipeline.framer.outputEncodedType).toBe('string')
    expect(channel.features).toHaveLength(2)
    const endpoint = await createEndpoint({
      id: 'parent',
      transport: channel.transport,
      features: [channel.features[0]!, channel.features[1]!] as const,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport })
      ]
    })
    /** Cleanup resumes a paused child even if a later assertion fails. */
    let paused = false
    let blocked: Promise<unknown> | undefined
    try {
      const payload = 'x'.repeat(128 * 1024)
      expect(await endpoint.send('child', 'echo', payload)).toBe(payload)
      expect(await endpoint.send('child', 'pause', null)).toBe('paused')
      paused = true
      /** A paused OS reader leaves the first whole envelope admitted but undrained. */
      blocked = endpoint.send('child', 'echo', 'y'.repeat(2 * 1024 * 1024))
      void blocked.catch(() => undefined)
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
      const rejected = await endpoint.send('child', 'echo', 'reject').then(
        () => undefined,
        (error: { code?: string; cause?: { code?: string } }) => error
      )
      expect([rejected?.code, rejected?.cause?.code]).toContain('OVERLOADED')
      expect(records.filter((record) => record.name === 'ipc.backlog.rejected')).toHaveLength(1)
      process.kill(handle.identity.pid!, 'SIGUSR1')
      paused = false
      try {
        expect(await blocked).toBe('y'.repeat(2 * 1024 * 1024))
      } catch (error) {
        throw new Error(
          `blocked send failed: ${String(error)}; child stderr: ${stderrTail.replaceAll(token, '[redacted]')}`
        )
      }
      const controller = new AbortController()
      const pending = endpoint.send('child', 'wait', null, { signal: controller.signal })
      controller.abort(new DOMException('cancelled by test', 'AbortError'))
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      if (paused) process.kill(handle.identity.pid!, 'SIGUSR1')
      await blocked?.catch(() => undefined)
      await endpoint.dispose()
      await channel.close()
      handle.terminate('force')
      await handle.exited
    }
  })

  it('[A2] serializes two concurrent sends on one real child pipe', async () => {
    const token = 'concurrent-send-token'
    const handle = await createNodeProcessLauncher().launch(
      {
        command: process.execPath,
        args: [fixture],
        env: { inherit: [], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    const physical = handle.channel!
    /** Count overlapping physical writes while retaining the actual Node pipe. */
    let activeWrites = 0
    let maximumWrites = 0
    const observed = {
      ...physical,
      async write(chunk: Uint8Array) {
        activeWrites += 1
        maximumWrites = Math.max(maximumWrites, activeWrites)
        try {
          await physical.write(chunk)
        } finally {
          activeWrites -= 1
        }
      }
    }
    const channel = await createProcessTransport(observed, {
      role: 'initiator',
      offer: createNativeProcessOffer({ peer: { id: 'parent', runtime: 'node' }, auth: token }),
      peerId: 'child',
      report: () => undefined,
      ipc: {
        connectionId: 'concurrent',
        sessionId: 'concurrent',
        maxPendingData: 2,
        log: () => undefined
      }
    })
    const endpoint = await createEndpoint({
      id: 'parent',
      transport: channel.transport,
      features: [channel.features[0]!, channel.features[1]!] as const,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport })
      ]
    })
    try {
      expect(
        await Promise.all([
          endpoint.send('child', 'echo', 'first'),
          endpoint.send('child', 'echo', 'second')
        ])
      ).toEqual(['first', 'second'])
      expect(maximumWrites).toBe(1)
    } finally {
      await endpoint.dispose()
      await channel.close()
      handle.terminate('force')
      await handle.exited
    }
  })
})
