import { MessageChannel } from 'node:worker_threads'
import type { IServiceWorkerClientsScope } from '../../../src/browser/service-worker-types.js'
import type {
  IServiceWorkerMessageReceiver,
  IServiceWorkerMessageTarget
} from '../../../src/browser/adapters/service-worker.js'

/** Own one page's physical pipe, delivery holds and native container subscriptions. */
class ServiceWorkerPageFixture {
  /** The worker realm alone owns Clients identity and worker-side dispatch. */
  #realm: ServiceWorkerRealmFixture
  /** Both physical ports stay fixture-owned after logical Host disposal. */
  #channel = new MessageChannel()
  /** Only the native page container owns incoming callbacks. */
  #listeners = new Set<(event: MessageEvent<unknown>) => void>()
  /** Count physical receipt independently of logical subscriptions and delivery holds. */
  #physicalReceipts = 0
  /** Fixture-only holds suppress delivery without manufacturing lifecycle events. */
  #holdOutgoing = false
  /** Inbound holds retain physical payloads for explicit ordered replay. */
  #holdIncoming = false
  /** Held native outbound frames remain available to wrong-source assertions. */
  readonly outgoing: unknown[] = []
  /** Held native inbound frames retain their original payload identities. */
  readonly incoming: unknown[] = []
  /** The outbound target represents registration.active for this generation. */
  readonly serviceWorker: IServiceWorkerMessageTarget
  /** Native event.source supplies the exact Client and reply target. */
  readonly client: IServiceWorkerMessageTarget
  /** Container subscriptions are distinct from outbound ServiceWorker operations. */
  readonly receiver: IServiceWorkerMessageReceiver
  /** Acquire the real pipe and attach its two native message observers once. */
  constructor(realm: ServiceWorkerRealmFixture, id: string) {
    this.#realm = realm
    this.serviceWorker = {
      postMessage: (data, transfer) => this.#channel.port1.postMessage(data, transfer as never)
    }
    this.client = {
      id,
      postMessage: (data, transfer) => this.#channel.port2.postMessage(data, transfer as never)
    }
    realm.register(id, this.client, this.#channel)
    this.#channel.port2.on('message', (data) => {
      this.#physicalReceipts += 1
      if (this.#holdOutgoing) this.outgoing.push(data)
      else this.#realm.dispatch(data, this.client)
    })
    this.#channel.port1.on('message', (data) => {
      if (this.#holdIncoming) this.incoming.push(data)
      else this.deliver(data)
    })
    this.receiver = {
      addEventListener: (_type, listener) => this.#listeners.add(listener),
      removeEventListener: (_type, listener) => this.#listeners.delete(listener)
    }
  }
  /** Snapshot native receivers so handoff cannot deliver one physical event twice. */
  deliver = (data: unknown, source: unknown = this.serviceWorker): void => {
    /** New subscriptions wait for the next native event. */
    const listeners = [...this.#listeners]
    for (const listener of listeners)
      listener({ data, source, origin: '' } as MessageEvent<unknown>)
  }
  /** Observe native subscriptions without inferring Host state. */
  listeners = (): number => this.#listeners.size
  /** Observe actual physical receipt even while delivery is held. */
  physicalReceipts = (): number => this.#physicalReceipts
  /** Hold worker-directed physical receipts for explicit replay. */
  holdToWorker = (): void => {
    this.#holdOutgoing = true
  }
  /** Hold page-directed physical receipts for explicit replay. */
  holdToPage = (): void => {
    this.#holdIncoming = true
  }
  /** Release already-held outbound frames in original arrival order. */
  releaseToWorker = (): void => {
    this.#holdOutgoing = false
    for (const data of this.outgoing.splice(0)) this.#realm.dispatch(data, this.client)
  }
  /** Release already-held inbound frames in original arrival order. */
  releaseToPage = (): void => {
    this.#holdIncoming = false
    for (const data of this.incoming.splice(0)) this.deliver(data)
  }
}

/** Own one native-shaped worker realm without mutable factory captures across pages. */
class ServiceWorkerRealmFixture {
  /** The worker scope owns all native page-message subscriptions. */
  #listeners = new Set<(event: MessageEvent<unknown>) => void>()
  /** Native Clients.get resolves reply targets independently of wire claims. */
  #clients = new Map<string, IServiceWorkerMessageTarget>()
  /** Test cleanup owns every physical pipe after borrowed Host subscriptions retire. */
  #channels: MessageChannel[] = []
  /** Silent loss suppresses physical delivery without inventing a worker close event. */
  #silent = false
  /** WaitUntil observes each native consumer's exact preparation Promise. */
  readonly lifetimes: Promise<unknown>[] = []
  /** Borrowed scope separates Client lookup and native event subscription from outbound targets. */
  readonly scope: IServiceWorkerClientsScope = {
    clients: { get: async (id) => this.#clients.get(id) },
    addEventListener: (_type, listener) => this.#listeners.add(listener),
    removeEventListener: (_type, listener) => this.#listeners.delete(listener)
  }
  /** Register the actual Client and fixture-owned physical pipe for one page. */
  register(id: string, client: IServiceWorkerMessageTarget, channel: MessageChannel): void {
    this.#channels.push(channel)
    this.#clients.set(id, client)
  }
  /** Deliver native source metadata; payload identity never selects a different Client. */
  dispatch = (data: unknown, source: unknown): void => {
    if (this.#silent) return
    /** Native ExtendableMessageEvent retains the original preparation completion. */
    const event = {
      data,
      source,
      origin: '',
      waitUntil: (opening: Promise<unknown>) => {
        this.lifetimes.push(opening)
      }
    } as unknown as MessageEvent<unknown>
    /** Native dispatch does not visit callbacks registered during the current handoff. */
    const listeners = [...this.#listeners]
    for (const listener of listeners) listener(event)
  }
  /** Observe the actual worker subscription count. */
  listeners = (): number => this.#listeners.size
  /** Model silent delivery loss while retaining both native ports. */
  silence = (): void => {
    this.#silent = true
  }
  /** Acquire a distinct page container, worker target and native Client identity. */
  page = (id: string): ServiceWorkerPageFixture => new ServiceWorkerPageFixture(this, id)
  /** Close fixture-owned pipes after logical owners release their borrowed subscriptions. */
  close = (): void => {
    for (const channel of this.#channels) {
      channel.port1.close()
      channel.port2.close()
    }
  }
}

/** Create an independent native-shaped worker realm backed by real MessageChannels. */
export function serviceWorkerRealm(): ServiceWorkerRealmFixture {
  return new ServiceWorkerRealmFixture()
}
