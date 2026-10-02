import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeAll, vi } from 'vitest'
import { CapabilityLevel, createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor, ProcessCapability } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { client, peers, evidence } from './fixtures/conformance-business.js'

/** Match the production default rate (budget.ts); resource acceptance never disables admission. */
const resourceLaunchRate = { max: 8, windowMs: 1000 }
/** Existing 30s preparation budget covers native observation and final cleanup beyond rate waiting. */
const resourceDeadlineMarginMs = 30_000
/** Four runtime warmups plus all 1000 required launches share the same rate limiter. */
const resourceTotalLaunches = 1000 + 4
/** K252 user ruling derives acceptance time from the unchanged production launch rate. */
const resourceDeadlineMs =
  Math.ceil(resourceTotalLaunches / resourceLaunchRate.max) * resourceLaunchRate.windowMs +
  resourceDeadlineMarginMs
/** Match the existing native observation budget; join the queued report before requesting dispose. */
const resourceReportDeadlineMs = 1000

beforeAll(async () => {
  const { admitConformanceToolchains } = await import(
    new URL('./fixtures/conformance-toolchains.mjs', import.meta.url).href
  )
  const receipt = admitConformanceToolchains()
  writeFileSync(join(evidence, 'resources-toolchains.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.accepted) throw new Error(JSON.stringify(receipt))
})

/** Native rows retain actual FD/process states rather than inferring exit from a close Promise. */
type IResourceRow = {
  pid: number
  fdCount: number
  children: Array<{ pid: number; ppid: number; status: number }>
  zombies: number
}
/**
 * The existing prestarted observer is shared with benchmark preparation, with a separate resource
 * mode.
 */
type IResourceObserver = {
  readResources(): Promise<IResourceRow[]>
  read(): Promise<Array<{ pid: number; rssBytes: number; cpuNs: number }>>
  close(): Promise<void>
}

/** Stop only a fixture-owned process group after a failed assertion; unrelated groups are untouched. */
function stopGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Launch four language peers in round-robin order and retain every native resource observation. */
async function rotations(perLanguage: number) {
  const { createMacPidObserver } = await import(
    new URL('../../bench/bare-node.mjs', import.meta.url).href
  )
  const observer: IResourceObserver = await createMacPidObserver([process.pid])
  const budget = createUnitBudget({ kind: 'process', maxUnits: 2, launchRate: resourceLaunchRate })
  const languages = peers.slice(0, 4)
  const counts = Object.fromEntries(languages.map((peer) => [peer.language, 0]))
  const rows: Array<{
    cycle: number
    language: string
    pid: number
    fdCount: number
    zombies: number
    leases: number
    rssBytes: number
    cpuNs: number
  }> = []
  /**
   * Warming each runtime before the FD baseline prevents compiler/module preparation being
   * miscounted as leaks.
   */
  const cycle = async (peer: (typeof peers)[number], index: number, record: boolean) => {
    const active = await client(peer, false, randomUUID(), undefined, false, budget)
    const pid = active.handles[0]!.identity.pid!
    try {
      expect(budget.inUse).toBeLessThanOrEqual(2)
      expect(await active.feature.request([`resource-${index}`])).toBe(`resource-${index}`)
    } finally {
      await active.close()
      for (const handle of active.handles) await handle.exited
    }
    const [resource] = await observer.readResources()
    const [usage] = await observer.read()
    expect(resource!.children.some((child) => child.pid === pid)).toBe(false)
    expect(resource!.zombies).toBe(0)
    expect(budget.inUse).toBe(0)
    expect(budget.pending).toBe(0)
    if (record) {
      counts[peer.language]++
      rows.push({
        cycle: index,
        language: peer.language,
        pid,
        fdCount: resource!.fdCount,
        zombies: resource!.zombies,
        leases: budget.inUse,
        rssBytes: usage!.rssBytes,
        cpuNs: usage!.cpuNs
      })
    }
    return resource!
  }
  let baseline: IResourceRow | undefined
  try {
    for (const peer of languages) baseline = await cycle(peer, -1, false)
    for (let index = 0; index < perLanguage * languages.length; index++) {
      const resource = await cycle(languages[index % languages.length]!, index, true)
      expect(resource.fdCount).toBe(baseline!.fdCount)
    }
    return {
      type: perLanguage === 250 ? 'resource-conformance' : 'resource-preparation',
      counts,
      baseline,
      rows,
      method:
        'macOS libproc proc_pidinfo(PROC_PIDLISTFDS/PROC_PIDT_SHORTBSDINFO), proc_listchildpids, proc_pid_rusage',
      warmupLaunches: 4,
      maxUnits: 2
    }
  } finally {
    writeFileSync(
      join(evidence, `resources-${perLanguage}.json`),
      JSON.stringify({ perLanguage, counts, baseline, rows }, null, 2)
    )
    budget.close()
    await observer.close()
  }
}

describe('[A6] actual language process resource ownership', () => {
  for (const peer of peers.slice(0, 4))
    it(`${peer.language} pause physical reader emits ACK and resumes the same business PID`, async () => {
      const active = await client(peer, false, randomUUID())
      const pid = active.handles[0]!.identity.pid!
      const { createMacPidObserver } = await import(
        new URL('../../bench/bare-node.mjs', import.meta.url).href
      )
      const observer: IResourceObserver = await createMacPidObserver([process.pid])
      try {
        expect(await active.runtime.endpoint.send(peer.id, 'peer.pause', [])).toBe('ACK')
        const started = Date.now()
        let status: number | undefined
        do {
          const [row] = await observer.readResources()
          status = row!.children.find((child) => child.pid === pid)?.status
          if (status !== 4) await new Promise((resolve) => setTimeout(resolve, 10))
        } while (status !== 4 && Date.now() - started < 1000)
        expect(status).toBe(4)
        process.kill(pid, 'SIGCONT')
        expect(await active.feature.request(['reader-resumed'])).toBe('reader-resumed')
        expect(active.handles).toHaveLength(1)
      } finally {
        process.kill(pid, 'SIGCONT')
        await active.close()
        for (const handle of active.handles) await handle.exited
        await observer.close()
      }
    }, 15000)
  it('TS EOF and owner release close the actual public service once and abort its pending provider', async () => {
    /** Physical EOF prevents a caller abort frame from disguising missing provider ownership. */
    const active = await client(peers[3]!, false, randomUUID())
    const waiting = active.runtime.endpoint.send('ts-peer', 'peer.wait', []).catch((error) => error)
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await active.rawChannels[0]!.close()
      await active.handles[0]!.exited
      await active.close()
      await waiting
      const line = Buffer.concat(active.output)
        .toString()
        .split('\n')
        .find((entry) => entry.startsWith('CLEANUP '))
      expect(line).toBeDefined()
      expect(JSON.parse(line!.slice('CLEANUP '.length))).toEqual([
        { calls: 1, settled: 1, providerAborts: 1 }
      ])
    } finally {
      await active.close()
      for (const handle of active.handles) await handle.exited
      writeFileSync(join(evidence, 'ts-owned-cleanup.stderr.log'), Buffer.concat(active.output))
    }
  }, 15000)
  for (const peer of peers.slice(0, 4))
    it(`${peer.language} exits with its observed descendant within 10s after parent SIGKILL`, async () => {
      /** The disposable parent uses the public Host facade and starts this exact language peer. */
      const parent = spawn(
        process.execPath,
        [
          new URL('./fixtures/conformance-parent.mjs', import.meta.url).pathname,
          JSON.stringify(peer)
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const exited = once(parent, 'close')
      const diagnostics: Buffer[] = []
      parent.stderr.on('data', (chunk) => diagnostics.push(chunk))
      const { createMacPidObserver } = await import(
        new URL('../../bench/bare-node.mjs', import.meta.url).href
      )
      let observer: IResourceObserver | undefined
      let pid: number | undefined
      let descendants: number[] = []
      const started = Date.now()
      try {
        /** Readiness contains actual identities only after a successful projected business request. */
        const ready = await new Promise<{ parentPid: number; peerPid: number }>(
          (resolve, reject) => {
            let buffer = ''
            parent.stdout.on('data', (chunk) => {
              buffer += chunk.toString()
              if (buffer.includes('\n')) resolve(JSON.parse(buffer.split('\n')[0]!))
            })
            parent.once('error', reject)
            parent.once('exit', () => reject(new Error(Buffer.concat(diagnostics).toString())))
          }
        )
        expect(ready.parentPid).toBe(parent.pid)
        pid = ready.peerPid
        observer = await createMacPidObserver([pid])
        const [before] = await observer!.readResources()
        descendants = before!.children.map((child) => child.pid)
        expect(descendants).toHaveLength(1)
        expect(before!.zombies).toBe(0)
        parent.kill('SIGKILL')
        await exited
        await observer!.close()
        observer = undefined
        /** ESRCH is the OS observation; a cleanup Promise alone cannot prove these PIDs disappeared. */
        const alive = (target: number) => {
          try {
            process.kill(target, 0)
            return true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
            throw error
          }
        }
        const killed = Date.now()
        while ([pid, ...descendants].some(alive) && Date.now() - killed < 10000)
          await new Promise((resolve) => setTimeout(resolve, 20))
        expect([pid, ...descendants].filter(alive)).toEqual([])
        writeFileSync(
          join(evidence, `kill9-${peer.language}.json`),
          JSON.stringify({ ...ready, descendants, elapsedMs: Date.now() - killed, started })
        )
      } finally {
        parent.kill('SIGKILL')
        await exited
        await observer?.close()
        /** Failed assertions retain diagnostics and stop only this fixture's observed process group. */
        if (pid) stopGroup(pid)
        writeFileSync(
          join(evidence, `kill9-${peer.language}.stderr.log`),
          Buffer.concat(diagnostics)
        )
      }
    }, 15000)
  it('rejects a third real facade before launch while two admitted peers remain usable', async () => {
    /** The shared budget is the production admission owner for all three facade attempts. */
    const budget = createUnitBudget({ kind: 'process', maxUnits: 2, overflow: 'reject' })
    /** Existing processes stay alive while the rejected candidate rolls back its registration. */
    const active = await Promise.all(
      peers.slice(0, 2).map((peer) => client(peer, false, randomUUID(), undefined, false, budget))
    )
    try {
      expect(budget.inUse).toBe(2)
      await expect(
        client(peers[2]!, false, randomUUID(), undefined, false, budget)
      ).rejects.toBeInstanceOf(Error)
      expect(budget.inUse).toBe(2)
      expect(budget.pending).toBe(0)
      for (const item of active) {
        expect(item.handles).toHaveLength(1)
        expect(await item.feature.request(['budget-still-alive'])).toBe('budget-still-alive')
      }
    } finally {
      for (const item of active) {
        await item.close()
        for (const handle of item.handles) await handle.exited
      }
      expect(budget.inUse).toBe(0)
      expect(budget.pending).toBe(0)
      budget.close()
    }
  }, 15000)
  for (const peer of peers.slice(0, 4))
    it(`${peer.language} monitored actual RSS violation terminates the child`, async () => {
      /** The builtin launcher is reused; only caller-owned native usage observation is added. */
      const launcher = createNodeProcessLauncher()
      const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
      const { createMacPidObserver } = await import(
        new URL('../../bench/bare-node.mjs', import.meta.url).href
      )
      let observer: IResourceObserver | undefined
      let measured = 0
      /** Limit failures must be attributed to the production monitor, not an unrelated child exit. */
      const reports: unknown[] = []
      const supervisor = createProcessSupervisor({
        id: `rss-${peer.language}`,
        isolation: 'best-effort',
        budget,
        spec: {
          command: peer.command,
          args: [...peer.args, '--stdio'],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          limits: { memoryBytes: 1 }
        },
        launcher: {
          ...launcher,
          capabilities: {
            ...launcher.capabilities,
            [ProcessCapability.memoryLimit]: CapabilityLevel.monitored
          },
          launch: async (spec, context) => {
            const handle = await launcher.launch(spec, context)
            observer = await createMacPidObserver([handle.identity.pid!])
            return {
              ...handle,
              sampleUsage: async () => {
                const [row] = await observer!.read()
                measured = row!.rssBytes
                return { rssBytes: measured }
              }
            }
          }
        },
        usage: { intervalMs: 10 },
        restart: { maxRestarts: 0 },
        report: (error) => reports.push(error)
      })
      try {
        const started = await supervisor.start()
        expect(started.state).toBe('ready')
        if (started.state !== 'ready') throw new Error(JSON.stringify(started))
        const outcome = await started.unit.exited
        expect(outcome.signal).toMatch(/^SIG(?:TERM|KILL)$/)
        expect(measured).toBeGreaterThan(1)
        /** Native exited precedes the owner's queued terminal report; disposing first cancels it. */
        await vi.waitFor(
          () =>
            expect(reports).toContainEqual(
              expect.objectContaining({
                source: '@migaia/supervision',
                code: 'SUPERVISION_EXHAUSTED',
                cause: expect.objectContaining({
                  source: '@migaia/supervision',
                  code: 'RESOURCE_LIMIT_EXCEEDED',
                  detail: expect.objectContaining({ maximum: 1, observed: measured })
                })
              })
            ),
          { timeout: resourceReportDeadlineMs }
        )
        await supervisor.dispose()
        expect(budget.inUse).toBe(0)
        writeFileSync(
          join(evidence, `rss-${peer.language}.json`),
          JSON.stringify({ pid: started.unit.identity.pid, measured, maximum: 1, outcome })
        )
      } finally {
        await supervisor.dispose()
        await observer?.close()
        budget.close()
      }
    }, 15000)
  it('resource preparation observes four real launch/exits and native FD/zombie/lease rows', async () => {
    const receipt = await rotations(1)
    expect(receipt.type).toBe('resource-preparation')
    expect(receipt.counts).toEqual({ python: 1, go: 1, rust: 1, node: 1 })
    expect(receipt.rows).toHaveLength(4)
  }, 30000)
  it(
    'performs 1000 actual round-robin launch/exits, 250 for each language, without FD or lease growth',
    async () => {
      const receipt = await rotations(250)
      expect(receipt.type).toBe('resource-conformance')
      expect(receipt.counts).toEqual({ python: 250, go: 250, rust: 250, node: 250 })
      expect(receipt.rows).toHaveLength(1000)
    },
    resourceDeadlineMs
  )
})
