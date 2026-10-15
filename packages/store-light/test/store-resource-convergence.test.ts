import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createStoreResource, type IStoreResource } from '@migaia/store-light'

/** Captures the exact public Suspense operation without adding an adapter test seam. */
function pending<T>(resource: IStoreResource<T>): Promise<T> {
  try {
    resource.read()
  } catch (error) {
    expect(error).toBeInstanceOf(Promise)
    return error as Promise<T>
  }
  throw new Error('expected pending resource')
}

describe('ARC-T02 canonical request with version ownership', () => {
  it('shares the native Promise, aborts superseded work immediately and releases late values once', async () => {
    let firstResolve!: (value: object) => void
    let secondResolve!: (value: object) => void
    const first = new Promise<object>((resolve) => {
      firstResolve = resolve
    })
    const second = new Promise<object>((resolve) => {
      secondResolve = resolve
    })
    const late = {}
    const fresh = {}
    const released: object[] = []
    let calls = 0
    const resource = createStoreResource(() => (++calls === 1 ? first : second), {
      dispose: (value) => {
        released.push(value)
      }
    })
    const releaseResource = resource.retainResource()
    const original = pending(resource)
    expect(pending(resource)).toBe(original)
    await Promise.resolve()
    resource.retry()
    const replacement = pending(resource)
    expect(replacement).not.toBe(original)
    await expect(original).rejects.toMatchObject({
      source: '@migaia/resource',
      code: 'REQUEST_ABORTED',
      name: 'AbortError'
    })
    firstResolve(late)
    secondResolve(fresh)
    expect(await replacement).toBe(fresh)
    expect(resource.read()).toBe(fresh)
    expect(released).toEqual([late])
    resource.forceDispose()
    releaseResource()
    await resource.whenTerminal()
    expect(released).toEqual([late, fresh])
  })

  it('restores stale data on refresh failure and retires values only after their version lease ends', async () => {
    const first = {}
    const second = {}
    const failure = new Error('refresh failed')
    const released: object[] = []
    const reported: unknown[] = []
    let call = 0
    const resource = createStoreResource(
      () => {
        call++
        if (call === 2) throw failure
        return call === 1 ? first : second
      },
      {
        dispose: (value) => {
          released.push(value)
        },
        onError: (error) => {
          reported.push(error)
        }
      }
    )
    const releaseResource = resource.retainResource()
    await pending(resource)
    const snapshot = resource.readSnapshot()
    const releaseVersion = resource.retainVersion(snapshot.token)
    resource.retry()
    expect(resource.read()).toBe(first)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(reported).toEqual([failure])
    expect(resource.read()).toBe(first)
    resource.retry()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(resource.read()).toBe(second)
    expect(released).toEqual([])
    releaseVersion()
    expect(released).toEqual([first])
    resource.dispose()
    expect(resource.read()).toBe(second)
    releaseResource()
    await resource.whenTerminal()
    expect(released).toEqual([first, second])
  })
})

it('ARC-T02 releases a loaded value if canonical clock settlement fails', async () => {
  const value = {}
  const failure = new Error('clock failed')
  const released: object[] = []
  const reports: unknown[] = []
  const manual = createManualScheduler()
  const resource = createStoreResource(() => value, {
    scheduler: {
      now: () => {
        throw failure
      },
      schedule: manual.schedule
    },
    dispose: (item) => {
      released.push(item)
    },
    onError: (error) => {
      reports.push(error)
    }
  })
  const release = resource.retainResource()
  const operation = pending(resource)
  await expect(operation).rejects.toMatchObject({
    source: '@migaia/resource',
    code: 'INVALID_OPTION',
    cause: failure
  })
  expect(released).toEqual([value])
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({ cause: failure })
  resource.forceDispose()
  release()
  await resource.whenTerminal()
  expect(released).toEqual([value])
})

it('ARC-T02 reports capture timer failure without losing a valid value or retaining its capture forever', async () => {
  const value = {}
  const failure = new Error('capture timer failed')
  const released: object[] = []
  const reports: unknown[] = []
  const resource = createStoreResource(() => value, {
    scheduler: {
      now: () => 0,
      schedule: () => {
        throw failure
      }
    },
    keepAliveMs: 0,
    dispose: (item) => {
      released.push(item)
    },
    onError: (error) => {
      reports.push(error)
    }
  })
  const release = resource.retainResource()
  let operation!: Promise<object>
  try {
    resource.captureSnapshot()
  } catch (error) {
    operation = error as Promise<object>
  }
  expect(await operation).toBe(value)
  expect(resource.read()).toBe(value)
  expect(reports).toEqual([failure])
  release()
  expect(released).toEqual([value])
  resource.forceDispose()
  await resource.whenTerminal()
})

it.each([false, true])(
  'ARC-T02 closes a resource-leased pending load without aborting it, failing=%s',
  async (failing) => {
    let resolve!: (value: object) => void
    let reject!: (error: unknown) => void
    const blocked = new Promise<object>((yes, no) => {
      resolve = yes
      reject = no
    })
    const value = {}
    const failure = new Error('closing load failed')
    const released: object[] = []
    const reports: unknown[] = []
    let signal!: { readonly aborted: boolean }
    const resource = createStoreResource(
      (context) => {
        signal = context.signal
        return blocked
      },
      {
        dispose: (item) => {
          released.push(item)
        },
        onError: (error) => {
          reports.push(error)
        }
      }
    )
    const release = resource.retainResource()
    const operation = pending(resource)
    await Promise.resolve()
    resource.dispose()
    expect(signal.aborted).toBe(false)
    if (failing) {
      reject(failure)
      await expect(operation).rejects.toBe(failure)
      await resource.whenTerminal()
      expect(reports).toEqual([failure])
      expect(released).toEqual([])
      release()
    } else {
      resolve(value)
      expect(await operation).toBe(value)
      expect(resource.read()).toBe(value)
      expect(released).toEqual([])
      release()
      await resource.whenTerminal()
      expect(released).toEqual([value])
    }
  }
)
