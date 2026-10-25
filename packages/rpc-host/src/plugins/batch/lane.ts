/**
 * Owns one physical source's FIFO ready-frame queue and each member's independent settlement.
 * Actual downstream write completion releases backpressure; cancellation and source retirement
 * remove exact members/listeners without adding a semantic execution queue.
 */
import { RpcCarrierFrameKind as K } from '@migaia/rpc-contract/protocol'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { createRpcAbortError } from '../../host/error-owner.js'
import {
  RpcBatchExtension,
  RpcBatchAdmissionChanged,
  RPC_BATCH_FIXED_BYTES,
  RPC_BATCH_MAX_BYTES,
  RPC_BATCH_STRING_BYTE_BOUND
} from './constants.js'
import type { IRpcBatchInput, IRpcBatchEntry } from './types.js'

/** Reuse the original busy-writer Set queue with independent logical member settlements. */
export class RpcBatchLane {
  /** Only real native backpressure creates queued members; idle sends remain immediate. */
  #writing = false
  /** Insertion order preserves FIFO while cancellation removes one member in constant time. */
  readonly #queued = new Set<IRpcBatchEntry>()
  /** Actual writes retain their logical settlements until physical drain or source retirement. */
  readonly #active = new Set<IRpcBatchEntry>()
  /** Physical connection shutdown, rather than a first member's caller signal, retires this lane. */
  readonly #signal: IAbortSignal
  /** Removing an idle/retired lane also releases its one physical abort listener. */
  readonly #release: () => void
  /** The first retirement reason rejects every remaining member without starting another write. */
  #closed = false
  /** The original physical/setup close reason survives late downstream admission callbacks. */
  #reason: unknown

  /** Capture only one physical-source lifecycle and one exact owner-index remover. */
  constructor(signal: IAbortSignal, release: () => void) {
    this.#signal = signal
    this.#release = release
    signal.addEventListener('abort', this.#abort, { once: true })
  }

  /** Attach cancellation once, then borrow the actual existing writer or start an idle singleton. */
  send(input: IRpcBatchInput): Promise<void> {
    if (this.#closed || this.#signal.aborted) {
      this.close(this.#reason ?? this.#signal.reason)
      return Promise.reject(this.#reason)
    }
    /** This original logical Promise settles only on its own physical write result. */
    const completion = deferred<void>()
    /** Only original write options can carry caller transfer and started authority. */
    const write = input.payload.write
    /** Explicit false means only the held physical lifecycle can cancel this write. */
    const signal =
      write?.signal === false ? this.#signal : (write?.signal ?? input.payload.context.signal)
    /** Snapshot final codec shape only; neither semantic ids nor business payloads are inspected. */
    const entry: IRpcBatchEntry = {
      payload: input.payload,
      next: input.next,
      write,
      signal,
      bound:
        input.payload.frame.kind === K.message &&
        typeof input.payload.frame.data === 'string' &&
        !input.payload.frame.sidecars?.length &&
        !write?.transfer?.length
          ? RPC_BATCH_FIXED_BYTES + input.payload.frame.data.length * RPC_BATCH_STRING_BYTE_BOUND
          : Infinity,
      cancelled: false,
      failed: false,
      failure: undefined,
      started: false,
      remove: () => undefined,
      resolve: completion.resolve,
      reject: completion.reject
    }
    /** Native admission can withdraw the same queued member before physical process writing. */
    const releaseAdmission = write?.admission?.guard?.((reason) => {
      if (this.#withdraw(entry)) entry.reject(reason)
    })
    /** CallRecord already owns CANCELLED; this member's stage ends without rejecting its siblings. */
    const abort = (): void => {
      if (this.#withdraw(entry)) entry.resolve()
    }
    entry.remove = () => {
      signal.removeEventListener('abort', abort)
      releaseAdmission?.()
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    if (!entry.cancelled) {
      if (this.#writing) this.#queued.add(entry)
      else {
        this.#writing = true
        void this.#drain([entry])
      }
    } else if (!this.#writing) this.#releaseLane()
    return completion.promise
  }

  /** Remove only this unstarted member; its caller or native queue decides the settlement. */
  #withdraw(entry: IRpcBatchEntry): boolean {
    if (entry.started || entry.cancelled) return false
    entry.cancelled = true
    this.#queued.delete(entry)
    entry.remove()
    return true
  }

  /** One ready prefix is consumed once; opaque/transfer boundaries remain independent singletons. */
  #take(): IRpcBatchEntry[] {
    /** Only the current physical group is allocated; no growing suffix is copied. */
    const entries: IRpcBatchEntry[] = []
    /** Fixed wrapper geometry plus per-member bounds never undercount physical JSON bytes. */
    let bytes = RPC_BATCH_FIXED_BYTES
    for (const entry of this.#queued) {
      if (entries.length && bytes + entry.bound > RPC_BATCH_MAX_BYTES) break
      this.#queued.delete(entry)
      entries.push(entry)
      bytes += entry.bound
      if (!Number.isFinite(entry.bound)) break
    }
    return entries
  }

  /** Actual write completion releases busy ownership before any caller continuation can enqueue. */
  async #drain(entries: IRpcBatchEntry[]): Promise<void> {
    for (const entry of entries) this.#active.add(entry)
    try {
      if (entries.length === 1) await this.#single(entries[0]!)
      else await this.#group(entries)
    } finally {
      for (const entry of entries) {
        entry.remove()
        this.#active.delete(entry)
      }
      if (!this.#closed && this.#queued.size) void this.#drain(this.#take())
      else {
        this.#writing = false
        this.#releaseLane()
      }
      for (const entry of entries) {
        if (entry.cancelled) continue
        if (entry.failed) entry.reject(entry.failure)
        else entry.resolve()
      }
    }
  }

  /** An original boundary frame keeps its exact transfer facts and original continuation. */
  async #single(entry: IRpcBatchEntry): Promise<void> {
    if (entry.cancelled || this.#closed) return
    try {
      await entry.next({
        ...entry.payload,
        write: { ...entry.write, onWriteStart: () => this.#start([entry]) }
      })
    } catch (error) {
      entry.failed = true
      entry.failure = error
    }
  }

  /** Recheck every member before invoking any original started callback at physical handoff. */
  #start(entries: readonly IRpcBatchEntry[]): void {
    if (this.#closed) throw this.#reason
    if (entries.some((entry) => entry.cancelled || entry.signal.aborted)) {
      if (entries.length > 1) throw RpcBatchAdmissionChanged
      throw createRpcAbortError(undefined, undefined, entries[0]!.signal.reason)
    }
    for (const entry of entries) {
      if (entry.started) continue
      entry.started = true
      entry.remove()
      entry.write?.onWriteStart?.()
    }
  }

  /** One aggregate failure retains the original native identity for every logical member. */
  async #group(entries: IRpcBatchEntry[]): Promise<void> {
    /** Admission reads are linear once; queued cancellation has already removed other members. */
    const survivors = entries.filter((entry) => !entry.cancelled)
    if (survivors.length < 2) {
      for (const entry of survivors) await this.#single(entry)
      return
    }
    try {
      await survivors[0]!.next({
        ...survivors[0]!.payload,
        context: {
          ...survivors[0]!.payload.context,
          signal:
            survivors[0]!.payload.context.connectionSignal ?? survivors[0]!.payload.context.signal
        },
        frame: {
          kind: K.extension,
          extension: RpcBatchExtension,
          data: { frames: survivors.map((entry) => entry.payload.frame) }
        },
        write: {
          admission: survivors[0]!.write?.admission,
          signal: false,
          onWriteStart: () => this.#start(survivors)
        }
      })
    } catch (error) {
      if (error === RpcBatchAdmissionChanged) {
        /** One bounded fallback handles cancellation during downstream async hooks, without retry. */
        for (const entry of survivors) await this.#single(entry)
      } else
        for (const entry of survivors) {
          entry.failed = true
          entry.failure = error
        }
    }
  }

  /** Physical retirement settles queued and in-flight members through the same first reason. */
  readonly #abort = (): void => this.close(this.#signal.reason)

  /** Native rollback/final close drops all callbacks and releases each logical member once. */
  close(reason: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#reason = reason
    for (const entry of [...this.#queued, ...this.#active]) {
      entry.cancelled = true
      entry.remove()
      entry.reject(reason)
    }
    this.#queued.clear()
    this.#active.clear()
    this.#releaseLane()
  }

  /** No idle lane retains its physical source signal or owner-map entry. */
  #releaseLane(): void {
    this.#signal.removeEventListener('abort', this.#abort)
    this.#release()
  }
}
