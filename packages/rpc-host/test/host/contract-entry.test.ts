/** Keeps the explicit Host contract entry identical to its single canonical peer package. */
import { expect, it } from 'vitest'
import * as host from '@migaia/rpc-host'
import {
  RpcLifecycleError,
  RpcConstructionError,
  RpcAbortError,
  isRpcError,
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from '@migaia/rpc-contract/errors'
import { normalizeRpcPortable } from '@migaia/rpc-contract/portable'

/** The fixed public symbol set is named explicitly; no wildcard contract export is supported. */
const expected = {
  RpcLifecycleError,
  RpcConstructionError,
  RpcAbortError,
  isRpcError,
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE,
  normalizeRpcPortable
}

/** Resolve the real manifest subpath at runtime, so the missing pre-migration entry fails in-test. */
const contractEntry = '@migaia/rpc-host/contract'

it('publishes each named contract symbol with its original runtime identity', async () => {
  /** Import rejection is an assertion failure when the real package does not publish the entry. */
  await expect(import(contractEntry)).resolves.toBeDefined()
  /** The native module namespace must contain exactly the agreed runtime subset. */
  const contract = await import(contractEntry)
  expect(new Set(Object.keys(contract))).toEqual(new Set(Object.keys(expected)))
  // The nine keys are a compile-time fixed publication contract, independent from runtime inputs.
  for (const [name, value] of Object.entries(expected)) expect(contract[name]).toBe(value)
})

it('removes every contract runtime symbol from the Host root without compatibility exports', () => {
  // The nine keys are fixed by the explicit entry contract above.
  for (const name of Object.keys(expected)) expect(host).not.toHaveProperty(name)
})

it('keeps instanceof symmetric for lifecycle, construction and abort errors', async () => {
  /** These runtime constructors resolve through the exact same application peer installation. */
  const contract = await import(contractEntry)
  /** The cause is caller-owned and must survive either package entry unchanged. */
  const cause = new Error('entry identity fixture')
  /** Each side constructs a real error; both entry-point constructors must recognize both objects. */
  const pairs = [
    [
      new RpcLifecycleError('lifecycle fixture', cause),
      new contract.RpcLifecycleError('lifecycle fixture', cause),
      RpcLifecycleError,
      contract.RpcLifecycleError
    ],
    [
      new RpcConstructionError('construction fixture', cause, []),
      new contract.RpcConstructionError('construction fixture', cause, []),
      RpcConstructionError,
      contract.RpcConstructionError
    ],
    [
      new RpcAbortError(undefined, undefined, cause),
      new contract.RpcAbortError(undefined, undefined, cause),
      RpcAbortError,
      contract.RpcAbortError
    ]
  ] as const
  // Three fixed error families are the agreed runtime-constructor additions and existing lifecycle.
  for (const [direct, forwarded, Direct, Forwarded] of pairs) {
    expect(direct).toBeInstanceOf(Forwarded)
    expect(forwarded).toBeInstanceOf(Direct)
    expect(direct.cause).toBe(cause)
    expect(forwarded.cause).toBe(cause)
  }
})
