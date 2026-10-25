import { indexedDbTestFeatures } from '../test/helpers/indexed-db-features.js'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '../src/indexed-db.js'
import { NativeTransactionActivity } from './native-transaction-cases.js'

/** Only plain evidence crosses the browser boundary; actual error identity is compared in realm. */
type INativeActivityResult = {
  readonly failed: boolean
  readonly source: string | undefined
  readonly code: string | undefined
  readonly causeName: string | undefined
  readonly operationAndOuterSame: boolean
  readonly text: string | null
  readonly bytes: readonly number[] | null
  readonly record: unknown
  readonly changes: readonly string[]
}

declare global {
  /** This declaration merges the scenario into the existing browser-page fixture interface. */
  interface Window {
    runIndexedDbNativeActivityScenario(
      mode: NativeTransactionActivity
    ): Promise<INativeActivityResult>
  }
}

/** Exercise the real browser transaction and read its result through an independent native store. */
window.runIndexedDbNativeActivityScenario = async (mode) => {
  /** Both registrations address the same database while retaining separate original controllers. */
  const dbName = `native-activity-${crypto.randomUUID()}`
  /** The actual public installation owns both native connections and their cleanup. */
  const host = await createStorageHost({
    plugins: [
      indexedDbBackendPlugin({ id: 'writer', dbName }, indexedDbTestFeatures),
      indexedDbBackendPlugin({ id: 'reader', dbName }, indexedDbTestFeatures)
    ]
  })
  /** This same store starts the original transaction rather than a test-authored scope. */
  const writer = host.backend('writer')
  /** Reads after settlement use another registered store and native connection. */
  const reader = host.backend('reader')
  /** The original feed must publish no rolled-back channel as committed. */
  const changes: string[] = []
  /** Only the subscription created by this scenario is removed during cleanup. */
  let unsubscribe: (() => void) | undefined
  /** The exact operation error remains inside this realm for the outer-Promise identity check. */
  let operationFailure: unknown
  try {
    await writer.set('text', 'before')
    await writer.setBytes('bytes', new Uint8Array([1]))
    await writer.putRecord({ value: 'before' }, 'record')
    unsubscribe = writer.subscribeChanges((change) => changes.push(change.channel))
    /** Unexpected success is returned as evidence instead of being disguised as an expected error. */
    const failure = await writer
      .transaction(
        async (scope) => {
          await scope.set('text', 'during')
          await scope.setBytes('bytes', new Uint8Array([2]))
          await scope.putRecord({ value: 'during' }, 'record')
          if (mode === NativeTransactionActivity.microtask) await Promise.resolve()
          else await new Promise<void>((resolve) => setTimeout(resolve, 10))
          if (mode === NativeTransactionActivity.timerReturn) return
          try {
            await scope.set('text', 'after')
          } catch (error) {
            operationFailure = error
            if (mode !== NativeTransactionActivity.caughtTimerWrite) throw error
          }
        },
        {
          /** The same transaction budget bounds the scenario if native scheduling stops. */
          timeoutMs: 5_000
        }
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )
    /** The original controller publishes on its queued microtask after native commit only. */
    await Promise.resolve()
    /** This annotation reads the actual coded failure without replacing it. */
    const error = failure as (Error & { source?: string; code?: string }) | undefined
    /** Native activity failure must remain reachable as the original cause. */
    const cause = error?.cause as { name?: string } | undefined
    /** Bytes are converted only for browser-result serialization, after independent native read. */
    const bytes = await reader.getBytes('bytes')
    return {
      failed: error !== undefined,
      source: error?.source,
      code: error?.code,
      causeName: cause?.name,
      operationAndOuterSame: operationFailure !== undefined && operationFailure === error,
      text: await reader.get('text'),
      bytes: bytes === null ? null : [...bytes],
      record: await reader.getRecord('record'),
      changes
    }
  } finally {
    unsubscribe?.()
    await host.dispose()
  }
}
