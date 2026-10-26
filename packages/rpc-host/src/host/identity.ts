/**
 * Own the host's single identity and trusted native bootstrap reconciliation, independent from
 * optional authentication.
 */
import type { IRpcDirectory, IRpcGeneration } from '@migaia/rpc-contract/protocol'
import type { IRpcLocalSourceFacts } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { createRpcConfigurationError, createRpcError } from './error-owner.js'
import { sameGeneration } from '../call/envelope.js'
import { RpcWarningCode, type IRpcWarning } from './warning.js'
import { HostWarningText } from './warning-text.js'

/** Public identity is global to the host; a transport never creates a second public self. */
export type IRpcSelf = Readonly<{ name: string; instanceId: string }>

/** Preserve the original secure fallback allocator without depending on an authentication plugin. */
export function defaultRpcId(): string {
  /** Native entropy supplies host identities before any cold transport can acquire resources. */
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
    | undefined
  try {
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
    if (cryptoApi?.getRandomValues) {
      /** Fixed 16-byte entropy preserves the existing identifier domain. */
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
      return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
    }
  } catch (cause) {
    throw createRpcConfigurationError(RpcCoreErrorText.uuidUnavailable, cause)
  }
  throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.uuidUnavailable)
}

/** Validate the supported public identity domain before any carrier can acquire resources. */
function captureSelf(value: IRpcSelf): IRpcSelf {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name ||
    value.name.length > 256 ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    value.instanceId.length > 256
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
  return Object.freeze({ name: value.name, instanceId: value.instanceId })
}

/** A trusted native parent selects the child's global identity before its first source starts. */
export class HostIdentity {
  /** Explicit child identity values warn when trusted native parent facts replace them. */
  readonly #configured: boolean
  /** The original flow registry owns warning subscriptions, fallback and handler failures. */
  readonly #dispatchWarning: (warning: IRpcWarning) => void
  /** The one immutable accepted identity is borrowed by every namespace directory. */
  #self: IRpcSelf
  /** Native restart/session facts belong to the same global identity owner. */
  #generation: IRpcGeneration
  /** Once traffic starts, later transports cannot change identities already published on the wire. */
  #started = false

  /** Capture caller configuration once; ordinary native hosts provide their original identity. */
  constructor(
    self: IRpcSelf | undefined,
    configured: boolean,
    dispatchWarning: (warning: IRpcWarning) => void
  ) {
    this.#configured = configured
    this.#dispatchWarning = dispatchWarning
    /** Default name matches its generated instance address, preserving direct host behavior. */
    const instanceId = self?.instanceId ?? defaultRpcId()
    this.#self = captureSelf(self ?? { name: instanceId, instanceId })
    this.#generation = Object.freeze({
      kind: 'session',
      value: 0,
      providerId: this.#self.instanceId
    })
  }

  /** Global public metadata remains immutable and never includes native launch credentials. */
  get self(): IRpcSelf {
    return this.#self
  }

  /** Directories and outgoing task tuples borrow the exact admitted generation fact. */
  get directorySelf(): IRpcDirectory['self'] {
    return { ...this.#self, generation: this.#generation }
  }

  /** Reconcile trusted bootstrap facts before constructing this source's first handshake. */
  admit(facts: IRpcLocalSourceFacts): void {
    if (facts.self !== undefined) {
      /** Capture before mutation so a mismatching source cannot partially replace global identity. */
      const incoming = captureSelf({
        ...facts.self,
        name: facts.self.name ?? (this.#configured ? this.#self.name : facts.self.instanceId)
      })
      if (
        this.#started &&
        (incoming.name !== this.#self.name || incoming.instanceId !== this.#self.instanceId)
      )
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
      if (!this.#started) {
        /** Capture only explicit child values that this parent actually replaces. */
        const nameIgnored =
          this.#configured && facts.self.name !== undefined && incoming.name !== this.#self.name
        /** An instance-only override must remain visible even when both display names agree. */
        const instanceIgnored = this.#configured && incoming.instanceId !== this.#self.instanceId
        /** Absent fields mean that identity component was retained, rather than ignored. */
        const data = Object.freeze({
          ...(nameIgnored ? { parentName: incoming.name, ignoredName: this.#self.name } : {}),
          ...(instanceIgnored
            ? {
                parentInstanceId: incoming.instanceId,
                ignoredInstanceId: this.#self.instanceId
              }
            : {})
        })
        this.#self = incoming
        this.#generation = Object.freeze({ ...this.#generation, providerId: incoming.instanceId })
        if (nameIgnored || instanceIgnored)
          this.#dispatchWarning(
            Object.freeze({
              code: RpcWarningCode.selfIgnored,
              message: HostWarningText.selfIgnored(data),
              data
            })
          )
      }
    }
    if (facts.generation !== undefined) {
      if (this.#started && !sameGeneration(facts.generation, this.#generation))
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
      this.#generation = Object.freeze({ ...facts.generation })
    }
    this.#started = true
  }
}
