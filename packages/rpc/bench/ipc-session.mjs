import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort, Worker } from 'node:worker_threads'
import {
  createNodeProcessLauncher,
  openProcessStdioChannel
} from '@migaia/rpc/process/adapters/node-child-process'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '@migaia/rpc/process/adapters/node-socket'
import { systemScheduler } from '@migaia/utils/scheduler'

/** One entry serves both sides so runtime/carrier/payload stay identical across paired windows. */
const entry = fileURLToPath(import.meta.url)
/** Readiness stays out-of-band and outside measurement windows. */
const readyText = 'IPC_READY\n'
/** Native proposal uses production grammar and JSON codec. */
let offer
/** Load the production endpoint graph only on RPC sides; bare RSS must not include it. */
async function rpcApi() {
  const processApi = await import('@migaia/rpc/process')
  const { endpointFor } = await import('../test/process/peers/ts/runtime.ts')
  const { createNodeThreadChannel } = await import('@migaia/rpc/threads')
  offer = (id) => processApi.createNativeProcessOffer({ peer: { id, runtime: 'node' } })
  return { ...processApi, endpointFor, createNodeThreadChannel }
}
/** Fixed benchmark method has no side effect besides returning its portable input. */
const echoMethod = 'bench.echo'

/**
 * Wait for a separately started peer, retaining startup failures as preparation errors.
 *
 * @param {import('node:child_process').ChildProcess} child Peer process.
 * @returns {Promise<void>} Ready marker consumed.
 * @throws {Error} Exit or launch failure before readiness.
 */
function waitReady(child) {
  return new Promise((resolve, reject) => {
    /** Readiness may span stderr chunks; status contains no business data. */
    let status = ''
    child.stderr.on('data', (chunk) => {
      status += chunk.toString()
      if (status.includes(readyText)) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`IPC peer exited before ready: ${code}`)))
  })
}

/**
 * Serve bare socket/stdio physical bytes with the paired JSON codec and carrier prefix.
 *
 * @param {import('@migaia/rpc/process').IProcessByteChannel} raw Owned physical channel.
 * @returns {Promise<void>} Resolves at physical close.
 */
async function serveBare(raw) {
  /** Sequential sender permits at most one physical reply awaiting a backpressured write. */
  let buffered = Buffer.alloc(0)
  /** Writes are FIFO and joined before final teardown. */
  let writing = Promise.resolve()
  /** Input budget is exactly the production native physical-frame limit. */
  const release = raw.onData((chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0)
      if (!size || size > 16_777_216) throw new RangeError('Bare frame outside carrier limit')
      if (buffered.length < size + 4) break
      const frame = buffered.subarray(0, size + 4)
      buffered = buffered.subarray(size + 4)
      writing = writing.then(() => raw.write(frame))
    }
  })
  await new Promise((resolve) => raw.onClose(resolve))
  release()
  await writing
}

/**
 * Build a production endpoint on a prepared channel and provide an exact echo.
 *
 * @param {import('@migaia/rpc/remote').IRemoteChannel} channel Public negotiated/static channel.
 * @returns {Promise<void>} Provider installed before peer readiness.
 */
async function serveRpc(channel) {
  const { endpointFor } = await rpcApi()
  const runtime = await endpointFor(channel, 'peer')
  runtime.endpoint.provide(echoMethod, (context) => context.success(context.data))
  channel.transport.onTransportError?.(() => {
    void runtime.endpoint.dispose().catch((error) => process.stderr.write(String(error)))
  })
}

/**
 * Create an isolated RPC or bare side without starting a measured window.
 *
 * @param {{ carrier: string; side: string; payload: string }} options Frozen unit and side.
 * @returns {Promise<object>} Owned peer, exchange, readiness and close ports.
 * @throws {Error} Preparation failure never becomes a ratio assertion.
 */
export async function createIpcSession({ carrier, side, payload, wire, peerRuntime }) {
  if (wire === 'jsonrpc') return createBridgeIpcSession({ carrier, side, payload, peerRuntime })
  /** Owned cleanup actions are registered before the next fallible preparation step. */
  const cleanup = []
  /** Physical raw channels exist only for byte carriers. */
  let raw
  /** Worker carrier shares parent PID; other carriers retain distinct peer PID. */
  let peerPid
  /** RPC runtime is public endpoint ownership; bare waits for one byte/message echo. */
  let runtime
  /** Stdio ready marker is observed by the launcher before any warmup or PID baseline. */
  let resolvePeerReady
  const peerReady = new Promise((resolve) => {
    resolvePeerReady = resolve
  })
  let status = ''
  /** Input encoding is identical for both paired sides' business value. */
  const encoded = Buffer.from(JSON.stringify(payload))
  /** Bare processes never load endpoint/proxy/bridge ownership during preparation or measurement. */
  const api = side === 'rpc' ? await rpcApi() : undefined
  try {
    if (carrier === 'worker') {
      const worker = new Worker(entry, { workerData: { side, carrier, child: true } })
      const exited = once(worker, 'exit')
      cleanup.push(async () => {
        await worker.terminate()
        await exited
      })
      await new Promise((resolve, reject) => {
        worker.once('message', (value) =>
          value === readyText ? resolve() : reject(new Error('Worker readiness invalid'))
        )
        worker.once('error', reject)
      })
      peerPid = process.pid
      if (side === 'rpc')
        runtime = await api.endpointFor(
          api.createNodeThreadChannel(worker, 'peer', { scheduler: systemScheduler }),
          'parent'
        )
      else {
        return {
          peerPid,
          ready: async () => undefined,
          exchange: () =>
            new Promise((resolve, reject) => {
              worker.once('message', (value) =>
                value === payload ? resolve() : reject(new Error('Bare worker mismatch'))
              )
              worker.postMessage(payload, undefined)
            }),
          close: async () => {
            for (const close of cleanup.reverse()) await close()
          }
        }
      }
    } else if (carrier === 'stdio-framed') {
      const handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: [entry, '--child', side, carrier],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
        },
        {
          signal: new AbortController().signal,
          output: (stream, chunk) => {
            if (stream !== 'stderr') return
            status += Buffer.from(chunk).toString()
            if (status.includes(readyText)) resolvePeerReady()
          }
        }
      )
      peerPid = handle.identity.pid
      raw = handle.channel
      cleanup.push(async () => {
        await handle.terminate('force')
        await handle.exited
      })
    } else if (carrier === 'socket-framed') {
      const directory = await mkdtemp(join(tmpdir(), 'rpc-bench-'))
      cleanup.push(() => rm(directory, { recursive: true, force: true }))
      const address = join(directory, 'peer.sock')
      const child = spawn(process.execPath, [entry, '--child', side, carrier, address], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const exited = once(child, 'close')
      cleanup.push(async () => {
        child.kill()
        await exited
      })
      await waitReady(child)
      peerPid = child.pid
      raw = await dialProcessByteChannel({ address })
    } else throw new Error(`Undelivered carrier: ${carrier}`)
    if (raw && side === 'rpc') {
      const channel = await api.createProcessTransport(raw, {
        role: 'initiator',
        peerId: 'peer',
        offer: { ...offer('parent'), auth: 'bench-local' },
        report: () => undefined,
        ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
      })
      runtime = await api.endpointFor(channel, 'parent')
      cleanup.push(() => channel.close())
    }
    if (runtime) {
      cleanup.push(() => runtime.endpoint.dispose())
      await runtime.endpoint.send('peer', echoMethod, payload)
      return {
        peerPid,
        encodedBytes: encoded.length,
        ready: async () => undefined,
        exchange: async () => {
          if ((await runtime.endpoint.send('peer', echoMethod, payload)) !== payload)
            throw new Error('RPC echo mismatch')
        },
        close: async () => {
          const failures = []
          for (const close of cleanup.reverse()) {
            try {
              await close()
            } catch (error) {
              failures.push(error)
            }
          }
          if (failures.length) throw new AggregateError(failures, 'IPC cleanup failed')
        }
      }
    }
    /** Bare side sends exactly the same codec-produced business bytes as RPC input. */
    const frame = Buffer.alloc(encoded.length + 4)
    frame.writeUInt32BE(encoded.length)
    frame.set(encoded, 4)
    /** Echo buffering belongs to one concurrency-one request; every byte is compared. */
    let buffer = Buffer.alloc(0)
    let waiting
    let failure
    const release = raw.onData((chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < frame.length) return
      if (!buffer.equals(frame)) failure = new Error('Bare echo mismatch')
      buffer = Buffer.alloc(0)
      if (failure) waiting?.reject(failure)
      else waiting?.resolve()
      waiting = undefined
    })
    const releaseClose = raw.onClose(() => {
      failure = new Error('Bare peer closed')
      waiting?.reject(failure)
    })
    cleanup.push(async () => {
      release()
      releaseClose()
      await raw.close()
    })
    return {
      peerPid,
      encodedBytes: encoded.length,
      ready: async () => {
        if (carrier === 'stdio-framed') await peerReady
      },
      exchange: () =>
        new Promise((resolve, reject) => {
          if (failure) {
            reject(failure)
            return
          }
          waiting = { resolve, reject }
          raw.write(frame).catch(reject)
        }),
      close: async () => {
        for (const close of cleanup.reverse()) await close()
      }
    }
  } catch (primary) {
    const failures = [primary]
    for (const close of cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    throw failures.length === 1
      ? primary
      : new AggregateError(failures, 'IPC preparation and cleanup failed')
  }
}

/**
 * Prepare one independent language peer with an unchanged carrier on bare and RPC sides.
 *
 * @param {{ carrier: string; side: string; payload: string; peerRuntime: string }} options Frozen
 *   peer profile.
 * @returns {Promise<object>} Physical/RPC echo session with actual peer PID.
 * @throws {Error} Original launch, negotiation, mismatch or cleanup failure.
 */
async function createBridgeIpcSession({ carrier, side, payload, peerRuntime }) {
  /** Both sides run this exact executable, argument profile and byte framing. */
  const peerRoot = new URL('../test/process/peers/', import.meta.url)
  const contractPath = fileURLToPath(
    new URL('../schema/vectors/remote-contract.json', import.meta.url)
  )
  let command, args, id
  if (peerRuntime === 'python') {
    command = 'python3'
    args = ['-B', fileURLToPath(new URL('python/peer.py', peerRoot)), '--business']
    id = 'python-peer'
  } else if (peerRuntime === 'rust' || peerRuntime === 'go') {
    command = execFileSync(
      'sh',
      [fileURLToPath(new URL(`${peerRuntime}/run.sh`, peerRoot)), '--executable'],
      { encoding: 'utf8' }
    ).trim()
    args = ['--business', '--contract', contractPath]
    id = `${peerRuntime}-peer`
  } else throw new Error('Undelivered bridge peer runtime')
  args.push('--jsonrpc', '--auth-fd', '3', ...(side === 'bare' ? ['--bare-jsonrpc'] : []))
  /** Dedicated FD bootstrap remains outside the byte stream on both paired sides. */
  const token = randomUUID()
  const cleanup = []
  let raw, peerPid, runtime
  try {
    if (carrier === 'stdio-content-length') {
      const { loadFdLauncher } = await import('./fd-fixture-loader.mjs')
      const handle = await (
        await loadFdLauncher()
      ).launch(
        {
          command,
          args: [...args, '--stdio'],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
      raw = handle.channel
      peerPid = handle.identity.pid
      cleanup.push(async () => {
        await handle.terminate('force')
        await handle.exited
      })
    } else if (carrier === 'socket-content-length') {
      const directory = await mkdtemp(join(tmpdir(), 'rpc-bench-bridge-'))
      cleanup.push(() => rm(directory, { recursive: true, force: true }))
      const address = join(directory, 'peer.sock'),
        authPath = join(directory, 'auth')
      writeFileSync(authPath, token, { mode: 0o600 })
      const fd = openSync(authPath, 'r')
      const child = spawn(command, [...args, '--listen-unix', address], {
        stdio: ['ignore', 'pipe', 'pipe', fd]
      })
      closeSync(fd)
      const exited = once(child, 'close')
      cleanup.push(async () => {
        child.kill()
        await exited
      })
      await new Promise((resolve, reject) => {
        let status = ''
        child.stderr.on('data', (chunk) => {
          status += chunk.toString()
          if (status.includes('READY')) resolve()
        })
        child.once('error', reject)
        child.once('exit', (code) => reject(new Error(`Bridge peer exited before ready: ${code}`)))
      })
      peerPid = child.pid
      raw = await dialProcessByteChannel({ address })
    } else throw new Error('Undelivered bridge carrier')
    cleanup.push(() => raw.close())
    if (side === 'rpc') {
      const { createJsonRpcRemoteChannel } = await import('@migaia/rpc/bridge/jsonrpc')
      const { bridgeEndpointFor } = await import('../test/process/peers/ts/runtime.ts')
      /** Contract describes the same request echo already proved by the conformance facade cases. */
      const contract = {
        schemaVersion: 1,
        plugin: 'p',
        features: {
          f: {
            methods: {
              request: { mode: 'request', idempotent: true },
              oneWay: { mode: 'one-way', idempotent: false }
            }
          }
        }
      }
      const channel = await createJsonRpcRemoteChannel({
        byte: raw,
        peerId: id,
        target: { kind: 'plugin', contract },
        offer: {
          versions: [{ major: 1, minor: 1 }],
          capabilities: [],
          peer: { id: 'parent', runtime: process.versions.bun ? 'bun' : 'node' }
        },
        token,
        scheduler: systemScheduler,
        wallClock: { timestamp: () => Date.now() },
        ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined },
        report: (error) => {
          throw error
        }
      })
      cleanup.push(() => channel.close())
      runtime = await bridgeEndpointFor(channel, 'parent')
      cleanup.push(() => runtime.endpoint.dispose())
    }
    /** The bare endpoint returns these exact codec-produced bytes without JSON or business dispatch. */
    const body = Buffer.from(JSON.stringify(payload)),
      frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
    let buffered = Buffer.alloc(0),
      waiting,
      failure
    if (side === 'bare') {
      const remove = raw.onData((chunk) => {
        buffered = Buffer.concat([buffered, chunk])
        if (buffered.length < frame.length) return
        if (!buffered.equals(frame)) failure = new Error('Bare bridge echo mismatch')
        buffered = Buffer.alloc(0)
        if (failure) waiting?.reject(failure)
        else waiting?.resolve()
        waiting = undefined
      })
      const removeClose = raw.onClose((reason) => {
        failure = reason ?? new Error('Bare bridge peer closed')
        waiting?.reject(failure)
      })
      cleanup.push(async () => {
        remove()
        removeClose()
      })
    }
    const exchange =
      side === 'rpc'
        ? async () => {
            if ((await runtime.endpoint.send(id, 'p.f.request', [payload])) !== payload)
              throw new Error('Bridge RPC echo mismatch')
          }
        : () =>
            new Promise((resolve, reject) => {
              if (failure) {
                reject(failure)
                return
              }
              waiting = { resolve, reject }
              raw.write(frame).catch(reject)
            })
    const close = async () => {
      const failures = []
      for (const release of cleanup.reverse()) {
        try {
          await release()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Bridge IPC cleanup failed')
    }
    return { peerPid, encodedBytes: body.length, ready: exchange, exchange, close }
  } catch (primary) {
    const failures = [primary]
    for (const close of cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    throw failures.length === 1
      ? primary
      : new AggregateError(failures, 'Bridge IPC preparation failed')
  }
}

/** Child entry installs the public protocol or a physical echo before signalling readiness. */
async function childMain(side, carrier, address) {
  const api = side === 'rpc' ? await rpcApi() : undefined
  if (carrier === 'worker') {
    if (side === 'bare')
      parentPort.on('message', (value) => parentPort.postMessage(value, undefined))
    else
      await serveRpc(
        api.createNodeThreadChannel(parentPort, 'parent', { scheduler: systemScheduler })
      )
    parentPort.postMessage(readyText, undefined)
    return
  }
  if (carrier === 'socket-framed') {
    /** Bare listener borrows native socket only; RPC listener authenticates through public adapter. */
    if (side === 'bare') {
      const { createServer } = await import('node:net')
      const server = createServer((socket) => socket.on('data', (chunk) => socket.write(chunk)))
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, resolve)
      })
    } else
      await listenProcessByteChannel({
        address,
        serviceId: 'rpc-bench',
        auth: {
          mode: 'required',
          verify: (token) => {
            if (token !== 'bench-local') throw new Error('Benchmark authentication failed')
            return 'bench'
          }
        },
        report: () => undefined,
        onConnection: async (pending) => {
          const admitted = await pending.accept({
            peerId: 'parent',
            offer: offer('peer'),
            report: () => undefined,
            ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
          })
          await serveRpc(admitted.channel)
        }
      })
    process.stderr.write(readyText)
    return
  }
  const { channel: raw } = await openProcessStdioChannel({ bootstrap: 'none' })
  if (side === 'bare') {
    process.stderr.write(readyText)
    await serveBare(raw)
  } else {
    const channel = await api.createProcessTransport(raw, {
      role: 'responder',
      peerId: 'parent',
      offer: offer('peer'),
      auth: { mode: 'none' },
      report: () => undefined,
      ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
    })
    await serveRpc(channel)
    process.stderr.write(readyText)
  }
}

if (parentPort) {
  const { workerData } = await import('node:worker_threads')
  await childMain(workerData.side, workerData.carrier)
} else if (process.argv.includes('--child')) {
  await childMain(...process.argv.slice(process.argv.indexOf('--child') + 1))
}
