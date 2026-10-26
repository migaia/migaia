/** Real public callers retain both correlations when one native batch carries their replies. */
import { Session as InspectorSession } from 'node:inspector/promises'
import type { Runtime } from 'node:inspector'
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { batch } from '@migaia/rpc-host/plugins/batch'
import {
  defineFlowFeature,
  defineTransportPlugin,
  RpcFlowPoint,
  RpcJsonCarrierCodec,
  type IRpcCarrierCodec,
  type IRpcCarrierFrame,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcHost } from '../../../dist/host/rpc-host.js'
import { RpcFlowProgram } from '../../../dist/sdk/flow-program.js'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'

/** Only this case retains a real caller Root for A17's fixed private-table observation. */
const inspectorRoot = '__rpcBatchResponseCaller'
/** Node exposes actual private descriptors beyond the bundled inspector declaration. */
type IProperties = Runtime.GetPropertiesReturnType & {
  privateProperties?: readonly { name: string; value?: Runtime.RemoteObject }[]
}
/** Only actual successfully encoded provider results contribute correlation IDs. */
type IReply = Extract<IRpcSemanticFrame, { kind: typeof RpcWireKind.result }>

/** Reuse A17's engine-read pattern for exactly the actual caller CallTable records, without hooks. */
class PendingInspector {
  /** The in-process inspector opens no network listener and executes no private owner method. */
  readonly #session = new InspectorSession()

  /** Retain only this caller's genuine Root until the final actual resource sample. */
  constructor(owner: RpcHost) {
    ;(globalThis as unknown as Record<string, unknown>)[inspectorRoot] = owner
    this.#session.connect()
  }

  /** Read the true #calls/#records Map size; absent descriptors never become a claimed zero. */
  async pending(): Promise<number> {
    /** The expression reaches only this test's retained actual Root reference. */
    const result = await this.#session.post('Runtime.evaluate', {
      expression: 'globalThis[' + JSON.stringify(inspectorRoot) + ']',
      objectGroup: inspectorRoot
    })
    if (result.exceptionDetails || !result.result.objectId)
      throw new Error('Batch response caller Root is unavailable to the inspector')
    /** These fixed fields are the existing production call owner and its original live Map. */
    const calls = await this.#field(result.result, '#calls')
    /** No pending count is reconstructed from completed business effects or returned values. */
    const records = await this.#field(calls, '#records')
    /** Node reports the actual size of this exact native Map reference. */
    const size = /^Map\((\d+)\)$/u.exec(records.description ?? '')
    if (records.subtype !== 'map' || !size)
      throw new Error('Batch response caller records are not an inspectable Map')
    return Number(size[1])
  }

  /** Read one existing private descriptor without invoking the owning class. */
  async #field(object: Runtime.RemoteObject, name: string): Promise<Runtime.RemoteObject> {
    /** A17 uses this same read-only engine descriptor operation. */
    const properties: IProperties = await this.#session.post('Runtime.getProperties', {
      objectId: object.objectId!,
      ownProperties: true
    })
    /** Both requested names are fixed private fields, not an arbitrary traversal API. */
    const field = properties.privateProperties?.find((property) => property.name === name)
    if (!field?.value) throw new Error('Batch response caller field is unavailable: ' + name)
    return field.value
  }

  /** Always disconnect and clear the temporary Root reference, including assertion failure. */
  async close(): Promise<void> {
    try {
      await this.#session.post('Runtime.releaseObjectGroup', { objectGroup: inspectorRoot })
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[inspectorRoot]
      this.#session.disconnect()
    }
  }
}

/** Witness only two genuine encoded replies after next enters their actual native batch lane. */
class ResponseBatchWitness {
  /** Exact encoded frame identities connect real reply IDs to the sole physical batch. */
  readonly responses = new Set<IRpcCarrierFrame>()
  /** Both results must enter before the independent native busy write may drain. */
  readonly entered = vi.fn()
  /** Handshake, setup request and directory traffic never contribute to this barrier. */
  #submitted = 0
  /** The actual opaque Feature registers this original stage in its native namespace group. */
  readonly feature = defineFlowFeature({
    name: 'batch-response-submissions',
    setup: () => ({ stages: { [RpcFlowPoint.frameOutbound]: this.#outbound } })
  })

  /** Returning native next preserves real physical completion and error ownership. */
  readonly #outbound: IRpcFlowStage<'frameOutbound'> = (payload, next) => {
    /** Short encoded replies enter the genuine batch owner synchronously before observation. */
    const traversal = next(payload)
    if (this.responses.has(payload.frame) && ++this.#submitted === 2) this.entered()
    return traversal
  }
}

/** The custom unbranded codec delegates each original stage once with its real receiver. */
function selectedCodec(codec: RpcJsonCarrierCodec, custom: boolean): IRpcCarrierCodec {
  if (!custom) return codec
  return {
    prepare: (message, context) => codec.prepare(message, context),
    encode: (message, context) => codec.encode(message, context),
    decode: (frame, context) => codec.decode(frame, context),
    restore: (message, context) => codec.restore(message, context)
  }
}

/** Observe the original once-only encode; no extra parse, restore or fabricated response is used. */
function observeReplies(
  codec: RpcJsonCarrierCodec,
  witness: ResponseBatchWitness,
  replies: IReply[]
) {
  /** Explicit observation state preserves the original codec receiver and its output identity. */
  const operation = { codec, encode: codec.encode, witness, replies }
  return vi.spyOn(codec, 'encode').mockImplementation((prepared, context) => {
    /** Reflect.apply delegates the original receiver-dependent native codec method unchanged. */
    const frame = Reflect.apply(operation.encode, operation.codec, [prepared, context])
    /** The actual prepared semantic frame already passed the original admission/capture stage. */
    const message = prepared.message as IRpcSemanticFrame
    if (message.kind === RpcWireKind.result) {
      operation.replies.push(message)
      operation.witness.responses.add(frame)
    }
    return frame
  })
}

/** Record each original caller settlement without replacing failure with a successful value. */
function recordReply(
  pending: Promise<unknown>,
  state: { payload: string; values: Map<string, unknown>; errors: unknown[] }
): Promise<void> {
  return pending.then(
    (value) => {
      state.values.set(state.payload, value)
    },
    (error: unknown) => {
      state.errors.push(error)
    }
  )
}

/** Session owns both attached carriers; this native source acquires no additional resource. */
function disposeSource(): void {}

for (const customCodec of [false, true]) {
  it(
    'one physical response batch settles two pending core requests (customCodec=' +
      customCodec +
      ')',
    async () => {
      /** The provider keeps the current default wire codec in both original variants. */
      const serverCodec = new RpcJsonCarrierCodec()
      /** Caller decode and cached restore always use this independent original instance. */
      const callerCodec = new RpcJsonCarrierCodec()
      /** The existing medium owns all actual physical write, busy and close behavior. */
      const left = new MemoryCarrier('response-provider', undefined, serverCodec, false)
      /** Only the caller selects the ordinary custom wrapper, matching the original fixture. */
      const right = new MemoryCarrier(
        'response-caller',
        undefined,
        selectedCodec(callerCodec, customCodec),
        false
      )
      left.link(right)
      right.link(left)
      /** Reuse the genuine listener; it owns no alternate request execution path. */
      const server = coreMemoryServer('provider')
      /** Only original successfully encoded reply frames can satisfy this native stage barrier. */
      const witness = new ResponseBatchWitness()
      /** These are real provider-produced replies with their original actual correlation IDs. */
      const replies: IReply[] = []
      /** The production batch Feature, rather than this fixture, constructs the one physical batch. */
      const batches: IRpcCarrierFrame[] = []
      /** Observe original encoding once, preserving native receiver and frame identity. */
      const encoded = observeReplies(serverCodec, witness, replies)
      /** The original stable native arrow keeps actual physical delivery and write ownership. */
      const send = left.write
      /** Recording a real batch never normalizes or decodes its member again. */
      const writing = vi.spyOn(left, 'write').mockImplementation((frame, options) => {
        if (frame.kind === 'extension' && frame.extension === 'batch@1') batches.push(frame)
        return send(frame, options)
      })
      /** Count only the original provider echo effects, excluding the caller's independent setup. */
      let providerCalls = 0
      /** Actual public provider execution supplies both original values through the native group. */
      const provider = await createRpcHost({
        ...server.options,
        plugins: [batch(), witness.feature, server.transport],
        provide: {
          echo: (value: string) => {
            providerCalls += 1
            return value
          }
        }
      })
      /** The caller's report channel retains original receive/parse failures unchanged. */
      const failures: unknown[] = []
      /** Retain A17's real Root, then use its genuine native open and public namespace. */
      const owner = new RpcHost({
        self: { name: 'caller', instanceId: 'caller' },
        provide: { busy: () => 'busy' },
        report: (error) => failures.push(error)
      })
      /** The cold source borrows only original SDK attachment and readiness ports. */
      const link = { server, left, right }
      /** Both real endpoints attach before either actual handshake may complete. */
      const transport = defineTransportPlugin({
        name: 'batch-response-caller',
        namespace: 'memory',
        open: async (context) => {
          const accepted = link.server.accept(link.left)
          const connected = context.attach(link.right)
          await Promise.all([accepted.ready, connected.ready])
          return { dispose: disposeSource }
        }
      })
      /** Each original first/second continuation remains attached to its own actual caller ID. */
      const values = new Map<string, unknown>()
      /** Rejections stay failed observations; cleanup never fabricates a returned value. */
      const errors: unknown[] = []
      /** One independent setup call occupies IO and is excluded from all original reply counts. */
      let busy: Promise<unknown> | undefined
      /** Join both original caller operations if any later assertion fails. */
      const calls: Promise<void>[] = []
      /** The fixed-path inspector is disconnected after this one Root's final resource sample. */
      let inspector: PendingInspector | undefined
      try {
        const caller = await owner.open(new RpcFlowProgram([batch(), transport]))
        inspector = new PendingInspector(owner)
        // Bilateral handshake writes precede the independent busy-call setup boundary below.
        writing.mockClear()
        left.holdWrites()
        busy = provider.memory.send('caller', 'busy')
        void busy.catch(() => undefined)
        await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1))
        for (const payload of ['first', 'second'])
          calls.push(
            recordReply(caller.memory.send('provider', 'echo', payload), {
              payload,
              values,
              errors
            })
          )
        await vi.waitFor(() => expect(witness.entered).toHaveBeenCalledTimes(1))
        expect(await inspector.pending()).toBe(2)
        left.releaseWrites()
        await vi.waitFor(() => expect(batches).toHaveLength(1))
        expect(replies).toHaveLength(2)
        expect(providerCalls).toBe(2)
        expect(new Set(replies.map((reply) => reply.id)).size).toBe(2)
        expect((batches[0]!.data as { frames: readonly IRpcCarrierFrame[] }).frames).toEqual([
          ...witness.responses
        ])
        await vi.waitFor(() =>
          expect(Object.fromEntries(values), 'both batched response IDs must settle').toEqual({
            first: 'first',
            second: 'second'
          })
        )
        await Promise.all(calls)
        expect(await inspector.pending()).toBe(0)
        await expect(busy).resolves.toBe('busy')
        expect(errors).toEqual([])
        expect(failures).toEqual([])
      } finally {
        left.releaseWrites()
        await Promise.allSettled([...calls, ...(busy ? [busy] : [])])
        writing.mockRestore()
        encoded.mockRestore()
        try {
          await Promise.all([owner.close(), provider.close()])
          await Promise.all([left.close(), right.close()])
        } finally {
          await inspector?.close()
        }
      }
    }
  )
}
