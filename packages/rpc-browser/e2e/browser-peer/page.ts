import { createBrowserPeer } from '@migaia/rpc-browser'
import type { IBrowserFixtureApi } from './api.js'

/**
 * Errors retain their complete public classification when crossing the Playwright serialization
 * boundary.
 */
function classify(error: unknown) {
  /** Native errors carry Core's attached identity without replacing their constructor or message. */
  const failure = error as Error & { source?: string; code?: string; reason?: string }
  return {
    source: failure.source,
    code: failure.code,
    name: failure.name,
    reason: failure.reason,
    message: failure.message
  }
}

/**
 * Creates a real cross-origin child and waits only for native script readiness before Core
 * negotiation.
 */
async function framePeer() {
  /** The second Vite origin proves Window source proof without same-origin property access. */
  const origin = 'http://127.0.0.1:4179'
  /** The test owns iframe attachment and removal; the Peer borrows its WindowProxy. */
  const frame = document.createElement('iframe')
  frame.src = `${origin}/browser-peer/frame.html?parentOrigin=${encodeURIComponent(location.origin)}`
  /** The child's non-protocol bootstrap is observed before the Peer begins reading frames. */
  const loaded = new Promise<void>((resolve) => {
    /** Native readiness is accepted only from the exact iframe and expected origin. */
    const ready = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== origin ||
        (event.data as { browserPeerFixture?: string })?.browserPeerFixture !== 'loaded'
      )
        return
      window.removeEventListener('message', ready)
      resolve()
    }
    window.addEventListener('message', ready)
  })
  document.body.append(frame)
  await loaded
  /** Typed calls use the package root and existing adapter-owned Window checks. */
  const peer = await createBrowserPeer<IBrowserFixtureApi>({
    connect: { window: frame.contentWindow!, origin },
    defaultTimeoutMs: 1000
  })
  return { frame, peer }
}

globalThis.runBrowserPeerWindow = async (unload = false) => {
  /** Each scenario owns one actual iframe lifetime and one borrowed Runtime Peer. */
  const fixture = await framePeer()
  try {
    if (unload) {
      /** Removing a cross-origin iframe has no reliable immediate transport-close signal. */
      const pending = fixture.peer
        .request('hold', undefined, { timeoutMs: 80 })
        .then(() => ({ code: 'unexpected-resolution' }), classify)
      fixture.frame.remove()
      return await pending
    }
    /** This concrete result demonstrates remote API inference and actual scalar delivery. */
    const echo = await fixture.peer.request('echo', 'window-peer')
    await fixture.peer.notify('record', 'window-notify')
    /** Ordered reliable delivery ensures the following request observes the earlier notification. */
    const recorded = await fixture.peer.request('recorded')
    /** The actual remote generator yields through Core's stream owner. */
    const values: number[] = []
    for await (const value of fixture.peer.stream('values', 5)) values.push(value)
    /** Borrowed Window cleanup retains the original close operation and attached iframe. */
    const closing = fixture.peer.close()
    /**
     * Promise identity is returned as data because Playwright cannot compare remote Promise
     * objects.
     */
    const sameClose =
      fixture.peer.close() === closing && fixture.peer[Symbol.asyncDispose]() === closing
    await closing
    return { echo, recorded, values, sameClose, borrowedAttached: fixture.frame.isConnected }
  } finally {
    await fixture.peer.close()
    fixture.frame.remove()
  }
}

/** A page owns its SharedWorker object and port while its Peer borrows the connected port. */
let shared: SharedWorker | undefined
/** The original typed Peer remains the only application request/notify/stream surface. */
let sharedPeer: Awaited<ReturnType<typeof createBrowserPeer<IBrowserFixtureApi>>> | undefined
/** Instrument only the native close call to prove borrowed ownership after Peer cleanup. */
let portCloses = 0

globalThis.connectBrowserPeerShared = async () => {
  shared = new SharedWorker(new URL('./shared-server.ts', import.meta.url), {
    type: 'module',
    name: 'browser-peer-e2e'
  })
  /** Native MessagePort methods require their exact built-in receiver. */
  const nativeClose = shared.port.close
  /** The held port identity is fixed before later page cleanup changes the shared reference. */
  const port = shared.port
  port.close = () => {
    portCloses += 1
    Reflect.apply(nativeClose, port, [])
  }
  sharedPeer = await createBrowserPeer<IBrowserFixtureApi>({
    connect: { sharedWorker: shared },
    defaultTimeoutMs: 1000
  })
}

globalThis.runBrowserPeerShared = async (label: string) => {
  /** Each page's distinct payload proves responses remain on its accepted native port. */
  const echo = await sharedPeer!.request('echo', label)
  await sharedPeer!.notify('record', `notify-${label}`)
  /** Shared application state deliberately remains one service; port sessions remain independent. */
  const recorded = await sharedPeer!.request('recorded')
  /** Stream values retain each page's concrete requested input. */
  const values: number[] = []
  for await (const value of sharedPeer!.stream('values', label === 'A' ? 10 : 20))
    values.push(value)
  return { echo, recorded, values, sessions: await sharedPeer!.request('sessions') }
}

globalThis.closeBrowserPeerShared = async (physical = false) => {
  if (physical) {
    /** A physical page-port close leaves pending business work under its existing Core deadline. */
    const pending = sharedPeer!
      .request('hold', undefined, { timeoutMs: 80 })
      .then(() => ({ code: 'unexpected-resolution' }), classify)
    shared!.port.close()
    /** Peer close still retires its own subscriptions after the request has settled. */
    const result = await pending
    await sharedPeer!.close()
    return result
  }
  /** Repeated Peer cleanup is idempotent and cannot take ownership of the caller's native port. */
  const closing = sharedPeer!.close()
  /** Native port ownership is measured before the fixture performs its own physical cleanup. */
  const sameClose = sharedPeer!.close() === closing
  await closing
  return { portCloses, sameClose }
}

declare global {
  var runBrowserPeerWindow: (unload?: boolean) => Promise<unknown>
  var connectBrowserPeerShared: () => Promise<void>
  var runBrowserPeerShared: (
    label: string
  ) => Promise<{ echo: string; recorded: string[]; values: number[]; sessions: number }>
  var closeBrowserPeerShared: (physical?: boolean) => Promise<unknown>
}
