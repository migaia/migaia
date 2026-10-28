/**
 * Defines client-slot statistics, pool lifecycle controls and caller-selected scheduling options.
 * These snapshots describe pool admission rather than provider concurrency.
 */
import type { IScheduler } from '@migaia/utils/scheduler'
import type { RpcPoolState } from './text.ts'

/** This snapshot measures pool client slots and FIFO entries, never provider concurrency. */
export type IRpcPoolStats = Readonly<{
  /** Requested capacity, retained after idle retirement and changed only by resize. */
  targetSize: number
  /** Acquired Peers still held, including retiring/closing members until their cleanup settles. */
  memberCount: number
  /**
   * Occupied ready-member slots; cold acquisitions not yet ready are not remote/provider
   * concurrency.
   */
  inFlight: number
  /** Accepted FIFO entries without an assigned member; assigned cold acquisitions are excluded. */
  queued: number
  /** Pool admission/drain phase, independent of native generation or supervision state. */
  state: RpcPoolState
}>

/** Pool controls own only the private sessions opened by their corresponding installation. */
export type IRpcPoolControls = Readonly<{
  /**
   * Returns a new frozen instantaneous snapshot; reading it neither subscribes nor changes
   * capacity.
   */
  stats(): IRpcPoolStats
  /**
   * Queues a positive-integer target change in call order. Shrink prefers idle members and waits
   * for occupied retirees without interrupting their calls; expansion acquires only the missing
   * members. Factory/cleanup failures reject, and failed expansion restores the old target while
   * still open. Closing pools reject resize with POOL_CLOSED.
   */
  resize(size: number): Promise<void>
  /**
   * Synchronously enters closing, rejects new admission and drains already accepted operations and
   * acquisitions before closing owned Peers. Streams must finish/return/throw or settle their
   * cancellation; no pool drain timeout is added. Repeated calls share one Promise. All member
   * closes are attempted; failures from this closing phase reject as CLOSE_FAILED AggregateError
   * with original errors and the first failure on cause, even though state has become closed.
   * Completed open-phase resize/idle failures have already been delivered and are not replayed.
   */
  close(): Promise<void>
}>

/** Scheduling limits are admitted before the Host opens any private member. */
export type IPoolPluginOptions = Readonly<{
  /** Required positive integer target; initial creation waits for this many independent Peers. */
  size: number
  /** Maximum waiting FIFO length, default 256; nonnegative integer, with 0 allowing no queue. */
  maxQueue?: number
  /**
   * Optional idle retirement delay; omitted disables it. Must be finite, positive and at most
   * 2147483647 ms, including fractional values. Target size remains unchanged after retirement;
   * later demand refills missing members through the original public factory.
   */
  idleTimeoutMs?: number
  /**
   * Owns idle timers only, default systemScheduler. Admitted once before Peer acquisition; timers
   * cancel on reserve/retire/close and request optional unref. Peer restart/deadline clocks retain
   * their source policy, and timer unref is a liveness hint rather than an earlier deadline.
   */
  scheduler?: IScheduler
}>
