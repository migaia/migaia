import type { IRpcContext } from '@migaia/rpc-host'
import { describe, expect, it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

describe('public provider registration isolation baseline', () => {
  it('retains provider results and the second registration after closing the first namespace', async () => {
    /** Each original endpoint has its own actual native pair, namespace and provider registration. */
    const first = await connectedCoreHosts(
      {},
      { echo: (_payload: unknown, context: IRpcContext) => context.success('first') },
      () => undefined
    )
    /** The second independent Host deliberately uses the same fixture peer names. */
    const second = await connectedCoreHosts(
      {},
      { echo: (_payload: unknown, context: IRpcContext) => context.success('second') },
      () => undefined
    )
    try {
      await expect(first.a.memory.send('b', 'echo', null)).resolves.toBe('first')
      await expect(second.a.memory.send('b', 'echo', null)).resolves.toBe('second')
      /** The original composed endpoint maps to its actual transport namespace cleanup owner. */
      const firstDispose = first.b.memory.close()
      expect(first.b.memory.close()).toBe(firstDispose)
      await firstDispose
      await expect(second.a.memory.send('b', 'echo', null)).resolves.toBe('second')
      expect(Object.keys(second.a.memory.peers.b!).length).toBe(1)
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })

  it('removes only the closed provider registration and retains both close Promise identities', async () => {
    /** An actual connected client observes provider publication and subsequent physical removal. */
    const first = await connectedCoreHosts(
      {},
      { echo: (_payload: unknown, context: IRpcContext) => context.success('first') },
      () => undefined
    )
    /** This separate native pair cannot borrow or lose the first namespace's registration. */
    const second = await connectedCoreHosts(
      {},
      { echo: (_payload: unknown, context: IRpcContext) => context.success('second') },
      () => undefined
    )
    try {
      /** The complete provider-owning Host closes its global catalog with one stable Promise. */
      const firstDispose = first.b.close()
      expect(first.b.close()).toBe(firstDispose)
      await firstDispose
      expect(Object.keys(first.a.memory.peers).length).toBe(0)
      expect(Object.keys(second.a.memory.peers.b!).length).toBe(1)
      /** The second complete registration retains its own identity and removes its publication. */
      const secondDispose = second.b.close()
      expect(second.b.close()).toBe(secondDispose)
      await secondDispose
      expect(Object.keys(second.a.memory.peers).length).toBe(0)
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })

  it('keeps concurrent provider executions on their original endpoint-local identities', async () => {
    /** Original business execution arrays retain their exact values and ordering. */
    const firstExecutions: string[] = []
    /** Identical method names and peer names must not join the second execution owner. */
    const secondExecutions: string[] = []
    /** Both registrations genuinely install concurrently through the existing native fixture. */
    const [first, second] = await Promise.all([
      connectedCoreHosts(
        {},
        {
          echo: (payload: unknown, context: IRpcContext) => {
            firstExecutions.push(String(payload))
            return context.success('first')
          }
        },
        () => undefined
      ),
      connectedCoreHosts(
        {},
        {
          echo: (payload: unknown, context: IRpcContext) => {
            secondExecutions.push(String(payload))
            return context.success('second')
          }
        },
        () => undefined
      )
    ])
    try {
      await first.a.memory.send('b', 'echo', 'first')
      await second.a.memory.send('b', 'echo', 'second')
      expect(firstExecutions).toEqual(['first'])
      expect(secondExecutions).toEqual(['second'])
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })
})
