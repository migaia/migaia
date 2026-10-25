import type { IStorageStore } from '../capability.js'
import { kv } from '../capabilities/kv.js'
import { conformanceCases, type IConformanceHarness, type IConformanceSubject } from './harness.js'
import {
  kvConformance,
  binaryConformance,
  recordsConformance,
  iterationConformance,
  transactionsConformance,
  crossChannelConformance,
  syncBinaryConformance
} from './legacy.js'
import { syncConformance, indexConformance, feedConformance } from './features.js'
import { standardConformance } from './standards.js'
import { nativeTransactionsConformance } from './transactions.js'

export type {
  IConformanceMatchers,
  IConformanceAsyncMatchers,
  IConformanceHarness
} from './harness.js'

/** Register the declared contract cases with the consumer's runner; never create a runner or host. */
export function runConformance<TStore extends IStorageStore<never>>(
  harness: IConformanceHarness,
  subject: IConformanceSubject<TStore>
): void {
  harness.describe(subject.name, () => {
    /** Selection is declarative; every selected case independently verifies the complete manifest. */
    const check = conformanceCases(harness, subject)
    const features = subject.features
    check('capabilities · complete token and feature manifest', () => undefined)
    if (subject.capabilities.includes(kv)) kvConformance(check, harness)
    if (features.syncRead) syncConformance(check, harness)
    if (features.binary) binaryConformance(check, harness)
    if (features.records) recordsConformance(check, harness)
    if (features.iteration) iterationConformance(check, harness)
    if (features.transactions) {
      if (features.records && subject.capabilities.includes(kv))
        transactionsConformance(check, harness)
      else nativeTransactionsConformance(check, harness, subject.capabilities)
    }
    if (features.binary && features.records) crossChannelConformance(check, harness)
    if (features.syncRead && features.binary) syncBinaryConformance(check, harness)
    if (features.secondaryIndexes) {
      const prepare = subject.prepareSecondaryIndexes
      indexConformance(
        check,
        harness,
        prepare ? (store, handle) => prepare(store as TStore, handle) : undefined
      )
    }
    if (features.changeFeed) feedConformance(check, harness)
    standardConformance(check, harness, subject.capabilities, features.batch === true)
  })
}
