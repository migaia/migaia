import { PluginHost, isDefinedPlugin } from '@migaia/plugin-host'
import { CapabilityLevel, createUnitBudget, ReplaceStrategy } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import type { IRemotePluginDefinition } from '../../src/remote/plugin.js'
import { describe, expect, it, vi } from 'vitest'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IProcessPluginOptions } from '../../src/process/plugin/types.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'

/** All replacement specs retain the same bootstrap secret while changing the launched command. */
function spec(command: string, token: string): IProcessSpec {
  return {
    command,
    args: [],
    env: { inherit: [], set: {} },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
    bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
  }
}

/** A launched handle resolves exit exactly when the supervisor terminates it. */
function processHandle(fingerprint: string): IProcessHandle {
  /** Termination is the only exit event in this deterministic fixture. */
  let settle!: (status: { code: number | null; signal: string | null }) => void
  return {
    identity: { fingerprint },
    exited: new Promise((resolve) => {
      settle = resolve
    }),
    terminate: () => settle({ code: 0, signal: null })
  }
}

/** One trusted in-memory adapter exercises the real process supervisor and remote setup. */
function fixture(withHostReplace = true) {
  const remote = remoteHarness()
  const scheduler = remote.binding.scheduler
  const token = 'replace-token'
  const original = spec('old-child', token)
  const budget = createUnitBudget({ kind: 'process', maxUnits: 2, scheduler })
  const launch = vi.fn(async (_spec: IProcessSpec) =>
    processHandle(`child-${launch.mock.calls.length}`)
  )
  const launcher = {
    capabilities: {
      termination: CapabilityLevel.enforced,
      'fault-isolation': CapabilityLevel.enforced,
      'bootstrap-stdin': CapabilityLevel.enforced
    },
    launch
  }
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const hostReplace = vi.fn(async () => undefined)
  const raw: IProcessByteChannel = {
    kind: 'byte',
    write: async () => undefined,
    onData: () => () => undefined,
    onClose: () => () => undefined,
    close: () => undefined
  }
  const options: IProcessPluginOptions = {
    name: 'p',
    contract: REMOTE_FIXTURE_CONTRACT,
    registrationOwner: { name: 'p', host },
    host: {
      disable: (name, policy) => host.plugin.disable(name, policy),
      enable: (name) => host.plugin.enable(name),
      ...(withHostReplace ? { replace: hostReplace } : {})
    },
    endpointFactory: async () => remote.served,
    report: () => undefined,
    deployment: {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token,
      supervision: {
        id: 'replace-fixture',
        spec: original,
        budget,
        scheduler,
        health: { check: async () => undefined },
        launcher,
        report: () => undefined
      },
      rawChannel: async () => raw,
      establish: async () => ({
        ...remote.channel,
        agreement: { ...remote.channel.agreement, source: 'negotiated' as const }
      })
    }
  }
  return { options, host, hostReplace, launch, token, original, budget, launcher }
}

describe('process plugin whole-process replacement', () => {
  it('[A9] synchronously rejects both strategies on a replaced definition', async () => {
    const test = fixture()
    let currentFeature: { request(params: unknown[]): Promise<unknown> } | undefined
    const plugin = createProcessPlugin({
      ...test.options,
      host: {
        ...test.options.host,
        replace: async (name, candidate) => {
          const handle = await test.host.replace(name, candidate)
          currentFeature = handle.getFeature('f') as typeof currentFeature
        }
      }
    })
    try {
      await test.host.use(plugin)
      await plugin.replace({ strategy: ReplaceStrategy.startThenSwitch })
      expect(test.launch).toHaveBeenCalledTimes(2)
      expect(() => plugin.replace({ strategy: ReplaceStrategy.stopThenStart })).toThrowError(
        expect.objectContaining({ code: 'SCOPE_TERMINAL' })
      )
      expect(() => plugin.replace({ strategy: ReplaceStrategy.startThenSwitch })).toThrowError(
        expect.objectContaining({ code: 'SCOPE_TERMINAL' })
      )
      expect(test.launch).toHaveBeenCalledTimes(2)
      expect(await currentFeature?.request(['live'])).toBe('result')
    } finally {
      await test.host.dispose()
    }
  })

  it.each([null, undefined])(
    '[A2/K229] codes malformed bootstrap payload %s before launch',
    async (payload) => {
      /** The native byte deployment is valid except for the malformed bootstrap bytes. */
      const test = fixture()
      try {
        const deployment = test.options.deployment
        if (deployment.kind !== 'spawn') throw new Error('fixture must spawn')
        expect(() =>
          createProcessPlugin({
            ...test.options,
            deployment: {
              ...deployment,
              supervision: {
                ...deployment.supervision,
                spec: {
                  ...deployment.supervision.spec,
                  bootstrap: { via: 'stdin', payload } as unknown as IProcessSpec['bootstrap']
                }
              }
            }
          })
        ).toThrowError(
          expect.objectContaining({
            source: '@migaia/rpc/process',
            code: 'PROCESS_PLUGIN_INVALID_OPTION',
            detail: { field: 'supervision.spec.bootstrap' }
          })
        )
        expect(test.launch).not.toHaveBeenCalled()
        expect(test.budget.inUse).toBe(0)
      } finally {
        await test.host.dispose()
      }
    }
  )

  it('[A2/A5] rejects an invalid local owner or missing default ping before launch', async () => {
    const test = fixture()
    try {
      expect(() =>
        createProcessPlugin({
          ...test.options,
          registrationOwner: { name: 'another-plugin', host: test.host }
        })
      ).toThrowError(
        expect.objectContaining({
          code: 'PROCESS_PLUGIN_INVALID_OPTION',
          detail: { field: 'registrationOwner' }
        })
      )
      const deployment = test.options.deployment
      if (deployment.kind !== 'spawn') throw new Error('fixture must spawn')
      const offer = {
        ...createNativeProcessOffer({ peer: { id: 'probe', runtime: 'node' } }),
        capabilities: ['close@1']
      }
      expect(() =>
        createProcessPlugin({
          ...test.options,
          deployment: {
            ...deployment,
            offer,
            supervision: { ...deployment.supervision, health: undefined }
          }
        })
      ).toThrowError(
        expect.objectContaining({
          code: 'PROCESS_RESILIENCE_INVALID_OPTION',
          detail: { field: 'deployment.offer.capabilities' }
        })
      )
      expect(test.launch).not.toHaveBeenCalled()
      expect(() =>
        createProcessPlugin({
          ...test.options,
          deployment: {
            ...deployment,
            offer,
            supervision: {
              ...deployment.supervision,
              health: { check: async () => undefined }
            }
          }
        })
      ).not.toThrow()
    } finally {
      await test.host.dispose()
    }
  })

  it('[A9] keeps trusted frozen metadata and delegates stop-then-start to its supervisor', async () => {
    const test = fixture()
    const plugin = createProcessPlugin(test.options)
    expect(isDefinedPlugin(plugin)).toBe(true)
    expect(Object.isFrozen(plugin)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(plugin, 'replace')).toMatchObject({ writable: false })
    try {
      await test.host.use(plugin)
      const next = spec('new-child', test.token)
      const result = await plugin.replace({ spec: next })
      expect(result).toEqual({
        strategy: ReplaceStrategy.stopThenStart,
        outcome: { kind: 'replaced', generation: 2 }
      })
      expect(test.launch).toHaveBeenCalledTimes(2)
      expect(test.launch.mock.calls[1]?.[0]).toBe(next)
      expect(test.hostReplace).not.toHaveBeenCalled()
    } finally {
      await test.host.dispose()
    }
  })

  it('[A9] rejects invalid strategy and bootstrap before any replacement owner is called', async () => {
    const test = fixture()
    const plugin = createProcessPlugin(test.options)
    try {
      await test.host.use(plugin)
      expect(() => plugin.replace({ strategy: 'hot' as ReplaceStrategy })).toThrowError(
        expect.objectContaining({ code: 'PROCESS_PLUGIN_INVALID_OPTION' })
      )
      expect(() => plugin.replace({ spec: spec('new-child', 'wrong-token') })).toThrowError(
        expect.objectContaining({
          code: 'PROCESS_PLUGIN_INVALID_OPTION',
          detail: { field: 'spec.bootstrap' }
        })
      )
      expect(test.launch).toHaveBeenCalledTimes(1)
      expect(test.hostReplace).not.toHaveBeenCalled()
    } finally {
      await test.host.dispose()
    }
  })

  it('[A9] routes start-then-switch through Host with a distinct trusted candidate', async () => {
    const test = fixture()
    const plugin = createProcessPlugin(test.options)
    try {
      await test.host.use(plugin)
      const result = await plugin.replace({ strategy: ReplaceStrategy.startThenSwitch })
      expect(result.strategy).toBe(ReplaceStrategy.startThenSwitch)
      expect(test.hostReplace).toHaveBeenCalledTimes(1)
      if (result.strategy === ReplaceStrategy.startThenSwitch) {
        expect(test.hostReplace).toHaveBeenCalledWith('p', result.plugin)
        expect(result.plugin).not.toBe(plugin)
        expect(isDefinedPlugin(result.plugin)).toBe(true)
      }
      expect(test.launch).toHaveBeenCalledTimes(1)
    } finally {
      await test.host.dispose()
    }
  })

  it('[A9] invalidates the caller pool once and never takes it for a candidate', async () => {
    const test = fixture()
    if (test.options.deployment.kind !== 'spawn') throw new Error('spawn fixture required')
    const deployment = test.options.deployment
    const take = vi.fn(() => undefined)
    const invalidate = vi.fn()
    const pool = {
      id: 'caller-pool',
      spec: deployment.supervision.spec,
      budget: deployment.supervision.budget,
      launcher: deployment.supervision.launcher,
      idle: 0,
      take,
      invalidate,
      dispose: async () => undefined
    }
    const hostReplace = vi.fn(async (_name: string, candidate: IRemotePluginDefinition) => {
      await test.host.replace('p', candidate)
    })
    const plugin = createProcessPlugin({
      ...test.options,
      host: { ...test.options.host, replace: hostReplace },
      deployment: {
        ...deployment,
        supervision: { ...deployment.supervision, prewarm: pool }
      }
    })
    try {
      await test.host.use(plugin)
      const initialTakeCount = take.mock.calls.length
      expect(() =>
        plugin.replace({
          strategy: ReplaceStrategy.startThenSwitch,
          spec: spec('', test.token)
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
      expect(invalidate).not.toHaveBeenCalled()
      expect(hostReplace).not.toHaveBeenCalled()
      const result = await plugin.replace({ strategy: ReplaceStrategy.startThenSwitch })
      expect(result.strategy).toBe(ReplaceStrategy.startThenSwitch)
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(take).toHaveBeenCalledTimes(initialTakeCount)
      expect(test.launch).toHaveBeenCalledTimes(2)
    } finally {
      await test.host.dispose()
    }
  })

  it('[A9] rejects borrowed connect replacement and missing Host replacement synchronously', async () => {
    const test = fixture(false)
    const spawn = createProcessPlugin(test.options)
    try {
      await test.host.use(spawn)
      expect(() => spawn.replace({ strategy: ReplaceStrategy.startThenSwitch })).toThrowError(
        expect.objectContaining({ detail: { field: 'host.replace' } })
      )
      const connect = createProcessPlugin({
        ...test.options,
        deployment: {
          kind: 'connect',
          address: 'fixture',
          token: test.token,
          dial: async () => {
            throw new Error('dial must not run')
          },
          establish: async () => {
            throw new Error('establish must not run')
          }
        }
      })
      expect(() => connect.replace()).toThrowError(
        expect.objectContaining({ detail: { field: 'deployment.kind' } })
      )
      expect(test.launch).toHaveBeenCalledTimes(1)
    } finally {
      await test.host.dispose()
    }
  })
})
