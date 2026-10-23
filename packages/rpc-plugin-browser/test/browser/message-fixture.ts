import type { IRtcDataChannelPluginOptions } from '@migaia/rpc-plugin-browser'

/** EventTarget doubles carry browser message metadata without implementing any RPC protocol. */
type IFixtureListener = (event: MessageEvent<unknown>) => void

/** A held browser resource exposes listener and close effects to ownership assertions. */
export function messageTarget(bufferMessages = false) {
  /** Each event kind has independent native-style subscriptions. */
  const listeners = new Map<string, Set<IFixtureListener>>()
  /** Outbound values expose the actual Core frames to source/origin rejection assertions. */
  const sent: unknown[] = []
  /** Native MessagePorts queue arrivals until the subscriber starts receiving. */
  const queued: MessageEvent<unknown>[] = []
  /** The caller controls whether the physical carrier delivers its queued messages. */
  let deliver = true
  /** Borrowed Peer cleanup must never invoke the resource owner's close operation. */
  let closeCalls = 0
  /** Paired resources wire only physical delivery, never handshake or runtime method dispatch. */
  let send: (message: unknown, origin?: string) => void = () => undefined
  /** Browser-shaped resource accepted by Window, MessagePort and listener source options. */
  const target = {
    postMessage(message: unknown, originOrTransfer?: string | readonly Transferable[]) {
      sent.push(message)
      if (deliver)
        send(message, typeof originOrTransfer === 'string' ? originOrTransfer : undefined)
    },
    start() {},
    close() {
      closeCalls += 1
      deliver = false
    },
    addEventListener(type: string, listener: IFixtureListener) {
      /** The native event kind selects the existing subscription collection. */
      const entries = listeners.get(type) ?? new Set<IFixtureListener>()
      entries.add(listener)
      listeners.set(type, entries)
      if (type === 'message' && queued.length)
        queueMicrotask(() => {
          for (const event of queued.splice(0))
            for (const receiving of listeners.get('message') ?? []) receiving(event)
        })
    },
    removeEventListener(type: string, listener: IFixtureListener) {
      listeners.get(type)?.delete(listener)
    }
  }
  return {
    target,
    sent,
    listeners,
    get closeCalls() {
      return closeCalls
    },
    setDeliver(enabled: boolean) {
      deliver = enabled
    },
    setSend(delivery: typeof send) {
      send = delivery
    },
    emit(type: string, data: unknown, source?: unknown, origin = '') {
      /** Carrier doubles copy native metadata without reading or rewriting wire frames. */
      const event = { data, source, origin } as MessageEvent<unknown>
      if (type === 'message' && bufferMessages && !listeners.get(type)?.size) {
        queued.push(event)
        return
      }
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    connect(port: unknown) {
      for (const listener of listeners.get('connect') ?? [])
        listener({ ports: [port] } as unknown as MessageEvent<unknown>)
    }
  }
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
