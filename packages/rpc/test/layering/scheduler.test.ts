import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManualScheduler, systemScheduler } from '@migaia/utils/promise'
import { createEndpoint, RpcConfigurationError, RpcTimeoutError } from '../../src/core/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { abort } from '../../src/core/middleware/abort.js'
import { defineMiddleware } from '../../src/core/middleware.js'
import { connect } from '../../src/core/middleware/connect.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import { createEndpointTimePort } from '../../src/core/internal/time-port.js'
import type { IRpcTransport } from '../../src/core/transport.js'

/** Captures scheduler identity at all three ownership boundaries. */
const schedulerCalls = vi.hoisted(() => ({
  kernel: [] as unknown[],
  kernelTime: [] as unknown[],
  webRpcHost: [] as unknown[],
  pluginHost: [] as unknown[]
}))

vi.mock('../../src/core/endpoint-kernel.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/endpoint-kernel.js')>(
    '../../src/core/endpoint-kernel.js'
  )
  return {
    ...actual,
    createEndpointKernel: (...args: Parameters<typeof actual.createEndpointKernel>) => {
      schedulerCalls.kernel.push(args[2])
      const kernel = actual.createEndpointKernel(...args)
      schedulerCalls.kernelTime.push(kernel.time.scheduler)
      return kernel
    }
  }
})

vi.mock('../../src/core/internal/web-rpc-plugin-host.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/core/internal/web-rpc-plugin-host.js')
  >('../../src/core/internal/web-rpc-plugin-host.js')
  return {
    ...actual,
    createWebRpcPluginHost: (...args: Parameters<typeof actual.createWebRpcPluginHost>) => {
      schedulerCalls.webRpcHost.push(args[4].scheduler)
      return actual.createWebRpcPluginHost(...args)
    }
  }
})

vi.mock('@migaia/plugin-host', async () => {
  const actual = await vi.importActual<typeof import('@migaia/plugin-host')>('@migaia/plugin-host')
  return {
    ...actual,
    defineHost: (options: Parameters<typeof actual.defineHost>[0]) => {
      schedulerCalls.pluginHost.push(options.host?.scheduler)
      return actual.defineHost(options)
    }
  }
})

/** Runtime-neutral core source root for the global-time bypass oracle. */
const coreRoot = join(import.meta.dirname, '../../src/core')

/** Recursively lists executable source files without generated declarations. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** A transport that never delivers, leaving outbound deadline ownership observable. */
function silentTransport(): IRpcTransport {
  return {
    platform: 'Memory',
    ownership: 'borrowed',
    topology: 'exclusive',
    send() {},
    subscribe() {
      return () => undefined
    }
  }
}

/** Lets queued delivery and provider continuations settle without advancing scheduler time. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('endpoint scheduler ownership', () => {
  it('A6 owns manual timer order, cancellation, and disposal through one time port', () => {
    const scheduler = createManualScheduler()
    const time = createEndpointTimePort(scheduler)
    expect(time.scheduler).toBe(scheduler)
    const fired: string[] = []
    time.setTimeout(() => fired.push('first'), 50)
    const cancelled = time.setTimeout(() => fired.push('cancelled'), 50)
    time.setTimeout(() => fired.push('second'), 50)
    time.clearTimeout(cancelled)
    scheduler.advance(49)
    expect(fired).toEqual([])
    scheduler.advance(1)
    expect(fired).toEqual(['first', 'second'])
    time.setTimeout(() => fired.push('disposed'), 100)
    time.dispose()
    expect(scheduler.pendingCount).toBe(0)
    time.setTimeout(() => fired.push('after dispose'), 1)
    scheduler.advance(101)
    expect(fired).toEqual(['first', 'second'])
  })

  it('A6 injects manual time into an endpoint deadline and rejects malformed schedulers', async () => {
    const scheduler = createManualScheduler()
    const transport = silentTransport()
    const endpoint = await createEndpoint({
      id: 'manual-time-client',
      transport,
      scheduler,
      middlewares: [connect({ transport }), timeout()]
    })
    const pending = endpoint.send('missing-server', 'echo', null, { timeoutMs: 50 })
    const result = pending.catch((error: unknown) => error)
    scheduler.advance(49)
    await Promise.resolve()
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    scheduler.advance(1)
    expect(await result).toBeInstanceOf(RpcTimeoutError)
    await endpoint.dispose()
    expect(scheduler.pendingCount).toBe(0)

    for (const invalid of [{ now: () => 1 }, { now: () => 1.5, schedule: scheduler.schedule }]) {
      const failure = await createEndpoint({
        id: 'invalid-scheduler',
        transport: silentTransport(),
        scheduler: invalid as typeof scheduler,
        middlewares: [connect()]
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RpcConfigurationError)
      expect(failure).toMatchObject({ code: 'INVALID_CONFIG' })
    }
  })

  it('A6 times out construction through the injected scheduler', async () => {
    const scheduler = createManualScheduler()
    const transport = silentTransport()
    const stall = defineMiddleware('scheduler-stall', () => ({
      install: () => new Promise<Record<string, never>>(() => undefined)
    }))
    const pending = createEndpoint({
      id: 'scheduler-construction',
      transport,
      scheduler,
      construction: { timeoutMs: 100 },
      middlewares: [connect({ transport }), stall]
    })
    const result = pending.catch((error: unknown) => error)
    for (let index = 0; index < 40 && scheduler.pendingCount === 0; index += 1)
      await Promise.resolve()
    expect(scheduler.pendingCount).toBeGreaterThan(0)
    scheduler.advance(100)
    expect(await result).toMatchObject({ code: 'MUTATION_EXECUTION_TIMEOUT' })
    expect(scheduler.pendingCount).toBe(0)
  })

  it('A6 preserves original scheduler identity through kernel and PluginHost', async () => {
    const scheduler = createManualScheduler()
    const transport = silentTransport()
    const injected = await createEndpoint({
      id: 'scheduler-injected-identity',
      transport,
      scheduler,
      middlewares: [connect({ transport })]
    })
    expect(schedulerCalls.kernel.at(-1)).toBe(scheduler)
    expect(schedulerCalls.kernelTime.at(-1)).toBe(scheduler)
    expect(schedulerCalls.webRpcHost.at(-1)).toBe(scheduler)
    expect(schedulerCalls.pluginHost.at(-1)).toBe(scheduler)
    expect(Object.isFrozen(scheduler)).toBe(false)
    await injected.dispose()

    const defaultTransport = silentTransport()
    const defaultEndpoint = await createEndpoint({
      id: 'scheduler-default-identity',
      transport: defaultTransport,
      middlewares: [connect({ transport: defaultTransport })]
    })
    expect(schedulerCalls.kernel.at(-1)).toBeUndefined()
    expect(schedulerCalls.kernelTime.at(-1)).toBe(systemScheduler)
    expect(schedulerCalls.webRpcHost.at(-1)).toBeUndefined()
    expect(schedulerCalls.pluginHost.at(-1)).toBeUndefined()
    await defaultEndpoint.dispose()
  })

  it('A6 timestamps failed responses and expires replay using manual time', async () => {
    const scheduler = createManualScheduler()
    const [clientBase, serverBase] = createMemoryTransportPair()
    const requests: unknown[] = []
    const responses: unknown[] = []
    const clientTransport: IRpcTransport = {
      ...clientBase,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'request') requests.push(message)
        return clientBase.send(message, options)
      }
    }
    const serverTransport: IRpcTransport = {
      ...serverBase,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'response') responses.push(message)
        return serverBase.send(message, options)
      }
    }
    let calls = 0
    const server = await createEndpoint({
      id: 'scheduler-server',
      transport: serverTransport,
      scheduler,
      provider: {
        fail: (context) => {
          calls += 1
          return context.failed('expected failure', 'EXPECTED_FAILURE')
        }
      },
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createEndpoint({
      id: 'scheduler-client',
      transport: clientTransport,
      scheduler,
      middlewares: [connect({ transport: clientTransport })]
    })
    scheduler.advance(42)
    await expect(client.send('scheduler-server', 'fail', null)).rejects.toBeDefined()
    expect(calls).toBe(1)
    expect(requests).toHaveLength(1)
    expect((responses[0] as { data?: { webRpc?: { sentAt?: number } } }).data?.webRpc?.sentAt).toBe(
      42
    )
    await clientBase.send(requests[0])
    await flushMicrotasks()
    expect(calls).toBe(1)
    scheduler.advance(310_001)
    await clientBase.send(requests[0])
    await flushMicrotasks()
    expect(calls).toBe(2)
    await client.dispose()
    await server.dispose()
    expect(scheduler.pendingCount).toBe(0)
  })

  it('A6 expires an early abort before a delayed provider request arrives', async () => {
    const scheduler = createManualScheduler()
    const [clientBase, serverTransport] = createMemoryTransportPair()
    let heldRequest: unknown
    let abortTimestamp: number | undefined
    const clientTransport: IRpcTransport = {
      ...clientBase,
      send(message, options) {
        const frame = message as {
          kind?: unknown
          data?: { webRpc?: { sentAt?: number; variation?: string } }
        }
        if (frame.kind === 'request') {
          heldRequest = message
          return
        }
        if (frame.kind === 'variation' && frame.data?.webRpc?.variation === 'abort')
          abortTimestamp = frame.data.webRpc.sentAt
        return clientBase.send(message, options)
      }
    }
    let providerAborted: boolean | undefined
    const server = await createEndpoint({
      id: 'early-abort-server',
      transport: serverTransport,
      scheduler,
      provider: {
        observe: (context) => {
          providerAborted = context.signal.aborted
          return context.success('completed')
        }
      },
      middlewares: [connect({ transport: serverTransport }), abort()]
    })
    const client = await createEndpoint({
      id: 'early-abort-client',
      transport: clientTransport,
      scheduler,
      middlewares: [connect({ transport: clientTransport }), abort(), timeout()]
    })
    const pending = client.send('early-abort-server', 'observe', null, { timeoutMs: 50 })
    for (let index = 0; index < 80 && heldRequest === undefined; index += 1) await Promise.resolve()
    expect(heldRequest).toBeDefined()
    scheduler.advance(50)
    await expect(pending).rejects.toBeInstanceOf(RpcTimeoutError)
    await flushMicrotasks()
    expect(abortTimestamp).toBe(50)
    scheduler.advance(310_001)
    await clientBase.send(heldRequest)
    for (let index = 0; index < 80 && providerAborted === undefined; index += 1)
      await Promise.resolve()
    expect(providerAborted).toBe(false)
    await client.dispose()
    await server.dispose()
    expect(scheduler.pendingCount).toBe(0)
  })

  it('A6 leaves no global Date or old timer owners in core source', () => {
    const systemOwners = new Set<string>()
    for (const path of sources(coreRoot)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          expect(node.text, path).not.toMatch(
            /^(Date|createRuntimeTimer|waitWithSignal|ControlTaskRegistry)$/u
          )
          if (node.text === 'systemScheduler') systemOwners.add(path.replace(`${coreRoot}/`, ''))
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect([...systemOwners]).toEqual(['endpoint-kernel.ts'])
  })

  it('A10 retains very long endpoint deadlines and requests unref for system timers', async () => {
    vi.useFakeTimers()
    const transport = silentTransport()
    const endpoint = await createEndpoint({
      id: 'scheduler-long-deadline',
      transport,
      middlewares: [connect({ transport }), timeout()]
    })
    const result = endpoint
      .send('missing-server', 'echo', null, {
        timeoutMs: 2_147_483_648
      })
      .then(
        () => 'resolved',
        () => 'rejected'
      )
    let settled = false
    void result.then(() => {
      settled = true
    })
    vi.advanceTimersByTime(1000)
    await flushMicrotasks()
    expect(settled).toBe(false)
    await endpoint.dispose()

    vi.useRealTimers()
    const unref = vi.fn()
    const schedule = vi.spyOn(systemScheduler, 'schedule').mockImplementation(() => ({
      cancel() {},
      unref
    }))
    try {
      const port = createEndpointTimePort(systemScheduler)
      port.setTimeout(() => undefined, 10)
      expect(unref).toHaveBeenCalledTimes(1)
      port.dispose()
    } finally {
      schedule.mockRestore()
    }
  })
})
