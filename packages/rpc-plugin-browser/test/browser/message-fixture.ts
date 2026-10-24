import type { IRtcDataChannelPluginOptions } from '@migaia/rpc-plugin-browser'

/** EventTarget doubles carry browser message metadata without implementing any RPC protocol. */
type IFixtureListener = (event: MessageEvent<unknown>) => void

/** A held browser resource exposes listener and close effects to ownership assertions. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function messageTargetFixtureState(bufferMessages = false) {
  const listeners = new Map<string, Set<IFixtureListener>>()
  const sent: unknown[] = []
  const queued: MessageEvent<unknown>[] = []
  let deliver = true
  let closeCalls = 0
  let send: (message: unknown, origin?: string) => void = () => undefined
  return { bufferMessages, listeners, sent, queued, deliver, closeCalls, send }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class MessageTargetFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof messageTargetFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor(bufferMessages = false) {
    this.#state = messageTargetFixtureState(bufferMessages)
    const target = {
      postMessage: (message: unknown, originOrTransfer?: string | readonly Transferable[]) => {
        this.#state.sent.push(message)
        if (this.#state.deliver) {
          ;(0, this.#state.send)(
            message,
            typeof originOrTransfer === 'string' ? originOrTransfer : undefined
          )
        }
      },
      start: () => {},
      close: () => {
        this.#state.closeCalls += 1
        this.#state.deliver = false
      },
      addEventListener: (type: string, listener: IFixtureListener) => {
        /** The native event kind selects the existing subscription collection. */
        const entries = this.#state.listeners.get(type) ?? new Set<IFixtureListener>()
        entries.add(listener)
        this.#state.listeners.set(type, entries)
        if (type === 'message' && this.#state.queued.length)
          queueMicrotask(() => {
            for (const event of this.#state.queued.splice(0))
              for (const receiving of this.#state.listeners.get('message') ?? []) receiving(event)
          })
      },
      removeEventListener: (type: string, listener: IFixtureListener) => {
        this.#state.listeners.get(type)?.delete(listener)
      }
    }
    this.value = {
      target,
      sent: this.#state.sent,
      listeners: this.#state.listeners,
      closeCalls: 0,
      setDeliver: (enabled: boolean) => {
        this.#state.deliver = enabled
      },
      setSend: (delivery: (message: unknown, origin?: string) => void) => {
        this.#state.send = delivery
      },
      emit: (type: string, data: unknown, source?: unknown, origin = '') => {
        /** Carrier doubles copy native metadata without reading or rewriting wire frames. */
        const event = { data, source, origin } as MessageEvent<unknown>
        if (
          type === 'message' &&
          this.#state.bufferMessages &&
          !this.#state.listeners.get(type)?.size
        ) {
          this.#state.queued.push(event)
          return
        }
        for (const listener of this.#state.listeners.get(type) ?? []) listener(event)
      },
      connect: (port: unknown) => {
        for (const listener of this.#state.listeners.get('connect') ?? [])
          listener({ ports: [port] } as unknown as MessageEvent<unknown>)
      }
    }

    Object.defineProperties(this.value, {
      closeCalls: {
        get: () => {
          return this.#state.closeCalls
        }
      }
    })
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
export function messageTarget(bufferMessages = false) {
  return new MessageTargetFixture(bufferMessages).value
}

/** Two fake realms preserve postMessage source and origin semantics through actual Core frames. */
export function windowPair() {
  /** The parent resource owns its inbound subscription and outbound native Window identity. */
  const left = messageTarget()
  /** The child resource remains distinct even when its messages contain copied wire identities. */
  const right = messageTarget()
  left.setSend((message, origin) => {
    if (origin !== 'https://left.test' && origin !== '*') return
    queueMicrotask(() =>
      left.emit('message', structuredClone(message), right.target, 'https://right.test')
    )
  })
  right.setSend((message, origin) => {
    if (origin !== 'https://right.test' && origin !== '*') return
    queueMicrotask(() =>
      right.emit('message', structuredClone(message), left.target, 'https://left.test')
    )
  })
  return { left, right }
}

/** Paired MessagePorts exercise reliable ordered delivery while caller retains physical ownership. */
export function portPair() {
  /** Each port has its own listener registration and physical-close count. */
  const left = messageTarget(true)
  /** The worker-side port has no Window source or origin authority. */
  const right = messageTarget(true)
  left.setSend((message) => queueMicrotask(() => right.emit('message', structuredClone(message))))
  right.setSend((message) => queueMicrotask(() => left.emit('message', structuredClone(message))))
  return { left, right }
}

/** RTC's native string carrier forwards EventTarget data without implementing an RPC protocol. */
export function rtcChannel(
  port: ReturnType<typeof messageTarget>
): IRtcDataChannelPluginOptions['rtcDataChannel'] {
  return {
    ordered: true,
    maxRetransmits: null,
    maxPacketLifeTime: null,
    readyState: 'open',
    send: (data) => port.target.postMessage(data),
    addEventListener: (type, listener) => port.target.addEventListener(type, listener),
    removeEventListener: (type, listener) => port.target.removeEventListener(type, listener)
  }
}
