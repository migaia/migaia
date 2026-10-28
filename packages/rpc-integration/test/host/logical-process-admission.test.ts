/** Public Host composition borrows only the genuine Process carrier, FIFO and logical capacity. */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { RpcTransportError } from '@migaia/rpc-contract/errors'
import { createRpcHost } from '@migaia/rpc-host'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import { chunkFeature } from '@migaia/rpc-host/plugins/chunk'
import {
  defineFlowFeature,
  defineTransportPlugin,
  RpcFlowPoint,
  type IRpcFlowStage,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrierFrame,
  IRpcCarrierWriteOptions,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import {
  sendQueueFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcBacklogEvent,
  type IProcessFeatureContext
} from '@migaia/rpc-plugin-process/features'
import type { IpcSendQueue } from '@migaia/rpc-plugin-process/features/send-queue'
import { IpcFlowControl } from '@migaia/rpc-plugin-process/features/flow-control'
import { createProcessCarrier } from '../../../rpc-plugin-process/dist/process/carrier.js'
import type { IProcessMessageChannel } from '../../../rpc-plugin-process/dist/process/types.js'

/** One actual native pair lends backpressure while all capacity remains on its installed queue. */
class NativeProcessAdmissionPair {
  /** The same original MessagePorts carry every real hello, control, request and response. */
  readonly #ports = new MessageChannel()
  /** Only the original Process feature factory supplies the native FIFO and flow owner. */
  readonly #definition: ReturnType<typeof sendQueueFeature>
  /** Published native queue is retained only for its existing event and idle observation APIs. */
  queue!: IpcSendQueue
  /** Actual flow snapshots supply logical counts, never a client in-flight approximation. */
  readonly events: IIpcBacklogEvent[] = []
  /** Original raw writes witness physical batches/fragments without replacing their admission. */
  readonly writes: IRpcCarrierFrame[] = []
  /** Original encoded member references prove physical grouping without observer-side decoding. */
  readonly submitted: IRpcCarrierFrame[] = []
  /** A separate case may hold real data on the same existing first native write receipt. */
  readonly firstDataEntered = deferred<IRpcCarrierFrame>()
  /** A real control write makes the existing batch lane busy without occupying data capacity. */
  readonly controlEntered = deferred<void>()
  /** The actual native data writer remains unfinished until this test releases it. */
  readonly dataEntered = deferred<IRpcCarrierFrame>()
  /** The third real frame hook guarantees all three members entered the existing batch owner. */
  readonly membersEntered = deferred<void>()
  /** The original flow alone announces reaching its configured logical data capacity. */
  readonly capacityReached = deferred<IIpcBacklogEvent>()
  /** Original native writes retain their own physical completion under this bounded hold. */
  readonly #controlRelease = deferred<void>()
  /** This second hold is the actual aggregate/fragment write completion, not a second queue. */
  readonly #dataRelease = deferred<void>()
  /** Native preparation holds are armed only after actual Session readiness. */
  #holdControl = false
  /** Only the next original physical data write is held. */
  #holdData = false
  /** Only the paired-data failure case borrows the first gate for an actual data-class write. */
  #holdFirstData = false
  /** Frame-hook ordinals provide an entry barrier only; they never represent logical capacity. */
  #members = 0
  /** The immutable configured capacity is compared only against genuine flow events. */
  readonly #capacity: number
  /** Actual transport setup supplies its existing health-control method. */
  #context: IRpcTransportSetupContext | undefined
  /** Health control borrows the same accepted Session handle as business calls. */
  #session: IRpcSessionHandle | undefined
  /** Public Hosts own all accepted Session and physical cleanup transactions. */
  #hosts: readonly { close(): Promise<void> }[] = []
  /** Every actual background failure remains observable without a new classification channel. */
  readonly reports: unknown[] = []

  /** Construct the original complete feature before acquiring any native IO. */
  constructor(capacity: number) {
    this.#capacity = capacity
    this.#definition = sendQueueFeature({ maxPendingData: capacity, maxPendingControl: 4 })
  }
  /** Observe the exact production installation without reconstructing its queue or flow. */
  readonly #install = (context: IProcessFeatureContext) => {
    /** This original receipt owns both the FIFO and its existing close disposer. */
    const installed = this.#definition.install(context)
    this.queue = installed.value
    this.queue.onEvent((event) => {
      this.events.push(event)
      if (
        event.name === IpcLogEventName['ipc.backlog.high'] &&
        event.pendingData === this.#capacity
      )
        this.capacityReached.resolve(event)
    })
    return installed
  }
  /** A genuine named stage observes entry before forwarding to the unchanged batch continuation. */
  readonly #member: IRpcFlowStage<'frameOutbound'> = (payload, next) => {
    /** The witness resolves only after this exact frame enters the real Chunk/Batch suffix. */
    const traversal = next(payload)
    if (payload.frame.kind === 'message' && payload.write?.sendClass === IpcSendClass.data) {
      this.submitted.push(payload.frame)
      this.#members += 1
      if (this.#members === 3) this.membersEntered.resolve()
    }
    return traversal
  }
  /** Borrow actual native methods; this fixture implements no codec, reservation or scheduler. */
  #raw(port: MessagePort, client: boolean): IProcessMessageChannel {
    return {
      kind: 'message',
      send: (value, _transfer, write) => this.#send(port, client, value, write),
      onMessage(listener) {
        port.on('message', listener)
        return () => {
          port.off('message', listener)
        }
      },
      onClose(listener) {
        /** Native close carries no Process reason of its own. */
        const closed = (): void => listener()
        port.on('close', closed)
        return () => {
          port.off('close', closed)
        }
      },
      close: () => port.close()
    }
  }
  /** Physical preparation is held before the original native postMessage accepts its actual frame. */
  async #send(
    port: MessagePort,
    client: boolean,
    value: unknown,
    write?: IRpcCarrierWriteOptions
  ): Promise<void> {
    if (client) {
      this.writes.push(value as IRpcCarrierFrame)
      if (this.#holdFirstData && write?.sendClass === IpcSendClass.data) {
        this.#holdFirstData = false
        this.firstDataEntered.resolve(value as IRpcCarrierFrame)
        await this.#controlRelease.promise
      } else if (this.#holdControl && write?.sendClass === IpcSendClass.control) {
        this.#holdControl = false
        this.controlEntered.resolve()
        await this.#controlRelease.promise
      } else if (this.#holdData && write?.sendClass === IpcSendClass.data) {
        this.#holdData = false
        this.dataEntered.resolve(value as IRpcCarrierFrame)
        await this.#dataRelease.promise
      }
    }
    port.postMessage(value)
  }
  /** Actual SDK setup passes the original raw source through the production Process carrier. */
  #transport(client: boolean) {
    return defineTransportPlugin({
      name: client ? 'logical-client-source' : 'logical-server-source',
      namespace: 'process',
      open: async (context) => {
        /** The original physical Process owner alone installs logical reservation and FIFO. */
        const carrier = createProcessCarrier(
          this.#raw(client ? this.#ports.port1 : this.#ports.port2, client),
          context,
          {
            id: client ? 'logical-client-carrier' : 'logical-server-carrier',
            features: client ? [{ ...this.#definition, install: this.#install }] : []
          }
        )
        /** This is the actual accepted Session later used for health and public business calls. */
        const session = context.attach(carrier)
        if (client) {
          this.#context = context
          this.#session = session
        }
        await session.ready
        return { dispose: () => context.detach(session) }
      }
    })
  }
  /** Real bilateral Host construction negotiates the original chunk and batch extensions. */
  async open() {
    /** Both directions use their own genuine optional feature installations. */
    const flow = () => [
      chunkFeature({ chunkBytes: 4096, maxMessageBytes: 64 * 1024 }),
      batchFeature()
    ]
    /** This observer only supplies a deterministic batch-entry barrier. */
    const witness = defineFlowFeature({
      name: 'logical-native-frame-entry',
      setup: () => ({ stages: { [RpcFlowPoint.frameOutbound]: this.#member } })
    })
    /** The sole public roots own identity, semantic handshake, dispatch and shutdown. */
    const [client, server] = await Promise.all([
      createRpcHost({
        self: { name: 'logical-client', instanceId: 'logical-client' },
        plugins: [
          chunkFeature({ chunkBytes: 4096, maxMessageBytes: 64 * 1024 }),
          witness,
          batchFeature(),
          this.#transport(true)
        ],
        report: (error) => this.reports.push(error)
      }),
      createRpcHost({
        self: { name: 'logical-server', instanceId: 'logical-server' },
        plugins: [...flow(), this.#transport(false)],
        provide: { echo: (value: string) => value },
        report: (error) => this.reports.push(error)
      })
    ])
    this.#hosts = [client, server]
    this.events.length = 0
    this.writes.length = 0
    this.submitted.length = 0
    return { client, server }
  }
  /** Hold one control operation through the original Session API after real readiness. */
  startControl(): Promise<void> {
    this.#holdControl = true
    return this.#context!.ping(this.#session!, { timeoutMs: false })
  }
  /** Hold the next actual data handoff, preserving its one original write completion. */
  holdData(): void {
    this.#holdData = true
  }
  /** Hold two real data writes on the two original native receipts, without another queue. */
  holdDataPair(): void {
    this.#holdFirstData = true
    this.#holdData = true
  }
  /** Reject only the entered second native write; its raw IO never posts the failed aggregate. */
  rejectData(reason: unknown): void {
    this.#dataRelease.reject(reason)
  }
  /** Return the first original native receipt, used by control or paired-data backpressure. */
  releaseControl(): void {
    this.#controlRelease.resolve()
  }
  /** Return the original aggregate or fragment physical completion. */
  releaseData(): void {
    this.#dataRelease.resolve()
  }
  /** Release fixture holds before joining the same public Host teardown owners. */
  async close(): Promise<void> {
    this.releaseControl()
    this.releaseData()
    await Promise.all(this.#hosts.map((host) => host.close()))
    this.#ports.port1.close()
    this.#ports.port2.close()
  }
}

it('holds three logical Process credits through one unfinished public batch and rejects a fourth', async () => {
  /** Capacity belongs to the original Process flow, independently from physical frame count. */
  const fixture = new NativeProcessAdmissionPair(3)
  /** Public business calls cross real codec, named stages, Process reservation and native IO. */
  /** The actual accepted public root supplies the business invocation namespace. */
  const { client } = await fixture.open()
  try {
    /** The real control lane alone creates native backpressure before business admission. */
    const control = fixture.startControl()
    await fixture.controlEntered.promise
    fixture.holdData()
    /** Each original public call independently reserves one logical data receipt. */
    const first = client.process.send('logical-server', 'echo', 'one')
    /** The second member waits only behind the same physical batch writer. */
    const second = client.process.send('logical-server', 'echo', 'two')
    /** The third logical member reaches the actual configured data capacity. */
    const third = client.process.send('logical-server', 'echo', 'three')
    /** Every original call rejection is observed even if a fixture assertion fails before release. */
    const results = Promise.allSettled([first, second, third])
    /** This original flow event, rather than client call count, supplies the capacity oracle. */
    const high = await fixture.capacityReached.promise
    await fixture.membersEntered.promise
    expect(high).toMatchObject({ pendingData: 3, pendingControl: 1, active: IpcSendClass.control })
    fixture.releaseControl()
    /** The held original native writer identifies the actual aggregate or first fragment. */
    const physical = await fixture.dataEntered.promise
    expect(physical).toMatchObject({ kind: 'extension', extension: 'batch@1' })
    expect((physical.data as { frames: unknown[] }).frames).toHaveLength(3)
    /** Healthy pong completes the real control send before asserting its returned logical credit. */
    await control
    await expect(client.process.send('logical-server', 'echo', 'four')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    expect(fixture.events.at(-1)).toMatchObject({
      name: IpcLogEventName['ipc.backlog.rejected'],
      pendingData: 3,
      pendingControl: 0,
      active: IpcSendClass.data
    })
    expect(
      fixture.writes.filter((frame) => frame.kind === 'extension' && frame.extension === 'batch@1')
    ).toHaveLength(1)
    fixture.releaseData()
    await expect(results).resolves.toEqual([
      { status: 'fulfilled', value: 'one' },
      { status: 'fulfilled', value: 'two' },
      { status: 'fulfilled', value: 'three' }
    ])
    await fixture.queue.whenIdle()
    /** Capacity three preserves its original low crossing at one; whenIdle above proves zero. */
    expect(fixture.events.at(-1)).toMatchObject({
      name: IpcLogEventName['ipc.backlog.low'],
      pendingData: 1
    })
    expect(await client.process.send('logical-server', 'echo', 'after-drain')).toBe('after-drain')
    expect(fixture.reports).toEqual([])
  } finally {
    await fixture.close()
  }
})

it('retains one logical Process credit across every physical fragment of a public call', async () => {
  /** Capacity one makes any attempted per-fragment reservation fail through the genuine owner. */
  const fixture = new NativeProcessAdmissionPair(1)
  /** The actual accepted public root supplies the business invocation namespace. */
  const { client } = await fixture.open()
  try {
    fixture.holdData()
    /** The genuine codec produces enough string data for several negotiated fragments. */
    const payload = 'x'.repeat(12_000)
    /** This one logical request must retain its exact receipt across every fragment. */
    const pending = client.process.send('logical-server', 'echo', payload)
    /** The held original native writer identifies the actual aggregate or first fragment. */
    const physical = await fixture.dataEntered.promise
    expect(physical).toMatchObject({ kind: 'extension', extension: 'chunk@1' })
    expect(await fixture.capacityReached.promise).toMatchObject({ pendingData: 1 })
    await expect(client.process.send('logical-server', 'echo', 'second')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    expect(fixture.events.at(-1)).toMatchObject({
      name: IpcLogEventName['ipc.backlog.rejected'],
      pendingData: 1
    })
    fixture.releaseData()
    await expect(pending).resolves.toBe(payload)
    await fixture.queue.whenIdle()
    expect(
      fixture.writes.filter((frame) => frame.kind === 'extension' && frame.extension === 'chunk@1')
        .length
    ).toBeGreaterThan(1)
    expect(
      fixture.events.filter(
        (event) => event.name === IpcLogEventName['ipc.backlog.high'] && event.pendingData === 1
      )
    ).toHaveLength(1)
    expect(
      fixture.events.filter(
        (event) => event.name === IpcLogEventName['ipc.backlog.low'] && event.pendingData === 0
      )
    ).toHaveLength(1)
    expect(await client.process.send('logical-server', 'echo', 'after-chunks')).toBe('after-chunks')
    expect(fixture.reports).toEqual([])
  } finally {
    await fixture.close()
  }
})

it('C004 actual failed Process batch keeps native whenIdle pending through both logical settlements', async () => {
  /** Existing source, native ports and sole installed Process queue own the entire public path. */
  const fixture = new NativeProcessAdmissionPair(3)
  /** Both public roots finish their genuine startup before native physical failure is armed. */
  const { client } = await fixture.open()
  /** The normal prototype method lends its actual receiving owner without replacing execution. */
  const reservations = vi.spyOn(IpcFlowControl.prototype, 'reserveWrite')
  try {
    fixture.holdDataPair()
    /** This is the first actual data write, not a control or a fabricated busy queue item. */
    const first = client.process.send('logical-server', 'echo', 'first')
    /** Keep the original first result observable even if a fixture assertion exits before release. */
    void first.catch(() => undefined)
    await fixture.firstDataEntered.promise
    /** A genuine reservation captured this same native flow before any frame became opaque. */
    const flow = reservations.mock.contexts[0]!
    expect(flow).toBe(fixture.queue.flow)
    /** Narrow only the original native instance captured by the real prototype invocation. */
    if (!(flow instanceof IpcFlowControl)) expect.fail('expected original native flow owner')
    /** Both independent public calls retain their own correlated failure promises. */
    const one = client.process
      .send('logical-server', 'echo', 'one')
      .catch((error: unknown) => error)
    /** The second member shares physical completion without borrowing the first call's result. */
    const two = client.process
      .send('logical-server', 'echo', 'two')
      .catch((error: unknown) => error)
    /** Only the actual native flow may announce complete logical and physical drain. */
    let idle = false
    /** The queue's real delegate returns this very same native pending drain receipt. */
    const nativeIdle = flow.whenIdle()
    expect(fixture.queue.whenIdle()).toBe(nativeIdle)
    /** Record completion of the original native drain promise, not Promise.all of client calls. */
    const drained = nativeIdle.then(() => {
      idle = true
    })
    await fixture.membersEntered.promise
    await Promise.resolve()
    expect(idle).toBe(false)
    fixture.releaseControl()
    await expect(first).resolves.toBe('first')
    /** The second actual native writer is the aggregate of both original encoded members. */
    const physical = await fixture.dataEntered.promise
    expect(fixture.writes).toHaveLength(2)
    expect(physical).toMatchObject({ kind: 'extension', extension: 'batch@1' })
    /**
     * These are original frame references retained at the real existing stage, never decoded
     * copies.
     */
    const members = (physical.data as { frames: IRpcCarrierFrame[] }).frames
    expect(members).toHaveLength(2)
    expect(members[0]).toBe(fixture.submitted[1])
    expect(members[1]).toBe(fixture.submitted[2])
    expect(idle).toBe(false)
    /** Process owns its real channel wrapper; this native leaf must remain exactly reachable. */
    const cause = new Error('custody native batch failure')
    fixture.rejectData(cause)
    /** Both promises settle only after the actual original writer rejects. */
    const failures = await Promise.all([one, two])
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(RpcTransportError)
      expect(failure).toMatchObject({ code: 'TRANSPORT' })
      expect(Array.from(walkErrorCauses(failure))).toContain(cause)
    }
    await drained
    expect(idle).toBe(true)
    await expect(client.process.send('logical-server', 'echo', 'recovered')).resolves.toBe(
      'recovered'
    )
    expect(fixture.writes).toHaveLength(3)
    expect(fixture.writes[2]).toBe(fixture.submitted[3])
  } finally {
    reservations.mockRestore()
    await fixture.close()
  }
})
