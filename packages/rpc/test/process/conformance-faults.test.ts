import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import {
  createProcessHost,
  createProcessPlugin,
  createProcessResilience,
  createProcessTransport,
  type IProcessByteChannel,
  type IProcessPluginOptions
} from '@migaia/rpc/process'
import type { IRemoteServeEndpoint } from '@migaia/rpc/remote'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame,
  RPC_STREAM_MAX_FRAME_BYTES
} from '@migaia/rpc/contract/framing/stream'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'
import { endpointFor, bridgeEndpointFor } from './peers/ts/runtime.js'
import {
  peers,
  evidence,
  contract,
  bridgeContract,
  deployment,
  wireFrames
} from './fixtures/conformance-business.js'

/** Only the five admitted real executables participate; Node and Bun are separate TS runtimes. */
type IPeer = (typeof peers)[number]
/** Public facade methods remain contract projected throughout fault injection. */
type IFeature = {
  request(
    params: unknown[],
    options?: { timeoutMs?: number; signal?: AbortSignal; idempotencyKey?: string }
  ): Promise<unknown>
  oneWay(params: unknown[]): Promise<void>
  generator(params: unknown[]): AsyncIterable<unknown>
}
/** Test configuration changes deployment policy, never the production protocol or state machine. */
type IFaultOptions = {
  host?: boolean
  bridge?: boolean
  scheduler?: ReturnType<typeof createManualScheduler>
  restart?: NonNullable<IProcessPluginOptions['deployment']['supervision']>['restart']
  maxPendingData?: number
}

/** Assemble existing public fixtures with observable policy, backlog and physical byte ownership. */
async function faultClient(peer: IPeer, options: IFaultOptions = {}) {
  /** One actual budget proves leases return after both success and malformed input. */
  const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: options.scheduler })
  /** Existing deployment owns launcher, bootstrap and language-specific executable preparation. */
  const fixture = deployment(
    peer,
    options.host ?? false,
    randomUUID(),
    undefined,
    options.bridge,
    budget
  )
  /** Each endpoint remains owned by its canonical remote binding. */
  const runtimes: IRemoteServeEndpoint[] = []
  /** Retain the physical writer only for explicit raw fault injection. */
  const physical: IProcessByteChannel[] = []
  /** Production IPC gate emits actual capacity transitions. */
  const backlog: unknown[] = []
  /** All governance, health and endpoint deadlines use exactly one clock. */
  const scheduler = options.scheduler ?? systemScheduler
  /** Explicit governance exposes terminal state without fabricating supervisor events. */
  const resilience = createProcessResilience({
    scheduler,
    report: (error) => fixture.reports.push(error)
  })
  /** Capture authenticated channels while preserving original bridge establishment. */
  const establish: IProcessPluginOptions['deployment']['establish'] = async (raw, context) => {
    if (raw.kind !== 'byte') throw new TypeError('fault fixture requires bytes')
    physical.push(raw)
    if (options.bridge) return fixture.selected.establish(raw, context)
    raw.onData((chunk) => fixture.stdout.push(chunk.slice()))
    return createProcessTransport(
      {
        ...raw,
        write: async (chunk) => {
          fixture.sent.push(chunk.slice())
          await raw.write(chunk)
        }
      },
      {
        role: 'initiator',
        peerId: peer.id,
        offer: context.offer!,
        scheduler: context.scheduler,
        signal: context.signal as AbortSignal,
        report: (error) => fixture.reports.push(error),
        ipc: {
          ...context.session,
          maxPendingData: options.maxPendingData,
          log: (record) => {
            backlog.push(record)
          }
        }
      }
    )
  }
  /** This helper constructs owned deployments only; borrowed tests retain their external PID owner. */
  if (fixture.selected.kind !== 'spawn') throw new TypeError('fault fixture requires spawn')
  /** Restart policy is delegated unchanged to the existing supervision owner. */
  const selected = {
    ...fixture.selected,
    establish,
    supervision: {
      ...fixture.selected.supervision,
      scheduler,
      restart: options.restart
    }
  }
  /** Existing public endpoint assembly reuses channel codec/framer/features. */
  const endpointFactory = async (channel: Parameters<typeof endpointFor>[0]) => {
    const endpoint = await (options.bridge ? bridgeEndpointFor : endpointFor)(channel, 'caller')
    runtimes.push(endpoint)
    return endpoint
  }
  /** Real PluginHost owns facade registration and release sequencing. */
  const local = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Host and Plugin publish the same contract with their distinct registration ownership. */
  const selectedContract = options.bridge ? bridgeContract : contract
  if (options.host) {
    const facade = createProcessHost({
      catalog: { p: selectedContract },
      deployment: selected,
      endpointFactory,
      resilience,
      report: (error) => fixture.reports.push(error)
    })
    try {
      await facade.ready()
      const installed = await facade.use('p')
      return {
        ...fixture,
        physical,
        runtimes,
        backlog,
        budget,
        resilience,
        facade,
        feature: installed.f as IFeature,
        close: async () => {
          await facade.release()
          await resilience.close()
          await local.dispose()
        }
      }
    } catch (error) {
      await facade.release()
      await resilience.close()
      await local.dispose()
      throw error
    }
  }
  /** Registration guard is provided by production resilience, not a local proxy wrapper. */
  const definition = createProcessPlugin({
    name: 'p',
    contract: selectedContract,
    registrationOwner: { name: 'p', host: local },
    host: local.plugin,
    deployment: selected,
    endpointFactory,
    resilience,
    report: (error) => fixture.reports.push(error)
  })
  try {
    const [installed] = await local.use(definition)
    return {
      ...fixture,
      physical,
      runtimes,
      backlog,
      budget,
      resilience,
      facade: undefined,
      feature: installed!.getFeature('f') as IFeature,
      close: async () => {
        await local.dispose()
        await resilience.close()
      }
    }
  } catch (error) {
    await local.dispose()
    await resilience.close()
    await Promise.all(fixture.handles.map((handle) => handle.exited))
    writeFileSync(
      join(evidence, `hf-${peer.language}-startup.stderr.log`),
      Buffer.concat(fixture.output)
    )
    writeFileSync(
      join(evidence, `hf-${peer.language}-startup.stdout.bin`),
      Buffer.concat(fixture.stdout)
    )
    throw error
  }
}

/** Preserve complete stdout/stderr and outbound frames for every real fault run. */
function receipt(active: Awaited<ReturnType<typeof faultClient>>, label: string) {
  writeFileSync(join(evidence, `hf-${label}.stdout.bin`), Buffer.concat(active.stdout))
  writeFileSync(join(evidence, `hf-${label}.stderr.log`), Buffer.concat(active.output))
  writeFileSync(join(evidence, `hf-${label}.sent.bin`), Buffer.concat(active.sent))
}

describe('[A5] canonical raw physical frame boundaries', () => {
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
  it('accepts exact 16 MiB Content-Length; rejects +1 before retaining body', () => {
    /** JSON quotes count toward the physical Content-Length budget. */
    const body = 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - 2)
    const encoded = encodeJsonRpcFrame(body)
    const decoder = createJsonRpcFrameDecoder()
    expect(decoder.push(encoded)).toEqual([body])
    decoder.finish()
    decoder.close()
    expect(decoder.bufferedBytes).toBe(0)
    const invalid = createJsonRpcFrameDecoder()
    expect(() => invalid.push(Buffer.from('Content-Length: 16777217\r\n\r\n'))).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
    invalid.close()
    expect(invalid.bufferedBytes).toBe(0)
    expect(() => encodeJsonRpcFrame('x'.repeat(RPC_STREAM_MAX_FRAME_BYTES - 1))).toThrow(
      expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
    )
  })
  it.each([
    'Content-Len',
    'Content-Length: 4\r\n\r\n{}',
    'Content-Length: 1\r\n\r\n\xff',
    'Content-Length: 1\r\n\r\n['
  ])('rejects bridge half-header/body, UTF-8 and JSON %#', (input) => {
    const decoder = createJsonRpcFrameDecoder()
    expect(() => {
      decoder.push(Buffer.from(input, 'latin1'))
      decoder.finish()
    }).toThrow(expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' }))
    decoder.close()
    expect(decoder.bufferedBytes).toBe(0)
  })
})

describe('[A5] real native business budget and independent session', () => {
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
        expect(await active.feature.request([payload], { timeoutMs: 10000 })).toBe(payload)
        const writes = active.sent.length
        await expect(
          active.feature.request(['x'.repeat(RPC_STREAM_MAX_FRAME_BYTES)], { timeoutMs: 10000 })
        ).rejects.toMatchObject({ cause: { code: 'FRAME_LIMIT_EXCEEDED' } })
        expect(active.sent).toHaveLength(writes)
        expect(await healthy.feature.request(['healthy'])).toBe('healthy')
        expect(await active.feature.request(['after-overflow'])).toBe('after-overflow')
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

describe('[A5] independent peer rejects raw malformed input', () => {
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
              expect(await active.feature.request(['after-invalid-json'])).toBe(
                'after-invalid-json'
              )
            } else await vi.waitFor(() => expect(closed, label).toBe(true), { timeout: 2000 })
            expect(active.handles).toHaveLength(1)
            expect(await healthy.feature.request([label])).toBe(label)
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

describe('[A4] real owned terminal guards', () => {
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
          await vi.waitFor(() =>
            expect(
              host ? active.facade!.inspectRegistration() : active.resilience.inspect('p')
            ).toMatchObject({ state: 'terminal' })
          )
          const writes = active.sent.length
          for (const method of ['request', 'oneWay'] as const)
            await expect(active.feature[method]([])).rejects.toMatchObject({
              source: '@migaia/rpc/process',
              code: 'PROCESS_TERMINAL_CALL'
            })
          await expect(
            active.feature.generator([])[Symbol.asyncIterator]().next()
          ).rejects.toMatchObject({ source: '@migaia/rpc/process', code: 'PROCESS_TERMINAL_CALL' })
          if (active.facade) {
            await expect(active.facade.use('p')).rejects.toMatchObject({
              source: '@migaia/rpc/process',
              code: 'PROCESS_TERMINAL_CALL'
            })
            await expect(active.facade.inspect()).rejects.toMatchObject({
              source: '@migaia/rpc/process',
              code: 'PROCESS_TERMINAL_CALL'
            })
          }
          expect(active.sent).toHaveLength(writes)
          expect(active.handles).toHaveLength(1)
          expect(
            wireFrames(active.sent).filter((frame) => frame.kind === 'request').length
          ).toBeGreaterThan(0)
        } finally {
          await active.close()
          await Promise.all(active.handles.map((handle) => handle.exited))
          receipt(active, `${peer.language}-terminal-${host}`)
        }
        expect(active.budget.inUse).toBe(0)
        expect(active.budget.pending).toBe(0)
        expect(scheduler.pendingCount).toBe(0)
        expect(active.resilience.inspect('p')).toBeUndefined()
      }, 15000)
})

describe('[A4] explicit persistent authenticated scope', () => {
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
    const active = await faultClient(peer, {
      restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
    })
    try {
      expect(
        await active.feature.request([], { timeoutMs: 5000, idempotencyKey: 'hf-original-key' })
      ).toBe('committed')
      expect(Number(readFileSync(join(directory, 'count.txt'), 'utf8'))).toBe(1)
      expect(active.handles).toHaveLength(2)
      expect((await active.handles[0]!.exited).code).toBe(17)
      const requests = wireFrames(active.sent).filter(
        (frame) => frame.kind === 'request' && frame.method === 'p.f.request'
      )
      expect(requests).toHaveLength(2)
      expect(requests.map((frame) => frame.data.route.idempotencyKey)).toEqual([
        'hf-original-key',
        'hf-original-key'
      ])
      expect(requests[1].data.route.timeoutMs).toBeLessThanOrEqual(requests[0].data.route.timeoutMs)
    } finally {
      await active.close()
      await Promise.all(active.handles.map((handle) => handle.exited))
      receipt(active, 'persistent-retry')
      await rm(directory, { recursive: true, force: true })
    }
    expect(active.budget.inUse).toBe(0)
  }, 15000)
})

/** Allow real I/O callbacks and the bounded production promise continuations to settle. */
async function settleFaultTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve))
  for (let turn = 0; turn < 32; turn++) await Promise.resolve()
}

describe('[A4] default native health detects real CPU loops', () => {
  for (const peer of peers)
    it(`${peer.language} busy loop fails at 17000ms and restarts owned PID`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, {
        scheduler,
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      try {
        const current = active.handles[0]!
        expect(active.resilience.inspect('p')).toMatchObject({ health: 'ping', state: 'ready' })
        expect(await active.runtimes[0]!.endpoint.send(peer.id, 'peer.busy', [])).toBe('ACK')
        let exited = false
        void current.exited.then(() => {
          exited = true
        })
        const origin = scheduler.now()
        for (let check = 0; check < 3; check++) {
          scheduler.advance(origin + (check + 1) * 5000 - scheduler.now())
          await settleFaultTurn()
          expect(exited).toBe(false)
          scheduler.advance(1999)
          await settleFaultTurn()
          expect(exited).toBe(false)
          scheduler.advance(1)
          await settleFaultTurn()
          if (check < 2) expect(exited).toBe(false)
        }
        expect(scheduler.now() - origin).toBe(17000)
        await current.exited
        await vi.waitFor(() =>
          expect(active.resilience.inspect('p')).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(() => expect(active.handles).toHaveLength(2))
        await vi.waitFor(async () =>
          expect(await active.feature.request(['after-busy'])).toBe('after-busy')
        )
        expect(active.handles[1]!.identity.pid).not.toBe(current.identity.pid)
        expect(
          wireFrames(active.sent).filter(
            (frame) => frame.kind === 'variation' && frame.data.route.variation === 'ping'
          )
        ).toHaveLength(3)
        expect(
          active.reports.some((error) => (error as { code?: string }).code === 'UNHEALTHY')
        ).toBe(true)
      } finally {
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-busy`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }, 20000)
})

describe('[A5] capacity one real stopped reader', () => {
  for (const peer of peers)
    it(`${peer.language} keeps send pending, rejects overload, reports backlog and recovers`, async () => {
      const active = await faultClient(peer, { maxPendingData: 1 })
      const healthy = await faultClient(peer)
      let paused = false
      let blocked: Promise<unknown> | undefined
      try {
        expect(await active.runtimes[0]!.endpoint.send(peer.id, 'peer.pause', [])).toBe('ACK')
        paused = true
        /** This real pipe write exceeds the OS pipe buffer while remaining below the frame budget. */
        blocked = active.runtimes[0]!.endpoint.send(
          peer.id,
          'p.f.request',
          ['x'.repeat(2 * 1024 * 1024)],
          { timeoutMs: 10000, trace: 'h-backlog-trace' }
        )
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
          active.runtimes[0]!.endpoint.send(peer.id, 'p.f.request', ['overloaded'], {
            trace: 'h-rejected-trace'
          })
        ).rejects.toMatchObject({ cause: { code: 'OVERLOADED' } })
        expect(active.sent).toHaveLength(writes)
        expect(active.backlog).toContainEqual(
          expect.objectContaining({
            name: 'ipc.backlog.rejected',
            pendingData: 1,
            trace: 'h-rejected-trace'
          })
        )
        expect(await healthy.feature.request(['healthy-during-backlog'])).toBe(
          'healthy-during-backlog'
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGCONT')
        paused = false
        expect(await blocked).toBe('x'.repeat(2 * 1024 * 1024))
        expect(await active.feature.request(['after-drain'])).toBe('after-drain')
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
