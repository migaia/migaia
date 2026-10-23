import { createTrayError } from '../errors.js'
import { TrayErrorCode } from '../error-code.js'
import { toWire } from './portable.js'
import type { IAnyTrayHost, ITrayRemote, ITrayRoutedRemote, ITrayCallOptions } from './typing.js'
import type { IRuntimeCallOptions } from '@migaia/rpc-host/plugin'
/** Dispatcher payload omits absent data; application objects are validated unchanged. */
export type ITrayInvocation = Readonly<{ path: string; payload?: unknown }>
/** One callable remote forwards each operation through its admission-bound sender. */
export type ITraySender = Readonly<{
  request(
    payload: ITrayInvocation,
    options?: Pick<IRuntimeCallOptions, 'signal' | 'timeoutMs'>
  ): Promise<unknown>
  notify(
    payload: ITrayInvocation,
    options?: Pick<IRuntimeCallOptions, 'signal' | 'timeoutMs'>
  ): Promise<void>
  stream(
    payload: ITrayInvocation,
    options?: Pick<IRuntimeCallOptions, 'signal' | 'timeoutMs'>
  ): AsyncIterableIterator<unknown>
}>
/** Capture a record admission, never a native generation; RPC receipts own calls already sent. */
export function createRemote<H extends IAnyTrayHost>(
  id: string,
  send: ITraySender
): ITrayRemote<H> {
  return Object.freeze({ id, ...createCalls(send) }) as ITrayRemote<H>
}
/** Both remote forms reuse the same portable envelope and argument forwarding owner. */
export function createRoutedRemote<H extends IAnyTrayHost>(
  host: string,
  send: ITraySender
): ITrayRoutedRemote<H> {
  return Object.freeze({ host, ...createCalls(send) }) as ITrayRoutedRemote<H>
}
/** Only the envelope's absent payload is omitted; no application field is silently removed. */
function createCalls(send: ITraySender) {
  const invocation = (path: string, payload: unknown): ITrayInvocation => {
    if (typeof path !== 'string') throw createTrayError(TrayErrorCode.pathNotExposed)
    return { path, ...(payload === undefined ? {} : { payload: toWire(payload) }) }
  }
  return {
    request: (path: string, payload?: unknown, options?: ITrayCallOptions) =>
      send.request(invocation(path, payload), options),
    notify: (path: string, payload?: unknown, options?: ITrayCallOptions) =>
      send.notify(invocation(path, payload), options),
    stream: (path: string, payload?: unknown, options?: ITrayCallOptions) =>
      send.stream(invocation(path, payload), options)
  }
}
