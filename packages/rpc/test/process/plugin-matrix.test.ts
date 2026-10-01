import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { matrixFixture, matrixDependency, type IMatrixFeature } from './matrix-fixture.js'

describe('I15 real process acceptance matrix', () => {
  it('[A1/A5] delays real hello/describe, starts dependency only after verification, and aborts actual stream', async () => {
    const test = await matrixFixture()
    const firstSpec = {
      ...test.spec,
      env: {
        inherit: [],
        set: {
          RPC_HANDSHAKE_GATE: join(test.directory, 'hello'),
          RPC_DESCRIBE_GATE: join(test.directory, 'describe')
        }
      }
    }
    /** The exact gate spec is installed through the existing process deployment. */
    const { createProcessPlugin } = await import('../../src/process/plugin/client.js')
    if (test.options.deployment.kind !== 'spawn') throw new Error('spawn required')
    const plugin = createProcessPlugin({
      ...test.options,
      deployment: {
        ...test.options.deployment,
        supervision: { ...test.options.deployment.supervision, spec: firstSpec }
      }
    })
    const dependent = matrixDependency(test, plugin)
    const use = test.host.use(plugin, dependent.definition)
    try {
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:before-handshake'))
      expect(dependent.install).not.toHaveBeenCalled()
      expect(test.describes).toBe(0)
      await test.gate('hello')
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:describe-entered'))
      expect(dependent.install).not.toHaveBeenCalled()
      expect(test.business).toBe(0)
      await test.gate('describe')
      await use
      expect(await dependent.immediate).toBe('child:ready')
      expect(dependent.install).toHaveBeenCalledTimes(1)
      expect(test.handles).toHaveLength(1)
      expect(test.hellos).toBe(1)
      expect(test.describes).toBe(1)
      const abort = new AbortController()
      const stream = dependent.feature.generator(['ordered'], { signal: abort.signal })
      expect(await stream.next()).toEqual({ done: false, value: 'ordered:1' })
      expect(await stream.next()).toEqual({ done: false, value: 'ordered:2' })
      const pending = stream.next().catch((error: unknown) => error)
      abort.abort('consumer-stop')
      expect(await pending).toBe('consumer-stop')
      await vi.waitFor(() =>
        expect(test.chunks.join('')).toContain('matrix:stream-aborted:ordered')
      )
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)

  it('[A1/A9] real prewarm keeps hello/describe once and transfers stderr identity across stop-first', async () => {
    const test = await matrixFixture({ warm: true })
    try {
      await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:before-bootstrap'))
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(0)
      const [installed] = await test.host.use(test.plugin)
      const proxy = installed.getFeature('f') as IMatrixFeature
      expect(test.callerChunks.join('').split('matrix:before-bootstrap').length - 1).toBe(1)
      expect(test.handles).toHaveLength(1)
      expect(test.hellos).toBe(1)
      expect(test.describes).toBe(1)
      const beforeStderr = test.logs.filter((entry) => entry.name === 'ipc.stderr').length
      await proxy.request(['stderr'])
      await vi.waitFor(() =>
        expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(
          beforeStderr + 1
        )
      )
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr').at(-1)).toMatchObject({
        ...test.sessions[0],
        processId: test.handles[0]!.identity.fingerprint
      })
      const initialTake = test.take!.mock.calls.length
      await test.plugin.replace({
        spec: { ...test.spec, env: { inherit: [], set: { RPC_VALUE: 'new' } } }
      })
      await vi.waitFor(async () => expect(await proxy.request(['value'])).toBe('new:value'))
      expect(test.take).toHaveBeenCalledTimes(initialTake)
      expect(test.invalidate).toHaveBeenCalledTimes(1)
      const afterReady = test.logs.filter((entry) => entry.name === 'ipc.stderr').length
      await proxy.request(['stderr'])
      await vi.waitFor(() =>
        expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(
          afterReady + 1
        )
      )
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr').at(-1)).toMatchObject({
        ...test.sessions[1],
        processId: test.handles[1]!.identity.fingerprint
      })
      expect(test.sessions[0]!.sessionId).not.toBe(test.sessions[1]!.sessionId)
      expect(test.hellos).toBe(2)
      expect(test.describes).toBe(2)
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)

  it.each([1, 2])(
    '[A9] real start-switch budget %i keeps old child until candidate ready or rollback',
    async (maxUnits) => {
      const test = await matrixFixture({ maxUnits })
      try {
        const [installed] = await test.host.use(test.plugin)
        const proxy = installed.getFeature('f') as IMatrixFeature
        if (maxUnits === 1) {
          const error = await test.plugin
            .replace({ strategy: 'start-then-switch' })
            .catch((error: unknown) => error)
          expect(error).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
          const find = (value: unknown): boolean =>
            !!value &&
            typeof value === 'object' &&
            (('rejection' in value && value.rejection === 'full') ||
              ('cause' in value && find(value.cause)) ||
              (value instanceof AggregateError && value.errors.some(find)))
          expect(
            find(error),
            JSON.stringify(error, Object.getOwnPropertyNames(error as object))
          ).toBe(true)
          expect(await proxy.request(['old'])).toBe('child:old')
        } else {
          const replacement = test.plugin.replace({
            strategy: 'start-then-switch',
            spec: {
              ...test.spec,
              env: {
                inherit: [],
                set: {
                  RPC_DESCRIBE_GATE: join(test.directory, 'candidate'),
                  RPC_VALUE: 'candidate'
                }
              }
            }
          })
          await vi.waitFor(() => expect(test.handles).toHaveLength(2))
          let exited = false
          void test.handles[0]!.exited.then(() => {
            exited = true
          })
          expect(await proxy.request(['old'])).toBe('child:old')
          expect(exited).toBe(false)
          expect(test.terminations).toHaveLength(0)
          await test.gate('candidate')
          const result = await replacement
          expect(result).toMatchObject({ strategy: 'start-then-switch' })
          if (result.strategy === 'start-then-switch')
            expect(result.plugin).toBe(test.hostReplace.mock.calls[0]![1])
          await test.handles[0]!.exited
          expect(() => test.plugin.replace()).toThrowError(
            expect.objectContaining({ code: 'SCOPE_TERMINAL' })
          )
        }
        expect(test.hostReplace).toHaveBeenCalledTimes(1)
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )

  it.each([2, 3])(
    '[A9] real pool budget %i retains retiring lease and refills original spec',
    async (maxUnits) => {
      const test = await matrixFixture({ maxUnits, warm: true, holdIdle: true })
      try {
        await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
        const [installed] = await test.host.use(test.plugin)
        const proxy = installed.getFeature('f') as IMatrixFeature
        await vi.waitFor(() => expect(test.handles).toHaveLength(2))
        const initialTake = test.take!.mock.calls.length
        const replacement = test.plugin.replace({
          strategy: 'start-then-switch',
          spec: { ...test.spec, env: { inherit: [], set: { RPC_VALUE: 'candidate' } } }
        })
        if (maxUnits === 2) {
          await expect(replacement).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
          expect(await proxy.request(['old'])).toBe('child:old')
          expect(test.budget.inUse).toBe(2)
        } else expect(await replacement).toMatchObject({ strategy: 'start-then-switch' })
        expect(test.take).toHaveBeenCalledTimes(initialTake)
        expect(test.invalidate).toHaveBeenCalledTimes(1)
        expect(test.invalidate!.mock.invocationCallOrder[0]).toBeLessThan(
          test.hostReplace.mock.invocationCallOrder[0]!
        )
        test.releaseIdle()
        await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
        expect(test.launchedSpecs.at(-1)).toBe(test.spec)
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )

  it('[A9] stop-first preserves dependency identity and suspend/enable timeline before real describe', async () => {
    const test = await matrixFixture({ gated: true })
    const dependent = matrixDependency(test)
    try {
      const [installed, dependentHandle] = await test.host.use(test.plugin, dependent.definition)
      const proxy = installed.getFeature('f') as IMatrixFeature
      expect(await dependent.immediate).toBe('child:ready')
      await test.closeGate('describe')
      const replacement = test.plugin.replace({ spec: test.spec })
      await test.handles[0]!.exited
      await vi.waitFor(() =>
        expect(test.chunks.join('').split('matrix:describe-entered').length - 1).toBe(2)
      )
      expect(test.disable).toHaveBeenCalledTimes(1)
      expect(test.enable).not.toHaveBeenCalled()
      expect(() => dependentHandle.getFeature('use')).toThrowError(
        expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
      )
      const before = test.business
      await expect(proxy.request(['blocked'])).rejects.toMatchObject({
        code: 'REMOTE_CLOSED',
        detail: { generation: 2 }
      })
      expect(test.business).toBe(before)
      await test.gate('describe')
      expect(await replacement).toMatchObject({ outcome: { kind: 'replaced', generation: 2 } })
      await vi.waitFor(async () => expect(await proxy.request(['restored'])).toBe('child:restored'))
      expect(installed.getFeature('f')).toBe(proxy)
      expect(dependent.install).toHaveBeenCalledTimes(1)
      expect(test.timeline).toEqual(['disable', 'enable'])
      expect(test.hellos).toBe(2)
      expect(test.describes).toBe(2)
      expect(test.sessions[0]).not.toEqual(test.sessions[1])
    } finally {
      await test.cleanup()
    }
  }, 20000)

  it.each(['stop-then-start', 'start-then-switch'] as const)(
    '[A9] release overlaps real %s candidate preparation',
    async (strategy) => {
      const test = await matrixFixture({ maxUnits: strategy === 'start-then-switch' ? 2 : 1 })
      try {
        await test.host.use(test.plugin)
        const replacing = test.plugin.replace({
          strategy,
          spec: {
            ...test.spec,
            env: { inherit: [], set: { RPC_DESCRIBE_GATE: join(test.directory, 'candidate') } }
          }
        })
        await vi.waitFor(() => expect(test.handles).toHaveLength(2))
        if (strategy === 'start-then-switch') {
          expect(() => test.host.unUse('p', { policy: 'cascade' })).toThrowError(
            expect.objectContaining({ code: 'LIFECYCLE_MUTATION' })
          )
          await test.gate('candidate')
          await replacing
          await test.host.unUse('p', { policy: 'cascade' })
        } else {
          const removing = test.host.unUse('p', { policy: 'cascade' })
          await test.gate('candidate')
          const results = await Promise.allSettled([replacing, removing])
          expect(results[1]).toMatchObject({ status: 'fulfilled', value: { ok: true } })
        }
        for (const handle of test.handles) await handle.exited
        expect(test.budget.inUse).toBe(0)
        expect(() => test.plugin.replace({ strategy })).toThrowError(
          expect.objectContaining({ code: 'SCOPE_TERMINAL' })
        )
      } finally {
        await test.cleanup()
      }
    },
    20000
  )

  it('[A9] real stop-first and start-switch overlap on canonical owners', async () => {
    const test = await matrixFixture({ maxUnits: 3 })
    try {
      await test.host.use(test.plugin)
      const switching = test.plugin.replace({
        strategy: 'start-then-switch',
        spec: {
          ...test.spec,
          env: {
            inherit: [],
            set: { RPC_DESCRIBE_GATE: join(test.directory, 'switch'), RPC_VALUE: 'switch' }
          }
        }
      })
      await vi.waitFor(() => expect(test.handles).toHaveLength(2))
      const stopping = test.plugin.replace({
        strategy: 'stop-then-start',
        spec: { ...test.spec, env: { inherit: [], set: { RPC_VALUE: 'stop' } } }
      })
      expect(await stopping).toMatchObject({ outcome: { kind: 'replaced', generation: 2 } })
      await test.gate('switch')
      const result = await switching
      expect(result.strategy).toBe('start-then-switch')
      const installed = await test.hostReplace.mock.results[0]!.value
      expect(await (installed.getFeature('f') as IMatrixFeature).request(['current'])).toBe(
        'switch:current'
      )
      expect(() => test.plugin.replace()).toThrowError(
        expect.objectContaining({ code: 'SCOPE_TERMINAL' })
      )
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)

  it('[A9] release first rejects both replacement strategies without touching active processes', async () => {
    const test = await matrixFixture({ maxUnits: 2 })
    try {
      await test.host.use(test.plugin)
      await test.host.unUse('p', { policy: 'cascade' })
      for (const strategy of ['stop-then-start', 'start-then-switch'] as const)
        expect(() => test.plugin.replace({ strategy })).toThrowError(
          expect.objectContaining({ code: 'SCOPE_TERMINAL' })
        )
      expect(test.hostReplace).not.toHaveBeenCalled()
      expect(test.handles).toHaveLength(1)
    } finally {
      await test.cleanup()
    }
  }, 20000)
})
