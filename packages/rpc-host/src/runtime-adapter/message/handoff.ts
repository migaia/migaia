import { hostRethrowReporter } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/errors.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { MessageResourceEvent } from './constants.js'
import type { INodeMessagePortLike } from '../../core/adapters/message-port.js'
import type { IAdapterEventTargetMessagePort } from './types.js'
import { collectListenerCleanupFailures } from '../../core/internal/listener-safety.js'

/** Platform adapters transfer native callbacks; only startup capture interprets message shape. */
export type IMessageReceiveHandoff<T> = Readonly<{
  subscribe(listener: (message: T) => void): void
  unsubscribe(listener: (message: T) => void): void
  activateReceive(): void
  fail(cause?: unknown): void
  close(): void
}>

/** Retain at most one application frame, then install the original native receiver directly. */
export function createMessageReceiveHandoff<T>(
  native: Readonly<{
    add(listener: (message: T) => void): void
    remove(listener: (message: T) => void): void
    observeFailure(listener: (cause?: unknown) => void): () => void
  }>,
  options: Readonly<{
    consume?: (message: T) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
): IMessageReceiveHandoff<T> {
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
      new TypeError(rpcMessageCapabilityControl.failureText, { cause }),
      RpcCoreErrorCode.invalidConfig
    )
    /** Native release failures must remain reachable without stranding the original startup. */
    const cleanupErrors = collectListenerCleanupFailures([
      removeFailure,
      () => native.remove(capture)
    ])
    failure = attachSecondaryErrors(failure, cleanupErrors) as Error
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

/** EventEmitter's original message callback is transferred directly after cold bootstrap. */
export function createEventEmitterMessageHandoff(
  native: INodeMessagePortLike,
  options: Readonly<{
    consume?: (message: unknown) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
) {
  /** Only cold capture owns the startup failure hooks. */
  const handoff = createMessageReceiveHandoff<unknown>(
    {
      add: (listener) => {
        native.on(MessageResourceEvent.message, listener)
      },
      remove: (listener) => {
        native.off(MessageResourceEvent.message, listener)
      },
      observeFailure(listener) {
        native.on(MessageResourceEvent.messageerror, listener)
        native.on(MessageResourceEvent.close, listener)
        return () => {
          native.off(MessageResourceEvent.messageerror, listener)
          native.off(MessageResourceEvent.close, listener)
        }
      }
    },
    options
  )
  /** This wrapper changes subscription assembly only; native provenance remains separate. */
  const port: INodeMessagePortLike = {
    postMessage: (message, transfer) => native.postMessage(message, transfer),
    on: (event, listener) => {
      if (event === MessageResourceEvent.message) handoff.subscribe(listener)
      else native.on(event, listener)
    },
    off: (event, listener) => {
      if (event === MessageResourceEvent.message) handoff.unsubscribe(listener)
      else native.off(event, listener)
    }
  }
  return Object.freeze({ ...handoff, port })
}

/** EventTarget hands off the original event callback, retaining the same bounded cold owner. */
export function createEventTargetMessageHandoff(
  native: IAdapterEventTargetMessagePort,
  options: Readonly<{
    consume?: (message: unknown) => boolean
    onFailure?: (error: unknown) => void
  }> = {}
) {
  /** A held EventTarget retains its original event shape at the physical messaging boundary. */
  const handoff = createMessageReceiveHandoff<{ data: unknown }>(
    {
      add: (listener) => native.addEventListener(MessageResourceEvent.message, listener),
      remove: (listener) => native.removeEventListener(MessageResourceEvent.message, listener),
      observeFailure(listener) {
        /**
         * Generic raw failure events expose the original native cause separately from their
         * wrapper.
         */
        const failure = (event: unknown): void =>
          listener(
            event && typeof event === 'object' && 'error' in event ? (event.error ?? event) : event
          )
        native.addEventListener(MessageResourceEvent.messageerror, listener)
        native.addEventListener(MessageResourceEvent.error, failure)
        /** Carrier failures retain their original cause during the same cold capture operation. */
        const removeError = native.onError?.(listener)
        return () => {
          native.removeEventListener(MessageResourceEvent.messageerror, listener)
          native.removeEventListener(MessageResourceEvent.error, failure)
          removeError?.()
        }
      }
    },
    {
      consume: options.consume ? (event) => options.consume!(event.data) : undefined,
      onFailure: options.onFailure
    }
  )
  /** After activation, canonical callbacks are installed directly on the original EventTarget. */
  const port: IAdapterEventTargetMessagePort = {
    postMessage: (message, transfer) => native.postMessage(message, transfer),
    ...(native.onError
      ? { onError: (listener: (error: unknown) => void) => native.onError!(listener) }
      : {}),
    addEventListener: (event, listener) => {
      if (event === MessageResourceEvent.message) handoff.subscribe(listener)
      else native.addEventListener(event, listener)
    },
    removeEventListener: (event, listener) => {
      if (event === MessageResourceEvent.message) handoff.unsubscribe(listener)
      else native.removeEventListener(event, listener)
    }
  }
  return Object.freeze({ ...handoff, port })
}
