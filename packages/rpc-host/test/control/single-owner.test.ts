/** Public control error identities stay canonical after remove old route/store surfaces. */
import { expect, it } from 'vitest'
import * as core from '@migaia/rpc-host'
import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'
import { RpcContractErrorCode, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

it('retains public cancellation and deadline identities at their sole error-code owner', () => {
  expect(Object.values(RpcContractErrorCode)).not.toContain('CANCELLED')
  expect(Object.values(RpcContractErrorCode)).not.toContain('DEADLINE_EXCEEDED')
  expect(RpcCoreErrorCode.cancelled).toBe('CANCELLED')
  expect(RpcCoreErrorCode.deadlineExceeded).toBe('DEADLINE_EXCEEDED')
  /** Moves the existing store factory from the mandatory root into its optional owner. */
  expect(Object.hasOwn(core, 'createRpcIdempotencyStore')).toBe(false)
  expect(createRpcIdempotencyStore).toBeTypeOf('function')
})
