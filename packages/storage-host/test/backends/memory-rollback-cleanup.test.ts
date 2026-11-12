import { describe, expect, it, vi } from 'vitest'
import { createStorageHost } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'

/** Cleanup failure injected into the next rollback; undefined leaves cleanup untouched. */
const injected: { cleanup: Error | undefined } = { cleanup: undefined }

/** The real transaction module, with an injection point on each owner's rollback cleanup. */
type ITransactionModule = typeof import('../../src/authoring/transaction.ts')

vi.mock('../../src/authoring/transaction.ts', async (importOriginal) =>
  wrapTransactionModule(await importOriginal<ITransactionModule>())
)

/** Replaces only `createTransactionOwner`, so memory owners route through `injectOwner`. */
function wrapTransactionModule(original: ITransactionModule): ITransactionModule {
  return {
    ...original,
    createTransactionOwner: (...args: Parameters<ITransactionModule['createTransactionOwner']>) =>
      injectOwner(original.createTransactionOwner(...args))
  } as ITransactionModule
}

/** Wraps `register`, so every attempt controller gains the cleanup injection. */
function injectOwner<TOwner extends { register: (...args: never[]) => unknown }>(
  owner: TOwner
): TOwner {
  const register = owner.register as (...args: unknown[]) => { closeIterators(): Promise<void> }
  return Object.assign(owner, {
    register: (...args: unknown[]) => injectCleanupFailure(register(...args))
  })
}

/** Makes the next `closeIterators` reject with the armed failure, once. */
function injectCleanupFailure<TControl extends { closeIterators(): Promise<void> }>(
  control: TControl
): TControl {
  const closeIterators = control.closeIterators
  return Object.assign(control, {
    closeIterators: async () => {
      const failure = injected.cleanup
      injected.cleanup = undefined
      await closeIterators()
      if (failure) throw failure
    }
  })
}

/** Collects every error reachable through `cause` and `errors`, without revisiting nodes. */
function reachable(root: unknown): Set<unknown> {
  const seen = new Set<unknown>()
  const queue: unknown[] = [root]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    if (typeof current !== 'object' || current === null) continue
    queue.push((current as { cause?: unknown }).cause)
    const errors = (current as { errors?: unknown }).errors
    if (Array.isArray(errors)) queue.push(...errors)
  }
  return seen
}

describe('memory transaction rollback cleanup', () => {
  it('keeps the callback failure first when iterator cleanup also fails', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const primary = new Error('callback failed')
    const cleanup = new Error('iterator cleanup failed')
    injected.cleanup = cleanup
    const failure = await store
      .transaction(async () => {
        throw primary
      })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    const aggregate = (failure as Error).cause as AggregateError
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(reachable(aggregate.errors[0]).has(primary)).toBe(true)
    expect(aggregate.errors[1]).toBe(cleanup)
    expect(reachable(failure).has(cleanup)).toBe(true)
  })

  it('throws the callback failure unchanged when cleanup succeeds', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const primary = new Error('callback failed')
    const failure = await store
      .transaction(async () => {
        throw primary
      })
      .catch((error: unknown) => error)
    expect((failure as Error).cause).toBe(primary)
  })
})
