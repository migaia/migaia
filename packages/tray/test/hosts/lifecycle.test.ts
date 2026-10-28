import { TrayInternal } from '../../src/hosts/constants.ts'
import type { ITrayRecord } from '../../src/hosts/parent/registry.ts'
import { describe, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assembled, chainHas, fixture, lines, marker, until } from './helper.ts'

describe('Tray lifecycle management', () => {
  const denoAvailable = spawnSync('deno', ['--version']).status === 0

  it.skipIf(!denoAvailable)(
    'disposes a Deno Thread without a PluginHost step timeout',
    () => {
      /** Existing package test entry launches one real Deno parent and its owned Thread child. */
      const entry = fileURLToPath(new URL('./fixtures/deno-owned-exit.mts', import.meta.url))
      /** Fixture output preserves admission notices independently from disposal diagnostics. */
      const output = execFileSync('deno', ['run', '-A', entry], {
        encoding: 'utf8',
        timeout: 20_000
      })
      /** A code-only assertion would hide a duplicate report or a simultaneous disposal timeout. */
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      expect(receipt.value).toBe('actual-deno-tray-worker')
      expect(receipt.admissionDiagnostics).toEqual([
        expect.objectContaining({ source: 'supervision', code: 'CAPABILITY_UNSUPPORTED' })
      ])
      expect(receipt.closeDiagnostics, JSON.stringify(receipt)).toEqual([
        expect.objectContaining({
          source: 'supervision',
          code: 'EXIT_UNOBSERVABLE',
          name: 'Error',
          detail: { kind: 'thread', generation: 1, phase: 'exit', capability: 'exit-observation' },
          message: expect.any(String)
        })
      ])
      expect(JSON.stringify(receipt.closeDiagnostics)).not.toMatch(
        /"code":"(?:REAP_TIMEOUT|DISPOSE_STEP_TIMEOUT)"/
      )
      expect(receipt.elapsedMs, JSON.stringify(receipt)).toBeLessThan(receipt.reapTimeoutMs / 2)
    },
    25_000
  )

  it.each([0, 1, 2])(
    'runtime %i drops a stale background ready receipt queued behind a newer replace',
    async (index) => {
      /**
       * Existing internal registry owner supplies the real queue and record, without new production
       * instrumentation.
       */
      const registryUrl = new URL('../../src/hosts/parent/registry.ts', import.meta.url).href
      /** The spy observes the original factory result and never substitutes its behavior. */
      const registryOwner = await import(registryUrl)
      /** Genuine canonical registry object is captured only for the required queue-race oracle. */
      const observation = vi.spyOn(registryOwner, 'createRegistry')
      /** Physical init appends prove that stale work never reaches a new child generation. */
      const initMarker = marker('stale-background')
      /**
       * Real runtime fixtures produce g2 through deps.tray.exit, never through fabricated ready
       * events.
       */
      const api = await fixture()
      /**
       * Parent assembly keeps the existing runtime outlet available for native generation
       * observation.
       */
      const { tray, host } = await assembled({ hosts: [api.hosts[index]] })
      /**
       * This fixture barrier holds the original queue before the manual entry and background
       * receipt are admitted.
       */
      let release!: () => void
      /** The limiter's running entry exposes exactly when queue admission is blocked. */
      let started!: () => void
      /** No separate test scheduler or queue is introduced. */
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      /** Parent waits for genuine limiter execution before racing native ready with replace. */
      const entered = new Promise<void>((resolve) => {
        started = resolve
      })
      /** Preserve the real removed record for the post-disposal init-index resource assertion. */
      let retainedRecord: ITrayRecord | undefined
      try {
        /** First generation init is already complete before the queue-race starts. */
        const remote = await tray.spawn(api.hosts[index].name, {
          id: 'stale',
          config: { label: 'old', initMarker }
        })
        /** Factory capture retains the actual existing record's limiter. */
        const registry = observation.mock.results.at(-1)!.value
        /** The real record is neither cloned nor replaced by this observation. */
        const record = registry.records.get('stale')
        retainedRecord = record
        /** Captured generation proves which receipt later becomes superseded. */
        const g1 = (await tray.get('stale')).generation
        expect([...record.inits.keys()]).toEqual([g1])
        /** Actual RPC ready, rather than early native unit readiness, admits the background receipt. */
        let readyGeneration = 0
        /** Parent queue has observed this same exact ready before this later listener records it. */
        const releaseReady = host[`${TrayInternal.namespacePrefix}stale`].members.on(
          'ready',
          (event: any) => {
            if (event.name === 'stale') readyGeneration = event.generation
          }
        )
        /**
         * Blocking one existing queue entry allows public replace to be admitted before native g2
         * ready.
         */
        const holding = record.queue.run(async () => {
          started()
          await blocked
        })
        await entered
        /** Manual entry is ahead of the not-yet-produced background ready receipt. */
        const replacing = tray.replace('stale', { config: { label: 'new', initMarker } })
        await remote.notify('node.svc.exitCrash', undefined)
        await until(
          () => readyGeneration,
          (generation) => generation === g1 + 1
        )
        releaseReady()
        release()
        await holding
        /** This result comes from actual native g3, not a Tray-manufactured generation. */
        const replacement = await replacing
        await record.queue.whenIdle()
        expect(replacement.generation).toBe(g1 + 2)
        expect([...record.inits.keys()]).toEqual([g1 + 2])
        expect(lines(initMarker)).toEqual([`init:stale:${g1}:old`, `init:stale:${g1 + 2}:new`])
        expect(await tray.get('stale')).toMatchObject({
          generation: g1 + 2,
          state: 'ready',
          config: { label: 'new' }
        })
      } finally {
        release()
        await tray.dispose()
        if (retainedRecord) expect(retainedRecord.inits.size).toBe(0)
        observation.mockRestore()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i immediately calls every restarted generation for 20 iterations, replaces config and restarts from stopped',
    async (index) => {
      /** Shared declarations preserve one business path across all runtime families. */
      const api = await fixture()
      /** Management state and connection ownership belong to this registry. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      try {
        /** One admission keeps its remote binding across native generation changes. */
        const remote = await tray.spawn(api.hosts[index].name, {
          id: 'managed',
          config: { label: 'old' }
        })
        /** Unit generation is independent from the RPC connection restart token. */
        let generation = (await tray.get('managed')).generation
        for (let iteration = 0; iteration < 20; iteration += 1) {
          /** The returned snapshot must belong to this exact queued restart. */
          const restarted = await tray.restart('managed')
          expect(restarted).toMatchObject({ state: 'ready' })
          expect(restarted.generation).toBeGreaterThan(generation)
          expect(await remote.request('node.svc.hello')).toMatchObject({
            generation: restarted.generation,
            initCount: 1
          })
          generation = restarted.generation
        }
        /** Replacement commits validated input only after generation init is callable. */
        const replaced = await tray.replace('managed', { config: { label: 'new' } })
        expect(replaced).toMatchObject({ state: 'ready', config: { label: 'new' } })
        expect(await remote.request('node.svc.hello')).toMatchObject({
          generation: replaced.generation,
          config: { label: 'new', validated: true },
          initCount: 1
        })
        await expect(tray.replace('managed', { config: { u: undefined } })).rejects.toMatchObject({
          code: 'TRAY_VALUE_NOT_PORTABLE'
        })
        expect((await tray.get('managed')).generation).toBe(replaced.generation)
        await tray.stop('managed')
        /** Readiness error retains the stopped outlet's concrete cause. */
        const stoppedError = await remote.request('node.svc.hello').catch((error: unknown) => error)
        expect(stoppedError).toMatchObject({ code: 'TRAY_INSTANCE_NOT_READY' })
        expect(chainHas(stoppedError, 'TARGET_UNKNOWN')).toBe(true)
        /** A stopped record retains admission identity and can start a new unit. */
        const restarted = await tray.restart('managed')
        expect(await remote.request('node.svc.hello')).toMatchObject({
          generation: restarted.generation,
          initCount: 1
        })
      } finally {
        await tray.dispose()
      }
    },
    90000
  )

  it.each([0, 1, 2])(
    'runtime %i uses one body for crash restart, clean stop and first-exit idempotency',
    async (index) => {
      /** All three definitions run the exact same exit Feature methods. */
      const api = await fixture()
      /** Read-only lifecycle events are the restart oracle. */
      const events: any[] = []
      /** Native supervision runs on-failure in every runtime. */
      const { tray, host } = await assembled({ hosts: [api.hosts[index]] })
      /** Only the admitted replacement's genuine peer-close receipts supply these wire facts. */
      const closeFrames: boolean[] = []
      /** The original scoped listener is released even when the clean-exit assertion fails. */
      let removePeerClosed: (() => void) | undefined
      for (const event of ['ready', 'restarting', 'stopped', 'failed'])
        tray.on(event, (value: any) => events.push(value))
      try {
        /** Notify intentionally has no pending response when the unit ends. */
        const remote = await tray.spawn(api.hosts[index].name, { id: 'exit' })
        /** Native unit generation must advance only after the crash restart becomes ready. */
        const initial = (await tray.get('exit')).generation
        await remote.notify('node.svc.exitCrash', undefined)
        await until(
          () => tray.list()[0],
          (record: any) => record.state === 'ready' && record.generation > initial
        )
        expect(events.map((event) => event.event)).toEqual(['ready', 'restarting', 'ready'])
        expect(await remote.request('node.svc.hello')).toMatchObject({
          initCount: 1,
          generation: expect.any(Number)
        })
        /** Observe the actual parent namespace after restart, excluding the prior crash receipt. */
        removePeerClosed = host[TrayInternal.connection].onPeerClosed(
          (event: Readonly<{ closeFrame: boolean }>) => {
            closeFrames.push(event.closeFrame)
          }
        )
        await remote.notify('node.svc.exitClean', undefined)
        await until(
          () => tray.list()[0],
          (record: any) => record.state === 'stopped'
        )
        expect(events.map((event) => event.event)).toEqual([
          'ready',
          'restarting',
          'ready',
          'stopped'
        ])
        expect(closeFrames).toContain(true)
      } finally {
        removePeerClosed?.()
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i preserves never-restart and the non-default maxRestarts 2 bound',
    async (index) => {
      /** Existing supervision owns crash classification and budget exhaustion. */
      const reports: unknown[] = []
      /** Child uses the same declaration name while parent policy differs. */
      const api = await fixture()
      /** Strict parent policy reaches its native runtime owner. */
      const strict = api.defineTrayHost({
        ...api.hosts[index],
        supervisor: { restart: { mode: 'never' } }
      })
      /** The original business and runtime reporter remains observable. */
      let tray = api.createTray({
        hosts: [strict],
        report: (error: unknown) => reports.push(error)
      })
      try {
        /** Strict crash may never restart. */
        const remote = await tray.spawn(strict.name, { id: 'strict', config: { label: 'old' } })
        await remote.notify('node.svc.exitCrash', undefined)
        await until(
          () => tray.list()[0],
          (record: any) => record.state === 'failed'
        )
        expect(reports.length).toBeGreaterThan(0)
        /**
         * Native terminal replace is a rejected value without an Error; Tray must not invent a
         * cause.
         */
        const terminalReplace = await tray
          .replace('strict', { config: { label: 'new' } })
          .catch((error: unknown) => error)
        expect(terminalReplace).toMatchObject({ code: 'TRAY_INSTANCE_START_FAILED' })
        expect((terminalReplace as Error).cause).toBeUndefined()
        expect((await tray.get('strict')).config).toEqual({ label: 'old' })
      } finally {
        await tray.dispose()
      }
      /** This bound differs from the native default five restarts. */
      const bounded = api.defineTrayHost({
        ...api.hosts[index],
        supervisor: { restart: { maxRestarts: 2, windowMs: 60000, initialDelayMs: 1 } }
      })
      tray = api.createTray({ hosts: [bounded], report: (error: unknown) => reports.push(error) })
      try {
        /** One admission survives only its first two supervised crash restarts. */
        const remote = await tray.spawn(bounded.name, { id: 'budget' })
        for (let crash = 0; crash < 2; crash += 1) {
          /** Captured generation distinguishes a restart from the previous ready state. */
          const generation = (await tray.get('budget')).generation
          await remote.notify('node.svc.exitCrash', undefined)
          await until(
            () => tray.list()[0],
            (record: any) => record.state === 'ready' && record.generation > generation
          )
        }
        await remote.notify('node.svc.exitCrash', undefined)
        await until(
          () => tray.list()[0],
          (record: any) => record.state === 'failed'
        )
        expect(reports.some((error) => chainHas(error, 'SUPERVISION_EXHAUSTED'))).toBe(true)
      } finally {
        await tray.dispose()
      }
    },
    40000
  )
})

describe('Tray lifecycle management', () => {
  it.each([0, 1, 2])(
    'runtime %i reports a background generation init failure and never presents it ready',
    async (index) => {
      /** Actual parent reporting receives the rejected background init. */
      const reports: unknown[] = []
      /** One fixture config makes only later generation init fail. */
      const api = await fixture()
      /** Native runtime receives the unchanged declared restart policy. */
      const tray = api.createTray({
        hosts: [api.hosts[index]],
        report: (error: unknown) => reports.push(error)
      })
      try {
        /** First init is successful; no test-only launcher hook produces the crash. */
        const remote = await tray.spawn(api.hosts[index].name, {
          id: 'background-init',
          config: { failAfterFirst: true }
        })
        await remote.notify('node.svc.exitCrash', undefined)
        await until(
          () => tray.list()[0],
          (record: any) => record.state === 'failed'
        )
        expect(reports.some((error) => chainHas(error, 'INIT_FAILED'))).toBe(true)
        await expect(remote.request('node.svc.hello')).rejects.toMatchObject({
          code: 'TRAY_INSTANCE_NOT_READY'
        })
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i serializes config snapshots and generation init for overlapping replace calls',
    async (index) => {
      /** Physical init log distinguishes the two queued replacements. */
      const initMarker = marker('replace-queue')
      /** Both replacements use the same real host runtime. */
      const api = await fixture()
      /** The registry serializes management without rejecting overlaps. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      try {
        await tray.spawn(api.hosts[index].name, {
          id: 'queue',
          config: { label: 'initial', initMarker }
        })
        /** Native generation before either replacement. */
        const generation = (await tray.get('queue')).generation
        /** First entry owns A even when B is enqueued before A settles. */
        const first = tray.replace('queue', { config: { label: 'A', initMarker } })
        /** Second entry must snapshot B independently. */
        const second = tray.replace('queue', { config: { label: 'B', initMarker } })
        /** Both results belong to their own completed queue entries. */
        const [a, b] = await Promise.all([first, second])
        expect(a).toMatchObject({
          config: { label: 'A' },
          generation: generation + 1,
          state: 'ready'
        })
        expect(b).toMatchObject({
          config: { label: 'B' },
          generation: generation + 2,
          state: 'ready'
        })
        expect(lines(initMarker)).toEqual([
          `init:queue:${generation}:initial`,
          `init:queue:${generation + 1}:A`,
          `init:queue:${generation + 2}:B`
        ])
        expect((await tray.get('queue')).config).toMatchObject({ label: 'B' })
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i keeps held request and stream receipts on the retired generation',
    async (index) => {
      /** One remote admission stays valid while native generations change. */
      const api = await fixture()
      /** Existing RPC receipts settle held work without replay. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      try {
        /** Real child methods hold work through the replacement boundary. */
        const remote = await tray.spawn(api.hosts[index].name, { id: 'held' })
        /** This is the generation that owns both old receipts. */
        const old = (await tray.get('held')).generation
        /** Request handler returns its own generation if drain completes it. */
        const request = remote.request('node.svc.sleep', 100).then(
          (value: any) => ({ value }),
          (error: unknown) => ({ error })
        )
        /** Stream emits its generation before replacement is initiated. */
        const stream = remote.stream('node.svc.held', 100)
        expect((await stream.next()).value).toEqual({ generation: old, item: 1 })
        /** Remaining stream receipt is observed before realm shutdown. */
        const pendingStream = stream.next().then(
          (value: any) => ({ value }),
          (error: unknown) => ({ error })
        )
        /** New calls may run only after new generation init. */
        const replacement = await tray.replace('held', { config: { label: 'new' } })
        /** A close rejection is a valid RPC receipt outcome; any fulfilled value must remain old. */
        const requestOutcome = await request
        if ('value' in requestOutcome) expect(requestOutcome.value.generation).toBe(old)
        else expect((requestOutcome.error as any).code).toBeTruthy()
        /** The stream must never silently continue in the replacement generation. */
        const streamOutcome = await pendingStream
        if ('value' in streamOutcome && !streamOutcome.value.done)
          expect(streamOutcome.value.value.generation).toBe(old)
        else if ('error' in streamOutcome) expect((streamOutcome.error as any).code).toBeTruthy()
        expect(await remote.request('node.svc.hello')).toMatchObject({
          generation: replacement.generation
        })
        await stream.return?.()
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i runs PluginHost cleanup once before every Tray ending and reports bounded shutdown failure',
    async (index) => {
      /** Native file appends are the cleanup oracle across all three realms. */
      const cleanupMarker = marker('cleanup')
      /** Hung disposer failure must reach the canonical report channel. */
      const reports: unknown[] = []
      /** The same plugin disposer belongs to each runtime's child Host. */
      const api = await fixture()
      /** Every operation uses the real outlet's retirement path. */
      const tray = api.createTray({
        hosts: [api.hosts[index]],
        report: (error: unknown) => reports.push(error)
      })
      /** Each native generation ending must produce one independent cleanup marker. */
      const expected: string[] = []
      try {
        /** Initial ready generation has an active business cleanup callback. */
        const remote = await tray.spawn(api.hosts[index].name, {
          id: 'cleanup',
          config: { cleanupMarker }
        })
        /** Queue entries stop and restart the same admission. */
        let generation = (await tray.get('cleanup')).generation
        await tray.stop('cleanup')
        expected.push(`cleanup:cleanup:${generation}`)
        await tray.restart('cleanup')
        generation = (await tray.get('cleanup')).generation
        await tray.restart('cleanup')
        expected.push(`cleanup:cleanup:${generation}`)
        generation = (await tray.get('cleanup')).generation
        await tray.replace('cleanup', { config: { cleanupMarker } })
        expected.push(`cleanup:cleanup:${generation}`)
        generation = (await tray.get('cleanup')).generation
        await tray.remove('cleanup')
        expected.push(`cleanup:cleanup:${generation}`)
        /** Public child exit uses PluginHost cleanup without a new lifecycle hook. */
        const exiting = await tray.spawn(api.hosts[index].name, {
          id: 'exiting',
          config: { cleanupMarker }
        })
        generation = (await tray.get('exiting')).generation
        await exiting.notify('node.svc.exitClean', undefined)
        await until(
          () => tray.list().find((record: any) => record.id === 'exiting'),
          (record: any) => record.state === 'stopped'
        )
        expected.push(`cleanup:exiting:${generation}`)
        await tray.spawn(api.hosts[index].name, { id: 'disposed', config: { cleanupMarker } })
        generation = (await tray.get('disposed')).generation
        await tray.dispose()
        expected.push(`cleanup:disposed:${generation}`)
        expect(lines(cleanupMarker)).toEqual(expected)
        expect(
          await remote.request('node.svc.hello').catch((error: unknown) => error)
        ).toMatchObject({ code: 'TRAY_DISPOSED' })
      } finally {
        await tray.dispose()
      }
      /** A separate unit hangs after registering its cleanup, so grace bounds a real disposer. */
      const hanging = api.createTray({
        hosts: [api.hosts[index]],
        report: (error: unknown) => reports.push(error)
      })
      try {
        await hanging.spawn(api.hosts[index].name, { id: 'hang', config: { cleanupHang: true } })
        await hanging.stop('hang', { graceMs: 20 })
        expect(hanging.list()[0].state).toBe('stopped')
        expect(reports.length).toBeGreaterThan(0)
      } finally {
        await hanging.dispose({ graceMs: 20 })
      }
    },
    50000
  )
})
