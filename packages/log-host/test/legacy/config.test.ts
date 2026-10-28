import fc from 'fast-check'
import { expect, it } from 'vitest'
import { createLogHost, type ILogPlugin, type ILogPluginCore } from '../../src/index.ts'
import { execution } from './fixtures.ts'

/** Preserve queued mutation order for every generated bounded input. */
async function orderedProperty(values: number[]): Promise<void> {
  /** The update hook is the independent observation of committed queue order. */
  const seen: number[] = []
  /** The real config owner starts from one known committed value. */
  const logger = createLogHost({
    execution,
    plugins: [
      {
        name: 'property-update',
        config: { value: 0 },
        install: empty,
        update: (next: { value: number }) => {
          seen.push(next.value)
        }
      }
    ]
  })
  /** Queue all recipes before waiting, preserving the original concurrency scenario. */
  const pending: Promise<void>[] = []
  for (const value of values)
    pending.push(logger.config.update('property-update', () => ({ value })))
  await Promise.all(pending)
  expect(seen).toEqual(values)
  await logger.shutdown('manual')
}

/** A configuration-only plugin deliberately exposes no runtime extensions. */
function empty(): Record<string, never> {
  return {}
}

/** Property generation retains the old bounded list and integer domain. */
async function configurationProperty(): Promise<void> {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer(), { maxLength: 12 }), orderedProperty))
}
it('serializes ordered config updates through the host queue', configurationProperty)

/** Public config reads keep committed snapshots isolated from the source option object. */
async function configSnapshots(): Promise<void> {
  /** Level policy has moved to a feature; this fixture exercises the unchanged peer config surface. */
  const logger = createLogHost({
    execution,
    plugins: [{ name: 'policy', config: { level: 'warn' }, install: empty }]
  })
  expect(logger.config.get('policy.level')).toBe('warn')
  await logger.config.update('policy', () => ({ level: 'error' }))
  expect(logger.config.get('policy.level')).toBe('error')
  await logger.shutdown('manual')
}
it('exposes isolated plugin config snapshots on the logger facade', configSnapshots)

/** Concurrent updates execute hooks serially, including asynchronous hook work. */
async function concurrentUpdates(): Promise<void> {
  /** Hook values expose the actual execution order. */
  const seen: number[] = []
  /** The asynchronous update hook retains one explicit microtask boundary. */
  const plugin: ILogPlugin<Record<string, never>, { value: number }> = {
    name: 'serial-update',
    install: empty,
    async update(config) {
      seen.push(config.value)
      await Promise.resolve()
    }
  }
  /** A real host supplies the canonical mutation queue. */
  const logger = createLogHost({ execution, plugins: [plugin] })
  await Promise.all([
    logger.config.update('serial-update', () => ({ value: 1 })),
    logger.config.update('serial-update', () => ({ value: 2 })),
    logger.config.update('serial-update', () => ({ value: 3 }))
  ])
  expect(seen).toEqual([1, 2, 3])
  await logger.shutdown('manual')
}
it('serializes concurrent updates', concurrentUpdates)

/** One plugin owns the flusher counted during a config update. */
class FlushUpdatePlugin {
  /** Registration identity is consumed by the public config facade. */
  readonly name = 'flush-in-update'
  /** The case asserts the callback count after the update settles. */
  flushed = 0
  /** Register the callback while the real installation scope is open. */
  install(core: ILogPluginCore): Record<string, never> {
    core.onFlush(() => this.countFlush())
    return {}
  }
  /** Count one actual drain callback without returning a numeric plugin result. */
  countFlush(): void {
    this.flushed++
  }
  /** The update must not wait on its own lifecycle queue entry. */
  async update(_config: { value: number }, core: ILogPluginCore): Promise<void> {
    await core.flush()
  }
}

/** Reject a fixture watchdog only if the business operation deadlocks. */
function rejectDeadlock(_resolve: unknown, reject: (reason: unknown) => void): void {
  setTimeout(() => reject(new Error('flush waited for its own lifecycle task')), 100)
}

/** A config hook can drain log work independently of its own mutation operation. */
async function updateCanFlush(): Promise<void> {
  /** The fixture records only real onFlush invocations. */
  const plugin = new FlushUpdatePlugin()
  /** All mutation and flush behavior comes from the public host. */
  const logger = createLogHost({ execution, plugins: [plugin] })
  /** A concurrent watchdog preserves the old bounded failure assertion. */
  const update = logger.config.update('flush-in-update', () => ({ value: 1 }))
  await expect(Promise.race([update, new Promise<never>(rejectDeadlock)])).resolves.toBeUndefined()
  expect(plugin.flushed).toBe(1)
  await logger.shutdown('manual')
}
it('allows plugin update to flush without waiting for its own lifecycle task', updateCanFlush)
