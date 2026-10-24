/** Actual TS endpoint loads genuine native source owners from the frozen disposable copy. */
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
/** Functional acceptance uses one existing arm and never gives timing or counter credit. */
const functional = process.env.XRT_FUNCTIONAL === '1'
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
  : new URL('../../..', import.meta.url)
/** Child and parent retain independent real runtime identity and cold source-loading provenance. */
const child = process.argv.includes('--child'),
  stem = process.env.XRT_STEM
/** Native definition, handshake and proposal imports retain their actual package source owners. */
const api = async () => {
  /** Each actual source owner remains independently loaded only on RPC arms. */
  const [definition, handshake, proposal] = await Promise.all([
    import(new URL('./rpc-plugin-process/src/process/index.ts', sourceRoot).href),
    import(new URL('./rpc-plugin-process/src/process/handshake.ts', sourceRoot).href),
    import(new URL('./rpc-plugin-process/src/process/offer.ts', sourceRoot).href)
  ])
  return { ...definition, ...handshake, ...proposal }
}
/** Each runtime uses its delivered public process and socket adapter. */
const processAdapter = () =>
  import(
    new URL(
      'rpc-plugin-process/src/process/adapters/' +
        { node: 'node-child-process', bun: 'bun-spawn', deno: 'deno-command' }[runtime] +
        '.ts',
      sourceRoot
    ).href
  )
const socketAdapter = () =>
  import(
    new URL(
      'rpc-plugin-process/src/process/adapters/' +
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
  return new BareJsonPort(raw, serve)
}

/** Bare control keeps only physical framing and JSON echo; no RPC module loads on this arm. */
class BareJsonPort {
  /** The same physical adapter owns writes and close. */
  #raw
  /** Server and reverse arms retain their original echo selection. */
  #serve
  /** The fixed cell selects one of the two existing bare framing grammars. */
  #content = cell.carrier.includes('content-length')
  /** Header bytes accumulate once, with constant work per incoming byte. */
  #header = []
  /** One body allocation is filled incrementally without repeated prefix copying. */
  #body
  /** Number of original body bytes received for this frame. */
  #bodyBytes = 0
  /** Original exchange FIFO uses constant work for each insertion/removal. */
  #waiting = new Map()
  /** Each exchange retains its original request position. */
  #issued = 0
  /** Next complete physical frame consumes the corresponding original request. */
  #received = 0
  /** Original physical writes stay serialized under one Promise chain. */
  #writing = Promise.resolve()
  /** Original physical close reason rejects all outstanding exchanges. */
  #closed
  /** Wire callbacks delegate to this one explicit bare owner. */
  constructor(raw, serve) {
    this.#raw = raw
    this.#serve = serve
    raw.onData((chunk) => this.#receive(chunk))
    raw.onClose((reason) => {
      this.#closed = reason ?? new Error(CrossRuntimeErrorText.closed)
      for (const waiter of this.#waiting.values()) waiter.reject(this.#closed)
      this.#waiting.clear()
    })
  }
  /** Produce exactly the original length-prefix or Content-Length bytes. */
  #encode(value) {
    /** JSON encoding remains the same single business serialization. */
    const body = Buffer.from(JSON.stringify(value))
    if (this.#content)
      return Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body])
    /** Native prefix remains four bytes and excludes the prefix itself. */
    const result = Buffer.alloc(4 + body.length)
    result.writeUInt32BE(body.length)
    result.set(body, 4)
    return result
  }
  /** Consume arbitrary physical fragments with total work linear in received bytes. */
  #receive(chunk) {
    /** Each byte belongs to one header or one original payload copy. */
    let cursor = 0
    while (cursor < chunk.length) {
      if (!this.#body) {
        this.#header.push(chunk[cursor++])
        /** Framing ends at the same fixed prefix or existing CRLF delimiter. */
        const length = this.#header.length
        if (
          this.#content
            ? length < 4 ||
              this.#header[length - 4] !== 13 ||
              this.#header[length - 3] !== 10 ||
              this.#header[length - 2] !== 13 ||
              this.#header[length - 1] !== 10
            : length < 4
        )
          continue
        /** One completed header selects the original supported payload size. */
        const header = Buffer.from(this.#header)
        /** Preserve original Content-Length conversion and frame rejection. */
        const size = this.#content
          ? Number(
              header
                .subarray(0, length - 4)
                .toString()
                .slice(16)
            )
          : header.readUInt32BE(0)
        if (!Number.isSafeInteger(size) || size <= 0 || size > 16777216)
          throw new RangeError(CrossRuntimeErrorText.frame)
        this.#body = Buffer.alloc(size)
        this.#bodyBytes = 0
        this.#header = []
      }
      /** Each received payload byte is copied exactly once into its final frame. */
      const take = Math.min(chunk.length - cursor, this.#body.length - this.#bodyBytes)
      this.#body.set(chunk.subarray(cursor, cursor + take), this.#bodyBytes)
      this.#bodyBytes += take
      cursor += take
      if (this.#bodyBytes !== this.#body.length) continue
      /** A complete physical body enters the original JSON echo path once. */
      const value = JSON.parse(this.#body.toString())
      this.#body = undefined
      if (this.#serve || (cell.direction === 'reverse' && value?.xrtReceipt !== true))
        this.#writing = this.#writing.then(() => this.#raw.write(this.#encode(value)))
      else {
        this.#waiting.get(this.#received)?.resolve(value)
        this.#waiting.delete(this.#received++)
      }
    }
  }
  /** Return the original exchange Promise and preserve write-failure settlement. */
  exchange = (value) =>
    new Promise((resolve, reject) => {
      if (this.#closed) {
        reject(this.#closed)
        return
      }
      this.#waiting.set(this.#issued++, { resolve, reject })
      this.#raw.write(this.#encode(value)).catch(reject)
    })
  /** Close retains the original physical close result without Promise adoption. */
  close = () => this.#raw.close()
}

/** Install one actual cold process definition on an ordinary Host; retain genuine Peer provenance. */
async function openNativeProcessHost(options) {
  /** Source-loaded process definition retains this arm's original runtime graph. */
  const processApi = await api()
  /** Local PluginHost is the canonical owner of native installation and cleanup. */
  const { PluginHost } = await import('@migaia/plugin-host')
  /** The private reader only projects the actual committed outlet, never a substitute facade. */
  const { readRuntimeOutletConnection } = await import(
    new URL('./rpc-host/src/remote/runtime-api/outlet.ts', sourceRoot).href
  )
  /** Native callback source remains the same already-open physical channel and handshake. */
  const { connect, ...settings } = options
  /** One ordinary Host owns this exact native transport definition. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  try {
    await host.use(
      processApi.processPlugin({ ...settings, name: 'bench', connect: { target: connect } })
    )
    return { host, peer: readRuntimeOutletConnection(host.process, 'bench').peer }
  } catch (primary) {
    try {
      await host.dispose()
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  }
}
/** Actual ordinary native Host owns provider lifetime, dispatch and admission. */
async function nativeProvider(raw) {
  const a = await api()
  return openNativeProcessHost({
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
          openNativeProcessHost({
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
  /** One source session retains the original physical arm and its native resources. */
  const owner = new CrossRuntimeSession(physicalSide)
  await owner.open()
  return owner.view()
}

/** One actual runtime pair owns readiness, physical resources, snapshot positions and native Host. */
class CrossRuntimeSession {
  /** The fixed bare/RPC arm selects only its original physical setup. */
  #side
  /** Snapshot filenames belong to this distinct physical arm. */
  #stem
  /** Snapshot ordinals advance only for this actual launched peer. */
  #peerSequence = 0
  /** Native exit receipts stop out-of-band polling without replacing the exit reason. */
  #peerExited = false
  /** The frozen direction determines whether the peer uses foreign delivered source. */
  #foreign
  /** The exact frozen runtime determines the original executable and adapter. */
  #peerRuntime
  /** The actual source-loaded process adapter owns native launch operations. */
  #adapter
  /** The actual source-loaded socket adapter owns Unix dialing. */
  #socket
  /** Original acquired resources retire in reverse acquisition order. */
  #cleanup = []
  /** The genuine physical channel is borrowed by the actual native Host. */
  #raw
  /** The original native launcher supplies this independently observed process identity. */
  #pid
  /** Physical peer diagnostics accumulate outside the measured business loop. */
  #stderr = ''
  /** The existing out-of-band marker resolves only this physical peer startup. */
  #resolveReady
  /** Native launch or premature exit rejects the original startup receipt. */
  #rejectReady
  /** All original startup paths join this one out-of-band readiness Promise. */
  #ready
  /**
   * Original foreignIdentity belongs to this physical arm and is shared only by its native
   * operations.
   */
  #foreignIdentity
  /** RPC arms retain the genuine committed Peer; bare arms retain only their physical echo owner. */
  #peer
  /** Capture the same finite arm metadata before native source acquisition. */
  constructor(physicalSide) {
    this.#side = physicalSide
    this.#stem = process.env.XRT_STEM + '.arm-' + sessionSequence++ + '.' + physicalSide
    this.#foreign = cell.direction !== 'native'
    this.#peerRuntime = this.#foreign
      ? cell.direction === 'reverse'
        ? cell.initiator
        : cell.provider
      : cell.provider
  }
  /** Source adapters and readiness precede the same original physical launch and handshake. */
  async open() {
    this.#adapter = await processAdapter()
    this.#socket = await socketAdapter()
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    /** Only the frozen foreign source manifest may determine a non-native executable. */
    const spec = this.#spec()
    /** Child and parent retain the same independent source-loaded runtime environment. */
    const env = {
      ...process.env,
      XRT_CELL: JSON.stringify(cell),
      XRT_SIDE: this.#side,
      XRT_STEM: this.#stem + '.peer'
    }
    if (cell.carrier.startsWith('stdio')) await this.#openStdio(spec, env)
    else await this.#openSocket(spec, env)
    this.#cleanup.push(() => this.#raw.close())
    if (this.#side === 'bare') this.#peer = barePort(this.#raw, false)
    else await this.#openRpc()
  }
  /** Preserve original raw stderr forwarding and readiness recognition. */
  #output = (stream, bytes) => {
    if (stream !== 'stderr') return
    /** The same physical bytes remain visible before any measured echo. */
    const text = Buffer.from(bytes).toString()
    this.#stderr += text
    process.stderr.write(text)
    if (this.#foreign ? /^READY\s+/m.test(this.#stderr) : this.#stderr.includes('XRT_READY'))
      this.#resolveReady()
  }
  /** Resolve only the original frozen executable and source identity for this physical arm. */
  #spec() {
    let spec
    /** Native identity binds the optimized executable to this arm's frozen foreign sources. */
    if (this.#foreign) {
      const path = fileURLToPath(new URL(this.#peerRuntime + '/', fixtureRoot)),
        executable = JSON.parse(process.env.XRT_FOREIGN_EXECUTABLES ?? '{}')[this.#peerRuntime]
      /** The source manifest was sealed before this window; no live checkout file supplies a peer. */
      const source = JSON.parse(readFileSync(process.env.XRT_SOURCE_MANIFEST, 'utf8')).foreign.find(
        (entry) => entry.runtime === this.#peerRuntime
      )
      for (const file of source.files)
        if (createHash('sha256').update(readFileSync(file.path)).digest('hex') !== file.sha256)
          throw new Error(CrossRuntimeErrorText.foreignSource)
      /** Existing optimized launchers resolve their actual executable before warmup begins. */
      const actualExecutable =
        this.#peerRuntime === 'python'
          ? executable
          : execFileSync('/bin/bash', [envRun, executable, '--executable'], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'inherit']
            }).trim()
      this.#foreignIdentity = {
        runtime: this.#peerRuntime,
        source,
        executable: actualExecutable,
        executableSHA256: createHash('sha256').update(readFileSync(actualExecutable)).digest('hex'),
        proof:
          'frozen source/build inputs plus actual launcher executable; no foreign internals claim'
      }
      state.foreignIdentities.push(this.#foreignIdentity)
      spec = {
        command: actualExecutable,
        args:
          this.#peerRuntime === 'python' ? ['-B', path + 'peer.py', '--business'] : ['--business']
      }
      spec.args.push('--jsonrpc', ...(this.#side === 'bare' ? ['--bare-jsonrpc'] : []))
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
    } else spec = command(this.#peerRuntime)

    return spec
  }
  /** Open the original process launcher with unchanged bootstrap, stdio and exit receipts. */
  async #openStdio(spec, env) {
    const factory =
      runtime === 'deno'
        ? this.#adapter.createDenoProcessLauncher
        : runtime === 'bun'
          ? this.#adapter.createBunProcessLauncher
          : this.#adapter.createNodeProcessLauncher
    const handle = await factory().launch(
      {
        ...spec,
        args: [
          ...spec.args,
          ...(this.#foreign ? ['--bootstrap', 'stdin', '--stdio'] : ['--child'])
        ],
        env: { inherit: ['PATH', 'TMPDIR'], set: env },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        ...(this.#foreign
          ? {
              bootstrap: {
                via: 'stdin',
                payload: new TextEncoder().encode(CrossRuntimeBench.token)
              }
            }
          : {})
      },
      { signal: new AbortController().signal, output: this.#output }
    )
    this.#raw = handle.channel
    this.#pid = handle.identity.pid
    this.#cleanup.push(async () => {
      handle.terminate('force')
      await handle.exited
    })
    void handle.exited.then((status) => {
      this.#peerExited = true
      this.#rejectReady(new Error(CrossRuntimeErrorText.peerExit(status.code)))
    })
    await this.#ready
  }
  /** Open the original Unix listener arm and join the same native readiness before dialing. */
  async #openSocket(spec, env) {
    const directory = mkdtempSync('/tmp/xrt-'),
      address = directory + '/p.sock'
    env.XRT_ADDRESS = address
    this.#cleanup.push(async () => rmSync(directory, { recursive: true, force: true }))
    if (this.#foreign) {
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
        args: [...spec.args, ...(!this.#foreign ? ['--child'] : [])],
        env,
        stdin: 'null',
        stdout: 'null',
        stderr: 'piped'
      }).spawn()
      this.#pid = native.pid
      void native.status.then(() => {
        this.#peerExited = true
      })
      this.#cleanup.push(async () => {
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
            this.#output('stderr', next.value)
          }
        } finally {
          reader.releaseLock()
        }
      })()
    } else {
      const native = spawn(spec.command, [...spec.args, ...(!this.#foreign ? ['--child'] : [])], {
        env,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      this.#pid = native.pid
      native.stderr.on('data', (bytes) => this.#output('stderr', bytes))
      native.once('error', this.#rejectReady)
      native.once('exit', (code) => {
        this.#peerExited = true
        this.#rejectReady(new Error(CrossRuntimeErrorText.peerExit(code)))
      })
      this.#cleanup.push(
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
    await this.#ready
    this.#raw = await this.#socket.dialProcessByteChannel({ address })
  }
  /** Actual ordinary PluginHost installation replaces the removed full process Peer factory. */
  async #openRpc() {
    const a = await api()
    const connect = this.#foreign
      ? async (context) => {
          const { createProcessJsonRpcChannel } = await import(
            new URL('./rpc-plugin-process/src/process/jsonrpc-channel.ts', sourceRoot).href
          )
          return createProcessJsonRpcChannel({
            byte: this.#raw,
            peerId: this.#peerRuntime + '-peer',
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
          a.createProcessTransport(this.#raw, {
            role: 'initiator',
            peerId: 'provider',
            offer: {
              ...offer(a, 'initiator', context.capabilities),
              auth: CrossRuntimeBench.token
            },
            report,
            ipc
          })
    const { host, peer } = await openNativeProcessHost({
      self: { name: 'initiator', instanceId: 'initiator' },
      provide:
        cell.direction === 'reverse'
          ? {
              bench: { echo: capture === 'count' ? (value) => echo(value[0]) : (value) => value[0] }
            }
          : undefined,
      providerLimits: limits,
      connect,
      report
    })
    this.#cleanup.push(() => host.dispose())
    this.#peer = peer
  }
  /** Expose original observation receipts without manufacturing a business Peer facade. */
  view() {
    return {
      pid: this.#pid,
      foreignIdentity: this.#foreignIdentity,
      exchange: (payload) =>
        this.#side === 'bare'
          ? this.#peer.exchange(payload)
          : this.#peer.request(
              cell.direction === 'reverse'
                ? CrossRuntimeBench.reverse
                : this.#foreign
                  ? CrossRuntimeBench.request
                  : RuntimeBench.echo,
              cell.direction === 'reverse' || this.#foreign ? [payload] : payload
            ),
      snapshot: () =>
        this.#foreign
          ? null
          : peerSnapshot(this.#pid, this.#stem, this.#peerSequence++, () => this.#peerExited),
      close: async () => {
        for (const close of this.#cleanup.reverse()) await close()
      },
      stderr: this.#stderr
    }
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

/** Counters retain matched N1/N2 arms; functional rows reuse one fresh bounded RPC arm. */
async function main() {
  /** This finite receipt identifies every requested cell and actual execution context. */
  const result = {
    cell,
    side,
    capture,
    variant,
    seed: CrossRuntimeBench.seed,
    warmup: 200,
    ...(functional
      ? {
          mode: 'functional',
          measureCalls: 800,
          functionalOnly: true,
          counterCredit: false,
          timingCredit: false,
          /** Plain source preserves actual rejection reasons but has no ledger occupancy hook. */
          replayOccupancy: null,
          replayOccupancyAvailable: false
        }
      : { N1: 128, N2: 768 }),
    sourceForm: 'TS public source entries; no RPC build/dist',
    head: process.env.XRT_HEAD,
    productLimits: { maxReplayEntriesPerPeer: 1024, maxReplayEntries: 4096, replayTtlMs: 310000 },
    sessions: functional
      ? 'one fresh RPC connection per row; warm200/sample800; cold/directory/reverse outer control retained'
      : 'every N1/N2 arm is a fresh independent matched connection',
    samples: []
  }
  try {
    for (const payloadBytes of capture === 'count' ? [64, 1024] : [cell.timingPayloadBytes]) {
      /** One-off fixture data has the same encoded bytes on RPC and bare arms. */
      const payload = 'x'.repeat(payloadBytes)
      if (functional) {
        /** The unchanged arm keeps exact echo/reverse validation, snapshots and joined cleanup. */
        const receipt = await arm(side, 800, payload)
        result.samples.push({ payloadBytes, receipt })
      } else {
        /** Startup and warmup are subtracted independently before the N2-N1 difference. */
        const first = await arm(side, 128, payload)
        const second = await arm(side, 768, payload)
        result.samples.push({ payloadBytes, first, second, deltaN: 640 })
      }
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
