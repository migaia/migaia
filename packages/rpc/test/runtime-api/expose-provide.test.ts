import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import type { IRuntimeThreadPluginOptions } from '../../src/threads/plugin.js'
import { runtimeSources } from './fixture.js'

/** Each acceptance uses the original Host mutation and disposal scopes. */
function managedHost() {
  return runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/** A genuine Feature supplies two independently counted whitelist candidates. */
function math(answer: number, calls: string[]) {
  return definePlugin({
    name: 'math',
    features: {
      operations: defineFeature(() => ({
        add: () => {
          calls.push('add')
          return answer
        },
        sub: () => {
          calls.push('sub')
          return -answer
        }
      }))
    },
    install: () => ({})
  })
}

/** Start the other genuine endpoint only after configuration admits the first physical source. */
async function attach(
  owners: readonly [ReturnType<typeof managedHost>, ReturnType<typeof managedHost>],
  options: Omit<IRuntimeThreadPluginOptions, 'name' | 'connect' | 'report'>
) {
  /** The existing memory source carries actual envelopes without a replacement dispatcher. */
  const carrier = runtimeSources()
  /** A configuration rejection before opening must leave the opposite Host untouched. */
  let opposite: Promise<unknown> | undefined
  try {
    await owners[0].use(
      createThreadPlugin({
        ...options,
        name: 'remote',
        connect: async (context) => {
          opposite = owners[1].use(
            createThreadPlugin({
              name: 'remote',
              connect: carrier.sources[1],
              report: () => undefined
            })
          )
          return carrier.sources[0](context)
        },
        report: () => undefined
      })
    )
    await opposite
    return carrier
  } catch (error) {
    await opposite
    carrier.close()
    throw error
  }
}

it('[A99] method-level expose admits only add, and whole plus method is one union', async () => {
  /** The same real business owner is used before and after changing the explicit whitelist. */
  const owners = [managedHost(), managedHost()] as const
  /** Each accepted business execution is observed independently from RPC completion. */
  const calls: string[] = []
  /** Both carriers are owned by this fixture and close after their Host registrations. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  try {
    await owners[0].use(math(42, calls))
    carriers.push(await attach(owners, { expose: ['math'] }))
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 42)
    /** The object form chooses the exact canonical receipt without widening its declared name. */
    const child = owners[1].thread!.get('remote')
    assert.equal(
      await owners[1].thread!.request({ name: 'remote', instanceId: child.instanceId }, 'math.add'),
      42
    )
    assert.throws(
      () => owners[1].thread!.request({ name: 'wrong', instanceId: child.instanceId }, 'math.add'),
      { code: 'TARGET_UNKNOWN' }
    )
    await Promise.all(owners.map((owner) => owner.unUse('remote')))
    /**
     * The pre-change factory rejects math.add; catch that result at the intended business
     * assertion.
     */
    const installed = await attach(owners, { expose: ['math.add'] }).then(
      (carrier) => {
        carriers.push(carrier)
        return true
      },
      (error: unknown) => error
    )
    assert.equal(installed, true, '[A99] method-level whitelist configures a real connection')
    calls.length = 0
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 42)
    await assert.rejects(
      Promise.resolve().then(() => owners[1].thread!.request('remote', 'math.sub')),
      { code: 'PROVIDER_NOT_FOUND' }
    )
    assert.deepEqual(calls, ['add'], '[A99] unlisted provider never executes')
    await Promise.all(owners.map((owner) => owner.unUse('remote')))
    carriers.push(await attach(owners, { expose: ['math', 'math.add'] }))
    calls.length = 0
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 42)
    assert.equal(await owners[1].thread!.request('remote', 'math.sub'), -42)
    assert.deepEqual(calls, ['add', 'sub'], '[A99] the union admits each callable once')
  } finally {
    for (const owner of owners) await owner.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A100] current Feature replacement changes new calls while its original disabled guard remains', async () => {
  /** These genuine registrations exercise name resolution through the original Host handle. */
  const owners = [managedHost(), managedHost()] as const
  /** The successor uses a distinct answer and the same public method contract. */
  const calls: string[] = []
  /** The original carrier is retained through replacement, rather than recreating a connection. */
  let carrier: ReturnType<typeof runtimeSources> | undefined
  try {
    await owners[0].use(math(42, calls))
    carrier = await attach(owners, { expose: ['math'] })
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 42)
    await owners[0].replace('math', math(84, calls))
    /** Preserve a pre-change rejection so the RED proves the changed observable result. */
    const answer = await owners[1]
      .thread!.request('remote', 'math.add')
      .catch((error: unknown) => error)
    assert.equal(answer, 84, '[A100] a new call resolves the current real Feature')
    const disabled = await owners[0].plugin.disable('math')
    calls.length = 0
    await assert.rejects(owners[1].thread!.request('remote', 'math.add'))
    assert.equal(calls.length, 0, '[A100] disabled successor performs no business')
    await disabled.token.enable()
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 84)
  } finally {
    for (const owner of owners) await owner.dispose()
    carrier?.close()
  }
})

it('[A101] Plugin provide uses the Peer method builder and rejects an exposure collision before opening', async () => {
  /** Independent Hosts prove provide is an actual inbound public method rather than an export. */
  const owners = [managedHost(), managedHost()] as const
  /** A local ordinary Feature establishes a working baseline before the new provide path. */
  const calls: string[] = []
  /** Successful attachments retain their original cleanup owners. */
  let carrier: ReturnType<typeof runtimeSources> | undefined
  try {
    await owners[0].use(math(42, calls))
    carrier = await attach(owners, {
      expose: ['math'],
      provide: { application: { echo: (payload: unknown) => payload } }
    } as Omit<IRuntimeThreadPluginOptions, 'name' | 'connect' | 'report'>)
    assert.equal(await owners[1].thread!.request('remote', 'math.add'), 42)
    const answer = await Promise.resolve()
      .then(() => owners[1].thread!.request('remote', 'application.echo', 43))
      .catch((error: unknown) => error)
    assert.equal(answer, 43, '[A101] Plugin-owned provide reaches the canonical Peer provider')
    await owners[0].unUse('remote')
    /** No source may run when the two builders compile the same full method name. */
    let opens = 0
    const rejected = await owners[0]
      .use(
        createThreadPlugin({
          name: 'collision',
          expose: ['math'],
          provide: { math: { add: () => 0 } },
          connect: async () => {
            opens += 1
            assert.fail('[A101] conflicting configuration acquired a physical source')
          },
          report: () => undefined
        } as IRuntimeThreadPluginOptions)
      )
      .then(
        () => undefined,
        (error: unknown) => error
      )
    assert.equal(opens, 0, '[A101] collision rejects at configuration time')
    /** Installation wrappers preserve the existing INVALID_CONFIG on their cause chain. */
    let error = rejected
    while (error && typeof error === 'object' && Reflect.get(error, 'code') !== 'INVALID_CONFIG')
      error = Reflect.get(error, 'cause')
    assert.equal(Reflect.get(error as object, 'code'), 'INVALID_CONFIG')
  } finally {
    for (const owner of owners) await owner.dispose()
    carrier?.close()
  }
})
