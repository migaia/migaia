import { defineLogPlugin } from '../src/plugin.ts'
import { expect, it } from 'vitest'
import {
  createLogHost,
  levelPlugin,
  forwardPlugin,
  LogHostStatus,
  defaultLogFailureReporter
} from '../src/index.ts'
import { defineLogFeature, projectLogEntry } from '../src/plugin.ts'
import { uuidFeature } from '../src/features/uuid.ts'
import type { ILogEntry, ILogFailure, ILogPluginCore } from '../src/typing.ts'

/** Real non-output plugins allow the independent core boundary to run before SDK integration. */
class CapturePlugin {
  /** Stable identity gives this fixture canonical installation and release behavior. */
  readonly name = 'capture'
  /** Entries are observed through the public plugin core rather than a test-only host seam. */
  readonly entries: ILogEntry[] = []
  /** Failures preserve their original values for independent business-boundary assertions. */
  readonly failures: ILogFailure[] = []
  /** The captured core also proves shared prototype methods work with peer-owned receivers. */
  core: ILogPluginCore | undefined
  /** Register independently owned observations using the real installation core. */
  install(core: ILogPluginCore): Record<string, never> {
    this.core = core
    core.useSink((entry) => this.receive(entry))
    core.onFailure((failure) => this.failures.push(failure))
    return {}
  }
  /** Store exactly the sink snapshot that the host delivered. */
  receive(entry: ILogEntry): void {
    this.entries.push(entry)
  }
}

/** Ordered queue admission drops only the oldest unstarted entry at capacity. */
async function boundedQueue(): Promise<void> {
  /** Fixture observations remain independent of the host queue internals. */
  const capture = new CapturePlugin()
  /** A capacity of two makes overflow observable without timing-dependent producer loops. */
  const host = createLogHost({ maxPending: 2, plugins: [levelPlugin(), capture] })
  host.info('a')
  host.info('b')
  host.info('c')
  expect(capture.entries).toEqual([])
  await host.flush()
  expect(capture.entries.map(entryMessage)).toEqual(['b', 'c'])
  expect(capture.failures).toHaveLength(1)
  expect(capture.failures[0].error).toMatchObject({ source: 'logging', code: 'QUEUE_OVERFLOW' })
  expect(capture.core).toBeDefined()
  await host.shutdown('manual')
}

/** Extract a stable business message without reading private fixture state. */
function entryMessage(entry: ILogEntry): string {
  return entry.message
}

/** Entry enrichment uses the installing host generator and retains its native payload references. */
async function entryEnrichment(): Promise<void> {
  /** Construction consumes one UUID; each enriched entry consumes the next one. */
  let sequence = 0
  /** One deterministic generator makes host-versus-global ownership observable. */
  const generate = () => `uuid-${++sequence}`
  /** A native Error must survive shallow entry snapshots by identity. */
  const error = new Error('fixture')
  /** The independent real plugin receives enriched entries after the asynchronous pipeline. */
  const capture = new CapturePlugin()
  /** Display false must not prevent per-entry UUID generation. */
  const host = createLogHost({
    randomUUID: generate,

    plugins: [
      defineLogPlugin({ name: 'policy', features: { uuid: uuidFeature({ display: false }) } }),
      capture
    ]
  })
  host.log('custom', 'message', error)
  await host.flush()
  expect(capture.entries[0].data).toMatchObject({ uuid: 'uuid-2', uuidDisplay: false })
  expect(capture.entries[0].error?.raw).toBe(error)
  expect(capture.entries[0].args[0]).toBe(error)
  await host.shutdown('manual')
}

/** Reentrant shutdown shares its published Promise while handlers may write their final log. */
async function terminalIdentity(): Promise<void> {
  /** The fixture retains the final entry delivered before plugin cleanup. */
  const capture = new CapturePlugin()
  /** A normal public host owns terminal ordering and frozen status observations. */
  const host = createLogHost({ plugins: [capture] })
  /** A handler is registered separately so it can observe the already-published terminal value. */
  const observer = new ShutdownObserver(host)
  host.onShutdown(() => observer.run())
  /** Every caller must see this exact Promise, including the callback that reenters shutdown. */
  const completion = host.shutdown('manual')
  expect(host.shutdown('manual')).toBe(completion)
  expect((await completion).logicalTerminal).toBe(true)
  expect(observer.completion).toBe(completion)
  expect(observer.status).toBe(LogHostStatus.shuttingDown)
  expect(capture.entries.map(entryMessage)).toEqual(['final'])
  expect(host.status).toBe(LogHostStatus.closed)
}

/** Handler state is named rather than captured by a nested test callback. */
class ShutdownObserver {
  /** The public host is the only authority available to this handler fixture. */
  #host: ReturnType<typeof createLogHost>
  /** Records the nested terminal call for exact identity comparison. */
  completion: ReturnType<ReturnType<typeof createLogHost>['shutdown']> | undefined
  /** Records status during the handler, independently of the later terminal state. */
  status: LogHostStatus | undefined
  /** Capture the public facade without installing new lifecycle machinery. */
  constructor(host: ReturnType<typeof createLogHost>) {
    this.#host = host
  }
  /** Reenter only after terminal admission has published its shared Promise. */
  run(): void {
    this.status = this.#host.status
    this.completion = this.#host.shutdown('manual')
    this.#host.log('info', 'final')
  }
}

/** Forward graph admission retains self/two-hop/three-hop cycle rejection without aliases. */
async function forwardingCycles(): Promise<void> {
  /** Three independent real hosts exercise multi-hop reachability, not just direct reverse edges. */
  const a = createLogHost()
  /** The second host forwards to the third after the first edge has committed. */
  const b = createLogHost()
  /** The sink host must receive the forwarded logical entry before source flush completes. */
  const capture = new CapturePlugin()
  /** The third host's fixture uses the public plugin interface. */
  const c = createLogHost({ plugins: [capture] })
  await a.use(forwardPlugin({ targets: [b] }))
  await b.use(forwardPlugin({ targets: [c] }))
  await expect(c.use(forwardPlugin({ targets: [a] }))).rejects.toMatchObject({
    source: 'logging',
    code: 'FORWARD_CYCLE'
  })
  await expect(c.use(forwardPlugin({ targets: [c] }))).rejects.toMatchObject({
    source: 'logging',
    code: 'FORWARD_SELF'
  })
  a.log('info', 'forwarded')
  await a.flush()
  expect(capture.entries.map(entryMessage)).toEqual(['forwarded'])
  await a.shutdown('manual')
  await b.shutdown('manual')
  await c.shutdown('manual')
}

/** Native identity admission rejects copied objects without trusting a descriptor's shape. */
function descriptorAdmission(): void {
  /** A valid complete custom descriptor is signed by the actual public SDK factory. */
  const feature = defineLogFeature({ phase: 'entry', stage: keepEntry })
  expect(() =>
    createLogHost({
      plugins: [defineLogPlugin({ name: 'policy', features: { feature0: { ...feature } } })]
    })
  ).toThrowError()
  expect(() => createLogHost({ maxPending: 0 })).toThrowError()
}

/** A complete identity stage makes descriptor construction meaningful without altering entries. */
function keepEntry(entry: ILogEntry): ILogEntry {
  return entry
}

/** Projection exposes the canonical error chain without serializing error.raw custom properties. */
function errorProjection(): void {
  /** Private fields must not cross the structured logging boundary. */
  const error = Object.assign(new Error('private'), { privateValue: 'secret' })
  /** The explicit entry avoids requiring unfinished SDK output installation. */
  const entry: ILogEntry = {
    id: 'entry',
    tag: 'info',
    time: new Date(0),
    message: 'message',
    args: [],
    context: [],
    data: {},
    error: { name: error.name, message: error.message, stack: error.stack, raw: error }
  }
  expect(JSON.stringify(projectLogEntry(entry))).not.toContain('privateValue')
  expect(entry.error?.raw).toBe(error)
  expect(() => defaultLogFailureReporter(error)).not.toThrow()
}

it('bounds ordered entry admission through real plugin core capabilities', boundedQueue)
it('enriches entries with the installing host generator', entryEnrichment)
it('shares terminal identity while admitting final handler logs', terminalIdentity)
it('rejects self and multi-hop forward cycles', forwardingCycles)
it('admits only issued feature identities', descriptorAdmission)
it('projects native errors without private raw fields', errorProjection)
