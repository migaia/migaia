import { expect, it, vi } from 'vitest'
import { nativeFeatureOutput } from '../native-feature.ts'
import type { IFeatureOutput } from '@migaia/plugin-host'
import { fileURLToPath } from 'node:url'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import {
  IpcSendClass as canonicalSendClass,
  type IRpcCarrier
} from '@migaia/rpc-contract/interfaces'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  sendQueueFeature as queueFeature,
  ipcLogFeature as logFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcLogRecord
} from '@migaia/rpc-plugin-process/features'
import sendQueue from '@migaia/rpc-plugin-process/features/send-queue'
import ipcLog from '@migaia/rpc-plugin-process/features/log'
import * as flow from '@migaia/rpc-plugin-process/features/flow-control'
import * as carrierOwner from '../../dist/process/carrier.js'
import * as stderrOwner from '../../dist/process/stderr.js'
import * as nativeIO from '../../dist/process/node-io.js'
import type { IProcessCommonOptions } from '../../dist/process/types.js'

/** Actual child bootstrap, provider traffic and stderr stay in the unchanged native fixture. */
const child = fileURLToPath(new URL('./fixtures/child.mts', import.meta.url))
/** Capture original native constructors before each test's observational spy is installed. */
const createChild = nativeIO.createAdapterChildStdio
/** The original carrier performs all codecs, feature installation and native lifetime work. */
const createCarrier = carrierOwner.createProcessCarrier
/** The canonical stderr owner alone subscribes, redacts and releases the actual native reader. */
const attachStderr = stderrOwner.attachIpcStderr

/** Observe original resources and cleanup order without substituting acquisition or a codec. */
class NativeConnectionObservation {
  /** Only native disposer entry appends these exact cleanup labels. */
  readonly closed: string[] = []
  /** This is the genuine carrier receipt created for the independent child. */
  carrier: IRpcCarrier | undefined
  /** The actual Node byte resource remains the sole physical close owner. */
  #raw: ReturnType<typeof createChild> | undefined
  /** Borrow the actual generation's stderr registration without adding a second listener. */
  #subscribe: NonNullable<IProcessCommonOptions['ipc']['stderr']> | undefined

  /** Wrap only the native close observation while retaining all original raw IO methods. */
  readonly child = (...args: Parameters<typeof createChild>): ReturnType<typeof createChild> => {
    this.#raw = createChild(...args)
    return { ...this.#raw, close: this.#close }
  }
  /** Return the same canonical carrier; only its existing receipt is retained by this test. */
  readonly create = (...args: Parameters<typeof createCarrier>): IRpcCarrier => {
    this.carrier = createCarrier(...args)
    return this.carrier
  }
  /** Lend the original subscription to the original stderr projection helper. */
  readonly attach = (...args: Parameters<typeof attachStderr>): ReturnType<typeof attachStderr> => {
    const [install, ipc, report, scheduler] = args
    this.#subscribe = ipc.stderr
    return attachStderr(install, { ...ipc, stderr: this.#stderr }, report, scheduler)
  }
  /** Record exact native unsubscription after its one original registration is acquired. */
  readonly #stderr: NonNullable<IProcessCommonOptions['ipc']['stderr']> = (listener) => {
    const unsubscribe = this.#subscribe!(listener)
    return () => {
      this.closed.push('stderr')
      unsubscribe()
    }
  }
  /** Preserve the actual native shared close Promise and its original failure. */
  readonly #close = (reason?: unknown): Promise<void> => {
    this.closed.push('physical')
    return this.#raw!.close(reason)
  }
}

it('shares the same two factories and original flow-control values across public imports', () => {
  expect(queueFeature).toBe(sendQueue)
  expect(logFeature).toBe(ipcLog)
  expect(flow.IpcSendClass).toBe(IpcSendClass)
  expect(flow.IpcLogEventName).toBe(IpcLogEventName)
  expect(IpcSendClass).toBe(canonicalSendClass)
  /** Removes the old Host/plugin log alias; Process remains the single event vocabulary. */
  expect(Object.keys(flow).toSorted()).toEqual([
    'IpcFlowControl',
    'IpcLogEventName',
    'IpcSendClass',
    'default',
    'flowControlFeature'
  ])
})

it('applies explicit data capacity while preserving control capacity on one actual process gate', async () => {
  /** Capture both complete native lane policies before caller mutation. */
  const capacity = { maxPendingData: 1, maxPendingControl: 1 }
  const definition = queueFeature(capacity)
  capacity.maxPendingData = 8
  /** Observe only the original complete feature's real installation and returned receipt. */
  const queues = vi.spyOn(
    Object.getPrototypeOf(await nativeFeatureOutput(definition)) as IFeatureOutput<
      typeof definition
    >,
    'install'
  )
  const queue = definition
  const records: IIpcLogRecord[] = []
  const logging = logFeature({
    report: (record) => {
      records.push(record)
    }
  })
  const logs = vi.spyOn(
    Object.getPrototypeOf(await nativeFeatureOutput(logging)) as IFeatureOutput<typeof logging>,
    'install'
  )
  const released = deferred<void>()
  const started = deferred<void>()
  const reports: unknown[] = []
  const host = await createRpcHost({
    self: { name: 'feature-parent', instanceId: 'feature-parent' },
    plugins: [processPlugin({ spawn: { entry: child }, features: { queue, logging } })],
    report: (error) => reports.push(error)
  })
  try {
    expect(await host.process.request('echo', 42)).toBe(42)
    expect(queues).toHaveBeenCalledTimes(1)
    expect(logs).toHaveBeenCalledTimes(1)
    const gate = queues.mock.results[0]!.value.value
    expect(logs.mock.calls[0]![0].gate).toBe(gate.flow)
    /** Direct admission proves captured data1/control1 on this exact physical installation. */
    records.length = 0
    const pending = gate.run({ sendClass: IpcSendClass.data }, () => {
      started.resolve()
      return released.promise
    })
    await started.promise
    await expect(host.process.notify('echo', 'saturated')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    const acceptedControl = gate.run({ sendClass: IpcSendClass.control }, () => undefined)
    await expect(
      gate.run({ sendClass: IpcSendClass.control }, () => undefined)
    ).rejects.toMatchObject({ code: 'OVERLOADED' })
    expect(
      records.filter((record) => record.name === IpcLogEventName['ipc.backlog.rejected'])
    ).toHaveLength(2)
    /** Retires deleted ipc.log fallback input, not the selected native log sink above. */
    released.resolve()
    await Promise.all([pending, acceptedControl])
    expect(await host.process.request('echo', 43)).toBe(43)
    expect(queues).toHaveBeenCalledTimes(1)
  } finally {
    released.resolve()
    await host.close()
    queues.mockRestore()
    logs.mockRestore()
  }
})

it('keeps native stderr on the selected log and unsubscribes it before physical connection close', async () => {
  const records: IIpcLogRecord[] = []
  /** The sink must not gain access to the captured native logging options as its receiver. */
  const receivers: unknown[] = []
  const observed = deferred<void>()
  const observation = new NativeConnectionObservation()
  const byte = vi.spyOn(nativeIO, 'createAdapterChildStdio').mockImplementation(observation.child)
  const carrier = vi
    .spyOn(carrierOwner, 'createProcessCarrier')
    .mockImplementation(observation.create)
  const stderr = vi.spyOn(stderrOwner, 'attachIpcStderr').mockImplementation(observation.attach)
  const reports: unknown[] = []
  const host = await createRpcHost({
    plugins: [
      processPlugin({
        spawn: { entry: child },
        features: {
          log: logFeature({
            report(this: unknown, record) {
              receivers.push(this)
              records.push(record)
              if (record.name === IpcLogEventName['ipc.stderr']) observed.resolve()
            }
          })
        }
      })
    ],
    report: (error) => reports.push(error)
  })
  try {
    expect(await host.process.request('stderr')).toEqual(expect.any(Number))
    await observed.promise
    expect(receivers).toEqual([undefined])
    expect(stderr).toHaveBeenCalledTimes(1)
    expect(records.filter((record) => record.name === IpcLogEventName['ipc.stderr'])).toEqual([
      expect.objectContaining({ text: '[child stderr redacted]' })
    ])
    expect(JSON.stringify(records)).not.toContain('private-process-feature-stderr')
    expect(observation.carrier).toBeDefined()
    await observation.carrier!.close()
    expect(observation.closed).toEqual(['stderr', 'physical'])
    await observation.carrier!.close()
    expect(observation.closed).toEqual(['stderr', 'physical'])
  } finally {
    await host.close()
    stderr.mockRestore()
    carrier.mockRestore()
    byte.mockRestore()
  }
})

/** Admission of one request and one notification through a process host with these roots. */
async function echoThrough(
  features: NonNullable<Parameters<typeof processPlugin>[0]['features']>
): Promise<void> {
  const host = await createRpcHost({
    self: { name: 'flow-root-parent', instanceId: 'flow-root-parent' },
    plugins: [processPlugin({ spawn: { entry: child }, features })]
  })
  try {
    expect(await host.process.request('echo', 7)).toBe(7)
    await host.process.notify('echo', 'notified')
  } finally {
    await host.close()
  }
}

it('routes writes through a root flow-control feature with and without a send queue', async () => {
  /** One shared admission owner is both a root and the queue's declared dependency. */
  const admission = flow.flowControlFeature({ maxPendingData: 4 })
  await echoThrough({ admission })
  await echoThrough({ admission, queue: queueFeature({ flow: admission }) })
})
