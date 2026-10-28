/** The sole profile exchanges real directories without optional legacy baseline switches. */
import { assert, expect, it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.ts'

// Removes v2/batch flags; both original scalar results survive.
it('exchanges genuine directories and returns both original scalar baseline values', async () => {
  /** Both public Hosts own the original real Session negotiation and provider dispatch. */
  const fixture = await connectedCoreHosts({}, { echo: (value) => value })
  try {
    expect(
      await Promise.all([fixture.a.memory.request('echo', 1), fixture.a.memory.request('echo', 2)])
    ).toEqual([1, 2])
    /** The real original handshake write carries the directory; Session views expose its methods. */
    const hello = fixture.pair[0].written.find(
      (frame) => frame.kind === 'handshake' && frame.step === 'hello'
    )
    assert(hello?.kind === 'handshake' && hello.step === 'hello')
    /** Directory schema3 is a current-profile assertion, never an old schema2 PASS claim. */
    expect(hello.directory.schemaVersion).toBe(3)
  } finally {
    await fixture.close()
  }
})
