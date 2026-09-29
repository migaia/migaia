import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** Keeps a microtask clock running while one installation path executes. */
const startClock = () => {
  /** Counts turns observable between lifecycle hooks. */
  let round = 0
  /** Stops the clock when the path has settled. */
  let active = false
  /** Advances one turn without introducing a timer or host mutation. */
  const tick = () => {
    if (!active || round >= 1024) return
    round += 1
    queueMicrotask(tick)
  }
  return {
    read: () => round,
    start: () => {
      round = 0
      active = true
      queueMicrotask(tick)
    },
    stop: () => {
      active = false
    }
  }
}

/** Builds a provider and dependent with observable no-setup hook calls. */
const createPair = (
  events: string[],
  readRound: () => number,
  activation?: 'lazy',
  version = 1
) => {
  /** Captures the provider install turn for relative timing. */
  let providerInstallRound = -1
  /** Captures the dependent feature exposure turn for relative timing. */
  let dependentExposeRound = -1
  const service = defineFeature(() => ({ version }))
  const provider = definePlugin({
    name: 'p',
    activation,
    features: { service },
    featureExpose: function () {
      events.push(`p.featureExpose:${arguments.length}`)
      return { pRead: () => version }
    },
    install: function () {
      providerInstallRound = readRound()
      events.push(`p.install:${arguments.length}`)
      return { pExtension: () => version }
    }
  })
  const dependentFeature = defineFeature(
    (_core, dependencies) => ({ version: dependencies.service.version }),
    { service: provider.getFeature('service') }
  )
  const dependent = definePlugin({
    name: 'c',
    activation,
    features: { dependentFeature },
    featureExpose: function () {
      dependentExposeRound = readRound()
      events.push(`c.featureExpose:${arguments.length}`)
      return { cRead: () => version }
    },
    install: function () {
      events.push(`c.install:${arguments.length}`)
      return { cExtension: () => version }
    }
  })
  return {
    provider,
    dependent,
    rounds: () => dependentExposeRound - providerInstallRound,
    installRound: () => providerInstallRound,
    exposeRound: () => dependentExposeRound
  }
}

describe('A11 no-setup installation preservation', () => {
  it('keeps hook arity, order, and microtask turns on every installation path', async () => {
    const options = {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    } as const

    /** Records ordinary batch installation against the base. */
    const useEvents: string[] = []
    const useClock = startClock()
    const usePair = createPair(useEvents, useClock.read)
    const useHost = new PluginHost<Record<string, never>>(options)
    useClock.start()
    await useHost.use(usePair.provider, usePair.dependent)
    useClock.stop()
    const use = { events: useEvents, providerToDependent: usePair.rounds() }
    await useHost.dispose()

    /** Records explicit lazy activation from invocation to first install. */
    const lazyEvents: string[] = []
    const lazyClock = startClock()
    const lazyPair = createPair(lazyEvents, lazyClock.read, 'lazy')
    const lazyHost = new PluginHost<Record<string, never>>(options)
    await lazyHost.use(lazyPair.provider, lazyPair.dependent)
    lazyClock.start()
    const activationRound = lazyClock.read()
    await lazyHost.activate('c')
    lazyClock.stop()
    const lazy = {
      events: lazyEvents,
      activationToInstall: lazyPair.installRound() - activationRound,
      providerToDependent: lazyPair.rounds()
    }
    await lazyHost.dispose()

    /** Records replacement candidate installation and dependent restart. */
    const replaceEvents: string[] = []
    const replaceClock = startClock()
    const replacePair = createPair(replaceEvents, replaceClock.read)
    const replaceHost = new PluginHost<Record<string, never>>(options)
    await replaceHost.use(replacePair.provider, replacePair.dependent)
    replaceEvents.length = 0
    const replacementPair = createPair(replaceEvents, replaceClock.read, undefined, 2)
    const replacement = replacementPair.provider
    replaceClock.start()
    await replaceHost.replace('p', replacement)
    replaceClock.stop()
    const replace = {
      events: replaceEvents,
      providerToDependent: replacePair.exposeRound() - replacementPair.installRound()
    }
    await replaceHost.dispose()

    /** Records synchronous construction and a later synchronous handle call. */
    const syncEvents: string[] = []
    const syncClock = startClock()
    const syncPair = createPair(syncEvents, syncClock.read)
    class SyncHost extends PluginHost<Record<string, never>> {
      constructor() {
        super(options)
        this.useSync([syncPair.provider, syncPair.dependent])
      }

      /** Exposes the protected synchronous path for the preservation case. */
      addSync(): void {
        this.useSync([
          definePlugin({
            name: 'handle',
            featureExpose: function () {
              syncEvents.push(`handle.featureExpose:${arguments.length}`)
              return { read: () => 1 }
            },
            install: function () {
              syncEvents.push(`handle.install:${arguments.length}`)
              return {}
            }
          })
        ])
      }
    }
    syncClock.start()
    const syncHost = new SyncHost()
    syncHost.addSync()
    syncClock.stop()
    const sync = { events: syncEvents, completedBeforeReturn: syncEvents.includes('c.install:1') }
    await syncHost.dispose()

    expect({ use, lazy, replace, sync }).toMatchSnapshot()
  })
})
