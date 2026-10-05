import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createThreadPlugin, type IRuntimeThreadPluginOptions } from '../../src/threads/plugin.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import * as portable from '../../src/contract/normalize.js'
import { byteProcessPipeline, messageProcessPipeline } from '../../src/process/pipeline.js'
import { registerFastCodec } from '../../src/core/internal/fast-path.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { ping } from '../../src/core/middleware/ping.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import {
  readAuthenticationEnvelope,
  wrapAuthenticationEnvelope
} from '../../src/core/middleware/authentication-envelope.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'

/** Read the original handshake's actual Host node, independently of an observed business route. */
async function nodeOf(host: ReturnType<typeof owner>, connection: string): Promise<string> {
  return (await readRuntimeOutletConnection(host.thread, connection)!.peer.describe()).nodeId!
}

/** Genuine Hosts retain the canonical registration, availability and cleanup owners. */
function owner() {
  return runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/** Join two actual Plugin registrations; no substitute dispatcher resolves business methods. */
async function attach(
  left: ReturnType<typeof owner>,
  right: ReturnType<typeof owner>,
  leftName: string,
  rightName: string,
  leftOptions: Partial<IRuntimeThreadPluginOptions> = {},
  rightOptions: Partial<IRuntimeThreadPluginOptions> = {},
  carrier = runtimeSources()
) {
  /** A rejected right-hand configuration must not strand the other source at its offer barrier. */
  let opposite: Promise<unknown> | undefined
  try {
    await right.use(
      createThreadPlugin({
        ...rightOptions,
        name: rightName,
        self: { name: rightName, instanceId: `${rightName}-caller` },
        connect: async (context) => {
          opposite = left.use(
            createThreadPlugin({
              ...leftOptions,
              name: leftName,
              self: { name: leftName, instanceId: `${leftName}-caller` },
              connect: carrier.sources[0],
              report: leftOptions.report ?? (() => undefined)
            })
          )
          return carrier.sources[1](context)
        },
        report: rightOptions.report ?? (() => undefined)
      })
    )
    await opposite
    return carrier
  } catch (error) {
    await opposite
    carrier.close()
    throw error
  }
}

it('[A104/A105] two forward Hosts preserve a notify-only terminal and await its completion', async () => {
  /** Four actual Hosts exercise two forward entries before the declared one-way provider. */
  const owners = [owner(), owner(), owner(), owner()] as const
  /** Original carriers remain alive until every Host has disposed its admitted work. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Terminal execution is observed independently of A ordinary physical-send completion. */
  const calls: unknown[] = []
  /** Actual forwarding failures are recorded through the original provider reporter. */
  const failures: any[] = []
  try {
    carriers.push(
      await attach(
        owners[2],
        owners[3],
        'd',
        'c',
        {},
        {
          contract: {
            schemaVersion: 1,
            plugin: 'service',
            features: { data: { methods: { tell: { mode: 'one-way', idempotent: false } } } }
          },
          provide: {
            service: {
              data: {
                tell: (value) => {
                  calls.push(value)
                }
              }
            }
          }
        }
      )
    )
    await owners[2].thread!.notify('d', 'service.data.tell', 'direct')
    await vi.waitFor(() => assert.deepEqual(calls, ['direct']))
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          expose: ['d.service.data.tell'],
          report: (error) => failures.push(error)
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['c.d.service.data.tell'],
          report: (error) => failures.push(error)
        }
      )
    )
    await owners[0].thread!.notify('b', 'c.d.service.data.tell', 'forwarded')
    await vi.waitFor(() => assert.deepEqual(calls, ['direct', 'forwarded']))
    assert.equal(failures.length, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A102/A104] one explicit connection method forwards through B with B as the direct caller', async () => {
  /** Three independent Hosts distinguish the original caller from the forwarding authority. */
  const owners = [owner(), owner(), owner()] as const
  /** Successful carriers remain owned by this fixture until all registrations close. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider observes actual caller context and independently counted business work. */
  const calls: unknown[] = []
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            math: {
              add: (payload, context) => {
                calls.push(Reflect.get(context, 'senderId'))
                return payload
              },
              sub: () => {
                calls.push('sub')
                return 0
              }
            }
          }
        }
      )
    )
    assert.equal(await owners[1].thread!.request('c', 'math.add', 42), 42)
    calls.length = 0
    /** Preserve a pre-change installation rejection for the intended business RED assertion. */
    const installed = await attach(
      owners[0],
      owners[1],
      'b',
      'a',
      {},
      {
        expose: ['c.math.add']
      }
    ).then(
      (carrier) => {
        carriers.push(carrier)
        return true
      },
      (error: unknown) => error
    )
    assert.equal(
      installed,
      true,
      '[A102] explicit remote exposure configures the original connection'
    )
    assert.equal(await owners[0].thread!.request('b', 'c.math.add', 42), 42)
    assert.deepEqual(calls, ['c-caller'], '[A102] C authorizes its direct B peer, rather than A')
    await assert.rejects(
      Promise.resolve().then(() => owners[0].thread!.request('b', 'c.math.sub')),
      { code: 'PROVIDER_NOT_FOUND' }
    )
    assert.equal(calls.length, 1, '[A104] an unexposed remote method performs no business')
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A103] an unexposed connection never forwards to its business provider', async () => {
  /** The working B-to-C path is independent evidence that the final provider is available. */
  const owners = [owner(), owner(), owner()] as const
  /** Each acquired source closes after its original Host scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Count business execution, rather than treating a rejected Promise as sufficient proof. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: { math: { add: () => ++calls } }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a'))
    await assert.rejects(
      Promise.resolve().then(() => owners[0].thread!.request('b', 'c.math.add')),
      { code: 'PROVIDER_NOT_FOUND' }
    )
    assert.equal(calls, 0)
    assert.equal(await owners[1].thread!.request('c', 'math.add'), 1)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A105] the original upstream abort reaches C and its remaining deadline never restarts', async () => {
  /** Each provider belongs to its actual Host scope. */
  const owners = [owner(), owner(), owner()] as const
  /** Acquired connections close after business cancellation settles. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider signals entry independently of the caller Promise. */
  let entered!: () => void
  /** Observe cancellation independently from the upstream rejection. */
  let canceled!: () => void
  /** No timer drives this fixture's synchronization. */
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  /** Resolve only when the original final-provider signal actually aborts. */
  const aborted = new Promise<void>((resolve) => {
    canceled = resolve
  })
  /** Record C's original deadline at actual provider entry. */
  let remaining: number | undefined
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            wait: (_payload, context) =>
              new Promise<void>((resolve) => {
                remaining = context.timeoutMs
                context.signal.addEventListener(
                  'abort',
                  () => {
                    canceled()
                    resolve()
                  },
                  { once: true }
                )
                entered()
              })
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.wait'] }))
    /** Cancellation must use the native signal rather than a forwarding-specific scope. */
    const controller = new AbortController()
    /** Attach rejection handling before abort can settle either original endpoint. */
    const result = owners[0]
      .thread!.request('b', 'c.wait', null, {
        signal: controller.signal,
        timeoutMs: 1000
      })
      .catch((error: unknown) => error)
    await started
    assert.ok(remaining !== undefined && remaining > 0 && remaining <= 1000)
    controller.abort()
    assert.equal(Reflect.get((await result) as object, 'code'), 'CANCELLED')
    await aborted
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A106] forwarded stream pulls remain lazy and early return reaches C exactly once', async () => {
  /** Actual stream owners retain both provider and caller lifetimes at every hop. */
  const owners = [owner(), owner(), owner()] as const
  /** Each original source remains live through the stream's return handshake. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Construction is independent from next credit, so unrequested pulls are detectable. */
  let constructed!: () => void
  /** Observe the genuine C iterator being installed, without a timing delay. */
  const ready = new Promise<void>((resolve) => {
    constructed = resolve
  })
  /** Count only final business pulls and cleanup. */
  let pulls = 0,
    returns = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            values: () => {
              constructed()
              return {
                [Symbol.asyncIterator]() {
                  return this
                },
                async next() {
                  pulls += 1
                  return { done: false as const, value: pulls }
                },
                async return() {
                  returns += 1
                  return { done: true as const, value: undefined }
                }
              }
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.values'] }))
    /** The public stream operation is identical for a local method and a forwarded method. */
    const iterator = owners[0].thread!.stream('b', 'c.values')
    assert.equal(pulls, 0, '[A106] upstream absence of credit performs no final next')
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    await ready
    assert.equal(pulls, 1)
    await iterator.return!()
    assert.equal(returns, 1)
    assert.equal(pulls, 1)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A107/A116] C business identity, stack and cause cross both hops with forward metadata', async () => {
  /** Business errors originate only at the final genuine provider. */
  const owners = [owner(), owner(), owner()] as const
  /** Original sources preserve wire serialization and cleanup ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Distinct native types and stacks distinguish the complete chain from a summary wrapper. */
  const cause = new TypeError('forward-fixture-cause')
  /** The source/code already belong to the public utils registry. */
  const original = attachErrorIdentity(new RangeError('forward-fixture-business', { cause }), {
    source: '@migaia/utils',
    code: 'INVALID_ARGUMENT'
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            fail: () => {
              throw original
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.fail'] }))
    /**
     * Preserve the top-level result for exact identity assertions instead of merely expecting
     * reject.
     */
    const failure = await owners[0].thread!.request('b', 'c.fail').catch((error: unknown) => error)
    assert.equal(Reflect.get(failure as object, 'source'), Reflect.get(original, 'source'))
    assert.equal(Reflect.get(failure as object, 'code'), Reflect.get(original, 'code'))
    assert.equal(Reflect.get(failure as object, 'stack'), original.stack)
    assert.equal(Reflect.get(Reflect.get(failure as object, 'cause'), 'stack'), cause.stack)
    assert.deepEqual(Reflect.get(failure as object, 'route'), [
      await nodeOf(owners[0], 'b'),
      await nodeOf(owners[1], 'a')
    ])
    assert.equal(
      owners[0].thread!.get('b').methods.find((method) => method.name === 'c.fail')?.forwardedVia,
      'c'
    )
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A109] A forwarding through B back to the same Host is refused before final business', async () => {
  /** Two different physical connections still refer to the same two runtime Host identities. */
  const owners = [owner(), owner()] as const
  /** Each actual source retains original scope ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The local terminal distinguishes refusal from a request that silently returned to its origin. */
  let calls = 0
  /** B's occupied provider lease distinguishes preflight from quota rejection. */
  let enter!: () => void, release!: () => void
  /** Observe actual entry without a delay. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** Keep the only B lease occupied while checking the loop. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[0],
        'back',
        'other',
        {},
        {
          provide: { echo: () => ++calls }
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['back.echo'],
          providerLimits: { maxGlobal: 1, maxPerPeer: 1 },
          provide: {
            hold: async () => {
              enter()
              await held
            }
          }
        }
      )
    )
    /** An unrelated admitted call occupies B before the loop is dispatched. */
    const occupied = owners[0].thread!.request('b', 'hold')
    await entered
    /** Counting the physical next-hop write distinguishes preflight refusal from a remote error. */
    const send = vi.spyOn(carriers[0]!.transports[0], 'send')
    /** Capture a success as well as a failure so the pre-change oracle fails for the right reason. */
    const result = await owners[0]
      .thread!.request('b', 'back.echo')
      .catch((error: unknown) => error)
    assert.equal(
      typeof result === 'object' && result !== null ? Reflect.get(result, 'code') : result,
      'FORWARD_LOOP'
    )
    assert.equal(calls, 0, '[A109] the rejected next hop never executes')
    assert.equal(send.mock.calls.length, 0, '[A109] the refused hop sends no frame')
    assert.deepEqual(Reflect.get(result as object, 'route'), [await nodeOf(owners[0], 'b')])
    release()
    await occupied
  } finally {
    release()
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it.each([3, 4])(
  '[A110] exactly three forwarding Hosts succeed; %i forwarding Hosts obey the fixed limit',
  async (hops) => {
    /** Each forwarding layer owns an independent Host and one real downstream slot. */
    const owners = Array.from({ length: hops + 2 }, () => owner())
    /** Backward construction makes every downstream directory available before compiling exposure. */
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** The logical method prefix grows once for each explicitly configured forward entry. */
    let method = 'echo'
    /** No rejected request may reach the final business provider. */
    let calls = 0
    /** A final context provides the actual ordered node route independently of caller-side metadata. */
    let route: unknown
    try {
      for (let index = owners.length - 2; index >= 0; index -= 1) {
        const terminal = index === owners.length - 2
        carriers.push(
          await attach(
            owners[index]!,
            owners[index + 1]!,
            'next',
            'upstream',
            {},
            terminal
              ? {
                  provide: {
                    echo: (_payload, context) => {
                      calls += 1
                      route = Reflect.get(context, 'route')
                      return 42
                    }
                  }
                }
              : { expose: [`next.${method}`] }
          )
        )
        if (!terminal) method = `next.${method}`
      }
      /** Only the final carrier follows the potentially refused fourth forward node. */
      const finalSend = vi.spyOn(carriers[0]!.transports[0], 'send')
      const result = await owners[0]!
        .thread!.request('next', method)
        .catch((error: unknown) => error)
      if (hops === 3) {
        assert.equal(result, 42)
        assert.equal(calls, 1)
        assert.ok(
          Array.isArray(route) && route.length === 4,
          '[A111] origin plus three forward nodes are ordered'
        )
        assert.equal(new Set(route).size, 4)
        assert.equal(Object.isFrozen(route), true)
        assert.deepEqual(
          route,
          await Promise.all(owners.slice(0, 4).map((host) => nodeOf(host, 'next')))
        )
      } else {
        assert.equal(
          typeof result === 'object' && result !== null ? Reflect.get(result, 'code') : result,
          'FORWARD_HOP_LIMIT'
        )
        assert.equal(calls, 0)
        assert.equal(finalSend.mock.calls.length, 0)
        assert.deepEqual(
          Reflect.get(result as object, 'route'),
          await Promise.all(owners.slice(0, 4).map((host) => nodeOf(host, 'next')))
        )
      }
    } finally {
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
    }
  }
)

it('[A109] A through B and C back to B is refused at C before its outbound send', async () => {
  /** Three Hosts exercise a repeated intermediate node, rather than only a repeated origin. */
  const owners = [owner(), owner(), owner()] as const
  /** Every connection still belongs to its actual Plugin scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The terminal is on B; reaching it would prove the repeated route was accepted. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[2],
        owners[1],
        'back',
        'other',
        {},
        {
          provide: { echo: () => ++calls }
        }
      )
    )
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'fromB',
        {},
        {
          expose: ['back.echo']
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'fromA',
        {},
        {
          expose: ['c.back.echo']
        }
      )
    )
    /** The rejected C-to-B hop cannot use transport completion as its refusal boundary. */
    const send = vi.spyOn(carriers[0]!.transports[0], 'send')
    const failure = await owners[0].thread!.request('b', 'c.back.echo').catch((error) => error)
    assert.equal(failure.code, 'FORWARD_LOOP')
    assert.deepEqual(failure.route, [await nodeOf(owners[0], 'b'), await nodeOf(owners[1], 'c')])
    assert.equal(send.mock.calls.length, 0)
    assert.equal(calls, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A107] a forwarded iterator failure keeps C source, stack, cause and admitted route', async () => {
  /** All iterator work crosses the actual stream owners at both hops. */
  const owners = [owner(), owner(), owner()] as const
  /** Scope cleanup remains independent of a failed pull. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider's native cause has its own independently recorded stack. */
  const cause = new TypeError('forward-stream-cause')
  /** Existing utils identity distinguishes business failure from B's stream controls. */
  const original = attachErrorIdentity(new RangeError('forward-stream-business', { cause }), {
    source: '@migaia/utils',
    code: 'INVALID_ARGUMENT'
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            fail: async function* () {
              throw original
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.fail'] }))
    const failure = await owners[0]
      .thread!.stream('b', 'c.fail')
      .next()
      .catch((error) => error)
    assert.equal(failure.source, Reflect.get(original, 'source'))
    assert.equal(failure.code, Reflect.get(original, 'code'))
    assert.equal(failure.stack, original.stack)
    assert.equal(failure.cause.stack, cause.stack)
    assert.deepEqual(failure.route, [await nodeOf(owners[0], 'b'), await nodeOf(owners[1], 'c')])
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A115] forwarded notify holds B admission until the actual C provider completes', async () => {
  /** B's provider limit is the resource under test; A's physical completion is independent. */
  const owners = [owner(), owner(), owner()] as const
  /** Both sources retain their ordinary provider and transport ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Synchronization observes genuine C business entry and completion without timer delays. */
  let enter!: () => void, release!: () => void
  /** C signals only after receiving the forwarded notification. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** Actual provider work remains pending until the test explicitly completes it. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** This independent method proves the next admitted request really executes after release. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            hold: async () => {
              enter()
              await held
            },
            echo: () => ++calls
          }
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['c.hold', 'c.echo'],
          providerLimits: { maxGlobal: 1, maxPerPeer: 1 }
        }
      )
    )
    await owners[0].thread!.notify('b', 'c.hold')
    await entered
    await assert.rejects(owners[0].thread!.request('b', 'c.echo'), { code: 'OVERLOADED' })
    assert.equal(calls, 0)
    release()
    await vi.waitFor(async () => assert.equal(await owners[0].thread!.request('b', 'c.echo'), 1))
    assert.equal(calls, 1)
  } finally {
    release()
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A108] a forwarded native call retires once and a fresh call uses C replacement', async () => {
  /** A-to-B uses an ordinary source while B owns a genuine supervised Worker connection. */
  const owners = [owner(), owner()] as const
  /** Cleanup covers A-to-B independently of the native execution budget. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The real unit budget must return to zero after all native generations close. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** Native handles provide authoritative termination and exit observations. */
  const launcher = createNodeThreadLauncher()
  /** Every acquired Worker remains in the test's final cleanup set. */
  const handles: INodeThreadHandle[] = []
  /** A forwarded execution must never enter a caller-supplied retry implementation. */
  let retryCalls = 0
  /** The final provider uses the existing parent reverse route to signal actual execution. */
  let enter!: () => void
  /** No process is terminated before the business provider has definitely started. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  try {
    await owners[1].use(
      definePlugin({
        name: 'parent',
        features: { data: defineFeature(() => ({ echo: () => 42, started: () => enter() })) },
        install: () => ({})
      })
    )
    await owners[1].use(
      createThreadPlugin({
        name: 'c',
        expose: ['parent'],
        report: () => undefined,
        retryPort: {
          dispatch: async (input) => {
            retryCalls += 1
            return input.sendOnce({
              expectedGeneration: input.generation,
              key: input.key,
              remainingMs: input.timeoutMs
            })
          }
        },
        spawn: {
          spec: {
            entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)),
            data: { advanced: true, crash: true }
          },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              const handle = await launcher.launch(
                {
                  ...args[0],
                  data: { ...(args[0].data as object), sequence: handles.length + 1 }
                },
                args[1]
              )
              handles.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
          report: () => undefined
        }
      })
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c'] }))
    /** The first success independently establishes the final native business path. */
    const first = owners[1].thread!.get('c').instanceId
    assert.equal(
      await owners[0].thread!.request('b', 'c.service.data.read', 'ordinary'),
      'ordinary'
    )
    const pending = owners[0]
      .thread!.request('b', 'c.service.data.read', 'retry', { timeoutMs: 3000 })
      .catch((error) => error)
    await entered
    await handles[0]!.exited
    const failure = await pending
    assert.equal(failure.code, 'PROVIDER_GENERATION_RETIRED')
    assert.equal(failure.source, '@migaia/rpc/core')
    assert.equal(retryCalls, 0, '[A108] an idempotent forward never enters custom retry')
    /** The next logical call may target the genuine replacement; the old call cannot replay. */
    await vi.waitFor(
      async () => {
        assert.equal(
          await owners[0].thread!.request('b', 'c.service.data.read', 'replacement'),
          'replacement'
        )
        assert.notEqual(owners[1].thread!.get('c').instanceId, first)
      },
      { timeout: 3000 }
    )
    assert.equal(handles.length, 2)
    assert.equal(retryCalls, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
}, 15_000)

it('[A115] unUse withdraws the forward slot and a same-name connection restores new calls', async () => {
  /** A-to-B retains its compiled method table while B replaces only the downstream connection. */
  const owners = [owner(), owner(), owner()] as const
  /** Each real source closes after its original registration scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The original and replacement final providers have separate execution counts. */
  const calls = [0, 0]
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            echo: () => {
              calls[0]! += 1
              return 'old'
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.echo'] }))
    assert.equal(await owners[0].thread!.request('b', 'c.echo'), 'old')
    await owners[1].unUse('c')
    await assert.rejects(owners[0].thread!.request('b', 'c.echo'), (error) => {
      assert.equal((error as any).source, '@migaia/rpc/core')
      assert.equal((error as any).code, 'TARGET_UNKNOWN')
      assert.equal((error as any).cause.code, 'PLUGIN_NOT_INSTALLED')
      return true
    })
    assert.deepEqual(calls, [1, 0])
    await owners[2].unUse('b')
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            echo: () => {
              calls[1]! += 1
              return 'replacement'
            }
          }
        }
      )
    )
    assert.equal(await owners[0].thread!.request('b', 'c.echo'), 'replacement')
    assert.deepEqual(calls, [1, 1])
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A115] closing B cancels its actual downstream provider before scope release completes', async () => {
  /** C observes the original provider signal independently of the upstream Promise. */
  const owners = [owner(), owner(), owner()] as const
  /** Keep both actual physical sources live until all scope cleanup completes. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Provider entry and abort observation require no timer or synthetic completion. */
  let enter!: () => void, cancel!: () => void
  /** Only real C business entry allows this fixture to request B closure. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** The original C abort signal must settle this observation before B closes. */
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            hold: (_payload, context) =>
              new Promise<void>((resolve) => {
                context.signal.addEventListener(
                  'abort',
                  () => {
                    cancel()
                    resolve()
                  },
                  { once: true }
                )
                enter()
              })
          }
        }
      )
    )
    /** This source owns physical close, so the remote caller observes the native transport failure. */
    const carrier = runtimeSources()
    const closing = {
      ...carrier,
      sources: [
        carrier.sources[0],
        async (context: Parameters<(typeof carrier.sources)[1]>[0]) => ({
          ...(await carrier.sources[1](context)),
          close: async () => {
            carrier.close()
            return undefined
          }
        })
      ] as const
    }
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.hold'] }, closing))
    const pending = owners[0]
      .thread!.request('b', 'c.hold', null, { timeoutMs: 3000 })
      .catch((error) => error)
    await entered
    await owners[1].dispose()
    await cancelled
    const failure = await pending
    assert.equal(failure.source, '@migaia/rpc/core')
    assert.equal(failure.code, 'TRANSPORT')
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it.each(['process', 'thread'] as const)(
  '[A111/A113] %s forwarding keeps one inbound normalization, native encoding and two signatures',
  async (kind) => {
    /** The original Host and Plugin owners execute both authenticated hops. */
    const owners = [owner(), owner(), owner()] as const
    /** Raw carrier ownership is unchanged by counters around canonical codec methods. */
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** Only this exact fixture object marks business payloads in the normalization counter. */
    const marker = 'a113-forward-payload'
    /** Observing the existing export changes no normalization behavior. */
    const normalize = vi.spyOn(portable, 'normalizePortable')
    /** Only whole business request JSON, excluding auth wrappers, counts as process encoding. */
    const stringify = vi.spyOn(JSON, 'stringify')
    /** The true provider count distinguishes authentication refusal from replay admission. */
    let calls = 0
    /** Real authentication callbacks expose success and signature failures independently. */
    const signs = [0, 0],
      verifies = [0, 0]
    /** Reports are bounded to this fixture and contain no key or payload snapshot. */
    const failures: unknown[] = []
    /** Enable business counters only after both actual directories are ready. */
    let counting = false
    /** A final signed outbound frame is retained only for the requested tamper discriminator. */
    let signedFrame: unknown
    /** Codec decode and encode bracket the exact B forwarding interval. */
    let incomingAt = 0,
      forwardedNormalizations = -1
    /** Identity carrier must pass B's admitted payload reference directly into its physical send. */
    let admitted: unknown, outbound: unknown
    /** Each connection has a distinct public fixture key, proving independent hop authentication. */
    const signature = (hop: number, value: unknown) =>
      createHmac('sha256', `a113-public-key-${hop}`).update(JSON.stringify(value)).digest('hex')
    /** Decode observation reads the actual protected semantic envelope without acting as a receiver. */
    const semantic = (value: unknown): any => {
      const bound = readAuthenticationEnvelope(value)
      return typeof bound.payload === 'string' ? JSON.parse(bound.payload) : bound.payload
    }
    /**
     * Custom factories select the existing Runtime API preset and its original authentication
     * owner.
     */
    const factory =
      (id: string, hop: number, side: number) =>
      async (channel: IRemoteChannel): Promise<IRemoteServeEndpoint> => {
        const endpoint = await createRuntimeApiEndpoint(
          {
            id,
            scheduler: channel.scheduler,
            targetIds: [channel.peerId],
            transport: channel.transport,
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              connect({ transport: channel.transport }),
              abort(),
              timeout(),
              ping(),
              hooks(),
              authentication({
                sign(value) {
                  const request = semantic(value)
                  if (counting && side === 0 && request.kind === 'request') signs[hop]! += 1
                  const frame = { value, signature: signature(hop, value) }
                  const encoded = kind === 'process' ? JSON.stringify(frame) : frame
                  if (counting && hop === 1 && side === 0 && request.method === 'echo')
                    signedFrame = encoded
                  return encoded
                },
                verify(value) {
                  const frame = (typeof value === 'string' ? JSON.parse(value) : value) as {
                    value: unknown
                    signature: string
                  }
                  assert.equal(
                    frame.signature,
                    signature(hop, frame.value),
                    '[A111] signed route cannot be changed'
                  )
                  const request = semantic(frame.value)
                  if (counting && side === 1 && request.kind === 'request') verifies[hop]! += 1
                  return frame.value
                }
              })
            ]
          },
          { supports: () => true },
          true
        )
        const original = endpoint as unknown as IRpcEndpoint
        original.hooks.on((event) => {
          if (event.name === 'failure') failures.push(event.error)
        })
        return { endpoint: original, oneWay: endpoint, stream: endpoint.stream }
      }
    /** Counter wrappers delegate exact registered codecs; they add no normalization or encoding. */
    const sourcePair = (hop: number) => {
      const carrier = runtimeSources()
      const pipeline = kind === 'process' ? byteProcessPipeline : messageProcessPipeline
      const sources = carrier.sources.map(
        (source, side) => async (context: Parameters<typeof source>[0]) => {
          const channel = await source(context)
          const codec = {
            ...pipeline.codec,
            encode(value: unknown) {
              if (counting && hop === 1 && side === 0 && (value as any).method === 'echo') {
                outbound = (value as any).data.payload
                const entries = normalize.mock.calls
                  .slice(incomingAt)
                  .filter(([input]) => (input as any)?.marker === marker)
                forwardedNormalizations = entries.length - 1
                admitted =
                  normalize.mock.results[
                    incomingAt +
                      normalize.mock.calls
                        .slice(incomingAt)
                        .findIndex(([input]) => (input as any)?.marker === marker)
                  ]?.value
              }
              return pipeline.codec.encode(value)
            },
            decode(value: unknown) {
              const decoded = pipeline.codec.decode(value)
              if (counting && hop === 0 && side === 1 && (decoded as any).kind === 'request')
                incomingAt = normalize.mock.calls.length
              return decoded
            }
          }
          registerFastCodec(codec)
          return {
            ...channel,
            pipeline: { codec, framer: pipeline.framer },
            agreement: { ...channel.agreement, codec: codec.id }
          }
        }
      ) as unknown as ReturnType<typeof runtimeSources>['sources']
      return { ...carrier, sources }
    }
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {
            endpointFactory: factory('c-caller', 1, 0)
          },
          {
            endpointFactory: factory('b-caller', 1, 1),
            provide: { echo: () => ++calls }
          },
          sourcePair(1)
        )
      )
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {
            endpointFactory: factory('b-caller', 0, 0)
          },
          {
            endpointFactory: factory('a-caller', 0, 1),
            expose: ['c.echo']
          },
          sourcePair(0)
        )
      )
      normalize.mockClear()
      stringify.mockClear()
      counting = true
      assert.equal(await owners[0].thread!.request('b', 'c.echo', { marker }), 1)
      assert.equal(
        forwardedNormalizations,
        0,
        '[A113] B adds no normalization after inbound admission'
      )
      assert.equal(
        outbound,
        admitted,
        '[A113] B outbound uses its original admitted payload reference'
      )
      assert.equal(
        stringify.mock.calls.filter(
          ([value]) => (value as any)?.kind === 'request' && (value as any)?.method === 'echo'
        ).length,
        kind === 'process' ? 1 : 0,
        '[A113] only the process codec encodes the whole forwarded request'
      )
      assert.deepEqual(signs, [1, 1])
      assert.deepEqual(verifies, [1, 1])
      assert.equal(failures.length, 0)
      /**
       * Delete a signed node while retaining the old signature; cryptographic verification must
       * fail.
       */
      const frame = (typeof signedFrame === 'string' ? JSON.parse(signedFrame) : signedFrame) as {
        value: unknown
        signature: string
      }
      const bound = readAuthenticationEnvelope(frame.value)
      const request = structuredClone(semantic(frame.value))
      request.data.route.forwardRoute.pop()
      const changed = wrapAuthenticationEnvelope(
        kind === 'process' ? JSON.stringify(request) : request,
        bound.nonce,
        BigInt(bound.counter)
      )
      const tampered = { value: changed, signature: frame.signature }
      carriers[0]!.transports[0].send(kind === 'process' ? JSON.stringify(tampered) : tampered)
      await vi.waitFor(() =>
        assert.equal(
          failures.filter((error) => (error as any)?.code === 'AUTHENTICATION_FAILED').length,
          1
        )
      )
      assert.equal(calls, 1, '[A111] changed route is rejected before the final provider')
      assert.deepEqual(
        verifies,
        [1, 1],
        '[A111] the changed signature never reaches replay admission'
      )
    } finally {
      counting = false
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      vi.restoreAllMocks()
    }
  }
)
