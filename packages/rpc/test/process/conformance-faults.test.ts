import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
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
  deployment
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
