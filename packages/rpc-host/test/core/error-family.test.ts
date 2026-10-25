import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  identifyRpcBoundaryFailure,
  deserializeRpcError,
  RPC_CORE_ERROR_SOURCE
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcError, RpcRemoteError, RpcTimeoutError } from '@migaia/rpc-contract/errors'
import {
  createRpcTimeoutError,
  createRpcError,
  createRpcRemoteError,
  isLocalRpcError,
  localRpcErrorCode
} from '../../dist/host/error-owner.js'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { attachErrorIdentity } from '@migaia/utils/error'

/** A real independent realm supplies native Error objects rather than local class instances. */
function foreignError(name: string, code: string, source = RPC_CORE_ERROR_SOURCE): unknown {
  return runInNewContext('Object.assign(new Error("foreign failure"), { name, code, source })', {
    name,
    code,
    source
  })
}

describe('coded error families', () => {
  it.each([
    RpcCoreErrorCode.deadlineExceeded,
    RpcCoreErrorCode.endpointDisposed,
    RpcCoreErrorCode.overloaded
  ] as const)(
    'public boundary helper and native diagnostic tag with code %s cannot mint local control identity',
    (code) => {
      /** The original single-native-error branch tags this same instance without private minting. */
      const original = new RangeError('listener fixture')
      const helper = identifyRpcBoundaryFailure(original, code, original.message)
      expect(helper).toBe(original)
      expect(helper).toMatchObject({ source: RPC_CORE_ERROR_SOURCE, code })
      expect(localRpcErrorCode(helper)).toBeUndefined()
      expect(isLocalRpcError(helper, RpcError)).toBe(false)
      /** Internal tagging is likewise diagnostic; native TypeError identity must survive it. */
      const native = new TypeError('native tag fixture')
      expect(tagRpcError(native, code)).toBe(native)
      expect(localRpcErrorCode(native)).toBeUndefined()
      expect(isLocalRpcError(native, RpcError)).toBe(false)
    }
  )
  it('retains local native families and their original instances', () => {
    /** Caller-owned failure objects remain untouched by classification. */
    const core = new RpcError(RpcCoreErrorCode.invalidConfig, 'fixture configuration')
    /** Remote codes retain the remote party code domain. */
    const remote = new RpcRemoteError('FIXTURE_REMOTE', 'fixture remote')
    /** Deadline classification retains the standard native family. */
    const timeout = new RpcTimeoutError()
    expect(isRpcErrorInstance(core)).toBe(true)
    expect(isRpcErrorInstance(timeout)).toBe(true)
    expect(isRpcRemoteError(remote)).toBe(true)
    expect(isRpcTimeoutError(timeout)).toBe(true)
    expect(isRpcErrorInstance(remote)).toBe(false)
    expect(isRpcRemoteError(core)).toBe(false)
    expect(isRpcTimeoutError(core)).toBe(false)
  })

  it('recognizes coded equivalent errors from an independent realm', () => {
    /** Foreign prototypes cannot satisfy any local Core instanceof check. */
    const core = foreignError('RpcError', RpcCoreErrorCode.invalidConfig)
    /** Remote wire codes need no entry in the local Core code enumeration. */
    const remote = foreignError('RpcRemoteError', 'FIXTURE_REMOTE')
    /** Timeout uses the exact original name, source and deadline code. */
    const timeout = foreignError('TimeoutError', RpcCoreErrorCode.deadlineExceeded)
    expect(core instanceof RpcError).toBe(false)
    expect(remote instanceof RpcRemoteError).toBe(false)
    expect(timeout instanceof RpcTimeoutError).toBe(false)
    expect(isRpcErrorInstance(core)).toBe(true)
    expect(isRpcRemoteError(remote)).toBe(true)
    expect(isRpcTimeoutError(timeout)).toBe(true)
  })

  it('does not classify unrelated names, sources or codes as these families', () => {
    expect(isRpcErrorInstance(foreignError('Error', RpcCoreErrorCode.invalidConfig))).toBe(false)
    expect(isRpcErrorInstance(foreignError('RpcError', 'FIXTURE_REMOTE'))).toBe(false)
    expect(isRpcRemoteError(foreignError('RpcRemoteError', 'FIXTURE_REMOTE', 'fixture'))).toBe(
      false
    )
    expect(isRpcTimeoutError(foreignError('TimeoutError', RpcCoreErrorCode.invalidConfig))).toBe(
      false
    )
    expect(
      isRpcTimeoutError(foreignError('TimeoutError', RpcCoreErrorCode.deadlineExceeded, 'fixture'))
    ).toBe(false)
  })

  it('public classification, copied prototypes and returned constructors never mint live control identity', () => {
    /** Only the original owner factory registers this observed timeout instance. */
    const owned = createRpcTimeoutError()
    /** The same constructor remains reachable through every ordinary Error instance. */
    const Constructor = owned.constructor as typeof RpcTimeoutError
    /** Construction through that reachable function provides diagnostics, never owner identity. */
    const constructed = new Constructor()
    /** An adapter can attach public Core fields, but cannot register the private mint record. */
    const tagged = attachErrorIdentity(new Error('tag fixture'), {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.deadlineExceeded
    })
    tagged.name = 'TimeoutError'
    /** Public wire decoding restores diagnostic family and stack without granting live control. */
    const decoded = deserializeRpcError({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.deadlineExceeded,
      name: 'TimeoutError',
      message: 'decode fixture',
      stack: 'fixture foreign stack'
    })
    /** A copied prototype also cannot acquire the factory's exact-reference record. */
    const copied = Object.assign(Object.create(Object.getPrototypeOf(owned)), {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.deadlineExceeded,
      name: 'TimeoutError'
    })
    for (const error of [constructed, tagged, decoded, copied]) {
      expect(isRpcTimeoutError(error)).toBe(true)
      expect(localRpcErrorCode(error)).toBeUndefined()
      expect(isLocalRpcError(error, RpcTimeoutError)).toBe(false)
    }
    expect(localRpcErrorCode(owned)).toBe(RpcCoreErrorCode.deadlineExceeded)
    expect(isLocalRpcError(owned, RpcTimeoutError)).toBe(true)
  })

  it('changing diagnostics or prototype of an observed error cannot change its original private family/code', () => {
    /** The original owner chose a generic INTERNAL failure, not cancellation. */
    const owned = createRpcError(RpcCoreErrorCode.internal, 'owner fixture')
    /** Public observations can be changed independently from the retained owner facts. */
    Object.defineProperty(owned, 'code', { value: RpcCoreErrorCode.deadlineExceeded })
    Object.setPrototypeOf(owned, RpcTimeoutError.prototype)
    owned.name = 'TimeoutError'
    expect(isRpcTimeoutError(owned)).toBe(true)
    expect(localRpcErrorCode(owned)).toBe(RpcCoreErrorCode.internal)
    expect(isLocalRpcError(owned, RpcTimeoutError)).toBe(false)
    expect(isLocalRpcError(owned, RpcError)).toBe(true)
  })

  it.each([
    RpcCoreErrorCode.overloaded,
    RpcCoreErrorCode.deadlineExceeded,
    RpcCoreErrorCode.endpointDisposed
  ] as const)(
    'an actual Core-created remote wrapper with peer code %s never acquires local control code',
    (code) => {
      /** A real response decoder uses this exact factory for an unrestricted remote code. */
      const remote = createRpcRemoteError(code, 'remote wrapper fixture')
      expect(isRpcRemoteError(remote)).toBe(true)
      expect(isLocalRpcError(remote, RpcRemoteError)).toBe(true)
      expect(isLocalRpcError(remote, RpcError)).toBe(false)
      expect(localRpcErrorCode(remote)).toBeUndefined()
    }
  )
})
