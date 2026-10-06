import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import {
  createProcessPlugin,
  createProcessResilience,
  createProcessTransport,
  type IProcessByteChannel,
  type IProcessPluginOptions
} from '@migaia/rpc/process'
import {
  createRemoteHost,
  createRemoteRetryPort,
  type IRemoteRetryPort,
  type IRemoteServeEndpoint,
  type IRemoteContract
} from '@migaia/rpc/remote'
import {
  createSpawnProcessBinding,
  createConnectProcessBinding,
  type IProcessPluginBinding
} from '../../src/process/plugin/binding.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame,
  RPC_STREAM_MAX_FRAME_BYTES
} from '@migaia/rpc/contract/framing/stream'
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '../../src/bridge/jsonrpc/framing.js'
import { endpointFor, bridgeEndpointFor } from './peers/ts/runtime.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
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
  address?: string
  token?: string
  retryPort?: IRemoteRetryPort
  contract?: IRemoteContract
}

/** Assemble existing public fixtures with observable policy, backlog and physical byte ownership. */
async function faultClient(peer: IPeer, options: IFaultOptions = {}) {
  /** One actual budget proves leases return after both success and malformed input. */
  const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: options.scheduler })
  /** Existing deployment owns launcher, bootstrap and language-specific executable preparation. */
  const fixture = deployment(
    peer,
    options.host ?? false,
    options.token ?? randomUUID(),
    options.address,
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
  /** Restart policy is delegated unchanged to the existing supervision owner. */
  const selected: IProcessPluginOptions['deployment'] =
    fixture.selected.kind === 'spawn'
      ? {
          ...fixture.selected,
          establish,
          supervision: {
            ...fixture.selected.supervision,
            scheduler,
            restart: options.restart
          }
        }
      : {
          ...fixture.selected,
          establish,
          supervision: { ...fixture.selected.supervision, scheduler, restart: options.restart }
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
  const selectedContract = options.contract ?? (options.bridge ? bridgeContract : contract)
  if (options.host) {
    /** The original owned or borrowed native binding retains health, stderr and real exit. */
    const binding =
      selected.kind === 'spawn'
        ? createSpawnProcessBinding(selected, (error) => fixture.reports.push(error), true)
        : createConnectProcessBinding(selected, (error) => fixture.reports.push(error))
    /** Logical retry settlement stays inside the same original physical drain owner. */
    let retry = options.retryPort
    const retryPort: IRemoteRetryPort = {
      dispatch(input) {
        retry ??= createRemoteRetryPort({
          events: input.events,
          scheduler: binding.scheduler,
          report: (error) => fixture.reports.push(error)
        })
        return binding.trackRequest(() => retry!.dispatch(input))
      }
    }
    /** D1/M6 retains this lower Host controller; no removed process facade is recreated. */
    const remoteFor = <TUnit extends object, TSpec>(owner: IProcessPluginBinding<TUnit, TSpec>) =>
      createRemoteHost({
        catalog: { p: selectedContract },
        binding: owner,
        endpointFactory: async (...args: Parameters<typeof endpointFactory>) =>
          owner.bindEndpoint(args[0], await endpointFactory(...args)),
        retryPort,
        callGuard: resilience.callGuard('fault-host'),
        report: (error) => fixture.reports.push(error)
      })
    const facade =
      selected.kind === 'spawn'
        ? remoteFor(binding as ReturnType<typeof createSpawnProcessBinding>)
        : remoteFor(binding as ReturnType<typeof createConnectProcessBinding>)
    /**
     * One retained governance registration follows the actual native supervisor and liquidation
     * owner.
     */
    const registration = resilience.attachRegistration(
      'fault-host',
      {
        ownership: selected.kind === 'spawn' ? 'spawn-owned' : 'connection-borrowed',
        health: binding.health,
        supervisor: binding.registrationSupervisor
      },
      { kind: 'standalone-host', release: facade.release }
    )
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
        registration,
        feature: installed.f as IFeature,
        close: async () => {
          await binding.drainCurrent()
          await facade.release()
          await registration.close()
          await resilience.close()
          await local.dispose()
        }
      }
    } catch (error) {
      await facade.release()
      await registration.close()
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
    retryPort: options.retryPort,
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
      registration: undefined,
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
  writeFileSync(join(evidence, `hf-${label}.stdout.bin`), Buffer.concat(active.stdout), {
    mode: 0o600
  })
  writeFileSync(join(evidence, `hf-${label}.stderr.log`), Buffer.concat(active.output), {
    mode: 0o600
  })
  writeFileSync(join(evidence, `hf-${label}.sent.bin`), Buffer.concat(active.sent), { mode: 0o600 })
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

describe('[A4] borrowed hang retains external process ownership', () => {
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
        expect(await active.feature.request(['before-hang'])).toBe('before-hang')
        expect(active.resilience.inspect('p')).toMatchObject({ health: 'ping', state: 'ready' })
        let closed = false
        active.physical[0]!.onClose(() => {
          closed = true
        })
        process.kill(child.pid!, 'SIGSTOP')
        paused = true
        const origin = scheduler.now()
        for (let check = 0; check < 3; check++) {
          scheduler.advance(origin + (check + 1) * 5000 - scheduler.now())
          await settleFaultTurn()
          scheduler.advance(2000)
          await settleFaultTurn()
          if (check < 2) expect(closed).toBe(false)
        }
        expect(scheduler.now() - origin).toBe(17000)
        await vi.waitFor(() => expect(closed).toBe(true))
        expect(child.exitCode).toBeNull()
        process.kill(child.pid!, 0)
        expect(active.handles).toHaveLength(0)
        process.kill(child.pid!, 'SIGCONT')
        paused = false
        await vi.waitFor(() =>
          expect(active!.resilience.inspect('p')).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(async () =>
          expect(await active!.feature.request(['after-redial'])).toBe('after-redial')
        )
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
              host ? active.registration!.inspect() : active.resilience.inspect('p')
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
    let active: Awaited<ReturnType<typeof faultClient>> | undefined
    try {
      active = await faultClient(peer, {
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
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

describe('[A4] physical departure before sendOnce admission', () => {
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
      const retryPort: IRemoteRetryPort = {
        dispatch: async (input) => {
          entered()
          await barrier
          return createRemoteRetryPort({
            events: input.events,
            scheduler,
            report: () => undefined
          }).dispatch(input)
        }
      }
      const active = await faultClient(peer, {
        scheduler,
        retryPort,
        restart: { mode: 'on-failure', initialDelayMs: 100, maxDelayMs: 100, maxRestarts: 1 }
      })
      let call: Promise<unknown> | undefined
      try {
        const writes = active.sent.length
        call = active.feature.request(['blocked-before-sendOnce']).then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        await waiting
        expect(active.sent).toHaveLength(writes)
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(() =>
          expect(active.resilience.inspect('p')).toMatchObject({ state: 'backoff' })
        )
        admit()
        expect(await call).toMatchObject({
          error: { source: '@migaia/rpc/remote', code: 'REMOTE_CLOSED' }
        })
        expect(
          wireFrames(active.sent).filter(
            (frame) => frame.kind === 'request' && frame.method === 'p.f.request'
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
        ).rejects.toMatchObject({ source: '@migaia/rpc/core', code: 'OVERLOADED' })
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

describe('[A4] real owned crash retry eligibility', () => {
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
          expect(await active.runtimes[0]!.endpoint.send(peer.id, 'peer.pause', [])).toBe('ACK')
          pending = active.feature.request(['replayed-value'], {
            idempotencyKey: 'hf-crash-original-key',
            timeoutMs: 500,
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
              wireFrames(active.sent).filter((frame) => frame.method === 'p.f.request')
            ).toHaveLength(1)
          )
          process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
          await active.handles[0]!.exited
          await settleFaultTurn()
          if (disposition === 'cancel') controller.abort('hf-cancelled')
          if (disposition === 'deadline') scheduler.advance(500)
          if (disposition === 'release') await active.close()
          if (disposition === 'ready' || disposition === 'cancel') {
            scheduler.advance(100)
            await vi.waitFor(() => expect(active.handles).toHaveLength(2))
            await vi.waitFor(() =>
              expect(active.resilience.inspect('p')).toMatchObject({ state: 'ready' })
            )
          }
          const result = await observed
          const requests = wireFrames(active.sent).filter(
            (frame) => frame.kind === 'request' && frame.method === 'p.f.request'
          )
          expect(requests).toHaveLength(disposition === 'ready' ? 2 : 1)
          if (disposition === 'ready') {
            expect(result).toEqual({ value: 'replayed-value' })
            expect(requests.map((frame) => frame.data.route.idempotencyKey)).toEqual([
              'hf-crash-original-key',
              'hf-crash-original-key'
            ])
            expect(requests[1].data.route.timeoutMs).toBeLessThan(requests[0].data.route.timeoutMs)
          } else if (disposition === 'cancel') {
            expect(result).toMatchObject({ error: { name: 'AbortError', cause: 'hf-cancelled' } })
          } else if (disposition === 'deadline') {
            expect(result).toMatchObject({ error: { name: 'TimeoutError' } })
          } else {
            expect(result).toMatchObject({
              error: { source: '@migaia/rpc/remote', code: 'REMOTE_RESULT_UNKNOWN' }
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

describe('[A4] real started streams do not resume after crash', () => {
  for (const peer of peers)
    it(`${peer.language} closes the old stream without another stream request`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, {
        scheduler,
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      try {
        const stream = active.feature
          .generator([['first', 'second', 'third']])
          [Symbol.asyncIterator]()
        expect(await stream.next()).toMatchObject({ done: false, value: 'first' })
        expect(await active.runtimes[0]!.endpoint.send(peer.id, 'peer.pause', [])).toBe('ACK')
        const next = stream.next().then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(() =>
          expect(active.resilience.inspect('p')).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(() => expect(active.handles).toHaveLength(2))
        await vi.waitFor(async () =>
          expect(await active.feature.request(['after-stream-crash'])).toBe('after-stream-crash')
        )
        expect(await next).toHaveProperty('error')
        expect(
          wireFrames(active.sent).filter(
            (frame) =>
              frame.kind === 'request' &&
              frame.method === `${RemoteMethodName.runtimeStreamPrefix}p.f.generator`
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

describe('[A4] owned bridge hang has no default health detector', () => {
  for (const peer of peers.slice(0, 3))
    it(`${peer.language} settles only the call deadline and retains its hung PID`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, { bridge: true, scheduler })
      let paused = false
      try {
        expect(active.resilience.inspect('p')).toMatchObject({ health: 'none', state: 'ready' })
        process.kill(active.handles[0]!.identity.pid!, 'SIGSTOP')
        paused = true
        const call = active.feature.request(['bridge-hang'], { timeoutMs: 100 }).then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        await settleFaultTurn()
        scheduler.advance(100)
        await settleFaultTurn()
        expect(await call).toHaveProperty('error')
        scheduler.advance(20000)
        await settleFaultTurn()
        expect(active.resilience.inspect('p')).toMatchObject({ health: 'none', state: 'ready' })
        expect(active.handles).toHaveLength(1)
        process.kill(active.handles[0]!.identity.pid!, 0)
      } finally {
        if (paused) process.kill(active.handles[0]!.identity.pid!, 'SIGCONT')
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-bridge-no-health`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }, 15000)
})

describe('[A4] standalone Host restart keeps local ownership and does not replay use', () => {
  for (const peer of peers)
    it(`${peer.language} leaves the new remote catalog uninstalled until explicit use`, async () => {
      const scheduler = createManualScheduler()
      const active = await faultClient(peer, {
        host: true,
        scheduler,
        restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
      })
      try {
        expect(await active.facade!.inspect()).toMatchObject({ plugins: [{ name: 'p' }] })
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        /** Host governance uses an opaque candidate ID; observe its public new endpoint instead. */
        await vi.waitFor(() => {
          scheduler.advance(1)
          expect(active.handles).toHaveLength(2)
        })
        await vi.waitFor(async () =>
          expect(await active.facade!.inspect()).toMatchObject({ plugins: [] })
        )
        /** A fresh explicit remote installation, rather than old use replay, restores business. */
        const installed = await active.facade!.use('p')
        expect(await (installed.f as IFeature).request(['new-explicit-use'])).toBe(
          'new-explicit-use'
        )
        expect(await active.facade!.inspect()).toMatchObject({ plugins: [{ name: 'p' }] })
      } finally {
        await active.close()
        await Promise.all(active.handles.map((handle) => handle.exited))
        receipt(active, `${peer.language}-host-no-use-replay`)
      }
      expect(active.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }, 15000)
})

describe('[A4] real non-idempotent request crash', () => {
  for (const original of peers)
    it(`${original.language} reports unknown result without replay`, async () => {
      /** Publish the matching explicit declaration to both public caller and real independent peer. */
      const selectedContract: IRemoteContract = {
        ...contract,
        features: {
          f: {
            methods: {
              ...contract.features.f!.methods,
              request: { mode: 'request', idempotent: false }
            }
          }
        }
      }
      /** The installed provider publishes its false declaration in v2; no v1 contract file exists. */
      const peer = { ...original, args: [...original.args, '--non-idempotent-request'] }
      const scheduler = createManualScheduler()
      let active: Awaited<ReturnType<typeof faultClient>> | undefined
      let call: Promise<unknown> | undefined
      try {
        active = await faultClient(peer, {
          contract: selectedContract,
          scheduler,
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
        })
        expect(await active.runtimes[0]!.endpoint.send(peer.id, 'peer.pause', [])).toBe('ACK')
        call = active.feature.request(['unknown-side-effect']).then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        await vi.waitFor(() =>
          expect(
            wireFrames(active!.sent).filter((frame) => frame.method === 'p.f.request')
          ).toHaveLength(1)
        )
        process.kill(active.handles[0]!.identity.pid!, 'SIGKILL')
        await active.handles[0]!.exited
        await vi.waitFor(() =>
          expect(active!.resilience.inspect('p')).toMatchObject({ state: 'backoff' })
        )
        scheduler.advance(1)
        await vi.waitFor(() =>
          expect(active!.resilience.inspect('p')).toMatchObject({ state: 'ready' })
        )
        expect(await call).toMatchObject({
          error: { source: '@migaia/rpc/remote', code: 'REMOTE_RESULT_UNKNOWN' }
        })
        const requests = wireFrames(active.sent).filter(
          (frame) => frame.kind === 'request' && frame.method === 'p.f.request'
        )
        expect(requests).toHaveLength(1)
        expect(requests[0].data.route).not.toHaveProperty('idempotencyKey')
        /** Supervisor ready precedes remote describe publication; join the actual business gate. */
        await vi.waitFor(async () =>
          expect(await active!.feature.request(['after-unknown'])).toBe('after-unknown')
        )
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
