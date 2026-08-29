import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DiscoveryRegistry } from '../src/internal/discovery-registry'
import { ChunkAssembler, splitUtf8, utf8ByteLength } from '../src/internal/chunk'
import { ResourceScope } from '../src/internal/resource-scope'
import { RequestReplayLedger } from '../src/internal/request-replay-ledger'
import { createSettlement } from '../src/internal/settlement'
import { OperationScope } from '../src/internal/operation-scope'
import { isWebRpcEnvelope, normalizeWebRpcEnvelope } from '../src/wire'

const runtimeProcess = (globalThis as { process?: { env?: { CI?: string } } }).process
const propertyParameters = { numRuns: runtimeProcess?.env?.CI ? 2_000 : 500 } as const

describe('property invariants', () => {
  it('normalizes arbitrary JSON values without producing a mutable partial envelope', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const normalized = normalizeWebRpcEnvelope(value)
        if (normalized === undefined) return
        expect(isWebRpcEnvelope(normalized)).toBe(true)
        expect(Object.isFrozen(normalized)).toBe(true)
      }),
      propertyParameters
    )
  })

  it('contains hostile getters and prototype keys at the wire boundary', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('kind', 'taskId', 'senderId', 'targetId', 'sentAt', 'data', '__proto__'),
        (hostileKey) => {
          const base = {
            kind: 'request',
            version: '1',
            taskId: 'task',
            senderId: 'sender',
            targetId: 'target',
            method: 'echo',
            data: { safe: true },
            sentAt: 1
          }
          const hostile = new Proxy(base, {
            get(target, key, receiver) {
              if (key === hostileKey) throw new Error('hostile getter')
              return Reflect.get(target, key, receiver)
            }
          })
          expect(() => normalizeWebRpcEnvelope(hostile)).not.toThrow()
          const normalized = normalizeWebRpcEnvelope(hostile)
          if (hostileKey === 'kind' || hostileKey === 'taskId' || hostileKey === 'senderId')
            expect(normalized).toBeUndefined()
          else if (normalized) expect(Object.isFrozen(normalized)).toBe(true)
        }
      ),
      propertyParameters
    )
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

  it('reassembles every valid UTF-8 chunk permutation without retaining state', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 4, max: 32 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 64 }),
        (value, maxBytes, permutationKeys) => {
          const parts = splitUtf8(value, maxBytes)
          if (parts.length === 0) return
          const order = Array.from({ length: parts.length }, (_, index) => index).sort(
            (left, right) =>
              (permutationKeys[left % permutationKeys.length] ?? 0) -
                (permutationKeys[right % permutationKeys.length] ?? 0) || left - right
          )
          const assembler = new ChunkAssembler({
            chunkSize: maxBytes,
            maxMessageBytes: Math.max(1, utf8ByteLength(value))
          })
          const result = order.map((index) =>
            assembler.accept(
              { messageId: 'property', index, total: parts.length, data: parts[index]! },
              'peer'
            )
          )
          expect(result.at(-1)).toBe(value)
        }
      ),
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
