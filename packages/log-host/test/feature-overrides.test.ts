import { defineLogPlugin } from '../src/plugin.ts'
import { expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { createLogHost } from '../src/index.ts'
import { defineLogFeature } from '../src/plugin.ts'
import {
  filterFeature,
  formatFeature,
  batchFeature,
  retryFeature,
  timeoutFeature
} from '../src/features/index.ts'
import type { ILogFeature } from '../src/typing.ts'
import { CaptureOutput, FailureCapture, nextTurn } from './fixtures/output.ts'

/** Named callbacks expose exactly which resolved gate/format definitions actually ran. */
class FeatureTrace {
  /** The fixture stores observable calls in their actual invocation order. */
  readonly calls: string[] = []
  /** Each custom gate forwards its observable label without defining a parallel feature name. */
  gate(label: string) {
    return defineLogFeature({ phase: 'gate', accept: () => this.accept(label) })
  }
  /** Record a gate invocation and deliberately accept so later stages remain observable. */
  accept(label: string): boolean {
    this.calls.push(label)
    return true
  }
  /** A format call observes the boundary between gate evaluation and transport delivery. */
  format() {
    return defineLogFeature({ phase: 'format', format: () => this.render() })
  }
  /** Return deterministic text independently of the native entry shape. */
  render(): string {
    this.calls.push('format')
    return 'formatted'
  }
  /** Rejected host filter invocations would expose a failed output-local override. */
  readonly hostFilter = (): boolean => {
    this.calls.push('host-filter')
    return false
  }
  /** The selected output-local filter must be the only active filter implementation. */
  readonly localFilter = (): boolean => {
    this.calls.push('local-filter')
    return true
  }
}

/** Output-local filter and format override their host defaults with independent observable effects. */
async function filterAndFormatOverrides(): Promise<void> {
  /** Gate traces prove the overridden host filter was never invoked. */
  const trace = new FeatureTrace()
  /** Observable plain text distinguishes output formatting from host JSON. */
  const format = formatFeature({ format: 'plain' })
  /** This output selects both local policies in one real SDK scope. */
  const output = new CaptureOutput({
    features: { filter: filterFeature({ filters: [trace.localFilter] }), format: format }
  })
  /** Host defaults would reject or serialize JSON if local resolution failed. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({
        name: 'policy',
        features: {
          filter: filterFeature({ filters: [trace.hostFilter] }),
          format: formatFeature({ format: 'json' })
        }
      }),
      output.plugin()
    ]
  })
  host.log('info', 'local')
  await host.flush()
  expect(trace.calls).toEqual(['local-filter'])
  expect(output.records).toHaveLength(1)
  expect(output.records[0].text).toContain('[INFO] local')
  expect(Object.hasOwn(output.formats[0], 'kind')).toBe(false)
  expect(output.formats[0]).not.toBe(format)
  await host.shutdown('manual')
}

/** Host three-item batching cannot delay an output that selects a two-item local boundary. */
async function batchOverride(): Promise<void> {
  /** Successful delivery itself is the barrier; no flush is allowed to trigger this batch. */
  const output = new CaptureOutput({ features: { batch: batchFeature({ maxSize: 2 }) } })
  /** The host default would not deliver until a third item, timer, or explicit flush. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { batch: batchFeature({ maxSize: 3 }) } }),
      output.plugin()
    ]
  })
  host.log('info', 'one')
  host.log('info', 'two')
  await output.delivered.promise
  expect(output.batches).toHaveLength(1)
  expect(output.batches[0]).toHaveLength(2)
  await host.shutdown('manual')
}

/** Retry override controls actual calls rather than merely changing a descriptor field. */
async function retryOverride(): Promise<void> {
  /** Always-failing delivery exposes the exact local total-attempt budget. */
  const output = new CaptureOutput({
    features: { retry: retryFeature({ attempts: 2 }) },
    failures: 10
  })
  /** Final failure remains visible once after both local attempts finish. */
  const failures = new FailureCapture()
  /** A larger host default would produce a third actual call if incorrectly retained. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { retry: retryFeature({ attempts: 3 }) } }),
      output.plugin()
    ]
  })
  host.onFailure(failures.receive)
  host.log('info', 'retry')
  await host.flush()
  expect(output.attempts).toBe(2)
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toBe(output.failure)
  await host.shutdown('manual')
}

/** A local timeout replaces the host duration instead of nesting another earlier deadline. */
async function timeoutOverride(): Promise<void> {
  /** Virtual time makes the two distinct durations independently observable. */
  const scheduler = createManualScheduler()
  /** The transport remains pending through both clock observations. */
  const blocked = deferred<void>()
  /** Local twenty-millisecond timeout must outlive the host ten-millisecond default. */
  const output = new CaptureOutput({
    features: { timeout: timeoutFeature({ ms: 20 }) },
    blocked: blocked.promise
  })
  /** Failure absence at ten and presence at twenty prove actual override semantics. */
  const failures = new FailureCapture()
  /** Both timeout and host drain remain in the same clock domain. */
  const host = createLogHost({
    scheduler,

    plugins: [
      defineLogPlugin({ name: 'policy', features: { timeout: timeoutFeature({ ms: 10 }) } }),
      output.plugin()
    ]
  })
  host.onFailure(failures.receive)
  host.log('info', 'timeout')
  await output.started.promise
  scheduler.advance(10)
  await nextTurn()
  expect(failures.failures).toEqual([])
  expect(output.signals[0].aborted).toBe(false)
  scheduler.advance(10)
  await nextTurn()
  await host.flush()
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toMatchObject({ source: 'logging', code: 'DELIVERY_FAILED' })
  blocked.resolve()
  await nextTurn()
  await host.shutdown('manual')
}

/** Overridden host gates disappear while surviving host gates precede local declaration order. */
async function customGateOrder(): Promise<void> {
  /** The trace sees gates, format and transport calls on one comparable timeline. */
  const trace = new FeatureTrace()
  /** Output Z then X must remain after surviving host Y. */
  const output = new CaptureOutput({
    features: { z: trace.gate('local-z'), x: trace.gate('local-x'), format: trace.format() },
    trace: trace.calls
  })
  /** Host X is overridden even though it appeared before Y in this scope. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({
        name: 'policy',
        features: { x: trace.gate('host-x'), y: trace.gate('host-y') }
      }),
      output.plugin()
    ]
  })
  host.log('info', 'gates')
  await host.flush()
  expect(trace.calls).toEqual(['host-y', 'local-z', 'local-x', 'format', 'deliver'])
  await host.shutdown('manual')
}

/** Format priority exposes the selected installed implementation to transport consumers. */
async function formatPriority(): Promise<void> {
  /** Each scope/default combination is observed independently, including literal defaults. */
  for (const fallback of ['json', 'plain', customDefault()] as const) {
    /** Without explicit scopes the output must receive the installed default formatter. */
    const output = new CaptureOutput({ defaultFormat: fallback })
    /** The default-only host cannot provide another implicit formatting policy. */
    const host = createLogHost({ plugins: [output.plugin()] })
    host.log('info', 'default')
    await host.flush()
    expect(output.formats[0].phase).toBe('format')
    if (typeof fallback === 'object') {
      expect(output.formats[0].format).toBe(defaultText)
      expect(output.formats[0]).not.toBe(fallback)
      expect(output.records[0].text).toBe('default-format')
    } else if (fallback === 'json')
      expect(JSON.parse(output.records[0].text).message).toBe('default')
    else expect(output.records[0].text).toContain('[INFO] default')
    await host.shutdown('manual')
  }
  /** Host explicit format must override a different transport default through its native instance. */
  const hostFormat = customDefault()
  /** A plain default would produce visibly different text if host selection failed. */
  const output = new CaptureOutput({ defaultFormat: 'plain' })
  /** Only host explicit formatting is present in this final independent fixture. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { hostFormat: hostFormat } }),
      output.plugin()
    ]
  })
  host.log('info', 'host')
  await host.flush()
  expect(output.formats[0].format).toBe(defaultText)
  expect(output.formats[0]).not.toBe(hostFormat)
  expect(output.records[0].text).toBe('default-format')
  await host.shutdown('manual')
}
/** A custom formatter remains independent of the record key chosen by its declaring plugin. */
function customDefault(): ILogFeature {
  return defineLogFeature({ phase: 'format', format: defaultText })
}
/** Stable custom text distinguishes descriptor selection from literal JSON/plain normalization. */
function defaultText(): string {
  return 'default-format'
}

/** BC6: two keys using the same feature factory remain two independently evaluated gates. */
async function differentKeyGatesBothApply(): Promise<void> {
  /** Record declarations, rather than a factory-owned name, distinguish these two gates. */
  const trace = new FeatureTrace()
  /** Transport delivery follows both surviving gates in the same observable trace. */
  const output = new CaptureOutput({ trace: trace.calls })
  /** Reusing defineLogFeature under two keys must not silently replace the first gate. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { a: trace.gate('a'), b: trace.gate('b') } }),
      output.plugin()
    ]
  })
  host.log('info', 'two-gates')
  await host.flush()
  expect(trace.calls).toEqual(['a', 'b', 'deliver'])
  expect(output.records).toHaveLength(1)
  await host.shutdown('manual')
}

it('overrides host filter and format independently', filterAndFormatOverrides)
it('uses output batch size before explicit flush', batchOverride)
it('uses output retry attempts instead of host attempts', retryOverride)
it('uses output timeout duration instead of host duration', timeoutOverride)
it('orders surviving host gates before output gates and formatting', customGateOrder)
it('resolves every format priority and exposes the installed formatter', formatPriority)
it(
  'BC6 evaluates different-key gates from the same factory in declaration order',
  differentKeyGatesBothApply
)
