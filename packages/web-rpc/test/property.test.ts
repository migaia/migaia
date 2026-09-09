import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DiscoveryRegistry } from '../src/internal/discovery-registry'
import { ResourceScope } from '../src/internal/resource-scope'
import { RequestReplayLedger } from '../src/internal/request-replay-ledger'
import { createSettlement } from '../src/internal/settlement'
import { OperationScope } from '../src/internal/operation-scope'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { normalizeWebRpcRoutingData } from '../src/internal/routing-data.js'

const runtimeProcess = (globalThis as { process?: { env?: { CI?: string } } }).process
const propertyParameters = { numRuns: runtimeProcess?.env?.CI ? 2_000 : 500 } as const

describe('property invariants', () => {
  it('normalizes arbitrary JSON values without producing a mutable partial envelope', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.jsonValue(),
          fc.constant({ kind: 'request', id: 'valid', method: 'ping', data: null })
        ),
        (value) => {
          /** Captures either canonical success or the expected closed-boundary failure. */
          let outcome:
            | { readonly value: ReturnType<typeof normalizeRpcEnvelope> }
            | { readonly error: unknown }
          try {
            outcome = { value: normalizeRpcEnvelope(value) }
          } catch (error) {
            outcome = { error }
          }
          if ('error' in outcome) {
            expect(outcome.error).toMatchObject({ code: 'INVALID_ENVELOPE' })
            return
          }
          expect(Object.isFrozen(outcome.value)).toBe(true)
        }
      ),
      propertyParameters
    )
  })

  it('contains hostile getters and prototype keys at the wire boundary', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'profile',
          'type',
          'applicationVersion',
          'senderId',
          'targetId',
          'sentAt',
          'payload',
          '__proto__'
        ),
        (hostileKey) => {
          const base = {
            webRpc: {
              profile: 'web-rpc.route.v1',
              type: 'request',
              applicationVersion: '1',
              senderId: 'sender',
              targetId: 'target',
              sentAt: 1
            },
            payload: { safe: true }
          }
          const hostile = new Proxy(base, {
            get(target, key, receiver) {
              if (key === 'webRpc' && hostileKey !== 'payload' && hostileKey !== '__proto__')
                return new Proxy(target.webRpc, {
                  get(route, routeKey, routeReceiver) {
                    if (routeKey === hostileKey) throw new Error('hostile getter')
                    return Reflect.get(route, routeKey, routeReceiver)
                  }
                })
              if (key === hostileKey) throw new Error('hostile getter')
              return Reflect.get(target, key, receiver)
            }
          })
          const normalized = normalizeWebRpcRoutingData(hostile)
          if (hostileKey !== 'payload' && hostileKey !== '__proto__')
            expect(normalized).toBeUndefined()
          else {
            expect(Object.isFrozen(normalized)).toBe(true)
            if (hostileKey === 'payload') expect(normalized).not.toHaveProperty('payload')
          }
        }
      ),
      propertyParameters
    )
  })

  it('accepts only tag-owned portable route metadata', () => {
    const valid = normalizeWebRpcRoutingData({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'request',
        applicationVersion: '1.0.0',
        senderId: 'sender',
        targetId: 'target',
        sentAt: 1
      },
      payload: { args: [1, 2] }
    })
    expect(valid).toEqual({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'request',
        applicationVersion: '1.0.0',
        senderId: 'sender',
        targetId: 'target',
        sentAt: 1
      },
      payload: { args: [1, 2] }
    })
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'request',
          applicationVersion: '1.0.0',
          senderId: 'sender',
          targetId: 'target',
          accepted: true,
          sentAt: 1
        }
      })
    ).toBeUndefined()
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'request',
          applicationVersion: '1.0.0',
          senderId: 'sender',
          targetId: 'target',
          sentAt: 1,
          unexpected: true
        }
      })
    ).toBeUndefined()
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'request',
          applicationVersion: '1.0.0',
          senderId: 'sender',
          targetId: 'target',
          sentAt: 1
        },
        unexpected: true
      })
    ).toBeUndefined()
  })

  it('keeps discovery remote state equivalent to a bounded map model', () => {
    const command = fc.record({
      operation: fc.constantFrom('set' as const, 'delete' as const),
      key: fc.string({ minLength: 1, maxLength: 12 }),
      value: fc.integer()
    })
    fc.assert(
      fc.property(fc.array(command, { maxLength: 200 }), (commands) => {
        const registry = new DiscoveryRegistry()
        const model = new Map<string, number>()
        for (const current of commands) {
          if (current.operation === 'set') {
            expect(registry.setRemote(current.key, current.value, 32)).toBe(
              model.has(current.key) || model.size < 32
            )
            if (model.has(current.key) || model.size < 32) model.set(current.key, current.value)
          } else {
            expect(registry.deleteRemote(current.key)).toBe(model.delete(current.key))
          }
        }
        expect(new Map(registry.remoteSnapshot<number>())).toEqual(model)
      }),
      propertyParameters
    )
  })

  it('keeps verified remote bindings stable at capacity boundaries', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 16
        }),
        fc.integer({ min: 1, max: 8 }),
        (keys, capacity) => {
          const retained: string[] = []
          const registry = new DiscoveryRegistry({
            retain: (token) => {
              retained.push(token)
              return true
            },
            release: () => undefined
          })
          const accepted = keys.filter((key, index) =>
            registry.setRemoteWithBinding(key, { index }, `peer-${index}`, capacity)
          )
          expect(accepted).toHaveLength(Math.min(keys.length, capacity))
          for (const key of accepted) expect(registry.hasRemote(key)).toBe(true)
          const overflow = keys.slice(capacity)
          for (const key of overflow) expect(registry.hasRemote(key)).toBe(false)
          expect(retained).toHaveLength(accepted.length)
          expect(registry.remoteSnapshot().map(([key]) => key)).toEqual(accepted)
        }
      ),
      propertyParameters
    )
  })

  it('rejects every stale operation after abort or generation change', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (abortClosing, staleGeneration) => {
        const closing = new AbortController()
        const scope = new OperationScope(7, false, closing.signal)
        if (abortClosing) closing.abort()
        const generation = staleGeneration ? 8 : 7
        if (abortClosing || staleGeneration)
          expect(() => scope.assertActive(generation)).toThrow('Endpoint disposed')
        else expect(() => scope.assertActive(generation)).not.toThrow()
        scope.abort()
      }),
      propertyParameters
    )
  })

  it('roundtrips every canonically framed string in physical order', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 4, max: 32 }), (value, chunkBytes) => {
        /** Uses D13's canonical framer instead of the removed WebRPC chunk owner. */
        const framer = createStringFramer({
          chunkBytes,
          maxMessageBytes: Math.max(chunkBytes, value.length)
        })
        /** Produces physical frames through the canonical selected-framer host. */
        const frames = framer.frame(value, { source: 'peer', messageId: 'property' })
        /** Feeds the canonical physical order to its reassembly owner. */
        const result = frames.map((frame) =>
          framer.accept(frame, { source: 'peer', messageId: 'property' })
        )
        expect(result.at(-1)).toEqual({ status: 'complete', value })
      }),
      propertyParameters
    )
  })

  it('keeps resource ownership balanced across arbitrary release sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('add' as const, 'release' as const, 'dispose' as const), {
          maxLength: 80
        }),
        async (commands) => {
          const scope = new ResourceScope()
          const handles: Array<() => void> = []
          let active = 0
          let releases = 0
          for (const command of commands) {
            if (command === 'add') {
              try {
                let owned = true
                const unregister = scope.add('property-resource', () => {
                  if (!owned) return
                  owned = false
                  active -= 1
                  releases += 1
                })
                handles.push(() => {
                  if (!owned) return
                  owned = false
                  active -= 1
                  unregister()
                })
                active += 1
              } catch {
                // A dispose command intentionally closes the scope for later commands.
              }
            } else if (command === 'release' && handles.length > 0) {
              const handle = handles[handles.length - 1]!
              handle()
              handle()
            } else {
              await scope.releaseAll()
              await scope.releaseAll()
            }
            expect(active).toBeGreaterThanOrEqual(0)
          }
          const errors = await scope.releaseAll()
          expect(errors).toEqual([])
          expect(active).toBe(0)
          expect(releases).toBeLessThanOrEqual(handles.length)
        }
      ),
      propertyParameters
    )
  })

  it('never re-admits a fresh replay key when capacity is exhausted', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 16 }), {
          minLength: 1,
          maxLength: 12
        }),
        fc.integer({ min: 1, max: 6 }),
        (keys, capacity) => {
          const ledger = new RequestReplayLedger(capacity, capacity, 1_000)
          const admitted = keys.slice(0, capacity).filter((key) => ledger.admit(key, 'peer', 0))
          expect(admitted).toHaveLength(Math.min(keys.length, capacity))

          for (const key of admitted) expect(ledger.admit(key, 'peer', 1)).toBe(false)
          const overflow = keys.slice(capacity)
          for (const key of overflow) expect(ledger.admit(key, 'peer', 1)).toBe(false)
          for (const key of admitted) expect(ledger.admit(key, 'peer', 999)).toBe(false)
          for (const key of admitted) expect(ledger.admit(key, 'peer', 1_000)).toBe(true)
        }
      ),
      propertyParameters
    )
  })

  it('keeps settlement exactly-once across arbitrary completion races', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('resolve' as const, 'reject' as const), {
          minLength: 1,
          maxLength: 32
        }),
        (actions) => {
          let cleanups = 0
          let resolves = 0
          let rejects = 0
          const settlement = createSettlement({
            cleanup: () => {
              cleanups += 1
            },
            resolve: () => {
              resolves += 1
            },
            reject: () => {
              rejects += 1
            }
          })
          const results = actions.map((action) =>
            action === 'resolve' ? settlement.resolve(undefined) : settlement.reject(new Error())
          )
          const winningAction = actions[0]
          expect(results.filter(Boolean)).toEqual([true])
          expect(settlement.isSettled()).toBe(true)
          expect(cleanups).toBe(1)
          expect(resolves + rejects).toBe(1)
          expect(winningAction === 'resolve' ? resolves : rejects).toBe(1)
        }
      ),
      propertyParameters
    )
  })
})
