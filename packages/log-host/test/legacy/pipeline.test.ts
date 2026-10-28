import { expect, it, vi } from 'vitest'
import { createLogHost, levelPlugin, forwardPlugin, type ILogEntry } from '../../src/index.ts'
import { thresholdFeature, uuidFeature } from '../../src/features/index.ts'
import { CaptureOutput, messageOf } from '../fixtures/output.ts'
import { execution } from './fixtures.ts'
import type { IAsyncMiddlewareStage } from '@migaia/middleware-pipeline'

/** The supported async branch preserves level filtering and UUID payload assertions. */
async function pipelineFeatures(): Promise<void> {
  /** Real SDK output owns host-default policy rather than an obsolete pipeline consumer fixture. */
  const output = new CaptureOutput()
  /** Shared lower-level policies are supplied by their approved feature factories. */
  const host = createLogHost({
    execution,
    randomUUID: fixedId,
    features: [thresholdFeature({ level: 'error' }), uuidFeature()],
    plugins: [levelPlugin(), output.plugin()]
  })
  host.log('debug', 'filtered')
  host.log('error', 'passes')
  await host.flush()
  expect(output.records.map(tagMessageUUID)).toEqual(['error:passes:mode-id'])
  await host.shutdown('manual')
}
/** Injected identity replaces only the removed global runtime manager entry. */
function fixedId(): string {
  return 'mode-id'
}
/** Preserve the original complete tag/message/UUID business assertion. */
function tagMessageUUID(record: { entry: ILogEntry }): string {
  return `${record.entry.tag}:${record.entry.message}:${record.entry.data.uuid}`
}

/** Synchronous stage exceptions remain contained by the asynchronous host pipeline. */
function throwingStage(): never {
  throw new Error('sync stage failed')
}
/** An inert reporter spy cannot affect the outcome being asserted. */
function ignoreDiagnostic(): void {}
/** Runtime error containment preserves original failure presence under the new reporter signature. */
async function pipelineErrorContainment(): Promise<void> {
  /** The default reporter's actual console call is the public diagnostic observation. */
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(ignoreDiagnostic)
  /** Only the supported host pipeline registration API is used. */
  const host = createLogHost({ execution })
  host.usePipeline(throwingStage)
  try {
    expect(() => host.log('info', 'message')).not.toThrow()
    await host.flush()
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'sync stage failed' })
    )
    expect(diagnostic).toHaveBeenCalledTimes(1)
  } finally {
    await host.shutdown('manual')
    diagnostic.mockRestore()
  }
}

/** The one supported middleware mode retains the original transformed-message assertion. */
const asyncStage: IAsyncMiddlewareStage<ILogEntry> = async (entry, next) => {
  await next({ ...entry, message: `${entry.message}:async` })
}
/** Public host stage registration replaces the removed mode-specific plugin fixture call. */
async function asynchronousPipeline(): Promise<void> {
  /** Transport observations remain independent of pipeline implementation internals. */
  const output = new CaptureOutput()
  /** The host exposes only the asynchronous middleware mode. */
  const host = createLogHost({ execution, plugins: [output.plugin()] })
  host.usePipeline(asyncStage)
  host.log('info', 'message')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['message:async'])
  await host.shutdown('manual')
}

/** New stage registration accepts async and ordinary functions without restoring retired modes. */
async function supportedPipelineMethods(): Promise<void> {
  /** A normal factory result exposes the exact approved async-only facade. */
  const host = createLogHost({ execution })
  expect(() => host.usePipeline(asyncStage)).not.toThrow()
  expect(() => host.usePipeline(identityStage)).not.toThrow()
  expect(host).not.toHaveProperty('useGeneratorPipeline')
  expect(host).not.toHaveProperty('useAsyncGeneratorPipeline')
  expect(host).not.toHaveProperty('useAsyncPipeline')
  await host.shutdown('manual')
}
/** The ordinary callback still returns the canonical async next completion. */
const identityStage: IAsyncMiddlewareStage<ILogEntry> = (entry, next) => next(entry)

/** Forward plugin removal keeps detached sources and live targets independently observable. */
async function forwardingRemoval(): Promise<void> {
  /** The original target sink must not receive the detached source entry. */
  const output = new CaptureOutput()
  /** Target lifecycle stays independent of the forwarding source. */
  const target = createLogHost({ execution, plugins: [output.plugin()] })
  /** Source edges are now owned by an explicit removable plugin registration. */
  const source = createLogHost({ execution })
  await source.use(forwardPlugin({ targets: [target] }))
  expect((await source.unUse('forward')).ok).toBe(true)
  await expect(source.unUse('forward')).rejects.toMatchObject({ code: 'PLUGIN_NOT_INSTALLED' })
  source.log('info', 'detached')
  await source.flush()
  expect(output.records.map(messageOf)).toEqual([])
  await source.use(forwardPlugin({ targets: [target] }))
  await source.shutdown('manual')
  target.log('info', 'target-still-live')
  await target.flush()
  expect(output.records.map(messageOf)).toEqual(['target-still-live'])
  await target.shutdown('manual')
}

/** Level methods always return before delivery after the deliberate asynchronous contract change. */
async function levelTiming(): Promise<void> {
  /** The actual output is the timing oracle rather than a mocked scheduler invocation. */
  const output = new CaptureOutput()
  /** No per-level asyncOutput option is required or exposed by the new plugin. */
  const host = createLogHost({ plugins: [levelPlugin(), output.plugin()] })
  host.info('async')
  expect(output.records).toEqual([])
  await host.flush()
  expect(output.records).toHaveLength(1)
  expect(output.records[0].entry.message).toBe('async')
  await host.shutdown('manual')
}

/** Host identity injection works independently of process/plugin global runtime capabilities. */
async function injectedIdentity(): Promise<void> {
  /** This supported constructor option replaces the removed runtime-manager identity source. */
  const host = createLogHost({ execution, randomUUID: browserIdentity })
  expect(host.ctx.id).toBe('browser-id')
  expect(host).not.toHaveProperty('raw')
  await host.shutdown('manual')
}
/** A fixed constructor identity retains the original native browser fixture assertion. */
function browserIdentity(): string {
  return 'browser-id'
}

it('runs logger pipeline features in asynchronous mode', pipelineFeatures)
it('contains synchronous pipeline errors during default dispatch', pipelineErrorContainment)
it('runs the supported asynchronous pipeline mode', asynchronousPipeline)
it('types pipeline registration from its fixed asynchronous contract', supportedPipelineMethods)
it('removes forwarding registrations and disconnects them on shutdown', forwardingRemoval)
it('always defers level logs until after the producer returns', levelTiming)
it('captures injected identity independently of a global runtime manager', injectedIdentity)
