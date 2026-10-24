import { describe, expect, it, vi } from 'vitest'
import { createManagedRuntimePeer } from '../../dist/remote/runtime-api/managed-peer.js'
import { remoteHarness } from './fixture.js'

/** One preparation fixture owns its fault flag and passive native acquisition count. */
class NativePreparationFixture {
  /** Existing cold native ports remain owned by the shared unit fixture. */
  readonly ports = remoteHarness()
  /** A transient preparation fault affects only the first explicit factory attempt. */
  #fail: boolean
  /** This count observes real binding.openChannel calls rather than readiness facade promises. */
  #opens = 0

  /** Configure only the fault input; construction starts no native channel. */
  constructor(fail: boolean) {
    this.#fail = fail
  }

  /** Expose passive acquisition evidence without creating another readiness owner. */
  get opens(): number {
    return this.#opens
  }

  /** Allow a new actual managed construction after the first failed candidate fully rolls back. */
  allowEndpoint(): void {
    this.#fail = false
  }

  /** Original binding acquisition records each candidate before returning the same unit port. */
  #open = async () => {
    this.#opens += 1
    return this.ports.channel
  }

  /** The exact original endpoint is borrowed only after fault-free construction. */
  #endpoint = async () => {
    if (this.#fail) throw new Error('transient endpoint failure')
    return this.ports.served
  }

  /** Prepare one genuine managed Peer over the canonical generation and resource holder. */
  prepare() {
    return createManagedRuntimePeer(
      {
        self: { name: 'caller', instanceId: 'caller' },
        endpointFactory: this.#endpoint,
        report: vi.fn()
      },
      { ...this.ports.binding, openChannel: this.#open }
    )
  }
}

/** Retained native preparation assertions survive removal of the old remote Host control facade. */
describe('native managed preparation', () => {
  it('closes resources after failed preparation before another explicit native construction', async () => {
    /** One original native binding can be borrowed again only after its failed candidate closes. */
    const fixture = new NativePreparationFixture(true)
    await expect(fixture.prepare()).rejects.toThrow('transient endpoint failure')
    expect(fixture.ports.calls.filter((call) => call === 'channel.close')).toHaveLength(1)
    fixture.allowEndpoint()
    const peer = await fixture.prepare()
    try {
      expect(fixture.opens).toBe(2)
    } finally {
      await peer.close()
    }
  })

  it('opens one borrowed channel when the native ready event precedes preparation', async () => {
    /** Supervisor readiness is genuine port state, independently of remote facade construction. */
    const fixture = new NativePreparationFixture(false)
    await fixture.ports.supervisor.start()
    fixture.ports.emit({ type: 'state', from: 'starting', to: 'ready', generation: 1 })
    const peer = await fixture.prepare()
    try {
      expect(fixture.opens).toBe(1)
    } finally {
      await peer.close()
    }
  })
})
