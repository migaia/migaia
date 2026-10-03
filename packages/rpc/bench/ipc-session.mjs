import { IpcBenchErrorText } from './error-text.mjs'
import './observe.mjs'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort, Worker, MessageChannel } from 'node:worker_threads'
import { readFileSync, existsSync } from 'node:fs'
/** Loader registration finishes before importing the actual production adapter modules. */
const { createNodeProcessLauncher, openProcessStdioChannel } =
  await import('@migaia/rpc/process/adapters/node-child-process')
/** Both bare and RPC byte sides reuse the exact delivered physical carrier. */
const { dialProcessByteChannel, listenProcessByteChannel } =
  await import('@migaia/rpc/process/adapters/node-socket')
/** Channel scheduling uses the runtime-neutral canonical owner. */
const { systemScheduler } = await import('@migaia/utils/scheduler')
/** Recorded failures/rejections retain missing reasons explicitly, never infer a cause from code. */
const classification = { failures: [], rejections: [], reports: [] }
globalThis.__IPC_BENCH_CLASSIFICATION = classification
/** Redact fixture credentials and payloads while retaining all semantic classification fields. */
function classify(error) {
  return {
    source: error?.source ?? null,
    code: error?.code ?? null,
    name: error?.name ?? typeof error,
    reason: error?.reason ?? null,
    message: String(error?.message ?? error)
      .replaceAll('bench-local', '[REDACTED_AUTH]')
      .replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
  }
}
/** Provider reasons are observed through the existing owner callback before any measured window. */
function rejected(event) {
  classification.rejections.push({
    ...event,
    verifiedPeerKey: '[REDACTED]',
    source: '@migaia/rpc/core',
    code: 'OVERLOADED',
    name: null,
    message: 'provider rejection event',
    classificationSource: 'existing onRejected; name not supplied'
  })
}
/** Original report failures remain observable in the receipt rather than silently discarded. */
function report(error) {
  classification.reports.push(classify(error))
}
/** Worker memory/CPU snapshots use a separate control port and never an RPC envelope. */
let snapshotPort
/** Each native child has an ordered out-of-band snapshot file sequence. */
let snapshotSequence = 0
/** Native peers share SIGUSR2 control; foreign peers have only native PID observations. */
async function peerSnapshot(peerPid) {
  if (snapshotPort)
    return new Promise((resolve) => {
      snapshotPort.once('message', resolve)
      snapshotPort.postMessage('snapshot')
    })
  const path = process.env.IPC_BENCH_STEM + '.peer.snapshot-' + snapshotSequence++ + '.json'
  process.kill(peerPid, 'SIGUSR2')
  while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 1))
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** One entry serves both sides so runtime/carrier/payload stay identical across paired windows. */
const entry = fileURLToPath(import.meta.url)
/** Readiness stays out-of-band and outside measurement windows. */
const readyText = 'IPC_READY\n'
/** Native proposal uses production grammar and JSON codec. */
let offer
/** Load the production endpoint graph only on RPC sides; bare RSS must not include it. */
async function rpcApi() {
  const processApi = await import('@migaia/rpc/process')
  const { endpointFor } = await import('../test/core/a10-p2-f-runtime.ts')
  const { createNodeThreadChannel } = await import('@migaia/rpc/threads')
  offer = (id) => processApi.createNativeProcessOffer({ peer: { id, runtime: 'node' } })
  return { ...processApi, endpointFor, createNodeThreadChannel }
}
/** Fixed benchmark method has no side effect besides returning its portable input. */
const echoMethod = 'bench.echo'
/**
 * Explicit sampling capacity accommodates warmup/1000 raw-Worker echoes; product default is
 * unchanged.
 */
const nativeProviderLimits = { maxReplayEntriesPerPeer: 1200, onRejected: rejected }

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
 * Serve bare socket/stdio frames with one JSON parse and serialization per payload.
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
      if (!size || size > 16_777_216) throw new RangeError(IpcBenchErrorText.bareFrame)
      if (buffered.length < size + 4) break
      /** The bare baseline includes business JSON work without endpoint or protocol dispatch. */
      const body = Buffer.from(
        JSON.stringify(JSON.parse(buffered.subarray(4, size + 4).toString()))
      )
      /** Regenerate the physical prefix from the serialized body, including noncanonical input. */
      const frame = Buffer.alloc(body.length + 4)
      frame.writeUInt32BE(body.length)
      frame.set(body, 4)
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
  const runtime = await endpointFor(channel, 'peer', nativeProviderLimits)
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
      const controls = new MessageChannel()
      snapshotPort = controls.port1
      cleanup.push(() => {
        controls.port1.close()
      })
      const worker = new Worker(entry, {
        workerData: {
          side,
          carrier,
          child: true,
          benchPort: controls.port2,
          benchStem: process.env.IPC_BENCH_STEM
        },
        transferList: [controls.port2]
      })
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
          'parent',
          nativeProviderLimits
        )
      else {
        /** Bare replies settle one FIFO waiter per physical message, including concurrent lanes. */
        const waiting = []
        worker.on('message', (value) => {
          const waiter = waiting.shift()
          if (value === payload) waiter?.resolve()
          else waiter?.reject(new Error('Bare worker mismatch'))
        })
        return {
          peerPid,
          peerSnapshot: () => peerSnapshot(peerPid),
          classification: () => classification,
          ready: async () => undefined,
          exchange: () =>
            new Promise((resolve, reject) => {
              waiting.push({ resolve, reject })
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
          env: { inherit: ['PATH'], set: { IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.peer' } },
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
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.peer' }
      })
      const exited = once(child, 'close')
      cleanup.push(async () => {
        child.kill()
        await exited
      })
      await waitReady(child)
      peerPid = child.pid
      raw = await dialProcessByteChannel({ address })
    } else throw new Error(IpcBenchErrorText.carrier(carrier))
    if (raw && side === 'rpc') {
      const channel = await api.createProcessTransport(raw, {
        role: 'initiator',
        peerId: 'peer',
        offer: { ...offer('parent'), auth: 'bench-local' },
        report,
        ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
      })
      runtime = await api.endpointFor(channel, 'parent', nativeProviderLimits)
      cleanup.push(() => channel.close())
    }
    if (runtime) {
      cleanup.push(() => runtime.endpoint.dispose())
      await runtime.endpoint.send('peer', echoMethod, payload)
      return {
        peerPid,
        peerSnapshot: () => peerSnapshot(peerPid),
        classification: () => classification,
        encodedBytes: encoded.length,
        ready: async () => undefined,
        exchange: async () => {
          try {
            if ((await runtime.endpoint.send('peer', echoMethod, payload)) !== payload)
              throw new Error(IpcBenchErrorText.echo)
          } catch (error) {
            classification.failures.push(classify(error))
            throw error
          }
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
          if (failures.length) throw new AggregateError(failures, IpcBenchErrorText.cleanup)
        }
      }
    }
    /** Bare side sends exactly the same codec-produced business bytes as RPC input. */
    const frame = Buffer.alloc(encoded.length + 4)
    frame.writeUInt32BE(encoded.length)
    frame.set(encoded, 4)
    /** Echo buffering belongs to one concurrency-one request; every byte is compared. */
    let buffer = Buffer.alloc(0)
    /** Equal-size echoes settle exactly one issued call per complete physical frame. */
    const waiting = []
    let failure
    const release = raw.onData((chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= frame.length) {
        const echoed = buffer.subarray(0, frame.length)
        buffer = buffer.subarray(frame.length)
        const waiter = waiting.shift()
        if (!echoed.equals(frame)) failure = new Error('Bare echo mismatch')
        if (failure) waiter?.reject(failure)
        else waiter?.resolve()
      }
    })
    const releaseClose = raw.onClose(() => {
      failure = new Error('Bare peer closed')
      for (const waiter of waiting.splice(0)) waiter.reject(failure)
    })
    cleanup.push(async () => {
      release()
      releaseClose()
      await raw.close()
    })
    return {
      peerPid,
      peerSnapshot: () => peerSnapshot(peerPid),
      classification: () => classification,
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
          waiting.push({ resolve, reject })
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
      : new AggregateError(failures, IpcBenchErrorText.preparationCleanup)
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
  } else throw new Error(IpcBenchErrorText.bridgeRuntime)
  /** This is the actual spawned executable, independently hashed from the immutable peer sources. */
  const executable = command.includes('/')
    ? command
    : execFileSync('which', [command], { encoding: 'utf8' }).trim()
  const foreignExecutable = {
    path: executable,
    SHA256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
    sourceRoot: fileURLToPath(new URL(peerRuntime + '/', peerRoot)),
    sourceStatus: 'readonly peer source manifest; binary hash distinct from JS loaded modules'
  }
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
    } else throw new Error(IpcBenchErrorText.bridgeCarrier)
    cleanup.push(() => raw.close())
    if (side === 'rpc') {
      const { createJsonRpcRemoteChannel } = await import('@migaia/rpc/bridge/jsonrpc')
      const { bridgeEndpointFor } = await import('../test/core/a10-p2-f-runtime.ts')
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
        report
      })
      cleanup.push(() => channel.close())
      runtime = await bridgeEndpointFor(channel, 'parent')
      cleanup.push(() => runtime.endpoint.dispose())
    }
    /** The bare peer parses and serializes this JSON payload once without RPC business dispatch. */
    const body = Buffer.from(JSON.stringify(payload)),
      frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
    let buffered = Buffer.alloc(0)
    /** Foreign bare replies use the same FIFO accounting and bytes as the sequential baseline. */
    const waiting = []
    let failure
    if (side === 'bare') {
      const remove = raw.onData((chunk) => {
        buffered = Buffer.concat([buffered, chunk])
        while (buffered.length >= frame.length) {
          const echoed = buffered.subarray(0, frame.length)
          buffered = buffered.subarray(frame.length)
          const waiter = waiting.shift()
          if (!echoed.equals(frame)) failure = new Error('Bare bridge echo mismatch')
          if (failure) waiter?.reject(failure)
          else waiter?.resolve()
        }
      })
      const removeClose = raw.onClose((reason) => {
        failure = reason ?? new Error('Bare bridge peer closed')
        for (const waiter of waiting.splice(0)) waiter.reject(failure)
      })
      cleanup.push(async () => {
        remove()
        removeClose()
      })
    }
    const exchange =
      side === 'rpc'
        ? async () => {
            try {
              if ((await runtime.endpoint.send(id, 'p.f.request', [payload])) !== payload)
                throw new Error(IpcBenchErrorText.bridgeEcho)
            } catch (error) {
              classification.failures.push(classify(error))
              throw error
            }
          }
        : () =>
            new Promise((resolve, reject) => {
              if (failure) {
                reject(failure)
                return
              }
              waiting.push({ resolve, reject })
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
      if (failures.length) throw new AggregateError(failures, IpcBenchErrorText.bridgeCleanup)
    }
    return {
      peerPid,
      encodedBytes: body.length,
      ready: exchange,
      exchange,
      close,
      peerSnapshot: async () => ({
        pid: peerPid,
        threadId: null,
        memory: null,
        loaded: [],
        reason: 'foreign runtime JS isolate fields not applicable',
        gcStatus: 'NOT_COLLECTED'
      }),
      classification: () => classification,
      foreignExecutable
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
      : new AggregateError(failures, IpcBenchErrorText.bridgePreparation)
  }
}

/** Child entry installs the public protocol or a physical echo before signalling readiness. */
async function childMain(side, carrier, address) {
  const api = side === 'rpc' ? await rpcApi() : undefined
  if (carrier === 'worker') {
    if (side === 'bare')
      parentPort.on('message', (value) =>
        parentPort.postMessage(JSON.parse(JSON.stringify(value)), undefined)
      )
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
      const { nodeByteStream } = await import('../dist/process/adapters/node-byte-stream.js')
      const server = createServer((socket) => {
        void serveBare(nodeByteStream(socket, socket, () => socket.destroy())).catch((error) => {
          process.stderr.write(String(error))
          socket.destroy(error)
        })
      })
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
            if (token !== 'bench-local') throw new Error(IpcBenchErrorText.authentication)
            return 'bench'
          }
        },
        report,
        onConnection: async (pending) => {
          const admitted = await pending.accept({
            peerId: 'parent',
            offer: offer('peer'),
            report,
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
      report,
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
