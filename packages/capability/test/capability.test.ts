import {
  AsyncCapabilityRelease,
  activateHostHandle,
  loadCapabilityModule
} from './fixtures/host-cleanup.ts'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilityHost, type ICapabilityHandle } from '../src/index.ts'
import { handleOf, enabledHost } from './fixtures/capability-host.ts'

/** Existing host cases grouped by one lifecycle concern; assertions remain unchanged. */
describe('能力闸门：激活、登记与隔离', () => {
  it(
    'activates once no matter how many callers ask concurrently',
    verifyActivatesOnceNoMatterHowManyCallersAskConcurrently
  )

  it('passes the host context into activation', verifyPassesTheHostContextIntoActivation)

  it(
    'snapshots registration identity and activation against caller mutation',
    verifySnapshotsRegistrationIdentityAndActivationAgainstCallerMutation
  )

  it(
    'rejects malformed registrations before they enter the name table',
    verifyRejectsMalformedRegistrationsBeforeTheyEnterTheNameTable
  )

  it(
    'disposes the handle exactly once when disabled, and re-activates fresh',
    verifyDisposesTheHandleExactlyOnceWhenDisabledAndReActivatesFresh
  )

  it(
    'stays off when activation fails, and keeps the reason',
    verifyStaysOffWhenActivationFailsAndKeepsTheReason
  )

  it(
    'refuses to enable what the flags turned off, which is the rollback path',
    verifyRefusesToEnableWhatTheFlagsTurnedOffWhichIsTheRollbackPath
  )

  it(
    'uses own-property allowlisting without invoking getters or the prototype chain',
    verifyUsesOwnPropertyAllowlistingWithoutInvokingGettersOrThePrototypeChain
  )

  it('keeps two tenants from seeing each other', verifyKeepsTwoTenantsFromSeeingEachOther)

  it(
    'rejects unknown names and double registration instead of guessing',
    verifyRejectsUnknownNamesAndDoubleRegistrationInsteadOfGuessing
  )

  it(
    'supports a lazily imported capability, which is the whole point',
    verifySupportsALazilyImportedCapabilityWhichIsTheWholePoint
  )

  it(
    'primary lifecycle methods expose structured and awaitable semantics',
    verifyPrimaryLifecycleMethodsExposeStructuredAndAwaitableSemantics
  )
})

/** Executes the existing case: activates once no matter how many callers ask concurrently. */
async function verifyActivatesOnceNoMatterHowManyCallersAskConcurrently(): Promise<void> {
  const activate = vi.fn(async () => handleOf())
  const host = enabledHost({ tenant: 'a' }, 'persist')
  host.register({ name: 'persist', activate })

  const results = await Promise.all([
    host.enable('persist'),
    host.enable('persist'),
    host.enable('persist')
  ])

  expect(results).toEqual([{ status: 'enabled' }, { status: 'enabled' }, { status: 'enabled' }])
  expect(activate).toHaveBeenCalledTimes(1)
  expect(host.state('persist')).toBe('on')
  await host.dispose()
}

/** Executes the existing case: passes the host context into activation. */
async function verifyPassesTheHostContextIntoActivation(): Promise<void> {
  const activate = vi.fn(async () => handleOf())
  const host = enabledHost({ tenant: 'acme' }, 'persist')
  host.register({ name: 'persist', activate })

  await host.enable('persist')

  expect(activate).toHaveBeenCalledWith({ tenant: 'acme' })
  await host.dispose()
}

/**
 * Executes the existing case: snapshots registration identity and activation against caller
 * mutation.
 */
async function verifySnapshotsRegistrationIdentityAndActivationAgainstCallerMutation(): Promise<void> {
  const original = handleOf()
  const replacement = handleOf()
  const observedThisNames: string[] = []
  const activateOriginal = vi.fn(async function (this: { name: string }) {
    observedThisNames.push(this.name)
    return original
  })
  const activateReplacement = vi.fn(async () => replacement)
  const definition = {
    name: 'persist',
    activate: activateOriginal
  }
  const host = enabledHost(undefined, 'persist', 'worker')
  host.register(definition)

  definition.name = 'worker'
  definition.activate = activateReplacement

  await expect(host.enable('persist')).resolves.toEqual({ status: 'enabled' })
  expect(activateOriginal).toHaveBeenCalledOnce()
  expect(observedThisNames).toEqual(['persist'])
  expect(activateReplacement).not.toHaveBeenCalled()
  host.setFlag('persist', false)
  expect(host.state('persist')).toBe('gated')
  expect(original.dispose).toHaveBeenCalledOnce()
  expect(() => host.state('worker')).toThrow('not registered')
  await host.dispose()
}

/** Executes the existing case: rejects malformed registrations before they enter the name table. */
async function verifyRejectsMalformedRegistrationsBeforeTheyEnterTheNameTable(): Promise<void> {
  const host = enabledHost(undefined, 'valid')

  expect(() => host.register({ name: '   ', activate: activateHostHandle })).toThrow(
    'name must be a non-empty string'
  )
  expect(() =>
    host.register({
      name: 'valid',
      activate: undefined
    } as never)
  ).toThrow('activate must be a function')
  expect(host.names).toEqual([])
  await host.dispose()
}

/**
 * Executes the existing case: disposes the handle exactly once when disabled, and re-activates
 * fresh.
 */
async function verifyDisposesTheHandleExactlyOnceWhenDisabledAndReActivatesFresh(): Promise<void> {
  const first = handleOf()
  const second = handleOf()
  const handles = [first, second]
  const host = enabledHost(undefined, 'persist')
  host.register({
    name: 'persist',
    activate: async () => handles.shift() as ICapabilityHandle
  })

  await host.enable('persist')
  await expect(host.disable('persist')).resolves.toBe(true)
  expect(first.dispose).toHaveBeenCalledTimes(1)
  // 关闭一个已关闭的能力不是错误，但也不该再释放一次
  await expect(host.disable('persist')).resolves.toBe(false)
  expect(first.dispose).toHaveBeenCalledTimes(1)

  await host.enable('persist')
  expect(host.handle('persist')).toBe(second)
  await host.dispose()
  expect(second.dispose).toHaveBeenCalledTimes(1)
}

/** Executes the existing case: stays off when activation fails, and keeps the reason. */
async function verifyStaysOffWhenActivationFailsAndKeepsTheReason(): Promise<void> {
  const onError = vi.fn()
  const host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError
  })
  host.register({
    name: 'worker',
    activate: async () => {
      throw new Error('chunk 404')
    }
  })

  await expect(host.enable('worker')).resolves.toMatchObject({
    status: 'failed',
    error: expect.any(Error)
  })
  // 「半开」是最坏的结果：调用方以为能用，实际没有 handle
  expect(host.state('worker')).toBe('failed')
  expect(host.handle('worker')).toBeUndefined()
  expect(String(host.error('worker'))).toContain('chunk 404')
  expect(onError).toHaveBeenCalledTimes(1)
  // 失败不影响 host 本身
  expect(host.disposed).toBe(false)
  await host.dispose()
}

/**
 * Executes the existing case: refuses to enable what the flags turned off, which is the rollback
 * path.
 */
async function verifyRefusesToEnableWhatTheFlagsTurnedOffWhichIsTheRollbackPath(): Promise<void> {
  const activate = vi.fn(async () => handleOf())
  const host = createCapabilityHost(undefined)
  host.register({ name: 'devtools', activate })

  await expect(host.enable('devtools')).resolves.toEqual({ status: 'gated' })
  expect(activate).not.toHaveBeenCalled()
  expect(host.state('devtools')).toBe('gated')
  await host.dispose()
}

/**
 * Executes the existing case: uses own-property allowlisting without invoking getters or the
 * prototype chain.
 */
async function verifyUsesOwnPropertyAllowlistingWithoutInvokingGettersOrThePrototypeChain(): Promise<void> {
  const getter = vi.fn(() => true)
  const flags = Object.create({ inherited: true }) as Record<string, boolean>
  Object.defineProperty(flags, 'getter', {
    enumerable: true,
    get: getter
  })
  flags.persist = true

  const host = createCapabilityHost(undefined, { flags })
  flags.persist = false
  for (const name of ['persist', 'inherited', 'getter', '__proto__']) {
    host.register({ name, activate: async () => handleOf() })
  }

  expect(getter).not.toHaveBeenCalled()
  expect(host.state('persist')).toBe('off')
  expect(host.state('inherited')).toBe('gated')
  expect(host.state('getter')).toBe('gated')
  expect(host.state('__proto__')).toBe('gated')

  // Map 保存 flag：危险键名只是普通字符串，不会落到 Object.prototype。
  host.setFlag('__proto__', true)
  expect(host.state('__proto__')).toBe('off')
  await expect(host.enable('__proto__')).resolves.toEqual({ status: 'enabled' })
  await host.dispose()
}

/** Executes the existing case: keeps two tenants from seeing each other. */
async function verifyKeepsTwoTenantsFromSeeingEachOther(): Promise<void> {
  const left = enabledHost({ tenant: 'left' }, 'persist')
  const right = createCapabilityHost(
    { tenant: 'right' },
    {
      flags: { persist: false }
    }
  )
  left.register({ name: 'persist', activate: async () => handleOf() })
  right.register({ name: 'persist', activate: async () => handleOf() })

  await left.enable('persist')
  await right.enable('persist')

  expect(left.state('persist')).toBe('on')
  expect(right.state('persist')).toBe('gated')
  left.dispose()
  right.dispose()
}

/** Executes the existing case: rejects unknown names and double registration instead of guessing. */
async function verifyRejectsUnknownNamesAndDoubleRegistrationInsteadOfGuessing(): Promise<void> {
  const host = enabledHost(undefined, 'persist')
  host.register({ name: 'persist', activate: async () => handleOf() })

  expect(() => host.register({ name: 'persist', activate: activateHostHandle })).toThrow(
    'already registered'
  )
  expect(() => host.state('nope')).toThrow('not registered')
  await expect(host.enable('nope')).rejects.toThrow('not registered')

  await host.dispose()
  // enable 是 async：释放后的调用以 rejection 形态报错，不是同步抛
  await expect(host.enable('persist')).rejects.toThrow('disposed')
}

/** Executes the existing case: supports a lazily imported capability, which is the whole point. */
async function verifySupportsALazilyImportedCapabilityWhichIsTheWholePoint(): Promise<void> {
  // 体积只在这条路上才真的省下来：关着的时候这个模块不进初始包。
  // 闸门保证的是时机、失败与竞态，省体积的是打包器。
  const load = vi.fn(loadCapabilityModule)
  const host = enabledHost(undefined, 'persist')
  host.register({
    name: 'persist',
    activate: async () => (await load()).install()
  })

  expect(load).not.toHaveBeenCalled()
  await host.enable('persist')
  expect(load).toHaveBeenCalledTimes(1)
  await host.dispose()
}

/** Executes the existing case: primary lifecycle methods expose structured and awaitable semantics. */
async function verifyPrimaryLifecycleMethodsExposeStructuredAndAwaitableSemantics(): Promise<void> {
  let released = false
  const host = enabledHost(undefined, 'persist')
  /** Cleanup becomes visible only after the original asynchronous release continuation. */
  const cleanup = new AsyncCapabilityRelease(() => {
    released = true
  })
  host.register({
    name: 'persist',
    activate: async () => ({ dispose: cleanup.dispose })
  })
  expect(await host.enable('persist')).toEqual({ status: 'enabled' })
  await host.disable('persist')
  expect(released).toBe(true)
  await host.dispose()
}
