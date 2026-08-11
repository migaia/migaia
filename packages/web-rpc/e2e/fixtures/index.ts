const scenario = new URL(location.href).searchParams.get('scenario');

if (!scenario) throw new Error('missing e2e scenario');

const scenarios: Record<string, () => Promise<unknown>> = {
  'broadcast-channel': () => import('./broadcast-channel'),
  'dedicated-worker': () => import('./dedicated-worker'),
  'message-port': () => import('./message-port'),
  'rtc-data-channel': () => import('./rtc-data-channel'),
  'service-worker': () => import('./service-worker'),
  'shared-worker': () => import('./shared-worker'),
  'window-iframe': () => import('./window-iframe')
};

const load = scenarios[scenario];
if (!load) throw new Error(`unknown e2e scenario: ${scenario}`);

/** Resolves only after the selected scenario has installed its page-global entry point. */
globalThis.e2eReady = load().then(() => undefined);

declare global {
  var e2eReady: Promise<void>;
}
