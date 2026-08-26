import { describe, expect, it } from 'vitest'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../src/core.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { outbound } from '../src/features/outbound.js'
import { connect } from '../src/middleware/connect.js'
import { hooks } from '../src/middleware/hooks.js'
import type { IWebRpcHookEvent, IWebRpcPlugin } from '../src/typing.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

let idSequence = 0

/** Creates a real middleware whose unresolved install exposes Host rollback cleanup. */
function createPendingMiddleware(
  started: () => void,
  pending: Promise<never>,
  onCleanup: () => void
): IWebRpcPlugin {
  return {
    name: `construction-pending-${idSequence++}`,
    metadata: { claims: emptyClaims },
    install: (scope) => {
      scope.own({}, onCleanup)
      started()
      return pending
    }
  }
}

/** Builds the public factory configuration used by the real construction transaction tests. */
function createConfig(
  signal: AbortSignal,
  listeners: readonly ((event: IWebRpcHookEvent) => void | Promise<void>)[],
  onHookError?: (error: unknown, event: IWebRpcHookEvent) => void,
  pending?: IWebRpcPlugin
): IWebRpcCoreConfig {
  const [transport] = createMemoryTransportPair()
  return {
    id: `construction-hooks-${idSequence++}`,
    transport,
    middlewares: [
      hooks({ listeners, onHookError }),
      connect(),
      ...(pending === undefined ? [] : [pending])
    ],
    construction: { signal }
  }
}

describe('real construction diagnostic reporter', () => {
  it('delivers the exact late install error after factory rejection and Host rollback', async () => {
    const controller = new AbortController()
    let resolveStarted!: () => void
    let rejectLate!: (error: unknown) => void
    let cleanupCalls = 0
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const pending = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const lateError = new Error('late construction failure')
    const events: IWebRpcHookEvent[] = []
    const pendingMiddleware = createPendingMiddleware(resolveStarted, pending, () => {
      cleanupCalls += 1
    })
    const construction = createComposedEndpoint(
      createConfig(
        controller.signal,
        [
          (event) => {
            events.push(event)
          }
        ],
        undefined,
        pendingMiddleware
      ),
      [outbound()]
    )

    await started
    controller.abort('construction cancelled')
    await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(cleanupCalls).toBe(1)
    expect(events).toHaveLength(0)

    rejectLate(lateError)
    await viWaitFor(() => {
      expect(events).toHaveLength(1)
    })
    expect(events[0]).toMatchObject({
      name: 'failure',
      code: 'INTERNAL',
      localId: expect.stringMatching(/^construction-hooks-/),
      at: expect.any(Number),
      error: lateError
    })
    expect(events[0]?.error).toBe(lateError)
    expect(cleanupCalls).toBe(1)
    // Mutation control: an outer finally/dispose would increment cleanupCalls or duplicate events.
  })

  it('isolates sync and async listener failures while preserving late delivery', async () => {
    const controller = new AbortController()
    let resolveStarted!: () => void
    let rejectLate!: (error: unknown) => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const pending = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const syncFailure = new Error('sync hook failure')
    const asyncFailure = new Error('async hook failure')
    const lateError = new Error('late diagnostic')
    const events: IWebRpcHookEvent[] = []
    const hookErrors: unknown[] = []
    const pendingMiddleware = createPendingMiddleware(resolveStarted, pending, () => undefined)
    const construction = createComposedEndpoint(
      createConfig(
        controller.signal,
        [
          () => {
            throw syncFailure
          },
          async () => {
            throw asyncFailure
          },
          (event) => {
            events.push(event)
          }
        ],
        (error) => {
          hookErrors.push(error)
        },
        pendingMiddleware
      ),
      [outbound()]
    )

    await started
    controller.abort()
    await expect(construction).rejects.toMatchObject({ code: 'CANCELLED' })
    rejectLate(lateError)
    await viWaitFor(() => {
      expect(events).toHaveLength(1)
      expect(hookErrors).toHaveLength(2)
    })
    expect(events[0]?.error).toBe(lateError)
    expect(hookErrors).toEqual([syncFailure, asyncFailure])
  })

  it('does not report a pre-settlement primary install failure as a late diagnostic', async () => {
    const primaryFailure = new Error('primary construction failure')
    const events: IWebRpcHookEvent[] = []
    const [transport] = createMemoryTransportPair()
    const failing: IWebRpcPlugin = {
      name: 'construction-primary-failure',
      metadata: { claims: emptyClaims },
      install: () => {
        throw primaryFailure
      }
    }
    const construction = createComposedEndpoint(
      {
        id: `construction-primary-${idSequence++}`,
        transport,
        middlewares: [
          hooks({
            listeners: [
              (event) => {
                events.push(event)
              }
            ]
          }),
          connect(),
          failing
        ]
      },
      [outbound()]
    )

    await expect(construction).rejects.toBe(primaryFailure)
    expect(events.filter((event) => event.error === primaryFailure)).toHaveLength(0)
  })
})

/** Uses Vitest's bounded polling without coupling the test to timer implementation details. */
async function viWaitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await Promise.resolve()
    }
  }
  throw lastError
}
