import { PeerMethod, PeerText } from './text.js'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { openSync, closeSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { dialProcessByteChannel } from '@migaia/rpc/process/adapters/node-socket'
import { RemoteMethodName, type IRemoteChannel } from '@migaia/rpc/remote'
import { endpointFor } from './runtime.js'

/** Supervisor configuration may supply the installed Bun executable; no download occurs. */
const executable =
  process.env.RPC_PEERS_RUNTIME === 'node'
    ? (process.env.RPC_PEERS_NODE ?? process.execPath)
    : (process.env.RPC_PEERS_BUN ?? 'bun')
/** One real public peer serves Plugin and Host profiles without importing production internals. */
const peer = join(
  import.meta.dirname,
  process.env.RPC_PEERS_RUNTIME === 'node' ? 'node-runner.mjs' : 'peer.mts'
)
/** Per-run evidence keeps complete peer stdout/stderr without printing any frame contents. */
const evidence = process.env.RPC_PEERS_EVIDENCE ?? '/tmp/m2-e-evidence'
mkdirSync(evidence, { recursive: true })
/** Both deployments use this exact production proposal and peer identity. */
const offer = createNativeProcessOffer({
  peer: { id: 'caller', runtime: 'node' },
  stream: true,
  capabilities: ['abort@1', 'wire-error@1']
})

/** Shared behavioral oracles keep each actual peer result distinct from successful transport writes. */
const vectors = JSON.parse(
  readFileSync(new URL('./public-behavior.json', import.meta.url), 'utf8')
) as {
  request: { input: string; expected: string }
  oneWay: { inputs: string[]; expected: { count: number; values: string[] } }
  generator: { input: string[]; expected: string[] }
  error: Record<string, unknown>
  cancel: { reason: string; expectedCode: string; providerReason: Record<string, unknown> }
  host: { name: string; installed: Record<string, unknown>; removed: Record<string, unknown> }
}

/** Assert real request, one-way receipt, error graph, cooperative cancellation and stream values. */
async function business(channel: IRemoteChannel, hostProfile: boolean): Promise<void> {
  /** Core performs discovery and supplies receiverId before admitting each business call. */
  const runtime = await endpointFor(channel, 'caller')
  try {
    /** Describe is a real reserved RPC method rather than a local fixture read. */
    const description = await runtime.endpoint.send('ts-peer', RemoteMethodName.describe, [])
    expect(description).toMatchObject(
      hostProfile
        ? { schemaVersion: 1, catalog: { p: { plugin: 'p' } } }
        : { schemaVersion: 1, plugin: 'p' }
    )
    if (hostProfile) {
      expect(
        await runtime.endpoint.send('ts-peer', RemoteMethodName.hostUse, [
          vectors.host.name,
          { value: 1 }
        ])
      ).toMatchObject(vectors.host.installed)
      expect(
        await runtime.endpoint.send('ts-peer', RemoteMethodName.hostInspect, [])
      ).toMatchObject({ plugins: [{ name: 'p' }] })
    }
    expect(await runtime.endpoint.send('ts-peer', 'p.f.request', [vectors.request.input])).toBe(
      vectors.request.expected
    )
    for (const input of vectors.oneWay.inputs)
      await runtime.oneWay!.sendOneWay('ts-peer', 'p.f.oneWay', [input])
    expect(await runtime.endpoint.send('ts-peer', PeerMethod.received, [])).toEqual(
      vectors.oneWay.expected
    )
    for (const method of ['p.f.generator', 'p.f.asyncGenerator']) {
      /** Three distinct values prove generator order and termination over the real transport. */
      const observed: unknown[] = []
      for await (const value of runtime.stream!.open('ts-peer', method, [vectors.generator.input]))
        observed.push(value)
      expect(observed).toEqual(vectors.generator.expected)
    }
    await expect(runtime.endpoint.send('ts-peer', PeerMethod.error, [])).rejects.toMatchObject(
      vectors.error
    )
    /** Caller reason remains a portable wire value and the provider observes cancellation. */
    const controller = new AbortController()
    const waiting = runtime.endpoint.send('ts-peer', PeerMethod.wait, [], {
      signal: controller.signal
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    controller.abort(new RangeError(vectors.cancel.reason))
    await expect(waiting).rejects.toMatchObject({ code: vectors.cancel.expectedCode })
    expect(await runtime.endpoint.send('ts-peer', PeerMethod.aborts, [])).toMatchObject([
      vectors.cancel.providerReason
    ])
    expect(await runtime.endpoint.send('ts-peer', 'p.f.request', ['after-abort'])).toBe(
      'after-abort'
    )
    expect(await runtime.endpoint.ping('ts-peer', undefined, { timeoutMs: 1000 })).toBe(true)
    if (hostProfile) {
      expect(
        await runtime.endpoint.send('ts-peer', RemoteMethodName.hostUnUse, [vectors.host.name])
      ).toEqual(vectors.host.removed)
      expect(
        await runtime.endpoint.send('ts-peer', RemoteMethodName.hostInspect, [])
      ).toMatchObject({ plugins: [] })
      expect(await runtime.endpoint.send('ts-peer', PeerMethod.echo, 'still-alive')).toBe(
        'still-alive'
      )
    }
  } finally {
    await runtime.endpoint.dispose()
    await channel.close()
  }
}

describe('public TS native peer', () => {
  it.each([false, true])(
    'stdio host=%s',
    async (hostProfile) => {
      /** Token reaches the child through the production native stdin bootstrap only. */
      const token = randomUUID()
      /** Full stderr remains available for identifying any child or transport failure. */
      const stderr: Uint8Array[] = []
      /** Launcher retains owned PID and process-group cleanup. */
      const handle = await createNodeProcessLauncher().launch(
        {
          command: executable,
          args: [peer, '--stdio', '--bootstrap', 'stdin', ...(hostProfile ? ['--host'] : [])],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        {
          signal: new AbortController().signal,
          output: (stream, chunk) => {
            if (stream === 'stderr') stderr.push(chunk.slice())
          }
        }
      )
      try {
        expect(handle.channel).toBeDefined()
        /** Capture full protocol output from the public raw port before handshake subscription. */
        const stdout: Uint8Array[] = []
        handle.channel!.onData((chunk) => stdout.push(chunk.slice()))
        handle.channel!.onClose(() =>
          writeFileSync(join(evidence, `stdio-${hostProfile}.stdout.bin`), Buffer.concat(stdout))
        )
        /** Public transport completes authentication before endpoint construction. */
        const channel = await createProcessTransport(handle.channel!, {
          role: 'initiator',
          peerId: 'ts-peer',
          offer: { ...offer, auth: token },
          report: () => undefined,
          ipc: { connectionId: 'client', sessionId: 'client', log: () => undefined }
        })
        await business(channel, hostProfile)
        await handle.exited
        expect(Buffer.concat(stderr).toString()).toContain(PeerText.ready)
      } finally {
        await handle.terminate('force')
        await handle.exited
        writeFileSync(join(evidence, `stdio-${hostProfile}.stderr.log`), Buffer.concat(stderr))
      }
    },
    10000
  )

  it.each([false, true])(
    'socket host=%s',
    async (hostProfile) => {
      /** Unique temporary address and inherited descriptor isolate every real listener. */
      const directory = await mkdtemp(join(tmpdir(), 'rpc-ts-public-'))
      /** Authentication material is never part of argv, environment or diagnostics. */
      const token = randomUUID()
      /** A one-use inherited FD supplies the independent listener's secret. */
      const tokenPath = join(directory, 'auth')
      writeFileSync(tokenPath, token, { mode: 0o600 })
      /** Parent closes its copy immediately after spawn; child owns FD 3. */
      const descriptor = openSync(tokenPath, 'r')
      /** Borrowed clients share the same live listener and never own its PID. */
      const child = spawn(
        executable,
        [
          peer,
          '--listen-unix',
          join(directory, 'peer.sock'),
          '--auth-fd',
          '3',
          ...(hostProfile ? ['--host'] : [])
        ],
        { stdio: ['ignore', 'pipe', 'pipe', descriptor], env: { PATH: process.env.PATH } }
      )
      closeSync(descriptor)
      /** Full stderr is retained to locate listener preparation and failure. */
      const stderr: Buffer[] = []
      /** Listener stdout stays separately attributable even though business bytes use sockets. */
      const stdout: Buffer[] = []
      child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk))
      try {
        await new Promise<void>((resolve, reject) => {
          child.stderr!.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes(PeerText.ready)) resolve()
          })
          child.once('error', reject)
          child.once('exit', () => reject(new Error(PeerText.earlyExit)))
        })
        for (let index = 0; index < 2; index += 1) {
          /** A second successful session proves closing the first preserves the external listener. */
          const raw = await dialProcessByteChannel({ address: join(directory, 'peer.sock') })
          /** Each received frame stream belongs to this exact socket session. */
          const receivedFrames: Uint8Array[] = []
          raw.onData((chunk) => receivedFrames.push(chunk.slice()))
          raw.onClose(() =>
            writeFileSync(
              join(evidence, `socket-${hostProfile}-${index}.frames.bin`),
              Buffer.concat(receivedFrames)
            )
          )
          const channel = await createProcessTransport(raw, {
            role: 'initiator',
            peerId: 'ts-peer',
            offer: { ...offer, auth: token },
            report: () => undefined,
            ipc: { connectionId: String(index), sessionId: String(index), log: () => undefined }
          })
          if (index === 0) await business(channel, hostProfile)
          else {
            const runtime = await endpointFor(channel, 'caller')
            expect(await runtime.endpoint.send('ts-peer', PeerMethod.echo, 'second-session')).toBe(
              'second-session'
            )
            await runtime.endpoint.dispose()
            await channel.close()
          }
          expect(child.exitCode).toBeNull()
        }
        expect(Buffer.concat(stderr).toString()).toContain(PeerText.ready)
      } finally {
        child.kill()
        await once(child, 'close')
        writeFileSync(join(evidence, `socket-${hostProfile}.stdout.bin`), Buffer.concat(stdout))
        writeFileSync(join(evidence, `socket-${hostProfile}.stderr.log`), Buffer.concat(stderr))
        await rm(directory, { recursive: true, force: true })
      }
    },
    10000
  )
})
