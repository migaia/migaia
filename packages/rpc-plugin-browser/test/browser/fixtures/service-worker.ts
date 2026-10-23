import { MessageChannel } from 'node:worker_threads'
import type { IServiceWorkerClientsScope } from '../../../src/browser/service-worker-types.js'
import type {
  IServiceWorkerMessageReceiver,
  IServiceWorkerMessageTarget
} from '../../../src/browser/adapters/service-worker.js'

/** Native-shaped receiver is distinct from every outbound target; MessagePorts remain internal. */
export function serviceWorkerRealm() {
  /** One actual worker scope dispatches native page messages to the installed carrier. */
  const workerListeners = new Set<(event: MessageEvent<unknown>) => void>()
  /** Native Clients.get, rather than a wire claim, resolves each currently addressable page. */
  const clients = new Map<string, IServiceWorkerMessageTarget>()
  /** Test cleanup owns these actual physical pipes; closing a Host must not close them. */
  const channels: MessageChannel[] = []
  /** WaitUntil observation proves preparation joins the original native event lifetime. */
  const lifetimes: Promise<unknown>[] = []
  /** Stopping native delivery models silent loss without inventing a worker-close event. */
  let silent = false
  /** Deliver only actual event metadata; source cannot be substituted by payload identity. */
  const dispatch = (data: unknown, source: unknown): void => {
    if (silent) return
    /** Native ExtendableMessageEvent keeps its asynchronous preparation alive. */
    const event = {
      data,
      source,
      origin: '',
      waitUntil: (opening: Promise<unknown>) => {
        lifetimes.push(opening)
      }
    } as unknown as MessageEvent<unknown>
    /** Native EventTarget does not visit listeners newly added during the same dispatch. */
    const listeners = [...workerListeners]
    for (const listener of listeners) listener(event)
  }
  /** This borrowed scope supplies the browser's actual native event and Clients operations. */
  const scope: IServiceWorkerClientsScope = {
    clients: { get: async (id) => clients.get(id) },
    addEventListener: (_type, listener) => workerListeners.add(listener),
    removeEventListener: (_type, listener) => workerListeners.delete(listener)
  }
  return {
    scope,
    lifetimes,
    dispatch,
    listeners: () => workerListeners.size,
    silence: () => {
      silent = true
    },
    /** Each page has separate Client, outbound worker target and inbound container identities. */
    page(id: string) {
      /** Real native structured cloning and asynchronous delivery are the physical test pipe. */
      const channel = new MessageChannel()
      channels.push(channel)
      /** Page container callbacks belong to the receiver, never to its outbound ServiceWorker. */
      const pageListeners = new Set<(event: MessageEvent<unknown>) => void>()
      /** Controlled holds expose genuine wire frames for wrong-source delivery assertions. */
      const outgoing: unknown[] = []
      const incoming: unknown[] = []
      /** Actual port receipt proves borrowed I/O remains live after logical Host disposal. */
      let physicalReceipts = 0
      /** Holds are fixture-only delivery control and do not manufacture native lifecycle events. */
      let holdOutgoing = false
      let holdIncoming = false
      /** One concrete target represents registration.active for this realm generation. */
      const serviceWorker: IServiceWorkerMessageTarget = {
        postMessage: (data, transfer) => channel.port1.postMessage(data, transfer as never)
      }
      /** Client identity and reply target come from the worker's native event.source. */
      const client: IServiceWorkerMessageTarget = {
        id,
        postMessage: (data, transfer) => channel.port2.postMessage(data, transfer as never)
      }
      clients.set(id, client)
      /** Container dispatch keeps the actual worker source separate from the sent frame. */
      const deliver = (data: unknown, source: unknown = serviceWorker): void => {
        /** Handoff may replace a listener; this physical event is delivered only once. */
        const listeners = [...pageListeners]
        for (const listener of listeners)
          listener({ data, source, origin: '' } as MessageEvent<unknown>)
      }
      channel.port2.on('message', (data) => {
        physicalReceipts += 1
        if (holdOutgoing) outgoing.push(data)
        else dispatch(data, client)
      })
      channel.port1.on('message', (data) => {
        if (holdIncoming) incoming.push(data)
        else deliver(data)
      })
      /** Only this container owns incoming subscriptions; target has no addEventListener. */
      const receiver: IServiceWorkerMessageReceiver = {
        addEventListener: (_type, listener) => pageListeners.add(listener),
        removeEventListener: (_type, listener) => pageListeners.delete(listener)
      }
      return {
        serviceWorker,
        receiver,
        client,
        outgoing,
        incoming,
        deliver,
        listeners: () => pageListeners.size,
        physicalReceipts: () => physicalReceipts,
        holdToWorker: () => {
          holdOutgoing = true
        },
        holdToPage: () => {
          holdIncoming = true
        },
        releaseToWorker: () => {
          holdOutgoing = false
          for (const data of outgoing.splice(0)) dispatch(data, client)
        },
        releaseToPage: () => {
          holdIncoming = false
          for (const data of incoming.splice(0)) deliver(data)
        }
      }
    },
    /** Test owner alone closes the internal pipes after all borrowed Host subscriptions retire. */
    close() {
      for (const channel of channels) {
        channel.port1.close()
        channel.port2.close()
      }
    }
  }
}
