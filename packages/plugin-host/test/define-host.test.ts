import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin, type IHostDomainCoreRequest } from '../src/index.js'
import { isManagedHost, openComposition } from '../src/composition-entry.js'

const hostOptions = {
  execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
}

/** A plugin that installs nothing, so a test observes admission rather than plugin behaviour. */
const plugin = (name: string) => definePlugin({ name, install: () => ({}) })

describe('defineHost', () => {
  it('domain core contract: one request per registration, indexed within its batch', async () => {
    const requests: IHostDomainCoreRequest[] = []
    const host = defineHost({
      host: hostOptions,
      domainCore: (request) => {
        requests.push(request)
        return {}
      }
    })
    await host.use(plugin('a'), plugin('b'), plugin('c'))
    expect(requests.map((request) => request.pluginName)).toEqual(['a', 'b', 'c'])
    expect(requests.map((request) => request.batchIndex)).toEqual([0, 1, 2])
    // One batch, one token: the index is only meaningful relative to the batch it counts within.
    expect(new Set(requests.map((request) => request.batch)).size).toBe(1)
    const firstBatch = requests[0]!.batch
    await host.use(plugin('d'))
    expect(requests).toHaveLength(4)
    expect(requests[3]!.pluginName).toBe('d')
    // A second call is a second batch, so its index restarts and its token differs.
    expect(requests[3]!.batchIndex).toBe(0)
    expect(requests[3]!.batch).not.toBe(firstBatch)
    await host.dispose()
  })

  it('dispose memoized: the chain runs exactly once however often it is called', async () => {
    let entered = 0
    const host = defineHost({
      host: hostOptions,
      dispose: async (next) => {
        entered += 1
        return next()
      }
    })
    const first = host.dispose()
    const second = host.dispose()
    // Same reference, not merely an equal result: a second chain would dispose an already-disposed
    // runtime and the middleware would observe a host it does not own any more.
    expect(second).toBe(first)
    await first
    await host.dispose()
    expect(entered).toBe(1)
  })

  it('is a managed host on the same terms as a class instance', async () => {
    const host = defineHost({ host: hostOptions })
    expect(isManagedHost(host)).toBe(true)
    const composition = openComposition(host)
    expect(typeof composition.createDataOrderSlot).toBe('function')
    expect(typeof composition.revision).toBe('number')
    await host.dispose()
  })

  it('registers an explicit receiver as the same managed host', async () => {
    const receiver = {}
    const host = defineHost({ host: hostOptions, receiver })
    expect(isManagedHost(receiver)).toBe(true)
    expect(openComposition(receiver).revision).toBe(openComposition(host).revision)
    await host.dispose()
  })
})
