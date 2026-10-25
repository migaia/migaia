/** Observe only the real native feature authoring boundary; resources remain genuine. */
import type {
  IRpcNativeTransportFeature,
  IRpcNativeFeatureContext,
  IRpcNativePoolMember
} from '@migaia/rpc-host/sdk'

/** Cases observe acquisition/cleanup through existing concrete native member methods. */
export type INativeObservation = Readonly<{
  beforeOpen?(index: number): void | Promise<void>
  closeErrors?: readonly unknown[]
  opened?(index: number): void
  afterClose?(instanceId: string | undefined): Promise<void>
  closeOrder?: number[]
}>

/** One original native member retains its exact methods and one observed cleanup completion. */
class ObservedMember implements IRpcNativePoolMember {
  /** The genuine transport-produced resource owns all execution and supervision. */
  readonly #member: IRpcNativePoolMember
  /** This fixture only records close order and optionally fails after real cleanup. */
  readonly #observation: INativeObservation
  /** Original acquisition order determines fixture errors and observations. */
  readonly #index: number
  /** Repeated cleanup observes the same final original-resource completion. */
  #closing: Promise<void> | undefined
  /** Genuine public native fields remain borrowed identities. */
  readonly record
  /** Native generation policy is never replaced by the fixture. */
  readonly native
  /** Capture an already-acquired actual source without acquiring or replacing media. */
  constructor(member: IRpcNativePoolMember, index: number, observation: INativeObservation) {
    this.#member = member
    this.#index = index
    this.#observation = observation
    this.record = member.record
    this.native = member.native
  }
  /** Preserve the genuine native current handle. */
  current(): ReturnType<IRpcNativePoolMember['current']> {
    return this.#member.current()
  }
  /** Native readiness still uses the original generation's shared preparation. */
  ready(
    signal?: Parameters<IRpcNativePoolMember['ready']>[0]
  ): ReturnType<IRpcNativePoolMember['ready']> {
    return this.#member.ready(signal)
  }
  /** Observe final cleanup exactly once after native operations have actually run. */
  close(): Promise<void> {
    return (this.#closing ??= this.#release())
  }
  /** The original native failure stays primary; selected fixture errors occur only after cleanup. */
  async #release(): Promise<void> {
    this.#observation.closeOrder?.push(this.#index)
    const instanceId = this.#member.current()?.current()?.view.peerId
    await this.#member.close()
    await this.#observation.afterClose?.(instanceId)
    if (this.#observation.closeErrors?.[this.#index] !== undefined)
      throw this.#observation.closeErrors[this.#index]
  }
}

/** Per-installation counters never cross reusable cold feature instances or host lifetimes. */
class NativeObservation<E extends object> {
  /** The complete production feature still owns every scheduler and business operation. */
  readonly #feature: IRpcNativeTransportFeature<E>
  /** Only actual accepted native resources become visible here. */
  readonly #members: IRpcNativePoolMember[]
  /** Existing callback gates and teardown observations are case-owned inputs. */
  readonly #observation: INativeObservation
  /** Acquisition ordinal is local to one genuine installation. */
  #next = 0
  /** Save cold configuration without opening any source. */
  constructor(
    feature: IRpcNativeTransportFeature<E>,
    members: IRpcNativePoolMember[],
    observation: INativeObservation
  ) {
    this.#feature = feature
    this.#members = members
    this.#observation = observation
  }
  /** Only the native constructor callback is observed; no Peer or logical media is fabricated. */
  readonly install = (context: IRpcNativeFeatureContext) =>
    this.#feature.install({
      ...context,
      openMember:
        context.openMember === undefined
          ? undefined
          : async (privateContext, events) => {
              const index = this.#next++
              this.#observation.opened?.(index)
              await this.#observation.beforeOpen?.(index)
              const member = new ObservedMember(
                await context.openMember!(privateContext, events),
                index,
                this.#observation
              )
              this.#members.push(member)
              return member
            }
    })
}

/** A genuine feature remains complete while the fixture observes its original acquisition port. */
export function observingPool<E extends object>(
  feature: IRpcNativeTransportFeature<E>,
  members: IRpcNativePoolMember[],
  observation: INativeObservation = {}
): IRpcNativeTransportFeature<E> {
  return {
    kind: feature.kind,
    install: (context) => new NativeObservation(feature, members, observation).install(context)
  }
}
