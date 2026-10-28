/** Real coroutine members preserve the added Host assembly oracle through one native Pool. */
import { assert, expect, it } from 'vitest'
import { createUnitBudget } from '../../supervision/dist/index.js'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import type { IRpcNativePoolMember } from '@migaia/rpc-host/sdk'
import { coroutinePlugin, type ICoroutineTaskContext } from '@migaia/rpc-plugin-coroutines'
import { pool } from '../dist/index.js'
import { observingPool } from './pool-fixture.ts'

/** Application work holds three actual leases without prescribing Pool selection order. */
class ProviderBarrier {
  /** Only genuine provider entries advance this finite application barrier. */
  #entered = 0
  /** All original business completions share this one application-owned release. */
  readonly #released = deferred<void>()

  /** Release only after three independent native resources have entered their held operations. */
  enter(): Promise<void> {
    if (++this.#entered === 3) this.#released.resolve()
    return this.#released.promise
  }
}

/** One genuine child provider retains its original ordinal scalar and stream values. */
class MemberProvider {
  /** The task's acquisition ordinal belongs to application data, never scheduler selection. */
  readonly #ordinal: number
  /** Original provider-entry evidence is independent from native or logical Session counts. */
  readonly #workload: MemberWorkload
  /** Public provide receives these real application functions. */
  readonly value

  /** Capture application collaborators without opening a transport or readiness generation. */
  constructor(ordinal: number, workload: MemberWorkload) {
    this.#ordinal = ordinal
    this.#workload = workload
    this.value = { value: this.#value, values: () => this.#values() }
  }

  /** Return the original native member's value once its optional application barrier releases. */
  readonly #value = async (payload?: { hold?: boolean }): Promise<number> => {
    this.#workload.calls.push(this.#ordinal)
    if (payload?.hold) await this.#workload.requests.enter()
    return this.#ordinal
  }

  /** Keep one real stream lease until all three original providers enter, then yield both values. */
  async *#values(): AsyncGenerator<number> {
    await this.#workload.streams.enter()
    yield this.#ordinal
    yield this.#ordinal + 10
  }
}

/** Genuine coroutine tasks own independent child Hosts and their original native stop signals. */
class MemberWorkload {
  /** Actual task acquisitions prove three resources rather than counting fixture open calls. */
  readonly contexts: ICoroutineTaskContext[] = []
  /** These entries count only real business execution inside the remote providers. */
  readonly calls: number[] = []
  /** Distinct scalar and stream phases retain independent application completion barriers. */
  readonly requests = new ProviderBarrier()
  /** Stream completion never depends on a synthetic Session or native readiness event. */
  readonly streams = new ProviderBarrier()

  /** The actual parent token creates the child's only transport and canonical handshake. */
  readonly task = async (context: ICoroutineTaskContext): Promise<void> => {
    this.contexts.push(context)
    const ordinal = this.contexts.length
    const provider = new MemberProvider(ordinal, this)
    const child = await createRpcHost({
      self: { name: 'remote', instanceId: `remote-${ordinal}` },
      plugins: [coroutinePlugin({ connectToParent: context.connect })],
      provide: provider.value
    })
    try {
      if (!context.signal.aborted) {
        const stopped = deferred<void>()
        context.signal.addEventListener('abort', () => stopped.resolve(), { once: true })
        await stopped.promise
      }
    } finally {
      await child.close()
    }
  }
}

/** Collect only this genuine public iterator; no private member call facade is restored. */
async function streamItems(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of stream) values.push(value)
  return values
}

// Post-C0 added oracle: original body SHA be319512f73ab8b41d2e06f584e797ca7af1e047c33805c63459791d0100fd29.
it('opens three genuine managed units behind one logical Pool target', async () => {
  /** The original shared budget still owns all three native execution leases. */
  const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 3, launchRate: false })
  /** Capture only genuine members produced by the existing concrete coroutine installer. */
  const members: IRpcNativePoolMember[] = []
  /** The real child providers and task stop signals stay on their existing owners. */
  const workload = new MemberWorkload()
  /** Preserve exact original diagnostics without filtering expected or unexpected errors. */
  const reports: unknown[] = []
  /** The existing fixture observes acquisition; the production feature still owns every lease. */
  const feature = observingPool(pool({ size: 3 }), members)
  const host = await createRpcHost({
    self: { name: 'assembled-host', instanceId: 'assembled-host' },
    plugins: [
      coroutinePlugin({
        features: [feature],
        spawn: workload.task,
        supervisor: { budget },
        report: (error) => reports.push(error)
      })
    ],
    report: (error) => reports.push(error)
  })
  /** These are the exact native supervisors, retained only to inspect final cleanup. */
  const supervisors = members.map((member) => {
    assert(member.record.supervisor)
    return member.record.supervisor
  })
  try {
    /** Read actual resource identities from their original shared Supervisor readiness results. */
    const units = await Promise.all(
      supervisors.map(async (supervisor) => {
        const outcome = await supervisor.whenReady()
        assert(outcome.state === 'ready')
        return outcome.unit
      })
    )
    expect(units).toHaveLength(3)
    /** Coroutine fingerprint strings are launcher-local; actual unit objects are distinct. */
    expect(new Set(units).size).toBe(3)
    expect(budget.inUse).toBe(3)
    expect(members).toHaveLength(3)
    /** Retires private member.request; original three ordinal results remain public business. */
    const values = await Promise.all(
      Array.from({ length: 3 }, () => host.coroutine.send('pool', 'value', { hold: true }))
    )
    expect(values.toSorted()).toEqual([1, 2, 3])
    /** Concurrent real stream leases prove both original values for each actual provider. */
    const streams = await Promise.all(
      Array.from({ length: 3 }, () =>
        streamItems(host.coroutine.stream('values') as AsyncIterableIterator<unknown>)
      )
    )
    expect(streams.toSorted((left, right) => Number(left[0]) - Number(right[0]))).toEqual([
      [1, 11],
      [2, 12],
      [3, 13]
    ])
    /** D7A/retires only the custom always-first guarantee; one target still returns a scalar. */
    const beforeRequest = workload.calls.length
    expect([1, 2, 3]).toContain(await host.coroutine.request('value'))
    expect(workload.calls).toHaveLength(beforeRequest + 1)
    const beforeSend = workload.calls.length
    expect([1, 2, 3]).toContain(await host.coroutine.send('pool', 'value'))
    expect(workload.calls).toHaveLength(beforeSend + 1)
    expect(Object.keys(host.coroutine.peers)).not.toContain('remote')
    expect(Object.keys(host.coroutine.peers)).toEqual(['pool'])
    await expect(host.coroutine.send('remote', 'value')).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    })
    for (const member of members) {
      const view = member.current()!.current()!.view
      await expect(host.coroutine.send(view.peerId, 'value')).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
    }
    /** Retires the two deleted endpoint-constructor spies; no synthetic counter replaces them. */
  } finally {
    await host.close()
    budget.close()
  }
  expect(supervisors).toHaveLength(3)
  expect(supervisors.map((supervisor) => supervisor.state)).toEqual([
    'disposed',
    'disposed',
    'disposed'
  ])
  expect(budget.inUse).toBe(0)
  expect(budget.pending).toBe(0)
  expect(reports).toEqual([])
})
