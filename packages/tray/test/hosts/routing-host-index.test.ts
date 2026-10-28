/** Target-host routing reads only that host's admitted records, including after logical revocation. */
import { describe, expect, it } from 'vitest'
import { TrayErrorCode } from '../../src/error-code.ts'
import { TrayInstanceState } from '../../src/hosts/constants.ts'
import { defineTrayHost } from '../../src/hosts/define-host.ts'
import { createRegistry } from '../../src/hosts/parent/registry.ts'
import { createRoutingRegistry } from '../../src/hosts/routing.ts'
import { defineRoutingPolicy } from '../../src/hosts/routing-policy.ts'

describe('target-host routing index', () => {
  it('skips unrelated records and removes revoked admissions while reading current ready state', () => {
    /** Registry admissions use genuine branded definitions without acquiring native child units. */
    const hostA = defineTrayHost({ name: 'indexA', plugins: () => [], exposes: [] })
    /** Unrelated host records must never be inspected by a pick for hostA. */
    const hostB = defineTrayHost({ name: 'indexB', plugins: () => [], exposes: [] })
    /** This test exercises selection alone, so any attempted dispatch or report is a failure. */
    const registry = createRegistry(
      (error) => {
        throw error
      },
      () => expect.unreachable('routing selection must not send a business call')
    )
    /** The first ready admission is later revoked to prove immediate host-index removal. */
    const first = registry.admit(hostA, 'a1', undefined)
    /** Another ready admission retains its original position after the first one leaves. */
    const second = registry.admit(hostA, 'a2', undefined)
    /** State changes must remain visible without updating membership in the host index. */
    const waiting = registry.admit(hostA, 'a3', undefined)
    first.state = TrayInstanceState.ready
    second.state = TrayInstanceState.ready
    waiting.state = TrayInstanceState.stopped
    /** Reading the old whole-registry filter's first property on B would increment this counter. */
    let unrelatedReads = 0
    for (const id of ['b1', 'b2', 'b3']) {
      /** Each unrelated admission remains ready and present while A is selected and revoked. */
      const record = registry.admit(hostB, id, undefined)
      record.state = TrayInstanceState.ready
      Object.defineProperty(record, 'definition', {
        get: () => {
          unrelatedReads += 1
          return hostB
        }
      })
    }
    /** Policy snapshots prove spawn order, ready filtering and revocation across repeated picks. */
    const observed: string[][] = []
    /** A synchronous genuine policy consumes the original frozen candidate projection. */
    const policy = defineRoutingPolicy('hostIndexPick', (candidates) => {
      /** One pass records the exact admitted candidate ids without nested callback helpers. */
      const ids: string[] = []
      for (const candidate of candidates) ids.push(candidate.id)
      observed.push(ids)
      expect(Object.isFrozen(candidates)).toBe(true)
      return candidates[0]!.id
    })
    /** Both hosts share one routing registry while only the target host's group is traversed. */
    const routing = createRoutingRegistry([hostA, hostB], [policy], registry)
    expect(routing.pick(hostA.name, policy.name)).toBe(first)
    expect(observed.at(-1)).toEqual(['a1', 'a2'])
    expect(unrelatedReads).toBe(0)

    registry.revoke(first)
    expect([...registry.recordsForHost(hostA.name)]).toEqual([second, waiting])
    expect(routing.pick(hostA.name, policy.name)).toBe(second)
    expect(observed.at(-1)).toEqual(['a2'])
    registry.revoke(second)
    waiting.state = TrayInstanceState.ready
    expect(routing.pick(hostA.name, policy.name)).toBe(waiting)
    expect(observed.at(-1)).toEqual(['a3'])
    registry.revoke(waiting)
    expect([...registry.recordsForHost(hostA.name)]).toEqual([])
    expect(() => routing.pick(hostA.name, policy.name)).toThrowError(
      expect.objectContaining({ code: TrayErrorCode.hostUnavailable })
    )
    expect(unrelatedReads).toBe(0)
    expect(registry.records.size).toBe(3)
  })
})
