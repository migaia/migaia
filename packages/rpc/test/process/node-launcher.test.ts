import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ProcessCapability } from '@migaia/supervision/process'
import { createRpcHello } from '../../src/contract/handshake.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../../src/contract/framing/stream.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { CHILD_STDERR_REDACTED } from '../../src/process/constants.js'
import type { IIpcLogRecord } from '../../src/core/plugins/flow-control.js'

/** The fixture is a separate Node process and imports only the built package output. */
const fixture = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/node-child.mjs')

describe('Node process launcher', () => {
  it.skipIf(process.platform === 'win32')(
    '[N3] force termination reaches a child process group',
    async () => {
      /** The grandchild inherits the launched child's POSIX process group. */
      const childCode =
        "const {spawn}=require('node:child_process'); const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.stderr.write('GPID='+grand.pid+'\\n'); setInterval(()=>{},1000)"
      let stderr = ''
      let resolveGrandchild: (pid: number) => void = () => undefined
      const grandchildReady = new Promise<number>((resolve) => {
        resolveGrandchild = resolve
      })
      const handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: ['-e', childCode],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
        },
        {
          signal: new AbortController().signal,
          output(stream, chunk) {
            if (stream !== 'stderr') return
            stderr += new TextDecoder().decode(chunk)
            const pid = /GPID=(\d+)/.exec(stderr)?.[1]
            if (pid) resolveGrandchild(Number(pid))
          }
        }
      )
      let grandchildPid: number | undefined
      /** A bounded wait also keeps a broken child fixture from hanging the suite. */
      const deadline = setTimeout(() => resolveGrandchild(0), 2_000)
      try {
        grandchildPid = await grandchildReady
        expect(grandchildPid).toBeGreaterThan(0)
        handle.terminate('force')
        await handle.exited
        /** Process exit propagation is asynchronous on the host OS. */
        let alive = true
        for (let attempt = 0; attempt < 25 && alive; attempt += 1) {
          try {
            process.kill(grandchildPid, 0)
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
          } catch {
            alive = false
          }
        }
        expect(alive).toBe(false)
      } finally {
        clearTimeout(deadline)
        handle.terminate('force')
        await handle.exited
        if (grandchildPid) {
          try {
            process.kill(grandchildPid, 'SIGKILL')
          } catch {
            // The expected group termination has already reaped this process.
          }
        }
      }
    }
  )

  it('[A7] drains stderr before bootstrap and keeps secrets out of IPC records', async () => {
    const launcher = createNodeProcessLauncher()
    expect(launcher.capabilities[ProcessCapability.bootstrapStdin]).toBe('enforced')
    expect(launcher.capabilities[ProcessCapability.bootstrapFd]).toBe('unsupported')
    /** The secret travels only in the framed stdin bootstrap and hello auth. */
    const token = 'node-bootstrap-secret-74e5'
    /** Output subscriptions model the one supervisor-owned stderr drain. */
    const stderrListeners = new Set<(chunk: Uint8Array) => void>()
    const records: IIpcLogRecord[] = []
    let stderrBytes = 0
    /** Separate pipes may deliver the reply before the parent's last stderr data event. */
    const expectedStderrBytes = 1024 * 1024 + token.length
    /** An output event, rather than elapsed time, proves the complete drain. */
    let completeStderr: () => void = () => undefined
    const stderrComplete = new Promise<void>((resolve) => {
      completeStderr = resolve
    })
    const controller = new AbortController()
    const handle = await launcher.launch(
      {
        command: process.execPath,
        args: [fixture, '; $(echo untouched)'],
        env: { inherit: [], set: { MIGAI_TEST_ALLOWED: 'allowed' } },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      },
      {
        signal: controller.signal,
        output(stream, chunk) {
          if (stream !== 'stderr') return
          stderrBytes += chunk.byteLength
          if (stderrBytes >= expectedStderrBytes) completeStderr()
          for (const listener of stderrListeners) listener(chunk)
        }
      }
    )
    expect(handle.channel).toBeDefined()
    const ready = await createProcessTransport(handle.channel!, {
      role: 'initiator',
      offer: createNativeProcessOffer({
        peer: { id: 'parent', runtime: 'node' },
        auth: token
      }),
      peerId: 'child',
      report: () => undefined,
      ipc: {
        connectionId: 'parent-connection',
        sessionId: 'parent-session',
        processId: String(handle.identity.pid),
        log(record) {
          records.push(record)
        },
        stderr(listener) {
          stderrListeners.add(listener)
          return () => {
            stderrListeners.delete(listener)
          }
        }
      }
    })
    /** Only the ready transport carries the request, never the bootstrap bytes. */
    const reply = new Promise<string>((resolveReply) => {
      ready.transport.subscribe(({ data }) => resolveReply(String(data)))
    })
    await ready.transport.send('ping')
    expect(JSON.parse(await reply)).toEqual({
      data: 'ping',
      allowed: 'allowed',
      argument: '; $(echo untouched)'
    })
    await stderrComplete
    expect(stderrBytes).toBeGreaterThanOrEqual(expectedStderrBytes)
    expect(JSON.stringify(records)).not.toContain(token)
    const stderrRecords = records.filter((record) => record.name === 'ipc.stderr')
    expect(stderrRecords.length).toBeGreaterThan(0)
    expect(stderrRecords).toEqual(
      stderrRecords.map(() =>
        expect.objectContaining({
          connectionId: 'parent-connection',
          sessionId: 'parent-session',
          processId: String(handle.identity.pid),
          text: CHILD_STDERR_REDACTED
        })
      )
    )
    await ready.transport.send('stop')
    expect(await handle.exited).toEqual({ code: 0, signal: null })
    await ready.close()
    expect(stderrListeners.size).toBe(0)
  })

  it('[A7] hands a coalesced bootstrap and hello to the same child decoder', async () => {
    const token = 'coalesced-token'
    const endpointFixture = resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      'fixtures/node-endpoint-child.mjs'
    )
    /** One physical stdin write carries both frames without a scheduler gap. */
    const child = spawn(process.execPath, [endpointFixture], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stderr?.resume()
    const hello = createRpcHello(
      createNativeProcessOffer({
        peer: { id: 'parent', runtime: 'node' },
        auth: token
      })
    )
    const bootstrap = encodeRpcStreamFrame(new TextEncoder().encode(token))
    const greeting = encodeRpcStreamFrame(new TextEncoder().encode(hello))
    const combined = new Uint8Array(bootstrap.byteLength + greeting.byteLength)
    combined.set(bootstrap)
    combined.set(greeting, bootstrap.byteLength)
    const response = new Promise<string>((resolveResponse, rejectResponse) => {
      const decoder = createRpcStreamFrameDecoder({
        onFrame: (frame) => resolveResponse(new TextDecoder().decode(frame)),
        onError: rejectResponse
      })
      child.stdout?.on('data', (chunk: Buffer) => decoder.push(chunk))
      child.once('error', rejectResponse)
      child.once('close', () => rejectResponse(new Error('child closed before accept')))
    })
    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        child.stdin?.write(combined, (error) => (error ? rejectWrite(error) : resolveWrite()))
      })
      expect(JSON.parse(await response)).toMatchObject({ kind: 'handshake', step: 'accept' })
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolveClose) =>
          child.once('close', () => resolveClose())
        )
        child.kill('SIGKILL')
        await exited
      }
    }
  })

  it('[A7][D1] contains EPIPE when a child closes stdin before a large bootstrap', async () => {
    /** The payload exceeds a pipe buffer so the child can close stdin before drain. */
    const bootstrap = new Uint8Array(1024 * 1024)
    /** A live child with closed fd 0 makes the write fail without a spawn failure. */
    const childCode = "require('node:fs').closeSync(0); setTimeout(() => {}, 200)"
    await expect(
      createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: ['-e', childCode],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: bootstrap }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
    ).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CONNECT_FAILED',
      cause: expect.objectContaining({ code: 'EPIPE' })
    })
  })
})
