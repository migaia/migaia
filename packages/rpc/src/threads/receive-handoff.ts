import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcCoreErrorCode } from '../core/index.js'
import { tagRpcError } from '../core/transport-kit.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { ThreadErrorText } from './error-text.js'
import { ThreadEvent } from './constants.js'
import type { INodeMessagePortLike } from '../core/adapters/message-port.js'
import type { IThreadWebPort } from './types.js'

/** Platform adapters transfer native callbacks; only startup capture interprets message shape. */
export type IThreadReceiveHandoff<T> = Readonly<{
  subscribe(listener: (message: T) => void): void
  unsubscribe(listener: (message: T) => void): void
  activateReceive(): void
  fail(cause?: unknown): void
  close(): void
}>

/** Retain at most one application frame, then install the original native receiver directly. */
export function createThreadReceiveHandoff<T>(
  native: Readonly<{
    add(listener: (message: T) => void): void
    remove(listener: (message: T) => void): void
    observeFailure(listener: (cause?: unknown) => void): () => void
  }>,
  options: Readonly<{
    consume?: (message: T) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
): IThreadReceiveHandoff<T> {
  /** Occupancy distinguishes an actual undefined native message from an empty cold slot. */
  let occupied = false
  /** A single early frame is released on delivery, failure or rollback. */
  let queued: T | undefined
  /** Canonical message transport has one physical receiver, installed after endpoint commit. */
  let receiver: ((message: T) => void) | undefined
  /** Activation permanently removes the cold capture path. */
  let activated = false
  /** Close removes only this bootstrap owner's hooks and retained frame. */
  let closed = false
  /** An incomplete source retains its original failure through the eventual activation attempt. */
  let failure: Error | undefined
  /** Native failure registration may invoke synchronously, before returning its remover. */
  let removeFailure: () => void = () => undefined
  /** Startup failure uses the existing registered bootstrap error and keeps native causes reachable. */
  const fail = (cause?: unknown): void => {
    if (closed || activated || failure) return
    failure = tagRpcError(
      new TypeError(ThreadErrorText.bootstrapFailed, { cause }),
      RpcCoreErrorCode.invalidConfig
    )
    native.remove(capture)
    removeFailure()
    occupied = false
    queued = undefined
    try {
      options.onFailure?.(failure)
    } catch (reporterFailure) {
      hostRethrowReporter(reporterFailure, IpcReporterContext)
    }
  }
  /** Private bootstrap/ACK is consumed; ordinary traffic occupies the sole cold application slot. */
  const capture = (message: T): void => {
    if (failure || closed) return
    try {
      if (options.consume?.(message)) return
      if (occupied) return fail()
      occupied = true
      queued = message
    } catch (cause) {
      fail(cause)
    }
  }
  native.add(capture)
  removeFailure = native.observeFailure(fail)
  if (failure) removeFailure()
  return Object.freeze({
    subscribe(listener) {
      if (activated) native.add(listener)
      else receiver = listener
    },
    unsubscribe(listener) {
      if (activated) native.remove(listener)
      else if (receiver === listener) receiver = undefined
    },
    fail,
    activateReceive() {
      if (failure) throw failure
      if (activated || closed) return
      activated = true
      native.remove(capture)
      removeFailure()
      if (receiver) native.add(receiver)
      /** Clear before invoking the receiver so reentrant activation cannot deliver twice. */
      const buffered = queued
      /** Occupancy is retained only across this synchronous transfer. */
      const deliver = occupied
      occupied = false
      queued = undefined
      if (deliver && receiver) receiver(buffered as T)
    },
    close() {
      if (closed) return
      if (!activated) fail()
      closed = true
      native.remove(capture)
      removeFailure()
      occupied = false
      queued = undefined
      receiver = undefined
    }
  })
}

/** Node's original message callback is transferred directly after cold bootstrap. */
export function createNodeThreadBootstrapHandoff(
  native: INodeMessagePortLike,
  options: Readonly<{
    consume?: (message: unknown) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
) {
  /** Only cold capture owns the startup failure hooks. */
  const handoff = createThreadReceiveHandoff<unknown>(
    {
      add: (listener) => {
        native.on(ThreadEvent.message, listener)
      },
      remove: (listener) => {
        native.off(ThreadEvent.message, listener)
      },
      observeFailure(listener) {
        native.on(ThreadEvent.messageerror, listener)
        native.on(ThreadEvent.close, listener)
        return () => {
          native.off(ThreadEvent.messageerror, listener)
          native.off(ThreadEvent.close, listener)
        }
      }
    },
    options
  )
  /** This wrapper changes subscription assembly only; native provenance remains separate. */
  const port: INodeMessagePortLike = {
    postMessage: (message, transfer) => native.postMessage(message, transfer),
    on: (event, listener) => {
      if (event === ThreadEvent.message) handoff.subscribe(listener)
      else native.on(event, listener)
    },
    off: (event, listener) => {
      if (event === ThreadEvent.message) handoff.unsubscribe(listener)
      else native.off(event, listener)
    }
  }
  return Object.freeze({ ...handoff, port })
}

/** EventTarget hands off the original event callback, retaining the same bounded cold owner. */
export function createWebThreadBootstrapHandoff(
  native: IThreadWebPort,
  options: Readonly<{
    consume?: (message: unknown) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
) {
  /** A genuine Worker retains EventTarget event shape at its physical messaging boundary. */
  const handoff = createThreadReceiveHandoff<{ data: unknown }>(
    {
      add: (listener) => native.addEventListener(ThreadEvent.message, listener),
      remove: (listener) => native.removeEventListener(ThreadEvent.message, listener),
      observeFailure(listener) {
        native.addEventListener(ThreadEvent.messageerror, listener)
        return () => native.removeEventListener(ThreadEvent.messageerror, listener)
      }
    },
    {
      consume: options.consume ? (event) => options.consume!(event.data) : undefined,
      onFailure: options.onFailure
    }
  )
  /** After activation, canonical callbacks are installed directly on the original EventTarget. */
  const port: IThreadWebPort = {
    postMessage: (message, transfer) => native.postMessage(message, transfer),
    addEventListener: (event, listener) => {
      if (event === ThreadEvent.message) handoff.subscribe(listener)
      else native.addEventListener(event, listener)
    },
    removeEventListener: (event, listener) => {
      if (event === ThreadEvent.message) handoff.unsubscribe(listener)
      else native.removeEventListener(event, listener)
    }
  }
  return Object.freeze({ ...handoff, port })
}
