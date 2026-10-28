import { expect, it, vi } from 'vitest'
import * as durable from '../src/index.ts'
import { createLogHost } from '@migaia/log-host'

/** The new root owns its three plugin factories and durable error identity. */
function durablePublication(): void {
  expect(durable.binlogPlugin).toBeTypeOf('function')
  expect(durable.walPlugin).toBeTypeOf('function')
  expect(durable.undoLogPlugin).toBeTypeOf('function')
  expect(durable.LOG_DURABLE_ERROR_SOURCE).toBe('logging.durable')
  expect(Object.values(durable.LogDurableErrorCode)).toHaveLength(12)
}

it('publishes the durable factories and twelve package-owned errors', durablePublication)

/** Argument and revoked-resource failures preserve their native type under the new owner. */
async function durableAdmission(): Promise<void> {
  expect(() => durable.assertLogInteger(0)).toThrowError(
    expect.objectContaining({
      source: 'logging.durable',
      code: 'INVALID_OPTION',
      name: 'RangeError'
    })
  )
  expect(() => durable.assertLogInteger(Number.MAX_SAFE_INTEGER + 1)).toThrowError(
    expect.objectContaining({
      source: 'logging.durable',
      code: 'LOG_SEQUENCE_EXHAUSTED',
      name: 'RangeError'
    })
  )
  /** This independent store uses the real public payload, state and closing boundaries. */
  const store = durable.memoryLogStore()
  await expect(store.append([{ kind: 'bad', payload: undefined }] as never)).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'LOG_PAYLOAD_INVALID',
    name: 'TypeError'
  })
  await expect(store.setState(1, durable.LogRecordState.done)).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'WAL_RECORD_INVALID'
  })
  await store.dispose()
  await expect(store.lastSeq()).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'RUNTIME_SHUTTING_DOWN'
  })
}

/** The same original store cannot be borrowed by a second installed plugin. */
async function duplicateBorrow(): Promise<void> {
  /** The creator retains disposal authority after either host shuts down. */
  const store = durable.memoryLogStore()
  /** Both hosts use the real plugin-host installation path. */
  const first = createLogHost({ plugins: [durable.binlogPlugin({ store })], report: ignoreFailure })
  /** The empty second host tests a real dynamic installation rejection. */
  const second = createLogHost({ report: ignoreFailure })
  try {
    await first.binlog.ready()
    /** Observe the real factory install without replacing its borrower or error construction. */
    const definition = durable.binlogPlugin({ store })
    /** The spy retains the exact original thrown instance before the peer attaches its wrapper. */
    const install = vi.fn(definition.install)
    /** One actual dynamic installation owns the shared peer rejection. */
    const pending = second.use({ ...definition, install })
    await expect(pending).rejects.toMatchObject({
      source: 'plugin.host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: { source: 'logging.durable', code: 'LOG_STORE_IN_USE', name: 'Error' }
    })
    expect(install.mock.results).toHaveLength(1)
    expect(install.mock.results[0]?.type).toBe('throw')
    /** The unchanged peer wrapper points directly to the original native durable error. */
    const original = install.mock.results[0]!.value
    expect(original).toBeInstanceOf(Error)
    await expect(pending).rejects.toHaveProperty('cause', original)
    await expect(
      first.binlog.append('native', null, {
        transaction: {
          store,
          append: rejectForeignPort,
          onCommit: ignoreRegistration,
          onRollback: ignoreRegistration
        }
      })
    ).rejects.toBe(foreignError)
  } finally {
    await second.shutdown('manual')
    await first.shutdown('manual')
    await store.dispose()
  }
}

/** Expected coded installation failures have their own assertions instead of terminal output. */
function ignoreFailure(): void {}

/** A native owner can use its own coded error; the port must preserve this exact object. */
const foreignError = Object.assign(new TypeError('native transaction fixture'), {
  source: 'native.fixture',
  code: 'NATIVE_FAILURE'
})
/** The native append's original rejection must remain the business operation's rejection. */
function rejectForeignPort(): Promise<readonly number[]> {
  return Promise.reject(foreignError)
}
/** This failing native transaction publishes no commit or rollback notification. */
function ignoreRegistration(): () => void {
  return ignoreFailure
}

it('keeps native argument types and actual durable operation rejections', durableAdmission)
it('attributes a second real installed borrow to the durable error domain', duplicateBorrow)
