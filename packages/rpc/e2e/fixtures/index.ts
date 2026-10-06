const scenario = new URL(location.href).searchParams.get('scenario')

if (!scenario) throw new Error('missing e2e scenario')

const scenarios: Record<string, () => Promise<unknown>> = {
  'broadcast-channel': () => import('./broadcast-channel.js'),
  'dedicated-worker': () => import('./dedicated-worker.js'),
  'automatic-thread': () => import('../../test/runtime-api/browser-peer.js'),
  'binary-thread': () => import('../../test/runtime-api/browser-binary.js'),
  'message-port': () => import('./message-port.js'),
  'manual-discovery': () => import('./manual-discovery.js'),
  'rtc-data-channel': () => import('./rtc-data-channel.js'),
  'service-worker': () => import('./service-worker.js'),
  'shared-worker': () => import('./shared-worker.js'),
  'window-iframe': () => import('./window-iframe.js'),
  'web-transport': () => import('./web-transport.js')
}

const load = scenarios[scenario]
if (!load) throw new Error(`unknown e2e scenario: ${scenario}`)

/** Resolves only after the selected scenario has installed its page-global entry point. */
globalThis.e2eReady = load().then(() => undefined)

declare global {
  var e2eReady: Promise<void>
}
