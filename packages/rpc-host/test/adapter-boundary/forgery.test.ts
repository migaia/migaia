/** Current public entries never export the retired arbitrary-target trust writers. */
import { describe, expect, it } from 'vitest'
import * as core from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/sdk'
import * as features from '@migaia/rpc-host/features'
import * as threads from '../../../rpc-plugin-thread/dist/threads/index.js'
import * as process from '../../../rpc-plugin-process/dist/process/index.js'

/** Removed JSON-RPC/runtime-peer entries have no compatibility export to include in this table. */
const publicEntries = [core, sdk, threads, process, features]

/** Ordinary package imports cannot qualify arbitrary caller-owned transports or callbacks. */
function expectPrivateWriter(name: string): void {
  // This fixed five-entry list is the current public package boundary, not a growable registry.
  for (const entry of publicEntries) expect(Object.hasOwn(entry, name), name).toBe(false)
}

describe('public adapter resource boundaries', () => {
  it('exposes no arbitrary carrier batch qualifier', () => {
    expectPrivateWriter('registerBatchAgreement')
  })

  it.each(['registerFastCodec', 'registerFastFramer'] as const)(
    '%s exposes no retired component qualifier',
    (writer) => {
      expectPrivateWriter(writer)
    }
  )

  it.each([
    'registerNativeReplayOwner',
    'registerLazyNativeReplayOwner',
    'bindNativeReplayTransport'
  ] as const)('%s exposes no arbitrary replay qualification writer', (writer) => {
    expectPrivateWriter(writer)
  })

  it('exposes no retired object-port qualifier', () => {
    expectPrivateWriter('registerJsonObjectPort')
  })

  it.each(['attachProviderBulkAdmission', 'attachProviderPreflight'] as const)(
    '%s exposes no private provider policy writer',
    (writer) => {
      expectPrivateWriter(writer)
    }
  )

  it('exposes neither retired owned-JSON snapshot writer', () => {
    expectPrivateWriter('prepareOwnedJsonSnapshot')
    expectPrivateWriter('prepareOwnedBinaryJsonSnapshot')
  })
})
