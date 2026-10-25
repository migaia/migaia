import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IRpcRetryFeature, IRpcAttempt } from '@migaia/rpc-contract/interfaces'
import { retry } from '@migaia/rpc-host/features/retry'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { sendQueue } from '@migaia/rpc-plugin-process/features/send-queue'
import { ipcLog } from '@migaia/rpc-plugin-process/features/log'
import type {
  ISpawnProcessPluginDeployment,
  IConnectProcessPluginDeployment
} from '@migaia/rpc-plugin-process'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame,
  RPC_STREAM_MAX_FRAME_BYTES
} from '@migaia/rpc-host/sdk'
import {
  peers,
  expected,
  assertWireGraph,
  evidence,
  deployment,
  wireFrames,
  installBusinessClient
} from './fixtures/conformance-business.js'

/** Only the original admitted native language recipes participate in this matrix. */
type IPeer = (typeof peers)[number]
/** Fault configuration changes real supervision and complete policies, never the semantic protocol. */
type IFaultOptions = {
  host?: boolean
  scheduler?: ReturnType<typeof createManualScheduler>
  restart?: ISpawnProcessPluginDeployment['supervision']['restart']
  maxPendingData?: number
  address?: string
  token?: string
  retry?: IRpcRetryFeature
}

/** Own the original native source and real public namespace across native replacement generations. */
class FaultClient {
  /** The existing production unit budget remains authoritative for native lease cleanup. */
  readonly budget
  /** Exact launched OS handles preserve independent exit and PID observations. */
  readonly handles: ReturnType<typeof deployment>['handles']
  /** Native stderr remains original evidence, separate from diagnostics returned by Host. */
  readonly output: ReturnType<typeof deployment>['output']
  /** Actual raw response chunks remain available to the post-run frame assertions. */
  readonly stdout: ReturnType<typeof deployment>['stdout']
  /** Actual native outgoing chunks preserve the original zero-write and retry-count evidence. */
  readonly sent: ReturnType<typeof deployment>['sent']
  /** Every original report object remains held unchanged. */
  readonly reports: ReturnType<typeof deployment>['reports']
  /** Physical injections borrow exactly the acquired raw channels, independently of RPC shutdown. */
  readonly physical: ReturnType<typeof deployment>['rawChannels']
  /** The installed real process log feature reports original capacity transitions. */
  readonly backlog: unknown[] = []
  /** Native acquisition inputs and passive receipts belong to this fixture operation. */
  readonly #fixture: ReturnType<typeof deployment>
  /** One immutable test scenario selects original clocks, restart and complete policy instances. */
  readonly #options: IFaultOptions
  /** The canonical public Host remains the only request, stream, pending and provider owner. */
  #installed: Awaited<ReturnType<typeof installBusinessClient>> | undefined

  /** Prepare only the native recipe; the normal install transaction owns all actual execution. */
  constructor(peer: IPeer, options: IFaultOptions) {
    this.#options = options
    this.budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: options.scheduler })
    this.#fixture = deployment(
      peer,
      options.host ?? false,
      options.token ?? randomUUID(),
      options.address,
      false,
      this.budget
    )
    this.handles = this.#fixture.handles
    this.output = this.#fixture.output
    this.stdout = this.#fixture.stdout
    this.sent = this.#fixture.sent
    this.reports = this.#fixture.reports
    this.physical = this.#fixture.rawChannels
  }
  /** Every business operation uses the same genuine namespace, including after native restart. */
  get namespace() {
    return this.#installed!.namespace
  }

  /** Add only the original supervision overrides and complete executing features to the source. */
  async open(): Promise<this> {
    const source = this.#fixture.selected
    const scheduler = this.#options.scheduler ?? systemScheduler
    const selected: ISpawnProcessPluginDeployment | IConnectProcessPluginDeployment =
      source.kind === 'spawn'
        ? {
            ...source,
            supervision: { ...source.supervision, scheduler, restart: this.#options.restart }
          }
        : {
            ...source,
            supervision: { ...source.supervision, scheduler, restart: this.#options.restart }
          }
    try {
      this.#installed = await installBusinessClient(this.#fixture, selected, [
        this.#options.retry ?? retry({ scheduler, report: (error) => this.reports.push(error) }),
        ...(this.#options.maxPendingData === undefined
          ? []
          : [
              sendQueue({ maxPendingData: this.#options.maxPendingData }),
              ipcLog({
                report: (record) => {
                  this.backlog.push(record)
                }
              })
            ])
      ])
      return this
    } catch (error) {
      await this.#installed?.close()
      await Promise.all(this.handles.map((handle) => handle.exited))
      writeFileSync(join(evidence, 'hf-startup.stderr.log'), Buffer.concat(this.output))
      writeFileSync(join(evidence, 'hf-startup.stdout.bin'), Buffer.concat(this.stdout))
      throw error
    }
  }
  /** Real public member queries sample the original supervisor state without retaining its object. */
  async state(): Promise<string | undefined> {
    const detail = await this.namespace.members.get('p')
    return 'state' in detail.unit ? detail.unit.state : undefined
  }
  /** The same Host close owns native drain/exit; only the explicit original manual clock is settled. */
  close = async (): Promise<void> => {
    await this.#installed?.close()
    if (this.#options.scheduler) await settleFaultTurn(this.#options.scheduler)
  }
}
/** Open one original real language/native scenario through the public production entry. */
async function faultClient(peer: IPeer, options: IFaultOptions = {}) {
  return new FaultClient(peer, options).open()
}

/** A one-peer native fixture must produce an actual iterator, never a fanout object. */
function singleStream(stream: ReturnType<FaultClient['namespace']['stream']>) {
  if (!(Symbol.asyncIterator in stream))
    throw new TypeError('fault fixture requires one native stream')
  return stream
}

/** Preserve complete stdout/stderr and outbound frames for every real fault run. */
function receipt(active: Awaited<ReturnType<typeof faultClient>>, label: string) {
  writeFileSync(join(evidence, `hf-${label}.stdout.bin`), Buffer.concat(active.stdout), {
    mode: 0o600
  })
  writeFileSync(join(evidence, `hf-${label}.stderr.log`), Buffer.concat(active.output), {
    mode: 0o600
  })
  writeFileSync(join(evidence, `hf-${label}.sent.bin`), Buffer.concat(active.sent), { mode: 0o600 })
}

describe('source domains error source domains', () => {
  it('uses the endpoint domain in the public TS behavior vector', () => {
    expect(expected.error, 'SOURCE_DOMAIN_PUBLIC_VECTOR_DOMAIN_SOURCE').toMatchObject({
      source: 'rpc.endpoint',
      code: 'INTERNAL',
      cause: {
        source: 'rpc.endpoint',
        code: 'INTERNAL',
        cause: { source: 'rpc.endpoint', code: 'INTERNAL', message: 'peer cause' }
      }
    })
  })

  for (const peer of peers)
    it(`${peer.language} preserves real wire diagnostics with endpoint domain sources`, async () => {
      /** The existing deployment starts the actual independent language executable. */
      const active = await faultClient(peer)
      /** Retain the caller's real rejection for comparison with the physical response. */
      let receivedError: unknown
      try {
        await expect(
          active.namespace.request('peer.error', []).catch((error) => {
            receivedError = error
            throw error
          })
        ).rejects.toMatchObject({
          code: 'INTERNAL',
          cause: {
            code: 'INTERNAL',
            message: 'peer error',
            cause: { code: 'INTERNAL', message: 'peer cause' }
          }
        })
        /** Observe the actual provider bytes through the canonical stream decoder. */
        const failedWire = wireFrames(active.stdout).find(
          (frame) => frame.kind === 'error' && frame.task.method === 'peer.error'
        )?.error
        expect(failedWire).toBeDefined()
        /** Existing graph assertions prove exact code/name/message/stack and cause preservation. */
        assertWireGraph((receivedError as { cause: unknown }).cause, failedWire)
        expect
          .soft(failedWire.nodes[failedWire.root], 'SOURCE_DOMAIN_WIRE_DOMAIN_SOURCE')
          .toMatchObject({
            source: 'rpc.endpoint',
            code: 'INTERNAL',
            message: 'peer error',
            cause: 1
          })
        expect.soft(failedWire.nodes[1], 'SOURCE_DOMAIN_WIRE_CAUSE_DOMAIN_SOURCE').toMatchObject({
          source: 'rpc.endpoint',
          code: 'INTERNAL',
          message: 'peer cause'
        })
        expect.soft(receivedError, 'SOURCE_DOMAIN_RECEIVED_DOMAIN_SOURCE').toMatchObject({
          source: 'rpc.endpoint',
          code: 'INTERNAL',
          cause: {
            source: 'rpc.endpoint',
            code: 'INTERNAL',
            message: 'peer error',
            cause: { source: 'rpc.endpoint', code: 'INTERNAL', message: 'peer cause' }
          }
        })
      } finally {
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-source-domain-error-source`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(active.budget.pending).toBe(0)
    })

  it('uses the process domain for a real Go authentication rejection', async () => {
    /** The admitted Go executable receives bootstrap and hello through its existing native entry. */
    const peer = peers.find((candidate) => candidate.language === 'go')!
    /** This test owns the raw child because a rejected hello cannot produce a ready facade. */
    const child = spawn(peer.command, [...peer.args, '--stdio', '--bootstrap', 'stdin'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    /** Register close observation before sending input so early launch failures remain visible. */
    const exited = once(child, 'close')
    /** Only peer-produced bytes are decoded as evidence of the rejected handshake. */
    const stdout: Uint8Array[] = []
    /** Retain native diagnostics without logging the local authentication fixture. */
    const stderr: Uint8Array[] = []
    child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk.slice()))
    child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk.slice()))
    try {
      child.stdin!.end(
        Buffer.concat([
          encodeRpcStreamFrame(Buffer.from('source-domain-bootstrap-token')),
          encodeRpcStreamFrame(
            Buffer.from(
              JSON.stringify({
                kind: 'handshake',
                step: 'hello',
                profile: 'migaia.rpc/2',
                peer: { id: 'caller', runtime: 'node' },
                versions: [{ major: 2, minor: 0 }],
                codecs: ['json'],
                extensions: [],
                directory: {
                  schemaVersion: 3,
                  self: {
                    name: 'caller',
                    instanceId: 'caller',
                    generation: { kind: 'connection', value: 0 },
                    applicationVersion: '0.0.0'
                  },
                  methods: []
                },
                auth: 'source-domain-different-token'
              })
            )
          )
        ])
      )
      expect((await exited)[0]).toBe(0)
      /** The real Go rejectRecord calls its generic wireError before returning this frame. */
      const rejected = wireFrames(stdout).find(
        (frame) => frame.kind === 'handshake' && frame.step === 'reject'
      )
      expect(rejected?.error.nodes[rejected.error.root]).toMatchObject({
        code: 'AUTH_REJECTED',
        name: 'Error',
        message: 'authentication rejected',
        stack: 'Error: authentication rejected'
      })
      expect(
        rejected.error.nodes[rejected.error.root],
        'SOURCE_DOMAIN_GENERIC_HANDSHAKE_SOURCE'
      ).toMatchObject({
        source: 'rpc.transport.process'
      })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
      writeFileSync(
        join(evidence, 'hf-go-source-domain-generic-handshake.stdout.bin'),
        Buffer.concat(stdout)
      )
      writeFileSync(
        join(evidence, 'hf-go-source-domain-generic-handshake.stderr.log'),
        Buffer.concat(stderr)
      )
    }
  })
})

describe('canonical raw physical frame boundaries', () => {
  it('accepts exactly 16 MiB and rejects oversized length before payload allocation', () => {
    /** Exact physical maximum includes arbitrary payload bytes, not a business JSON value. */
    const payload = new Uint8Array(RPC_STREAM_MAX_FRAME_BYTES).fill(97)
    /** Canonical decoder emits one payload even when both prefix and body are split. */
    const frames: Uint8Array[] = []
    const errors: unknown[] = []
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error)
    })
    const encoded = encodeRpcStreamFrame(payload)
    decoder.push(encoded.subarray(0, 2))
    decoder.push(encoded.subarray(2, 1024))
    decoder.push(encoded.subarray(1024))
    decoder.finish()
    decoder.close()
    expect(frames).toHaveLength(1)
    expect(Buffer.from(frames[0]!).equals(Buffer.from(payload))).toBe(true)
    expect(errors).toEqual([])
    for (const length of [RPC_STREAM_MAX_FRAME_BYTES + 1, 0xffffffff]) {
      const rejected: unknown[] = []
      const invalid = createRpcStreamFrameDecoder({
        onFrame: () => expect.fail('oversize payload delivered'),
        onError: (error) => rejected.push(error)
      })
      const header = Buffer.alloc(4)
      header.writeUInt32BE(length)
      /** Constructor interception proves the complete invalid prefix allocates no payload. */
      const allocation = vi.spyOn(globalThis, 'Uint8Array')
      try {
        invalid.push(header)
        expect(allocation).not.toHaveBeenCalled()
      } finally {
        allocation.mockRestore()
        invalid.close()
      }
      expect(rejected).toMatchObject([{ code: 'FRAME_LIMIT_EXCEEDED' }])
    }
    expect(() => encodeRpcStreamFrame(new Uint8Array(RPC_STREAM_MAX_FRAME_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })
    )
  })
  it.each([Uint8Array.of(0, 1), Uint8Array.of(0, 0, 0, 4, 97, 98), Uint8Array.of(0, 0, 0, 0)])(
    'rejects half-header, half-body EOF and zero length %#',
    (bytes) => {
      const errors: unknown[] = []
      const decoder = createRpcStreamFrameDecoder({
        onFrame: () => expect.fail('invalid frame delivered'),
        onError: (error) => errors.push(error)
      })
      decoder.push(bytes)
      decoder.finish()
      decoder.finish()
      decoder.close()
      expect(errors).toMatchObject([{ code: 'INVALID_FRAME' }])
    }
  )
  it('delivers coalesced native frames in FIFO order without truncation', () => {
    const frames: Uint8Array[] = []
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (frame) => frames.push(frame),
      onError: (error) => {
        throw error
      }
    })
    decoder.push(
      Buffer.concat([
        encodeRpcStreamFrame(Buffer.from('first')),
        encodeRpcStreamFrame(Buffer.from('你好🙂'))
      ])
    )
    decoder.finish()
    decoder.close()
    expect(frames.map((frame) => Buffer.from(frame).toString())).toEqual(['first', '你好🙂'])
  })
})

describe('borrowed hang retains external process ownership', () => {
  for (const peer of peers)
    it(`${peer.language} closes only the hung socket and redials the same external PID`, async () => {
      /** The test owns the listener; the public connect facade owns only each socket. */
      const directory = await mkdtemp(join(tmpdir(), 'rpc-hf-borrowed-'))
      const address = join(directory, 'peer.sock')
      const token = randomUUID()
      const auth = join(directory, 'auth')
      writeFileSync(auth, token, { mode: 0o600 })
      const fd = openSync(auth, 'r')
      const child = spawn(
        peer.command,
        [...peer.args, '--listen-unix', address, '--auth-fd', '3'],
        {
          stdio: ['ignore', 'pipe', 'pipe', fd]
        }
      )
      closeSync(fd)
      const exited = once(child, 'close')
      const stderr: Buffer[] = []
      child.stderr!.on('data', (chunk) => stderr.push(chunk))
      let paused = false
      let active: Awaited<ReturnType<typeof faultClient>> | undefined
      const scheduler = createManualScheduler()
      try {
        await new Promise<void>((resolve, reject) => {
          child.stderr!.on('data', (chunk) => {
            if (chunk.toString().includes('READY')) resolve()
          })
          child.once('error', reject)
          child.once('exit', () => reject(new Error('borrowed fixture exited before ready')))
        })
        active = await faultClient(peer, {
          address,
          token,
          scheduler,
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
        })
        expect(await active.namespace.request('p.f.request', ['before-hang'])).toBe('before-hang')
        expect({
          state: await active.state()
        }).toMatchObject({ state: 'ready' })
        let closed = false
        active.physical[0]!.onClose(() => {
          closed = true
        })
        process.kill(child.pid!, 'SIGSTOP')
        paused = true
        const origin = scheduler.now()
        for (let check = 0; check < 3; check++) {
          scheduler.advance(origin + (check + 1) * 5000 - scheduler.now())
          await settleFaultTurn(scheduler)
          scheduler.advance(2000)
          await settleFaultTurn(scheduler)
          if (check < 2) expect(closed).toBe(false)
        }
        expect(scheduler.now() - origin).toBe(17000)
        await vi.waitFor(() => expect(closed).toBe(true))
        expect(child.exitCode).toBeNull()
        process.kill(child.pid!, 0)
        expect(active.handles).toHaveLength(0)
        process.kill(child.pid!, 'SIGCONT')
        paused = false
        await vi.waitFor(async () =>
          expect({
            state: await active!.state()
          }).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(async () => {
          await settleFaultTurn(scheduler)
          expect(await active!.namespace.request('p.f.request', ['after-redial'])).toBe(
            'after-redial'
          )
        })
        expect(active.physical).toHaveLength(2)
        await active.close()
        process.kill(child.pid!, 0)
        expect(child.exitCode).toBeNull()
        expect(scheduler.pendingCount).toBe(0)
      } finally {
        if (paused) process.kill(child.pid!, 'SIGCONT')
        await active?.close()
        if (active) receipt(active, `${peer.language}-borrowed-hang`)
        /** Only the external test owner terminates its listener after facade release is proven. */
        child.kill()
        await exited
        writeFileSync(
          join(evidence, `hf-${peer.language}-borrowed-listener.stderr.log`),
          Buffer.concat(stderr),
          { mode: 0o600 }
        )
        await rm(directory, { recursive: true, force: true })
      }
    }, 15000)
})

describe('real native business budget and independent session', () => {
  for (const peer of peers)
    it(`${peer.language} near limit succeeds; encoded overflow writes zero; resources return`, async () => {
      const active = await faultClient(peer)
      const healthy = await faultClient(peer)
      try {
        /**
         * Leave room for the complete canonical request/response envelope around the business
         * string.
         */
        const payload = 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - 4096)
        expect(
          await active.namespace.request('p.f.request', [payload], {
            timeout: timeout({ ms: 10000, scheduler: systemScheduler })
          })
        ).toBe(payload)
        const writes = active.sent.length
        await expect(
          active.namespace.request('p.f.request', ['x'.repeat(RPC_STREAM_MAX_FRAME_BYTES)], {
            timeout: timeout({ ms: 10000, scheduler: systemScheduler })
          })
        ).rejects.toMatchObject({ cause: { code: 'FRAME_LIMIT_EXCEEDED' } })
        expect(active.sent).toHaveLength(writes)
        expect(await healthy.namespace.request('p.f.request', ['healthy'])).toBe('healthy')
        expect(await active.namespace.request('p.f.request', ['after-overflow'])).toBe(
          'after-overflow'
        )
      } finally {
        await active.close()
        await healthy.close()
        await Promise.all([...active.handles, ...healthy.handles].map((handle) => handle.exited))
        receipt(active, `${peer.language}-budget`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(active.budget.pending).toBe(0)
      expect(healthy.budget.inUse).toBe(0)
      expect(healthy.budget.pending).toBe(0)
    }, 30000)
})

describe('independent peer rejects raw malformed input', () => {
  for (const peer of peers)
    it(`${peer.language} rejects malicious length, UTF-8, JSON and truncated EOF independently`, async () => {
      /** Every malformed connection is independent of this continuously usable deployment. */
      const healthy = await faultClient(peer)
      try {
        for (const [label, bytes, eof] of [
          ['oversize', Uint8Array.of(1, 0, 0, 1), false],
          ['malicious', Uint8Array.of(255, 255, 255, 255), false],
          ['half-header', Uint8Array.of(0, 0), true],
          ['half-body', Uint8Array.of(0, 0, 0, 4, 123), true],
          ['utf8', encodeRpcStreamFrame(Uint8Array.of(255)), false],
          ['json', encodeRpcStreamFrame(Buffer.from('[')), false]
        ] as const) {
          const active = await faultClient(peer, {
            restart: { mode: 'on-failure', maxRestarts: 0 }
          })
          /** Physical closure proves parser rejection; process exit belongs to later owner release. */
          let closed = false
          const unsubscribe = active.physical[0]!.onClose(() => {
            closed = true
          })
          try {
            /** Bypass business normalization only to inject these explicit physical faults. */
            await active.physical[0]!.write(bytes)
            if (eof) await active.physical[0]!.close()
            if (label === 'json' && ['node', 'bun'].includes(peer.language)) {
              /**
               * Ready JSON is rejected by the canonical core decoder and reported, without
               * requiring fatal transport closure.
               */
              await vi.waitFor(() =>
                expect(Buffer.concat(active.output).toString()).toContain(
                  'PEER_ERROR DECODE_FAILED'
                )
              )
              expect(await active.namespace.request('p.f.request', ['after-invalid-json'])).toBe(
                'after-invalid-json'
              )
            } else await vi.waitFor(() => expect(closed, label).toBe(true), { timeout: 2000 })
            expect(active.handles).toHaveLength(1)
            expect(await healthy.namespace.request('p.f.request', [label])).toBe(label)
          } finally {
            unsubscribe()
            await active.close()
            await Promise.all(active.handles.map((handle) => handle.exited))
            receipt(active, `${peer.language}-raw-${label}`)
            writeFileSync(join(evidence, `hf-${peer.language}-raw-${label}.injected.bin`), bytes)
          }
          expect(active.budget.inUse).toBe(0)
          expect(active.budget.pending).toBe(0)
        }
      } finally {
        await healthy.close()
        await Promise.all(healthy.handles.map((handle) => handle.exited))
      }
      expect(healthy.budget.inUse).toBe(0)
    }, 30000)
})

describe('real owned terminal guards', () => {
  for (const peer of peers)
    for (const host of [false, true])
      it(`${peer.language} Host=${host} crash terminal rejects all new calls with zero frames`, async () => {
        /** Logical timers remain deterministic while the peer exits through the actual OS. */
        const scheduler = createManualScheduler()
        const active = await faultClient(peer, {
          host,
          scheduler,
          restart: { mode: 'on-failure', maxRestarts: 0 }
        })
        try {
          const current = active.handles[0]!
          process.kill(current.identity.pid!, 'SIGKILL')
          await current.exited
          await vi.waitFor(async () =>
            expect({ state: await active.state() }).toMatchObject({ state: 'terminal' })
          )
          const writes = active.sent.length
          for (const operation of [
            () => active.namespace.request('p.f.request', []),
            () => active.namespace.notify('p.f.oneWay', []),
            () => singleStream(active.namespace.stream('p.f.generator', [])).next()
          ])
            await expect(async () => operation()).rejects.toMatchObject({
              source: 'rpc.remote',
              code: 'REMOTE_CLOSED'
            })
          expect(active.sent).toHaveLength(writes)
          expect(active.handles).toHaveLength(1)
          expect(
            wireFrames(active.sent).filter((frame) => frame.kind === 'call').length
          ).toBeGreaterThan(0)
        } finally {
          await active.close()
          await Promise.all(active.handles.map((handle) => handle.exited))
          receipt(active, `${peer.language}-terminal-${host}`)
        }
        expect(active.budget.inUse).toBe(0)
        expect(active.budget.pending).toBe(0)
        expect(scheduler.pendingCount).toBe(0)
        expect(await active.state()).toBe('disposed')
      }, 15000)
})

describe('explicit persistent authenticated scope', () => {
  it('replays the original key once after committed crash without executing the side effect twice', async () => {
    /**
     * File backing is private, bounded to one benign result, and removed after all child ownership
     * ends.
     */
    const directory = await mkdtemp(join(tmpdir(), 'rpc-hf-store-'))
    const peer: IPeer = {
      language: 'persistent',
      command: process.execPath,
      args: [
        new URL('./fixtures/conformance-faults-persistent.mjs', import.meta.url).pathname,
        directory
      ],
      id: 'ts-peer'
    }
    let active: Awaited<ReturnType<typeof faultClient>> | undefined
    try {
      active = await faultClient(peer, {
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      expect(
        await active.namespace.request('p.f.request', [], {
          timeout: timeout({ ms: 5000 }),
          idempotencyKey: 'hf-original-key'
        })
      ).toBe('committed')
      expect(Number(readFileSync(join(directory, 'count.txt'), 'utf8'))).toBe(1)
      expect(active.handles).toHaveLength(2)
      expect((await active.handles[0]!.exited).code).toBe(17)
      const requests = wireFrames(active.sent).filter(
        (frame) => frame.kind === 'call' && frame.task?.method === 'p.f.request'
      )
      expect(requests).toHaveLength(2)
      expect(requests.map((frame) => frame.options.idempotencyKey)).toEqual([
        'hf-original-key',
        'hf-original-key'
      ])
      expect(requests[1].options.remainingMs).toBeLessThanOrEqual(requests[0].options.remainingMs)
    } finally {
      await active?.close()
      if (active) {
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, 'persistent-retry')
      }
      await rm(directory, { recursive: true, force: true })
    }
    expect(active!.budget.inUse).toBe(0)
  }, 15000)
})

describe('physical departure before sendOnce admission', () => {
  for (const peer of peers)
    it(`${peer.language} returns REMOTE_CLOSED with zero business frames`, async () => {
      const scheduler = createManualScheduler()
      let admit!: () => void
      let entered!: () => void
      /** The public injected retry port delays admission, then delegates every state decision. */
      const barrier = new Promise<void>((resolve) => {
        admit = resolve
      })
      const waiting = new Promise<void>((resolve) => {
        entered = resolve
      })
      /** The original barrier surrounds the complete retry policy's one actual attempt. */
      const admission = { entered, barrier, policy: retry({ scheduler, report: () => undefined }) }
      const retryPort: IRpcRetryFeature = {
        kind: 'retry',
        async run<T>(attempt: IRpcAttempt<T>): Promise<T> {
          admission.entered()
          await admission.barrier
          return admission.policy.run(attempt)
        }
      }
      const active = await faultClient(peer, {
        scheduler,
        retry: retryPort,
        restart: { mode: 'on-failure', initialDelayMs: 100, maxDelayMs: 100, maxRestarts: 1 }
      })
      let call: Promise<unknown> | undefined
      try {
        const writes = active.sent.length
        call = active.namespace.request('p.f.request', ['blocked-before-sendOnce']).then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        await waiting
        expect(active.sent).toHaveLength(writes)
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(async () =>
          expect({
            state: await active.state()
          }).toMatchObject({ state: 'backoff' })
        )
        admit()
        expect(await call).toMatchObject({
          error: { source: 'rpc.remote', code: 'REMOTE_CLOSED' }
        })
        expect(
          wireFrames(active.sent).filter(
            (frame) => frame.kind === 'call' && frame.task?.method === 'p.f.request'
          )
        ).toHaveLength(0)
      } finally {
        admit()
        await call
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-before-sendOnce`)
      }
      expect(scheduler.pendingCount).toBe(0)
      expect(active.budget.inUse).toBe(0)
    }, 15000)
})

/** Settle real I/O, explicitly run manual deferred jobs, and join bounded Promise continuations. */
async function settleFaultTurn(scheduler?: ReturnType<typeof createManualScheduler>) {
  await new Promise<void>((resolve) => setImmediate(resolve))
  for (let turn = 0; turn < 32; turn++) {
    scheduler?.advance(0)
    await Promise.resolve()
  }
}

describe('default native health detects real CPU loops', () => {
  for (const peer of peers)
    it(`${peer.language} busy loop fails at 17000ms and restarts owned PID`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, {
        scheduler,
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      try {
        const current = active.handles[0]!
        expect({
          state: await active.state()
        }).toMatchObject({ state: 'ready' })
        expect(await active.namespace.request('peer.busy', [])).toBe('ACK')
        let exited = false
        void current.exited.then(() => {
          exited = true
        })
        const origin = scheduler.now()
        for (let check = 0; check < 3; check++) {
          scheduler.advance(origin + (check + 1) * 5000 - scheduler.now())
          await settleFaultTurn(scheduler)
          expect(exited).toBe(false)
          scheduler.advance(1999)
          await settleFaultTurn(scheduler)
          expect(exited).toBe(false)
          scheduler.advance(1)
          await settleFaultTurn(scheduler)
          if (check < 2) expect(exited).toBe(false)
        }
        expect(scheduler.now() - origin).toBe(17000)
        await current.exited
        await vi.waitFor(async () =>
          expect({
            state: await active.state()
          }).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(() => expect(active.handles).toHaveLength(2))
        await vi.waitFor(async () => {
          await settleFaultTurn(scheduler)
          expect(await active.namespace.request('p.f.request', ['after-busy'])).toBe('after-busy')
        })
        expect(active.handles[1]!.identity.pid).not.toBe(current.identity.pid)
        expect(
          wireFrames(active.sent).filter(
            (frame) => frame.kind === 'control' && frame.operation === 'ping'
          )
        ).toHaveLength(3)
      } finally {
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-busy`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }, 20000)
})

describe('capacity one real stopped reader', () => {
  for (const peer of peers)
    it(`${peer.language} keeps send pending, rejects overload, reports backlog and recovers`, async () => {
      const active = await faultClient(peer, { maxPendingData: 1 })
      const healthy = await faultClient(peer)
      let paused = false
      let blocked: Promise<unknown> | undefined
      try {
        expect(await active.namespace.request('peer.pause', [])).toBe('ACK')
        paused = true
        /** This real pipe write exceeds the OS pipe buffer while remaining below the frame budget. */
        blocked = active.namespace.request('p.f.request', ['x'.repeat(2 * 1024 * 1024)], {
          timeout: timeout({ ms: 10000, scheduler: systemScheduler }),
          trace: 'h-backlog-trace'
        })
        let settled = false
        void blocked.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          }
        )
        await settleFaultTurn()
        expect(settled).toBe(false)
        const writes = active.sent.length
        await expect(
          active.namespace.request('p.f.request', ['overloaded'], {
            trace: 'h-rejected-trace'
          })
        ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'OVERLOADED' })
        expect(active.sent).toHaveLength(writes)
        expect(active.backlog).toContainEqual(
          expect.objectContaining({
            name: 'ipc.backlog.rejected',
            pendingData: 1,
            trace: 'h-rejected-trace'
          })
        )
        expect(await healthy.namespace.request('p.f.request', ['healthy-during-backlog'])).toBe(
          'healthy-during-backlog'
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGCONT')
        paused = false
        expect(await blocked).toBe('x'.repeat(2 * 1024 * 1024))
        expect(await active.namespace.request('p.f.request', ['after-drain'])).toBe('after-drain')
        expect(active.backlog).toContainEqual(
          expect.objectContaining({ name: 'ipc.backlog.low', pendingData: 0 })
        )
      } finally {
        if (paused) process.kill(active.handles[0]!.identity.pid!, 'SIGCONT')
        await active.close()
        await healthy.close()
        await blocked?.catch(() => undefined)
        await Promise.all([...active.handles, ...healthy.handles].map((handle) => handle.exited))
        receipt(active, `${peer.language}-backlog`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(active.budget.pending).toBe(0)
      expect(healthy.budget.inUse).toBe(0)
      expect(healthy.budget.pending).toBe(0)
    }, 15000)
})

describe('real owned crash retry eligibility', () => {
  for (const peer of peers)
    for (const disposition of ['ready', 'cancel', 'deadline', 'release', 'no-generation'] as const)
      it(`${peer.language} sends ${disposition === 'ready' ? 'one' : 'zero'} replay after ${disposition}`, async () => {
        const scheduler = createManualScheduler()
        const active = await faultClient(peer, {
          scheduler,
          restart: {
            mode: 'on-failure',
            initialDelayMs: 100,
            maxDelayMs: 100,
            maxRestarts: disposition === 'no-generation' ? 0 : 1
          }
        })
        const controller = new AbortController()
        let pending: Promise<unknown> | undefined
        try {
          expect(await active.namespace.request('peer.pause', [])).toBe('ACK')
          pending = active.namespace.request('p.f.request', ['replayed-value'], {
            idempotencyKey: 'hf-crash-original-key',
            timeout: timeout({ ms: 500, scheduler }),
            signal: controller.signal
          })
          /**
           * Observe every settlement immediately so intentional crash rejection cannot go
           * unhandled.
           */
          const observed = pending.then(
            (value) => ({ value }),
            (error) => ({ error })
          )
          await vi.waitFor(() =>
            expect(
              wireFrames(active.sent).filter((frame) => frame.task?.method === 'p.f.request')
            ).toHaveLength(1)
          )
          process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
          await active.handles[0]!.exited
          await settleFaultTurn(scheduler)
          if (disposition === 'cancel') controller.abort('hf-cancelled')
          if (disposition === 'deadline') scheduler.advance(500)
          if (disposition === 'release') await active.close()
          if (disposition === 'ready' || disposition === 'cancel') {
            scheduler.advance(100)
            await vi.waitFor(() => expect(active.handles).toHaveLength(2))
            await vi.waitFor(async () => {
              await settleFaultTurn(scheduler)
              expect({
                state: await active.state()
              }).toMatchObject({ state: 'ready' })
            })
          }
          const result = await observed
          const requests = wireFrames(active.sent).filter(
            (frame) => frame.kind === 'call' && frame.task?.method === 'p.f.request'
          )
          expect(requests).toHaveLength(disposition === 'ready' ? 2 : 1)
          if (disposition === 'ready') {
            expect(result).toEqual({ value: 'replayed-value' })
            expect(requests.map((frame) => frame.options.idempotencyKey)).toEqual([
              'hf-crash-original-key',
              'hf-crash-original-key'
            ])
            expect(requests[1].options.remainingMs).toBeLessThan(requests[0].options.remainingMs)
          } else if (disposition === 'cancel') {
            expect(result).toMatchObject({ error: { name: 'AbortError', cause: 'hf-cancelled' } })
          } else if (disposition === 'deadline') {
            expect(result).toMatchObject({ error: { name: 'TimeoutError' } })
          } else {
            expect(result).toMatchObject({
              error: { source: 'rpc.remote', code: 'REMOTE_RESULT_UNKNOWN' }
            })
          }
        } finally {
          await active.close()
          await pending?.catch(() => undefined)
          await Promise.all(active.handles.map((handle) => handle.exited))
          receipt(active, `${peer.language}-retry-${disposition}`)
        }
        expect(active.budget.inUse).toBe(0)
        expect(scheduler.pendingCount).toBe(0)
      }, 15000)
})

describe('real started streams do not resume after crash', () => {
  for (const peer of peers)
    it(`${peer.language} closes the old stream without another stream request`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, {
        scheduler,
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      try {
        const stream = singleStream(
          active.namespace.stream('p.f.generator', [['first', 'second', 'third']])
        )
        expect(await stream.next()).toMatchObject({ done: false, value: 'first' })
        expect(await active.namespace.request('peer.pause', [])).toBe('ACK')
        const next = stream.next().then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(async () =>
          expect({
            state: await active.state()
          }).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(() => expect(active.handles).toHaveLength(2))
        await vi.waitFor(async () => {
          await settleFaultTurn(scheduler)
          expect(await active.namespace.request('p.f.request', ['after-stream-crash'])).toBe(
            'after-stream-crash'
          )
        })
        expect(await next).toHaveProperty('error')
        expect(
          wireFrames(active.sent).filter(
            (frame) =>
              frame.kind === 'call' &&
              frame.task?.method === 'p.f.generator' &&
              frame.task.mode === 'stream'
          )
        ).toHaveLength(1)
      } finally {
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-stream-crash`)
      }
      expect(scheduler.pendingCount).toBe(0)
      expect(active.budget.inUse).toBe(0)
    }, 15000)
})

describe('real non-idempotent request crash', () => {
  for (const original of peers)
    it(`${original.language} reports unknown result without replay`, async () => {
      /** The installed provider publishes its false declaration in v2; no v1 contract file exists. */
      const peer = { ...original, args: [...original.args, '--non-idempotent-request'] }
      const scheduler = createManualScheduler()
      let active: Awaited<ReturnType<typeof faultClient>> | undefined
      let call: Promise<unknown> | undefined
      try {
        active = await faultClient(peer, {
          scheduler,
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
        })
        expect(
          wireFrames(active.stdout)
            .filter((frame) => frame.directory)
            .at(-1)
            ?.directory.methods.find((method: { name: string }) => method.name === 'p.f.request')
        ).toMatchObject({ idempotent: false })
        expect(await active.namespace.request('peer.pause', [])).toBe('ACK')
        call = active.namespace.request('p.f.request', ['unknown-side-effect']).then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        await vi.waitFor(() =>
          expect(
            wireFrames(active!.sent).filter((frame) => frame.task?.method === 'p.f.request')
          ).toHaveLength(1)
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(async () =>
          expect({
            state: await active!.state()
          }).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(async () =>
          expect({
            state: await active!.state()
          }).toMatchObject({ state: 'ready' })
        )
        expect(await call).toMatchObject({
          error: { source: 'rpc.remote', code: 'REMOTE_RESULT_UNKNOWN' }
        })
        const requests = wireFrames(active.sent).filter(
          (frame) => frame.kind === 'call' && frame.task?.method === 'p.f.request'
        )
        expect(requests).toHaveLength(1)
        expect(requests[0].options).not.toHaveProperty('idempotencyKey')
        /** Supervisor ready precedes remote describe publication; join the actual business gate. */
        await vi.waitFor(async () => {
          await settleFaultTurn(scheduler)
          expect(await active!.namespace.request('p.f.request', ['after-unknown'])).toBe(
            'after-unknown'
          )
        })
      } finally {
        await active?.close()
        await call
        if (active) {
          await Promise.all(active.handles.map((handle) => handle.exited))
          receipt(active, `${peer.language}-non-idempotent-crash`)
        }
      }
      expect(active!.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }, 15000)
})
