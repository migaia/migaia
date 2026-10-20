/** Shared fixture routes keep native providers and their callers on one concrete contract. */
export const FixtureMethod = {
  /** Worker and direct-Core providers increment the actual business payload. */
  increment: 'increment',
  /** Child provider executes the real child-to-Worker hop before answering its parent. */
  cascade: 'cascade',
  /** Parent joins actual Worker startup before starting its business acceptance. */
  ready: 'ready',
  /** Actual bound diagnostic addresses are application setup data, never copied probe events. */
  diagnostics: 'diagnostics',
  /** Worker closes its actual collector without closing its business Peer. */
  closeCollector: 'closeCollector',
  /** Child closes both remote-host collectors before parent repeats its business call. */
  closeCollectors: 'closeCollectors'
}

/** Standalone argv and its oracle use this explicit mode to construct real collectors. */
export const FixtureMode = { observed: 'observed' }

/** This result scope explicitly separates native business evidence from direct-Core observations. */
export const FixtureScope = 'managed-business-and-direct-Core'

/** Three-host trace and diagnostic routes are shared by the runnable fixtures and their oracle. */
export const FixtureTrace = {
  /** Explicit caller-owned trace; native Peer call options remain unchanged. */
  id: 'T1',
  /** Every host gets an independent collector and an unprobed service connection. */
  host: { parent: 'parent', child: 'child', worker: 'worker' },
  /** Known caller identities let custom outgoing factories use their genuine handshake address. */
  caller: { parent: 'devtools-trace-parent', child: 'devtools-trace-child-worker' },
  /** Ephemeral loopback ports avoid socket files and address cleanup workarounds. */
  address: 'tcp://127.0.0.1:0',
  /** Public fixture-only credential authenticates the additional local diagnostic sockets. */
  token: 'rpc-devtools-local-service-fixture',
  /** The actual nested public service owns all query/watch/record conversion. */
  servicePrefix: 'devtools.',
  /** Parent recording crosses the same real service Peer as its hub target. */
  recordStart: 'devtools.record.start',
  recordStop: 'devtools.record.stop',
  /** Independent offline target preserves the exported sequence without replacing live targets. */
  offline: 'traced-parent-recording',
  /** Self-filter proof uses real local Peer traffic on an additional endpoint, not synthetic views. */
  selfClient: 'devtools-self-filter-client',
  selfProvider: 'devtools-self-filter-provider',
  /** Existing best-effort native termination degradation is the sole admitted reported warning. */
  processKind: 'process',
  warning: 'existing platform warning',
  failure: 'unexpected failure',
  acceptance: 'actual three-host trace'
}

/**
 * Choose the diagnostic server's explicit local address in this fixture execution.
 *
 * @param {string} host One of the fixture's parent, child or worker host names.
 * @returns {string} Public handshake and endpoint identity for that host's service.
 * @throws {Error} No intentional failure; callers supply canonical fixture host strings.
 */
export function fixtureServiceId(host) {
  return `devtools-trace-${host}-service`
}

/**
 * Choose the matching parent-side diagnostic client identity without claiming native authority.
 *
 * @param {string} host Target host's canonical fixture name.
 * @returns {string} Client identity admitted by that service's ordinary token verifier.
 * @throws {Error} No intentional failure; callers supply canonical fixture host strings.
 */
export function fixtureServiceClientId(host) {
  return `devtools-trace-${host}-client`
}
