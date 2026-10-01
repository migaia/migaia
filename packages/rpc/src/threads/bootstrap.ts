import { ThreadBootstrap, ThreadEvent } from './constants.js'
import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import type { IThreadWebPort } from './types.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'

/** Private addressing is separate from portable business data and carries no RPC handshake. */
export type IThreadBootstrapData = Readonly<{ peerId: string; data?: IRpcPortableValue }>

/** Read Node workerData or Web bootstrap without leaking its wrapper into business configuration. */
export function readThreadBootstrap(value: unknown): IThreadBootstrapData {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== ThreadBootstrap.data ||
    !('peerId' in value) ||
    typeof value.peerId !== 'string' ||
    value.peerId.length === 0
  )
    return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
  return Object.freeze({
    peerId: value.peerId,
    ...('data' in value && value.data !== undefined ? { data: normalizePortable(value.data) } : {})
  })
}

/** Consume data and address, remove the listener, prepare the service, then acknowledge readiness. */
export function receiveThreadData(
  port: IThreadWebPort,
  prepare: (data: IRpcPortableValue | undefined, peerId: string) => PromiseLike<void> | void
): Promise<IRpcPortableValue | undefined> {
  return new Promise((resolve, reject) => {
    /** This listener owns only the first private bootstrap message. */
    const receive = (event: { data: unknown }): void => {
      if (
        event.data === null ||
        typeof event.data !== 'object' ||
        !('kind' in event.data) ||
        event.data.kind !== ThreadBootstrap.data
      )
        return
      port.removeEventListener(ThreadEvent.message, receive)
      void (async () => {
        /** A fresh snapshot keeps private business data under the public portable contract. */
        const bootstrap = readThreadBootstrap(event.data)
        await prepare(bootstrap.data, bootstrap.peerId)
        port.postMessage({ kind: ThreadBootstrap.acknowledged }, undefined)
        resolve(bootstrap.data)
      })().catch(reject)
    }
    port.addEventListener(ThreadEvent.message, receive)
  })
}
