/** Original observer lifecycle predicates receive actual public Host and native Session owners. */
import { createRpcHost } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/plugins/auth'
import {
  probe,
  defineProbe,
  type IRpcProbeDescriptor,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { assert, expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

// The acquired native Session owns lifecycle and reentrant close.
it('probe observes native handshake, ready and reentrant close without changing calls', async () => {
  /** Copy the original borrowed synchronous view only at this observer consumer boundary. */
  const seen: Readonly<IRpcProbeEventView>[] = []
  /** One successful physical activation publishes the original single descriptor. */
  let described = 0
  /** This is the same native completion returned to a synchronous closing observer. */
  let nestedClose: Promise<void> | undefined
  /** The original accepted Session becomes available after its real handshake completes. */
  let handle: ReturnType<ReturnType<typeof coreMemoryServer>['lookup']>
  /** A genuine readonly plugin observes the native Session rather than a private emitter facade. */
  const observer = defineProbe({
    stages: ['peer'],
    describe: () => {
      described++
    },
    emit: (view) => {
      seen.push(Object.freeze({ ...view }))
      if (view.lifecycle === 'closing') nestedClose = handle?.handle.close()
    }
  })
  /** The existing source fixture owns the real subscription, carrier pair and native admission. */
  const listener = coreMemoryServer('provider')
  /** Business and observation share one actual receiving Host and its actual namespace group. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [probe(observer), ...listener.options.plugins],
    provide: { echo: (value) => value }
  })
  /** Only this public caller sends the original business value through the installed source. */
  const client = await listener.connect('caller')
  try {
    handle = listener.lookup('caller')
    assert(handle)
    expect(await client.host.memory.send('provider', 'echo', 3)).toBe(3)
    expect(described).toBe(1)
    expect(seen.map((view) => view.lifecycle)).toEqual(
      expect.arrayContaining(['handshake', 'ready'])
    )
    /** The same real native owner publishes completion before invoking the closing sink. */
    const closed = handle.handle.close()
    expect(nestedClose).toBe(closed)
    await closed
    expect(seen.map((view) => view.lifecycle)).toContain('closing')
  } finally {
    await Promise.all([client.host.close(), server.close()])
  }
})

// Authentication facts come from the one actual Feature installation.
it('describes native encryption from the actual authentication configuration owner', async () => {
  /** Successful native publication alone may expose these immutable protection facts. */
  const descriptors: IRpcProbeDescriptor[] = []
  /** The receiving source acquires its ordinary genuine physical endpoint and codec. */
  const listener = coreMemoryServer('provider')
  /** These original identity transforms enable encryption and signing without another codec. */
  const protection = auth({
    encrypt: (value) => value,
    decrypt: (value) => value,
    sign: (value) => value,
    verify: (value) => value
  })
  /** Actual flow facts supply the descriptor rather than a test-created authentication snapshot. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      protection,
      probe({
        stages: ['frame', 'protected'],
        emit: () => undefined,
        describe: (value) => descriptors.push(value)
      }),
      ...listener.options.plugins
    ]
  })
  /** Both handshakes use the same genuine opaque Feature definition with independent installations. */
  const client = await listener.connect('caller', { plugins: [protection] })
  try {
    expect(descriptors[0]!.authentication).toBe('encrypt-sign')
  } finally {
    await Promise.all([client.host.close(), server.close()])
  }
})
