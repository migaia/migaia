/**
 * Declares probe definition, compiled-handle and observation callback contracts. Canonical
 * event/descriptor data comes from rpc-contract; definitions and emitters own private records and
 * subscription lifetimes rather than these public declarations.
 */
import type {
  IRpcProbeStageName,
  RpcProbeStage,
  IRpcProbeEventView,
  IRpcProbeDescriptor
} from '@migaia/rpc-contract/interfaces'

/** Event and descriptor shapes belong to the same pure contract used by all actual producers. */
export type {
  IRpcProbeEventView,
  IRpcProbeObservation,
  IRpcProbeDescriptor
} from '@migaia/rpc-contract/interfaces'

/** Definition-time options compile once; capture is opt-in and initially a subset of stages. */
export type IRpcProbeDefinition = Readonly<{
  /**
   * Required nonempty initial list of peer/message/envelope/encoded/frame/protected/carrier/forward
   * stages.
   */
  stages: readonly IRpcProbeStageName[]
  /** Optional payload-capture stages; defaults to none and must be a subset of stages. */
  capture?: readonly IRpcProbeStageName[]
  /** Optional synchronous payload projection applied before captured content reaches emit. */
  redact?(stage: RpcProbeStage, content: unknown): unknown
  /** Filters method-bearing logical/envelope events; methodless variation controls remain visible. */
  methods?: readonly string[]
  /** Deterministic sampling fraction greater than zero and at most one; defaults to one. */
  sample?: number
  /** Optional synchronous cold callback receiving the actual endpoint capabilities. */
  describe?(descriptor: IRpcProbeDescriptor): void
  /** Synchronous observation callback; copy fields to retain a reused live view. */
  emit(view: IRpcProbeEventView): void
  /** Optional diagnostic callback for probe failures; business operations retain their own result. */
  onError?(error: unknown): void
}>

/**
 * Frozen public handle retains compiled filters while private stage updates can pause or resume it.
 * Standalone stageMask is a getter; a host's data field retains its initial compiled mask. Emitters
 * read private state once at installation and use their own fixed-shape records thereafter.
 */
export type IRpcProbe = Readonly<{
  /**
   * Current stage bits on a standalone handle; an attached host data field retains its initial
   * mask.
   */
  readonly stageMask: number
  /** Immutable payload-capture mask compiled at definition. */
  readonly captureMask: number
  /** Compiled logical method filter; undefined admits all method names. */
  readonly methods: ReadonlySet<string> | undefined
  /** 0xffffffff means all events; other values compare against the unsigned sample key. */
  readonly sampleThreshold: number
  /** An empty list pauses the probe; validation failures leave the previous mask unchanged. */
  setStages(stages: readonly IRpcProbeStageName[]): void
}>

/** Transport capability receives physical observations without owning the endpoint emitter. */
export type IRpcCarrierProbe = Readonly<{
  /** Whether the physical adapter should supply content for this installation. */
  readonly capturing: boolean
  /**
   * Emit one synchronous physical observation using the adapter's actual direction, size and
   * carrier facts.
   */
  emit(
    direction: number,
    sizeBytes: number,
    carrier: string,
    detail: Readonly<Record<string, string | number | boolean>> | undefined,
    content: unknown
  ): void
}>
