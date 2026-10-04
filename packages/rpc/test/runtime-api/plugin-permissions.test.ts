import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { PluginHost, defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { runtimeSources } from './fixture.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'

/** Rejection checks retain the canonical wrapper while requiring the original permission code. */
function permission(error: unknown, code: string): boolean {
  /** Core may retain the original package error on its bounded serialized cause chain. */
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (Reflect.get(current, 'code') === code) return true
    current = Reflect.get(current, 'cause')
  }
  assert.fail(`expected original permission code ${code}`)
}

/** Actual Hosts retain their original admission, mutation queue and disposal scopes. */
function host() {
  return defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

it('[A12][A13][A34] genuine connections revoke inbound modes and exact target receipts without affecting a sibling', async () => {
  /** This supported class entry also exercises static typing of its actual published slot. */
  const owner = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Each other side owns an independent endpoint and the same public installation entry. */
  const remote = [host(), host()] as const
  /** Original carriers and actual capability offers remain independent for both connections. */
  const carriers = [runtimeSources(), runtimeSources()] as const
  /** The same exposed real Feature counts execution in all modes. */
  const calls: string[] = []
  /** Notify business rejection is reported by the canonical provider owner, not the caller. */
  const reports: unknown[] = []
  /** A genuine Feature dependency lets original Host policy suspend only the first connection. */
  const gate = definePlugin({
    name: 'gate',
    features: { data: defineFeature(() => ({ read: () => 1 })) },
    install: () => ({})
  })
  /** Each service is a normal local Plugin; no fixture dispatch or structural Host is used. */
  const service = (label: string, answer: number) =>
    definePlugin({
      name: 'service',
      features: {
        data: defineFeature(() => ({
          read: () => {
            calls.push(label)
            return answer
          },
          values: function* () {
            calls.push(label)
            yield answer
          }
        }))
      },
      install: () => ({})
    })
  try {
    await owner.use(gate, service('owner', 42))
    for (const [index, target] of remote.entries())
      await target.use(service(`remote-${index}`, 43 + index))
    for (const [index, target] of remote.entries()) {
      /** These are the real public runtime definitions, with no substitute Peer or outlet. */
      const connection = createThreadPlugin({
        name: `connection-${index}`,
        connect: carriers[index]!.sources[0],
        expose: ['service'],
        report: (error) => reports.push(error)
      })
      /** The original functional definition owner admits a required dependency on the first only. */
      const definition =
        index === 0
          ? definePlugin({
              ...connection,
              features: {
                permission: defineFeature(
                  (_core, dependencies) => ({ read: dependencies.gate.read }),
                  {
                    gate: gate.getFeature('data')
                  }
                )
              }
            })
          : connection
      await Promise.all([
        owner.use(definition),
        target.use(
          createThreadPlugin({
            name: `connection-${index}`,
            connect: carriers[index]!.sources[1],
            expose: ['service'],
            report: (error) => reports.push(error)
          })
        )
      ])
    }
    /** Both contributions share one actual class descriptor and retain distinct target receipts. */
    const outlet = owner.thread!
    /** An old child is bound to the exact first contribution, never a later same-name candidate. */
    const first = outlet.get('connection-0')
    assert.equal(await first.request('service.read'), 43)
    assert.equal(await outlet.request('connection-1', 'service.read'), 44)
    assert.equal(await remote[0].thread!.request('connection-0', 'service.read'), 42)
    for (const state of ['disabled', 'suspended'] as const) {
      /** Enable tokens belong to the original dependency/registration owner. */
      const disabled =
        state === 'disabled'
          ? await owner.plugin.disable('connection-0')
          : await owner.plugin.disable('gate', { policy: 'suspend' })
      calls.length = 0
      reports.length = 0
      assert.throws(() => first.request('service.read'), { code: 'TARGET_UNKNOWN' })
      await assert.rejects(remote[0].thread!.request('connection-0', 'service.read'), (error) =>
        permission(error, state === 'disabled' ? 'PLUGIN_DISABLED' : 'PLUGIN_SUSPENDED')
      )
      await remote[0].thread!.notify('connection-0', 'service.read')
      await assert.rejects(
        remote[0].thread!.stream('connection-0', 'service.values').next(),
        (error) => permission(error, state === 'disabled' ? 'PLUGIN_DISABLED' : 'PLUGIN_SUSPENDED')
      )
      await vi.waitFor(() => assert.ok(reports.length > 0))
      assert.equal(
        calls.length,
        0,
        '[A13] disabled/suspended connection executes no exposed business in any mode'
      )
      assert.equal(await outlet.request('connection-1', 'service.read'), 44)
      assert.equal(await remote[1].thread!.request('connection-1', 'service.read'), 42)
      assert.deepEqual(
        calls,
        ['remote-1', 'owner'],
        '[A13] sibling registration retains both directions'
      )
      await disabled.token.enable()
      assert.equal(await remote[0].thread!.request('connection-0', 'service.read'), 42)
    }
    /** A target Feature's original enabled guard independently revokes exposure authority. */
    const disabledService = await owner.plugin.disable('service')
    calls.length = 0
    await assert.rejects(remote[1].thread!.request('connection-1', 'service.read'), (error) =>
      permission(error, 'PLUGIN_DISABLED')
    )
    assert.equal(calls.length, 0)
    await disabledService.token.enable()
    /** Duplicate-name admission cannot run a new source or replace a functioning contribution. */
    let sourceCalls = 0
    await assert.rejects(
      owner.use(
        createThreadPlugin({
          name: 'connection-0',
          connect: async () => {
            sourceCalls += 1
            assert.fail('[A13] duplicate candidate acquired a source')
          },
          report: (error) => reports.push(error)
        })
      ),
      (error) => permission(error, 'PLUGIN_DUPLICATE')
    )
    assert.equal(sourceCalls, 0)
    assert.equal(await first.request('service.read'), 43)
    await owner.replace('service', service('replacement', 45))
    calls.length = 0
    await assert.rejects(remote[0].thread!.request('connection-0', 'service.read'), (error) =>
      permission(error, 'REGISTRATION_REVOKED')
    )
    assert.equal(
      calls.length,
      0,
      '[A34] captured Feature permission cannot revive a successor output'
    )
    await owner.unUse('connection-0')
    assert.equal(owner.thread, outlet, '[A34] first removal retains the shared facade')
    assert.throws(() => first.request('service.read'), { code: 'TARGET_UNKNOWN' })
    assert.equal(await outlet.request('connection-1', 'service.read'), 44)
    await owner.unUse('connection-1')
    assert.equal(owner.thread, undefined, '[A34] the final contribution retires publication')
  } finally {
    await owner.dispose()
    for (const target of remote) await target.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A18][A34] actual empty broadcast and closing admission use the original Host state', async () => {
  /** The source carrier belongs to this fixture and is closed after original Host cleanup. */
  const carrier = runtimeSources()
  /** Two real owners activate the same public symmetric plugin. */
  const owners = [host(), host()] as const
  /** Cleanup remains pending so synchronous admission can be observed before drain completes. */
  let release!: () => void
  /** The deferred disposal is an ordinary owned resource, not a replacement lifecycle owner. */
  const cleaning = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await owners[0].use(
      definePlugin({
        name: 'cleanup',
        install(core) {
          core.onDispose(() => cleaning)
          return {}
        }
      })
    )
    await Promise.all(
      owners.map((owner, index) =>
        owner.use(
          createThreadPlugin({
            name: 'remote',
            connect: carrier.sources[index]!,
            report: () => undefined
          })
        )
      )
    )
    /** The facade was genuinely published before the original Host started closing. */
    const outlet = owners[0].thread!
    await owners[0].unUse('remote')
    assert.deepEqual(
      await outlet.broadcast('hidden.read'),
      [],
      '[A18] no future target is notified'
    )
    /** Original dispose closes Host admission synchronously even while resources still await drain. */
    const closing = owners[0].dispose()
    for (const mode of ['request', 'notify', 'stream'] as const)
      assert.throws(() => outlet[mode]('remote', 'hidden.read'), { code: 'HOST_DISPOSING' })
    release()
    await closing
  } finally {
    release()
    for (const owner of owners) await owner.dispose()
    carrier.close()
  }
})

it('[A18][A19] real broadcast snapshots three targets and reports a send failure and subsequent departure once', async () => {
  /** Actual independent Hosts and carriers keep every recipient in its own canonical endpoint. */
  const owner = host()
  /** The three target registrations use the same real public factory, never stubbed Peer methods. */
  const targets = [host(), host(), host()] as const
  /** Original memory carriers deliver the real envelopes and independently own physical cleanup. */
  const carriers = [runtimeSources(), runtimeSources(), runtimeSources()] as const
  /** Test-only physical observation begins after genuine directory exchange and ordinary business. */
  const sent = [0, 0, 0]
  /** Every target counts the actual exposed function execution. */
  const invoked = [0, 0, 0]
  /** Original provider/send errors remain native and are separately observable by their reporter. */
  const reports: unknown[] = []
  /** The actual second carrier rejects physical sending with this native cause. */
  const failure = new RangeError('broadcast carrier fixture failure')
  /** Only the explicit broadcast enables the failure/departure injection. */
  let armed = false
  try {
    for (const [index, target] of targets.entries()) {
      await target.use(
        definePlugin({
          name: 'service',
          features: {
            data: defineFeature(() => ({
              read: () => {
                invoked[index]! += 1
                return 42
              }
            }))
          },
          install: () => ({})
        })
      )
      await Promise.all([
        owner.use(
          createThreadPlugin({
            name: `connection-${index}`,
            connect: async (context) => {
              /** Keep the actual platform source and every canonical channel field unchanged. */
              const channel = await carriers[index]!.sources[0](context)
              /**
               * Inherit the original closed getter and subscriptions while observing the real
               * sender.
               */
              const transport = Object.create(channel.transport)
              Object.defineProperty(transport, 'send', {
                value: (message: unknown) => {
                  if (!armed) return channel.transport.send(message)
                  sent[index]! += 1
                  if (index === 1) throw failure
                  if (index === 0)
                    return owner.unUse('connection-2').then(() => channel.transport.send(message))
                  return channel.transport.send(message)
                }
              })
              return { ...channel, transport }
            },
            report: (error) => reports.push(error)
          })
        ),
        target.use(
          createThreadPlugin({
            name: `connection-${index}`,
            connect: carriers[index]!.sources[1],
            expose: ['service'],
            report: (error) => reports.push(error)
          })
        )
      ])
    }
    /** The committed original slot contains three independently authenticated directory receipts. */
    const outlet = owner.thread!
    /** Keep accepted instance order before the third receipt is retired during physical send. */
    const ids = targets.map((_target, index) => outlet.get(`connection-${index}`).instanceId)
    await outlet.notify('connection-0', 'service.read')
    await vi.waitFor(() => assert.deepEqual(invoked, [1, 0, 0]))
    invoked.fill(0)
    armed = true
    /** Broadcast delegates one-way only and retains the pre-send snapshot despite later removal. */
    const results = await outlet.broadcast('service.read')
    assert.deepEqual(
      results.map(({ instanceId, ok }) => [instanceId, ok]),
      [
        [ids[0], true],
        [ids[1], false],
        [ids[2], false]
      ]
    )
    assert.deepEqual(
      sent,
      [1, 1, 0],
      '[A19] departed target receives no frame and failures never retry'
    )
    await vi.waitFor(() => assert.deepEqual(invoked, [1, 0, 0]))
    assert.equal(reports.length, 2, '[A19] each failed target reports once')
    assert.ok(
      reports.some((error) => error instanceof Error && error.cause === failure),
      '[A19] original native send cause remains reachable'
    )
    assert.equal((results[1]!.error as { code?: string }).code, RpcCoreErrorCode.transport)
    assert.equal((results[2]!.error as { code?: string }).code, RpcCoreErrorCode.targetUnknown)
  } finally {
    await owner.dispose()
    for (const target of targets) await target.dispose()
    for (const carrier of carriers) carrier.close()
  }
})
