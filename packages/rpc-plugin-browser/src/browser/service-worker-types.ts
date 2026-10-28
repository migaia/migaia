/** Defines native ServiceWorker Client events, scope lookup and cold page or worker options. */
import type { IBrowserPluginOptions } from './plugin-types.ts'
import type {
  IServiceWorkerMessageReceiver,
  IServiceWorkerMessageTarget
} from './adapters/service-worker.ts'

/** Native worker events identify the actual page Client and may extend their preparation lifetime. */
export type IServiceWorkerClientEvent = MessageEvent<unknown> &
  Readonly<{ waitUntil?(opening: Promise<unknown>): void }>

/** Worker-side native scope borrows Clients resolution and one message event subscription. */
export type IServiceWorkerClientsScope = Readonly<{
  clients: Readonly<{
    get(id: string): PromiseLike<IServiceWorkerMessageTarget | undefined>
  }>
  addEventListener(type: 'message', listener: (event: IServiceWorkerClientEvent) => void): void
  removeEventListener(type: 'message', listener: (event: IServiceWorkerClientEvent) => void): void
}>

/** A page sends to one active worker while receiving through its separate native container. */
export type IServiceWorkerPluginOptions = IBrowserPluginOptions &
  (
    | Readonly<{
        serviceWorker: IServiceWorkerMessageTarget
        receiver?: IServiceWorkerMessageReceiver
        clients?: never
      }>
    | Readonly<{
        clients: IServiceWorkerClientsScope
        serviceWorker?: never
        receiver?: never
      }>
  )
