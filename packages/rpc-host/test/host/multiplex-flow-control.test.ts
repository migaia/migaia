import { nativeFeatureOutput } from '../../../rpc-plugin-process/test/native-feature.ts'
/** Process-owned feature execution replaces the removed host-multiplex/outbound-gate adapters. */
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  sendQueueFeature,
  ipcLogFeature,
  IpcSendClass,
  type IProcessFeatureContext
} from '../../../rpc-plugin-process/dist/features/index.js'

/** Each original native connection lends its actual identity and cancellation/report ports. */
function nativeContext(connectionId: string): IProcessFeatureContext {
  return {
    owner: connectionId,
    connectionId,
    sessionId: connectionId,
    signal: new AbortController().signal,
    report: () => undefined
  }
}

it('uses each original envelope gate and log once while an unrelated physical peer remains writable', async () => {
  /** One original native completion remains unresolved while B owns its logical capacity. */
  const released = deferred<void>()
  /** The real executing feature signals only actual native sender entry. */
  const started = deferred<void>()
  /** B owns one native feature installation; C has a separate original installation. */
  const bContext = nativeContext('b')
  /** Capacity lives in the genuine process feature, never a host-side shadow gate. */
  const b = (
    await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1, maxPendingControl: 1 }))
  ).install(bContext)
  /** The unrelated source keeps its own native identity and admission resources. */
  const c = (
    await nativeFeatureOutput(sendQueueFeature({ maxPendingData: 1, maxPendingControl: 1 }))
  ).install(nativeContext('c'))
  /** Original logging observes the same actual executing gate. */
  const records = vi.fn()
  /** The real process logger borrows B's event stream without another capacity counter. */
  const logging = (await nativeFeatureOutput(ipcLogFeature({ report: records }))).install({
    ...bContext,
    gate: b.value,
    onReportError: () => undefined
  })
  /** Native physical invocation is counted independently for the unrelated peer. */
  const writeC = vi.fn()
  /** Concrete native classification is a real input to the existing feature boundary. */
  const data = { sendClass: IpcSendClass.data }
  try {
    expect(b.value).toBeDefined()
    /** Accepted completion remains owned until this original native write settles. */
    const pending = b.value.run(data, () => {
      started.resolve()
      return released.promise
    })
    await started.promise
    await expect(b.value.run(data, vi.fn())).rejects.toMatchObject({ code: 'OVERLOADED' })
    await c.value.run(data, writeC)
    expect(writeC).toHaveBeenCalledTimes(1)
    expect(
      records.mock.calls.filter(([record]) => record.name === 'ipc.backlog.rejected')
    ).toHaveLength(1)
    released.resolve()
    await pending
    expect(
      records.mock.calls.filter(([record]) => record.name === 'ipc.backlog.high')
    ).toHaveLength(1)
  } finally {
    released.resolve()
    logging.dispose()
    b.dispose()
    c.dispose()
    await Promise.all([b.value.whenIdle(), c.value.whenIdle()])
  }
})
