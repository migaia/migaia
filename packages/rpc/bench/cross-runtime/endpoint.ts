/** Actual TS endpoint loads only RPC public-entry source files in a frozen disposable copy. */
import { state, runtime, echo, report, onRejected, classify, snapshot } from './observe.js'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { loadavg } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createMacPidObserver } from '../bare-node.mjs'
import { nearestRank } from '../ipc.mjs'
import { CrossRuntimeErrorText } from '../error-text.mjs'
import { CrossRuntimeBench, RuntimeBench } from '../text.mjs'
/** Fixed cell metadata is supplied by the sealed scope plan, never by a peer. */
const cell = JSON.parse(process.env.XRT_CELL ?? '{}'),
  side = process.env.XRT_SIDE ?? 'rpc',
  capture = process.env.XRT_CAPTURE ?? 'plain',
  variant = process.env.XRT_VARIANT ?? 'base'
/** The source tree selects diagnostic entry observations independently of timing. */
const fixtureRoot = new URL(
  process.env.XRT_FIXTURE_ROOT ?? '../../test/process/peers/',
  import.meta.url
)
/**
 * Prepared evidence graph is explicit; ordinary fixture execution imports actual public RPC TS
 * source.
 */
const sourceRoot = process.env.XRT_SOURCE_ROOT
  ? new URL(process.env.XRT_SOURCE_ROOT)
  : new URL('../../src/', import.meta.url)
/** Child and parent retain independent real runtime identity and cold source-loading provenance. */
const child = process.argv.includes('--child'),
  stem = process.env.XRT_STEM
/** Exact source imports correspond to public package export subpaths. */
const api = async () => import(new URL('process/index.ts', sourceRoot).href)
/** Each runtime uses its delivered public process and socket adapter. */
const processAdapter = () =>
  import(
    new URL(
      'process/adapters/' +
        { node: 'node-child-process', bun: 'bun-spawn', deno: 'deno-command' }[runtime] +
        '.ts',
      sourceRoot
    ).href
  )
const socketAdapter = () =>
  import(
    new URL(
      'process/adapters/' +
        { node: 'node-socket', bun: 'bun-socket', deno: 'deno-socket' }[runtime] +
        '.ts',
      sourceRoot
    ).href
  )
/** Provider budgets cover the bounded c1 fixture and expose existing rejection reasons. */
const limits = { onRejected }
/** The exact existing tool wrapper is supplied by the owner before any peer launch. */
const envRun = process.env.XRT_ENV_RUN
if (!envRun) throw new TypeError(CrossRuntimeErrorText.wrapper)
/** The actual factory capabilities are retained in each native offer, including generations. */
const offer = (a, id, caps) => ({
  ...a.createNativeProcessOffer({ peer: { id, runtime } }),
  capabilities: caps
})
/** Both directions reuse the currently authenticated logical connection. */
const ipc = { connectionId: 'xrt', sessionId: 'xrt', log: () => undefined }
/** Runtime commands run actual TS without a build or packaged RPC dist. */
function command(which) {
  const entry = fileURLToPath(
    new URL(which === 'node' ? 'node-source.mjs' : 'endpoint.ts', import.meta.url)
  )
  return {
    command: '/bin/bash',
    args: [
      envRun,
      which,
      ...(which === 'deno'
        ? [
            'run',
            '--allow-all',
            '--sloppy-imports',
            '--node-modules-dir=manual',
            '--cached-only',
            entry
          ]
        : [entry])
    ]
  }
}
/** Snapshot signaling is a cold/out-of-band control, never an RPC provider. */
let sequence = 0
/** Each fresh session has distinct out-of-band files, so a previous arm cannot satisfy readiness. */
let sessionSequence = 0
if (child) {
  const snap = () => {
    /** Publish only a complete snapshot; the parent never reads a just-created partial file. */
    const path = stem + '.snapshot-' + sequence++ + '.json'
    writeFileSync(path + '.tmp', JSON.stringify(snapshot()))
    renameSync(path + '.tmp', path)
  }
  if (runtime === 'deno') Deno.addSignalListener('SIGUSR2', snap)
  else process.on('SIGUSR2', snap)
}
/** Deliver one bare JSON echo using exactly the paired public physical byte adapter. */
function barePort(raw, serve) {
  let buffer = Buffer.alloc(0),
    waiting = [],
    writing = Promise.resolve(),
    closed
  const content = cell.carrier.includes('content-length')
  const encode = (value) => {
    const body = Buffer.from(JSON.stringify(value))
    if (content)
      return Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body])
    const result = Buffer.alloc(4 + body.length)
    result.writeUInt32BE(body.length)
    result.set(body, 4)
    return result
  }
  raw.onData((chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      let size, start
      if (content) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) break
        size = Number(buffer.subarray(0, end).toString().slice(16))
        start = end + 4
      } else {
        if (buffer.length < 4) break
        size = buffer.readUInt32BE(0)
        start = 4
      }
      if (!Number.isSafeInteger(size) || size <= 0 || size > 16777216)
        throw new RangeError(CrossRuntimeErrorText.frame)
      if (buffer.length < start + size) break
      const value = JSON.parse(buffer.subarray(start, start + size).toString())
      buffer = buffer.subarray(start + size)
      if (serve || (cell.direction === 'reverse' && value?.xrtReceipt !== true))
        writing = writing.then(() => raw.write(encode(value)))
      else waiting.shift()?.resolve(value)
    }
  })
  raw.onClose((reason) => {
    closed = reason ?? new Error(CrossRuntimeErrorText.closed)
    for (const w of waiting.splice(0)) w.reject(closed)
  })
  return {
    exchange: (value) =>
      new Promise((resolve, reject) => {
        if (closed) {
          reject(closed)
          return
        }
        waiting.push({ resolve, reject })
        raw.write(encode(value)).catch(reject)
      }),
    close: () => raw.close()
  }
}
/** Public source provider owns lifecycle, dispatch and provider admission. */
async function nativeProvider(raw) {
  const a = await api()
  return a.createProcessPeer({
    self: { name: 'provider', instanceId: 'provider' },
    provide: { bench: { echo: capture === 'count' ? echo : (value) => value } },
    providerLimits: limits,
    connect: (context) =>
      a.createProcessTransport(raw, {
        role: 'responder',
        peerId: 'initiator',
        offer: offer(a, 'provider', context.capabilities),
        auth: { mode: 'none' },
        report,
        ipc
      }),
    report
  })
}
/** Real child starts one standard adapter and signals source readiness before warmup. */
async function childMain() {
  if (cell.carrier.startsWith('stdio')) {
    const p = await processAdapter(),
      { channel } = await p.openProcessStdioChannel({ bootstrap: 'none' })
    process.stderr.write(CrossRuntimeBench.ready)
    if (side === 'bare') barePort(channel, true)
    else await nativeProvider(channel)
  } else {
    const address = process.env.XRT_ADDRESS,
      s = await socketAdapter()
    if (side === 'bare') {
      const { createServer } = await import('node:net')
      const server = createServer((socket) => {
        const raw = {
          kind: 'byte',
          write: (bytes) =>
            new Promise((resolve, reject) =>
              socket.write(bytes, (error) => (error ? reject(error) : resolve()))
            ),
          onData: (listener) => {
            socket.on('data', listener)
            return () => socket.off('data', listener)
          },
          onClose: (listener) => {
            socket.on('close', listener)
            return () => socket.off('close', listener)
          },
          close: async () => socket.destroy()
        }
        barePort(raw, true)
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, resolve)
      })
    } else {
      const a = await api()
      await s.listenProcessByteChannel({
        address,
        serviceId: 'xrt',
        auth: {
          mode: 'required',
          verify: (token) => {
            if (token !== CrossRuntimeBench.token)
              throw new Error(CrossRuntimeErrorText.authentication)
            return 'xrt'
          }
        },
        report,
        onConnection: (pending) =>
          a.createProcessPeer({
            self: { name: 'provider', instanceId: 'provider' },
            provide: { bench: { echo: capture === 'count' ? echo : (value) => value } },
            providerLimits: limits,
            connect: async (context) =>
              (
                await pending.accept({
                  peerId: 'initiator',
                  offer: offer(a, 'provider', context.capabilities),
                  report,
                  ipc
                })
              ).channel,
            report
          })
      })
    }
    process.stderr.write(CrossRuntimeBench.ready)
  }
}
/** One source session has a matched physical child and exact actual runtime pair. */
async function session(physicalSide = side) {
  const side = physicalSide,
    stem = process.env.XRT_STEM + '.arm-' + sessionSequence++ + '.' + physicalSide
  /** Snapshot ordinals are local to this actual freshly launched peer. */
  let peerSequence = 0
  /** Actual native exit stops an out-of-band read; it cannot wait forever on a dead writer. */
  let peerExited = false
  const foreign = cell.direction !== 'native',
    peerRuntime = foreign
      ? cell.direction === 'reverse'
        ? cell.initiator
        : cell.provider
      : cell.provider
  const adapter = await processAdapter(),
    socket = await socketAdapter(),
    cleanup = []
  let raw,
    pid,
    stderr = '',
    resolveReady,
    rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const output = (stream, bytes) => {
    if (stream !== 'stderr') return
    const text = Buffer.from(bytes).toString()
    stderr += text
    process.stderr.write(text)
    if (foreign ? /^READY\s+/m.test(stderr) : stderr.includes('XRT_READY')) resolveReady()
  }
  let spec
  /** Native identity binds the optimized executable to this arm's frozen foreign sources. */
  let foreignIdentity
  if (foreign) {
    const path = fileURLToPath(new URL(peerRuntime + '/', fixtureRoot)),
      executable = JSON.parse(process.env.XRT_FOREIGN_EXECUTABLES ?? '{}')[peerRuntime]
    /** The source manifest was sealed before this window; no live checkout file supplies a peer. */
    const source = JSON.parse(readFileSync(process.env.XRT_SOURCE_MANIFEST, 'utf8')).foreign.find(
      (entry) => entry.runtime === peerRuntime
    )
    for (const file of source.files)
      if (createHash('sha256').update(readFileSync(file.path)).digest('hex') !== file.sha256)
        throw new Error(CrossRuntimeErrorText.foreignSource)
    /** Existing optimized launchers resolve their actual executable before warmup begins. */
    const actualExecutable =
      peerRuntime === 'python'
        ? executable
        : execFileSync('/bin/bash', [envRun, executable, '--executable'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit']
          }).trim()
    foreignIdentity = {
      runtime: peerRuntime,
      source,
      executable: actualExecutable,
      executableSHA256: createHash('sha256').update(readFileSync(actualExecutable)).digest('hex'),
      proof:
        'frozen source/build inputs plus actual launcher executable; no foreign internals claim'
    }
    state.foreignIdentities.push(foreignIdentity)
    spec = {
      command: actualExecutable,
      args: peerRuntime === 'python' ? ['-B', path + 'peer.py', '--business'] : ['--business']
    }
    spec.args.push('--jsonrpc', ...(side === 'bare' ? ['--bare-jsonrpc'] : []))
    spec = {
      command: '/bin/bash',
      args: [
        process.env.XRT_ENV_RUN ??
          fileURLToPath(
            new URL('../../../../docs/rpc/scratch/core-refactor-impl/env-run.sh', import.meta.url)
          ),
        spec.command,
        ...spec.args
      ]
    }
  } else spec = command(peerRuntime)
  const env = {
    ...process.env,
    XRT_CELL: JSON.stringify(cell),
    XRT_SIDE: side,
    XRT_STEM: stem + '.peer'
  }
  if (cell.carrier.startsWith('stdio')) {
    const factory =
      runtime === 'deno'
        ? adapter.createDenoProcessLauncher
        : runtime === 'bun'
          ? adapter.createBunProcessLauncher
          : adapter.createNodeProcessLauncher
    const handle = await factory().launch(
      {
        ...spec,
        args: [...spec.args, ...(foreign ? ['--bootstrap', 'stdin', '--stdio'] : ['--child'])],
        env: { inherit: ['PATH', 'TMPDIR'], set: env },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        ...(foreign
          ? {
              bootstrap: {
                via: 'stdin',
                payload: new TextEncoder().encode(CrossRuntimeBench.token)
              }
            }
          : {})
      },
      { signal: new AbortController().signal, output }
    )
    raw = handle.channel
    pid = handle.identity.pid
    cleanup.push(async () => {
      handle.terminate('force')
      await handle.exited
    })
    void handle.exited.then((status) => {
      peerExited = true
      rejectReady(new Error(CrossRuntimeErrorText.peerExit(status.code)))
    })
    await ready
  } else {
    const directory = mkdtempSync('/tmp/xrt-'),
      address = directory + '/p.sock'
    env.XRT_ADDRESS = address
    cleanup.push(async () => rmSync(directory, { recursive: true, force: true }))
    if (foreign) {
      const auth = directory + '/auth'
      writeFileSync(auth, CrossRuntimeBench.token, { mode: 0o600 })
      spec = {
        command: '/bin/sh',
        args: [
          '-c',
          'exec 3<"$1"; shift; exec "$@"',
          'xrt',
          auth,
          spec.command,
          ...spec.args,
          '--auth-fd',
          '3',
          '--listen-unix',
          address
        ]
      }
    }
    if (runtime === 'deno') {
      const native = new Deno.Command(spec.command, {
        args: [...spec.args, ...(!foreign ? ['--child'] : [])],
        env,
        stdin: 'null',
        stdout: 'null',
        stderr: 'piped'
      }).spawn()
      pid = native.pid
      void native.status.then(() => {
        peerExited = true
      })
      cleanup.push(async () => {
        try {
          native.kill('SIGTERM')
        } catch {}
        await native.status
      })
      void (async () => {
        const reader = native.stderr.getReader()
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) break
            output('stderr', next.value)
          }
        } finally {
          reader.releaseLock()
        }
      })()
    } else {
      const native = spawn(spec.command, [...spec.args, ...(!foreign ? ['--child'] : [])], {
        env,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      pid = native.pid
      native.stderr.on('data', (bytes) => output('stderr', bytes))
      native.once('error', rejectReady)
      native.once('exit', (code) => {
        peerExited = true
        rejectReady(new Error(CrossRuntimeErrorText.peerExit(code)))
      })
      cleanup.push(
        () =>
          new Promise((resolve) => {
            if (native.exitCode !== null) {
              resolve()
              return
            }
            native.once('close', resolve)
            native.kill()
          })
      )
    }
    await ready
    raw = await socket.dialProcessByteChannel({ address })
  }
  cleanup.push(() => raw.close())
  if (side === 'bare') {
    const port = barePort(raw, false)
    return {
      pid,
      foreignIdentity,
      exchange: (payload) => port.exchange(payload),
      snapshot: () => (foreign ? null : peerSnapshot(pid, stem, peerSequence++, () => peerExited)),
      close: async () => {
        for (const close of cleanup.reverse()) await close()
      },
      stderr
    }
  }
  const a = await api()
  const connect = foreign
    ? async (context) => {
        const { createJsonRpcRemoteChannel } = await import(
          new URL('bridge/jsonrpc/index.ts', sourceRoot).href
        )
        return createJsonRpcRemoteChannel({
          byte: raw,
          peerId: peerRuntime + '-peer',
          target: {
            kind: 'plugin',
            contract: {
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
          },
          offer: {
            versions: [{ major: 1, minor: 1 }],
            capabilities: context.capabilities.filter((value) =>
              [
                'runtime-api@1',
                'batch@1',
                'abort@1',
                'jsonrpc-bridge@1',
                'wire-error@1',
                'deadline@1',
                'trace@1',
                'idempotency@1'
              ].includes(value)
            ),
            peer: { id: 'initiator', runtime }
          },
          token: CrossRuntimeBench.token,
          scheduler: systemScheduler,
          wallClock: { timestamp: () => Date.now() },
          report,
          ipc
        })
      }
    : (context) =>
        a.createProcessTransport(raw, {
          role: 'initiator',
          peerId: 'provider',
          offer: { ...offer(a, 'initiator', context.capabilities), auth: CrossRuntimeBench.token },
          report,
          ipc
        })
  const peer = await a.createProcessPeer({
    self: { name: 'initiator', instanceId: 'initiator' },
    provide:
      cell.direction === 'reverse'
        ? { bench: { echo: capture === 'count' ? (value) => echo(value[0]) : (value) => value[0] } }
        : undefined,
    providerLimits: limits,
    connect,
    report
  })
  cleanup.push(() => peer.close())
  return {
    pid,
    foreignIdentity,
    exchange: (payload) =>
      peer.request(
        cell.direction === 'reverse'
          ? CrossRuntimeBench.reverse
          : foreign
            ? CrossRuntimeBench.request
            : RuntimeBench.echo,
        cell.direction === 'reverse' ? [payload] : foreign ? [payload] : payload
      ),
    snapshot: () => (foreign ? null : peerSnapshot(pid, stem, peerSequence++, () => peerExited)),
    close: async () => {
      for (const close of cleanup.reverse()) await close()
    },
    stderr
  }
}
/** Snapshot polling follows the existing out-of-band fixture control and carries no RPC call. */
async function peerSnapshot(pid, prefix, ordinal, exited) {
  const path = prefix + '.peer.snapshot-' + ordinal + '.json'
  process.kill(pid, 'SIGUSR2')
  while (!existsSync(path)) {
    if (exited()) throw new Error(CrossRuntimeErrorText.snapshotExit)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}
/** Finite business lanes use c1; no rate catch-up or unrecorded burst exists. */
async function calls(s, n, payload) {
  if (cell.direction === 'reverse') {
    const receipt = await s.exchange({ xrtReverse: true, count: n, payload })
    if (
      receipt?.xrtReceipt !== true ||
      receipt.calls !== n ||
      !Number.isFinite(receipt.elapsedNs) ||
      receipt.elapsedNs <= 0 ||
      !Array.isArray(receipt.latenciesNs) ||
      receipt.latenciesNs.length !== n
    )
      throw new Error(CrossRuntimeErrorText.reverse)
    return {
      ...receipt,
      elapsedMs: receipt.elapsedNs / 1000000,
      p50: nearestRank(receipt.latenciesNs, 0.5),
      p99: nearestRank(receipt.latenciesNs, 0.99),
      timingOwner: cell.initiator + ' logical initiator; outer TS control excluded'
    }
  }
  /** One bounded latency series is written only by the actual logical initiator. */
  const latenciesNs = []
  const started = performance.now()
  for (let index = 0; index < n; index++) {
    const round = performance.now()
    const result = await s.exchange(payload)
    if (result !== payload) throw new Error(CrossRuntimeErrorText.echo)
    latenciesNs.push((performance.now() - round) * 1e6)
  }
  return {
    calls: n,
    elapsedMs: performance.now() - started,
    latenciesNs,
    p50: nearestRank(latenciesNs, 0.5),
    p99: nearestRank(latenciesNs, 0.99),
    clientInFlightPeak: 1,
    burstSize: 1
  }
}
/** One measured arm owns a fresh connection; startup and warmup never enter its clock. */
async function arm(kind, count, payload, measure = false) {
  /** Every arm carries its own cold/control contribution and independent replay ledger. */
  const cold = snapshot()
  /** Session acquisition never changes product limits or silently shares another arm. */
  const active = await session(kind)
  /** The existing PID observer is started before warmup; no sampler starts inside the clock. */
  let observer
  /** Cleanup failures remain attached to the primary failure, not substituted for it. */
  const failures = []
  /** A receipt exists only after every requested business sample settles. */
  let receipt
  try {
    observer = measure ? await createMacPidObserver([process.pid, active.pid]) : undefined
    /** Counter and timing arms use the same bounded warmup and fresh owner. */
    const warm = await calls(active, 200, payload)
    /** The first snapshot follows warmup; its allocation remains outside measured business. */
    const before = { local: snapshot(), peer: await active.snapshot() }
    /** Native CPU uses the two exact endpoint PIDs, not aggregate child totals. */
    const cpuBefore = observer ? await observer.read() : undefined
    /** Scalar echo returns are checked by the existing loop, including reverse initiator receipts. */
    const business = await calls(active, count, payload)
    /** Take CPU immediately after the final settled business response. */
    const cpuAfter = observer ? await observer.read() : undefined
    /** Foreign outer control remains separately disclosed in resource deltas. */
    const after = { local: snapshot(), peer: await active.snapshot() }
    receipt = {
      side: kind,
      samples: count,
      warm,
      business,
      cold,
      before,
      after,
      parentPid: process.pid,
      peerPid: active.pid,
      foreignIdentity: active.foreignIdentity,
      cpuByPid: cpuAfter?.map((row) => ({
        pid: row.pid,
        cpuNs: row.cpuNs - cpuBefore.find((before) => before.pid === row.pid).cpuNs
      })),
      rssByPid: cpuAfter?.map((row) => ({ pid: row.pid, rssBytes: row.rssBytes })),
      cpuScope:
        cell.direction === 'reverse'
          ? 'native endpoint PID delta includes the one outer peer.reverse control around the foreign inner business loop'
          : 'native endpoint PID deltas after warmup; no launch CPU',
      memoryScope:
        'boundary RSS only; shared parent has both graphs loaded; no peak/relative RSS acceptance credit',
      observer: observer ? { method: observer.method, intervalMs: observer.intervalMs } : undefined
    }
  } catch (error) {
    failures.push(error)
  }
  /** Join both owners even if measurement or observer acquisition failed. */
  for (const result of await Promise.allSettled([
    active.close(),
    ...(observer ? [observer.close()] : [])
  ]))
    if (result.status === 'rejected') failures.push(result.reason)
  if (failures.length > 1) throw new AggregateError(failures, CrossRuntimeErrorText.cleanup)
  if (failures.length) throw failures[0]
  return receipt
}

/** Counters use matched N1/N2 fresh arms; required payload cells never share retention. */
async function main() {
  /** This finite receipt identifies every requested cell and actual execution context. */
  const result = {
    cell,
    side,
    capture,
    variant,
    seed: CrossRuntimeBench.seed,
    warmup: 200,
    N1: 128,
    N2: 768,
    sourceForm: 'TS public source entries; no RPC build/dist',
    head: process.env.XRT_HEAD,
    productLimits: { maxReplayEntriesPerPeer: 1024, maxReplayEntries: 4096, replayTtlMs: 310000 },
    sessions: 'every N1/N2 arm is a fresh independent matched connection',
    samples: []
  }
  try {
    for (const payloadBytes of capture === 'count' ? [64, 1024] : [cell.timingPayloadBytes]) {
      /** One-off fixture data has the same encoded bytes on RPC and bare arms. */
      const payload = 'x'.repeat(payloadBytes)
      /** Startup and warmup are subtracted independently before the N2-N1 difference. */
      const first = await arm(side, 128, payload)
      const second = await arm(side, 768, payload)
      result.samples.push({ payloadBytes, first, second, deltaN: 640 })
    }
    result.status = 'PASS'
  } catch (error) {
    state.failures.push(classify(error))
    result.status = 'FAIL'
    result.failure = classify(error)
    process.exitCode = 1
  }
  result.final = snapshot()
  writeFileSync(stem + '.json', JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: result.status,
      cell: cell.key,
      side,
      capture,
      variant,
      samples: result.samples.length,
      failure: result.failure
    })
  )
}

/** Actual independent AA and ABBA arms preserve the sealed six-block cross-runtime protocol. */
async function timing() {
  /** The option-A receipt keeps every arm and its own current window admission. */
  const result = {
    cell,
    side: 'paired',
    capture,
    variant,
    seed: CrossRuntimeBench.seed,
    warmup: 200,
    measureCalls: 800,
    blocks: 6,
    sourceForm: 'TS public source entries; no RPC build/dist',
    head: process.env.XRT_HEAD,
    productLimits: { maxReplayEntriesPerPeer: 1024, maxReplayEntries: 4096, replayTtlMs: 310000 },
    sessions: 'one fresh independent connection per arm; no retained 4000-call connection',
    samples: [],
    AA: [],
    timingAdmission: state.timingAdmission
  }
  /** Payload selection belongs to the unchanged finite directed inventory. */
  const payload = 'x'.repeat(cell.timingPayloadBytes)
  try {
    for (let block = 0; block < 6; block++) {
      for (const kind of ['rpc', 'bare']) {
        /** A/A repetitions launch separately with the same defaults, warmup and sample count. */
        const first = await arm(kind, 800, payload, true)
        const second = await arm(kind, 800, payload, true)
        result.AA.push({ block, side: kind, first, second })
      }
      /** The actual ABBA order is retained; no isolated gain is added to another. */
      const sample = { block, order: ['rpc', 'bare', 'bare', 'rpc'], windows: [] }
      for (const kind of sample.order) sample.windows.push(await arm(kind, 800, payload, true))
      result.samples.push(sample)
    }
    result.status = 'PASS'
  } catch (error) {
    state.failures.push(classify(error))
    result.status = 'FAIL'
    result.failure = classify(error)
    process.exitCode = 1
  }
  result.final = snapshot()
  writeFileSync(stem + '.json', JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: result.status,
      cell: cell.key,
      mode: 'timing',
      blocks: result.samples.length,
      AApairs: result.AA.length,
      failure: result.failure
    })
  )
}

if (child) await childMain()
else if (process.env.XRT_TIMING === '1') {
  const battery = execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' }),
    settings = execFileSync('/usr/bin/pmset', ['-g', 'custom'], { encoding: 'utf8' }),
    load = loadavg()
  state.timingAdmission = {
    date: new Date().toISOString(),
    load,
    battery,
    settings,
    AC: battery.includes("'AC Power'"),
    lowPowerModeZero: /AC Power:[\s\S]*lowpowermode\s+0/.test(settings),
    qualified:
      load[0] <= 3 &&
      load[1] <= 3 &&
      battery.includes("'AC Power'") &&
      /AC Power:[\s\S]*lowpowermode\s+0/.test(settings)
  }
  if (state.timingAdmission.qualified) await timing()
  else {
    writeFileSync(
      stem + '.json',
      JSON.stringify(
        { cell, status: 'ADMISSION_REFUSED', timingAdmission: state.timingAdmission },
        null,
        2
      ) + '\n'
    )
    process.exitCode = 75
  }
} else await main()
