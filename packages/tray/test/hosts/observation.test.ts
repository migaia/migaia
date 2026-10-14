import { describe, expect, it, vi } from 'vitest'
import { defineProbe, RpcProbeStage } from '@migaia/rpc-core/probe'
import * as CoroutineSupervision from '@migaia/supervision/coroutine'
import * as ThreadSupervision from '@migaia/supervision/threads'
import * as ProcessSupervision from '@migaia/supervision/process'
import { chainHas, classify, fixture, lines, marker, until } from './helper.js'

describe('Tray runtime observation', () => {
  it('[A7] observes parent messages for two units per runtime and child serve messages in native realms', async () => {
    /** Snapshots survive the probe's mutable view reuse. */
    const events: any[] = []
    /** Counting belongs to the runtime's genuine message probe. */
    const probe = defineProbe({ stages: ['message'], emit: (event) => events.push({ ...event }) })
    /** Shared declarations run the same business call in each runtime. */
    const api = await fixture()
    /** Probe is passed through the public createTray option. */
    const tray = api.createTray({ hosts: api.hosts, probe })
    try {
      for (const definition of api.hosts)
        for (let index = 0; index < 2; index += 1) {
          /** Each child marker identifies observations made by serveTrayHost itself. */
          const probeMarker = marker('child-probe')
          /** The marker is passed only as portable instance config. */
          const remote = await tray.spawn(definition.name, {
            id: `${definition.runtime}-${index}`,
            config: { probeMarker }
          })
          /** This call must add message observations after the ready/init traffic. */
          const before = events.length
          await remote.request('node.svc.echo', definition.runtime)
          expect(events.length).toBeGreaterThan(before)
          if (definition.runtime !== 'coroutine')
            await until(
              () => lines(probeMarker).length,
              (count) => count > 0
            )
        }
      expect(
        events.filter((event) => event.stage === RpcProbeStage.message).length
      ).toBeGreaterThan(6)
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it('[A7] projects the non-default heapBytes into the real Worker resource limit', async () => {
    /** The actual Worker returns resourceLimits from node:worker_threads. */
    const api = await fixture()
    /** 96 MiB is deliberately distinct from runtime defaults. */
    const definition = api.defineTrayHost({
      ...api.nodeTh,
      limits: { heapBytes: 96 * 1024 * 1024 }
    })
    /** Limits are supplied through the public host DSL. */
    const tray = api.createTray({ hosts: [definition] })
    try {
      /** Native identity confirms this provider is inside a Worker realm. */
      const remote = await tray.spawn(definition.name, { id: 'limited' })
      expect(await remote.request('node.svc.hello')).toMatchObject({
        threadId: expect.any(Number),
        resourceLimits: { maxOldGenerationSizeMb: 96 }
      })
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it.each([0, 1, 2])(
    '[A7] runtime %i forwards startupTimeoutMs to the real native launch/ready deadline',
    async (index) => {
      /** Native report classifies the real startup deadline rather than a Tray init timer. */
      const reports: unknown[] = []
      /**
       * Native terminal events retain the original startup error even when RPC's ready outcome is
       * only a state.
       */
      const nativeFailures: unknown[] = []
      /** Specific A7 slow phase honors the existing native launch/ready cancellation signal. */
      const slowPhase = (signal: any) =>
        new Promise<void>((resolve, reject) => {
          /** This fixture timer delays the native operation; the deadline remains supervision-owned. */
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort)
            resolve()
          }, 250)
          /** Cancellation rejects with the exact native STARTUP_TIMEOUT reason. */
          const abort = () => {
            clearTimeout(timer)
            reject(signal.reason)
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      /** Coroutine launch cancellation happens before its original task and MessagePorts exist. */
      let launchEntered = false
      /** The original launcher must not run after its genuine launch context was aborted. */
      let launchDelegations = 0
      /** Only coroutine needs its existing exported launcher owner; other families use ready. */
      let launcherObservation: any
      if (index === 0) {
        /** Exported native module is the exact owner imported by coroutine/supervisor.js. */
        const launcherUrl = new URL(
          '../../../supervision/dist/coroutine/launcher.js',
          import.meta.url
        ).href
        /** Instrumentation retains the canonical launcher object, capabilities and methods. */
        const launcherOwner = await import(launcherUrl)
        /** The real factory still constructs the native launcher's closure-owned state. */
        const originalLauncher = launcherOwner.createCoroutineLauncher
        launcherObservation = vi
          .spyOn(launcherOwner, 'createCoroutineLauncher')
          .mockImplementation((scheduler: any) => {
            /**
             * Exact native interface is preserved; no handle, event, state or outcome is
             * fabricated.
             */
            const launcher = originalLauncher(scheduler)
            /** This native method uses closure-owned scheduler/state and no mutable receiver. */
            const launch = launcher.launch
            launcher.launch = async (spec: any, context: any) => {
              launchEntered = true
              await slowPhase(context.signal)
              if (context.signal.aborted) throw context.signal.reason
              launchDelegations += 1
              return launch(spec, context)
            }
            return launcher
          })
      }
      /** Public canonical factories keep their original real native launchers and handles. */
      const owners: any[] = [CoroutineSupervision, ThreadSupervision, ProcessSupervision]
      /** Factory names are the existing ownership boundary consumed by each RPC family. */
      const names = [
        'createCoroutineSupervisor',
        'createThreadSupervisor',
        'createProcessSupervisor'
      ]
      /** Only the chosen family's original public factory is instrumented. */
      const original = owners[index][names[index]]
      /** The slow ready callback must observe a real unit handle, not a fabricated state. */
      let nativeReady = false
      /**
       * Native startup timer receives the unchanged Tray policy and cancels the fixture's slow
       * ready.
       */
      const observation = vi
        .spyOn(owners[index], names[index]!)
        .mockImplementation((options: any) => {
          /** The actual public factory keeps the real launch profile and owns its deadline timer. */
          const supervisor = original(
            index === 0
              ? options
              : {
                  ...options,
                  ready: async (unit: any, signal: any) => {
                    nativeReady = Boolean(unit.identity)
                    await options.ready?.(unit, signal)
                    await slowPhase(signal)
                  }
                }
          )
          supervisor.subscribe((event: any) => {
            if (event.error !== undefined) nativeFailures.push(event.error)
          })
          return supervisor
        })
      /** Parent receives the same built host contract as each Node entry. */
      const api = await fixture()
      /**
       * Native startup covers launcher/ready; post-native RPC bootstrap is explicitly outside this
       * bound.
       */
      const definition = api.defineTrayHost({
        ...api.hosts[index],
        supervisor: { startupTimeoutMs: 25, restart: { mode: 'never' } }
      })
      /** Failure must pass through the canonical native supervision owner. */
      const tray = api.createTray({
        hosts: [definition],
        report: (error: unknown) => reports.push(error)
      })
      try {
        /** The source may never reach generation init at this bound. */
        const failure = await tray
          .spawn(definition.name, { id: 'slow' })
          .catch((error: unknown) => error)
        expect(failure).toMatchObject({ code: 'TRAY_INSTANCE_START_FAILED' })
        expect(observation.mock.calls[0]?.[0]).toMatchObject({ startupTimeoutMs: 25 })
        if (index === 0) {
          expect(launchEntered).toBe(true)
          expect(launchDelegations).toBe(0)
          expect(launcherObservation.mock.calls.length).toBeGreaterThan(0)
        } else expect(nativeReady).toBe(true)
        expect(
          chainHas(failure, 'STARTUP_TIMEOUT') ||
            reports.some((error) => chainHas(error, 'STARTUP_TIMEOUT')) ||
            nativeFailures.some((error) => chainHas(error, 'STARTUP_TIMEOUT')),
          JSON.stringify({
            failure: classify(failure),
            reports: reports.map((error) => classify(error)),
            nativeFailures: nativeFailures.map((error) => classify(error))
          })
        ).toBe(true)
        expect(tray.list()).toEqual([])
      } finally {
        await tray.dispose()
        observation.mockRestore()
        launcherObservation?.mockRestore()
      }
    },
    30000
  )

  it('[A7] delivers the process CAPABILITY_UNSUPPORTED supervision notice to the parent report', async () => {
    /** Canonical process launcher advertises its existing capability strengths. */
    const reports: unknown[] = []
    /** Native process path is required for the degradation notice. */
    const api = await fixture()
    /** Parent report receives original supervision diagnostics. */
    const tray = api.createTray({
      hosts: [api.nodePr],
      report: (error: unknown) => reports.push(error)
    })
    try {
      await tray.spawn('node-pr', { id: 'notice' })
      expect(reports.some((error) => chainHas(error, 'CAPABILITY_UNSUPPORTED'))).toBe(true)
    } finally {
      await tray.dispose()
    }
  }, 30000)
})
