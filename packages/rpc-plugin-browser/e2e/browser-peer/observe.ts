import type { IRpcTransport } from '@migaia/rpc-host/plugin'
import { createWindowMessageTransport } from '@migaia/rpc-plugin-browser/adapters/window'
import { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'

/** Serializable assertions prove the physical transfer and observer lifetime across real realms. */
type IObservationResult = {
  directions: number[]
  carrier: string[]
  sizes: number[]
  detached: boolean
  captured: number[]
  received: number[]
  transfers: number
  rejectedSource: number
  afterDispose: number
  failures: string[]
}

declare global {
  /** Playwright invokes the real Window observation fixture through this browser-owned entry. */
  var runWindowObserve: () => Promise<IObservationResult>
  /** Playwright invokes the real SharedWorker observation fixture through this browser-owned entry. */
  var runSharedWorkerObserve: () => Promise<IObservationResult>
}

/** Run identical direct-probe assertions for real Window and SharedWorker carrier boundaries. */
async function runObserve(
  transport: IRpcTransport<unknown, Transferable>,
  spoof?: () => Promise<void>
): Promise<IObservationResult> {
  /** Results retain primitive fields immediately because production detail is reused. */
  const result: IObservationResult = {
    directions: [],
    carrier: [],
    sizes: [],
    detached: false,
    captured: [],
    received: [],
    transfers: 0,
    rejectedSource: 0,
    afterDispose: 0,
    failures: []
  }
  /** Capturing occurs synchronously before native detachment. */
  const dispose = transport.observe!({
    capturing: true,
    /** Read reusable event fields synchronously, before postMessage can detach their bytes. */
    emit(direction, size, carrier, detail, content) {
      result.directions.push(direction)
      result.carrier.push(carrier)
      result.sizes.push(size)
      if (direction === 0) {
        result.captured = Array.from(content as Uint8Array)
        result.transfers = detail!.transfers as number
      } else result.rejectedSource = detail!.rejectedSource as number
    }
  })
  /** Existing carrier errors are visible without influencing echo results. */
  const removeError = transport.onListenerError?.((error) => result.failures.push(String(error)))
  /** The receive resolver is fixture state and is replaced for the second business send. */
  let receive: ((value: unknown) => void) | undefined
  /** Source proof remains at the same business boundary as Endpoint connect middleware. */
  const unsubscribe = transport.subscribe((message) => {
    if (transport.sourceProof && !transport.sourceProof(message.source, message.origin)) return
    receive?.(message.data)
  })
  try {
    await spoof?.()
    /** This direct payload's buffer is detached by actual browser postMessage. */
    const bytes = new Uint8Array([7, 8, 9])
    /** Business delivery must finish without depending on any collector or Core emitter. */
    const reply = new Promise<unknown>((resolve) => {
      receive = resolve
    })
    transport.send(bytes, { transfer: [bytes.buffer] })
    result.detached = bytes.byteLength === 0
    result.received = Array.from((await reply) as Uint8Array)
    dispose()
    dispose()
    /** A second round trip proves disposer stops observation while business delivery continues. */
    const later = new Promise<unknown>((resolve) => {
      receive = resolve
    })
    transport.send(new Uint8Array([10]))
    await later
    result.afterDispose = result.directions.length
    return result
  } finally {
    dispose()
    unsubscribe()
    removeError?.()
  }
}

/** Observe a real iframe, including one sibling Window source rejection. */
globalThis.runWindowObserve = async () => {
  /** Each invocation owns fresh realms and removes them at completion. */
  const frame = document.createElement('iframe')
  /** The sibling has the same origin but must still fail exact Window source proof. */
  const sibling = document.createElement('iframe')
  frame.src = '/browser-peer/observe-frame.html'
  /** The echo script must be loaded before the first physical send. */
  const loaded = new Promise<void>((resolve) => {
    /** Native load completion means the iframe echo script can receive the first transfer. */
    frame.onload = () => resolve()
  })
  document.body.append(frame, sibling)
  await loaded
  /** The raw factory is exercised directly with fake IRpcCarrierProbe, independently of probe-core. */
  const transport = createWindowMessageTransport({
    target: frame.contentWindow!,
    receiver: window,
    targetOrigin: location.origin
  })
  try {
    return await runObserve(
      transport,
      /** Emit spoof traffic from the sibling realm and wait until native source rejection occurs. */
      () =>
        new Promise<void>((resolve) => {
          /** Wait for actual native source rejection before sending the valid echo. */
          const spoofed = (event: MessageEvent) => {
            if (event.source !== sibling.contentWindow) return
            window.removeEventListener('message', spoofed)
            resolve()
          }
          window.addEventListener('message', spoofed)
          sibling.srcdoc =
            "<script>parent.postMessage('sibling-spoof', parent.location.origin)</script>"
        })
    )
  } finally {
    frame.remove()
    sibling.remove()
  }
}

/** Observe a real SharedWorker MessagePort and close only the caller-owned native port. */
globalThis.runSharedWorkerObserve = async () => {
  /** Vite builds this worker module with its real SharedWorker entry semantics. */
  const worker = new SharedWorker(new URL('./observe.worker.ts', import.meta.url), {
    type: 'module'
  })
  try {
    return await runObserve(createSharedWorkerTransport(worker.port))
  } finally {
    worker.port.close()
  }
}
