/** Original registration and source-isolation business uses actual public hosts and native IO. */
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { assert, expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

// C008 retains the exact later-invalid-entry error; C075's old private getter input is retired.
it('rejects the later invalid provider entry and keeps a fresh registration independent', async () => {
  /** This is the original own-data map: a valid method precedes an undefined invalid member. */
  const invalidProvider = {
    valid: () => 'valid',
    invalid: undefined
  } as unknown as NonNullable<IRpcHostOptions['provide']>
  /** The original construction failure is observed without wrapping or changing its native family. */
  const failed = coreMemoryServer('provider-partial-host')
  /** Capture synchronous cold rejection and asynchronous native rejection through the same await. */
  let failure: unknown
  try {
    await createRpcHost({ ...failed.options, provide: invalidProvider })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({
    name: 'RpcError',
    source: 'rpc.endpoint',
    code: RpcCoreErrorCode.invalidConfig
  })

  /** A fresh public owner compiles its one original method after the failed construction. */
  const server = coreMemoryServer('provider-retry-fresh')
  /** This actual provider replaces only the removed context.success wrapper shape. */
  const host = await createRpcHost({ ...server.options, provide: { fresh: () => 'fresh' } })
  /** Its accepted method directory belongs to the actual Session, not a debug snapshot reader. */
  const client = await server.connect('provider-retry-client')
  try {
    expect(Object.keys(client.host.memory.peers['provider-retry-fresh']!)).toHaveLength(1)
    await expect(client.host.memory.send('provider-retry-fresh', 'fresh')).resolves.toBe('fresh')
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// C089: the deleted source label is replaced only by an actual different accepted physical source.
it('keeps the original execution and single terminal after foreign route and source ingress', async () => {
  /** Only this original echo provider changes the business execution count. */
  let executions = 0
  /** Preserve the original accepted native target and caller identities. */
  const server = coreMemoryServer('r70-authority-host')
  /** A real barrier reply proves that earlier physical input has completed Session admission. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      echo: (value, context) => {
        executions += 1
        return context.success(value)
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** Both endpoints are real carriers from the existing native test fixture. */
  const client = await server.connect('r70-peer')
  /** This separately admitted source cannot claim the first caller's sender identity. */
  const other = await server.connect('other-r70-peer')
  try {
    await client.host.memory.send('r70-authority-host', 'echo', 'r70-data')
    expect(executions).toBe(1)
    /** The actual call supplies every task/generation field used by the hostile physical inputs. */
    const admitted = client.pair[1].written.find(
      (frame) => frame.kind === 'call' && frame.task.method === 'echo'
    )
    assert(admitted?.kind === 'call')
    await client.pair[1].write({
      kind: 'message',
      data: {
        ...admitted,
        id: 'forged-sender',
        route: { ...admitted.route, senderId: 'forged-peer' }
      }
    })
    await client.pair[1].write({
      kind: 'message',
      data: {
        ...admitted,
        id: 'forged-receiver',
        route: { ...admitted.route, receiverId: 'wrong-receiver' }
      }
    })
    await other.pair[1].write({
      kind: 'message',
      data: { ...admitted, id: 'forged-source' }
    })
    await client.host.memory.send('r70-authority-host', 'barrier', 'first-source-settled')
    await other.host.memory.send('r70-authority-host', 'barrier', 'second-source-settled')
    expect(executions).toBe(1)
    expect(
      [client, other].flatMap(({ pair }) =>
        pair[0].written.filter(
          (frame) =>
            (frame.kind === 'result' || frame.kind === 'error') && frame.task.method === 'echo'
        )
      )
    ).toHaveLength(1)
  } finally {
    await Promise.all([client.host.close(), other.host.close(), host.close()])
  }
})

// C094: actual physical source ownership and provider removal replace old kernel snapshot fields.
it('isolates two original provider endpoints and prevents execution or replies after removal', async () => {
  /** Preserve the two independent original provider execution counters. */
  let firstExecutions = 0
  /** The second provider cannot inherit either the first source or its retirement. */
  let secondExecutions = 0
  /** Each original target owns its own actual public registration and carrier pair. */
  const first = coreMemoryServer('r70-isolation-first')
  /** Cross-endpoint traffic reaches a different actual receiving Session. */
  const second = coreMemoryServer('r70-isolation-second')
  /** The first real provider owns its original literal result and execution count. */
  const firstHost = await createRpcHost({
    ...first.options,
    provide: {
      echo: (_value, context) => {
        firstExecutions += 1
        return context.success('first')
      }
    }
  })
  /** A real barrier on the second endpoint observes cross-source admission in order. */
  const secondHost = await createRpcHost({
    ...second.options,
    provide: {
      echo: (_value, context) => {
        secondExecutions += 1
        return context.success('second')
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** Native source identities remain independent of both target endpoint names. */
  const firstClient = await first.connect('r70-peer-first')
  /** Only the second actual pair may send an admitted second-endpoint call. */
  const secondClient = await second.connect('r70-peer-second')
  try {
    await firstClient.host.memory.send('r70-isolation-first', 'echo')
    await secondClient.host.memory.send('r70-isolation-second', 'echo')
    expect(firstExecutions).toBe(1)
    expect(secondExecutions).toBe(1)
    /** Borrow the exact original task rather than manufacturing an authenticated principal. */
    const admitted = firstClient.pair[1].written.find((frame) => frame.kind === 'call')
    assert(admitted?.kind === 'call')
    await secondClient.pair[1].write({
      kind: 'message',
      data: { ...admitted, id: 'r70-cross-endpoint' }
    })
    await secondClient.host.memory.send('r70-isolation-second', 'barrier', 'after-cross-endpoint')
    expect(secondExecutions).toBe(1)

    /** This actual Root owns the public provider catalog and closes its original physical source. */
    await firstHost.close()
    await expect(
      firstClient.host.memory.send('r70-isolation-first', 'echo', 'r70-post-removal')
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.targetUnknown })
    expect(firstExecutions).toBe(1)
    /** No new terminal can be produced by the removed provider after the original one reply. */
    expect(
      firstClient.pair[0].written.filter(
        (frame) =>
          (frame.kind === 'result' || frame.kind === 'error') && frame.task.method === 'echo'
      )
    ).toHaveLength(1)
    /** The surviving public endpoint still has its accepted provider and original result. */
    await expect(secondClient.host.memory.send('r70-isolation-second', 'echo')).resolves.toBe(
      'second'
    )
  } finally {
    await Promise.all([
      firstClient.host.close(),
      secondClient.host.close(),
      firstHost.close(),
      secondHost.close()
    ])
  }
})
