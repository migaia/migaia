import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { FixtureMethod } from './fixtures/text.mjs'

/** Native identities and trace evidence come from the same actual three-host standalone program. */
type IProgramResult = {
  scope: 'managed-business-and-direct-Core'
  result: number
  afterCollectorClose?: number
  parentPid: number
  childPid: number
  workerPid: number
  workerThreadId: number
  collectorInstallations: Readonly<{ parent: boolean; child: boolean; worker: boolean }>
  core?: {
    events: number
    frameEvents: number
    protectedEvents: number
    localFrameDiffersFromProtected: boolean
    orderedTimeline: boolean
    recordingEvents: number
    recordingSequencePreserved: boolean
    metadataContentHidden: boolean
    result: number
    afterCollectorClose: number
  }
  trace?: {
    hops: readonly {
      method: string
      stages: readonly string[]
      outboundCarriers: number
      inboundCarriers: number
      frameContentDiffers: boolean
    }[]
    orderedTimeline: boolean
    recordingEvents: number
    recordingSequencePreserved: boolean
    selfFiltered: boolean
  }
}

/** Run the actual entry outside Vitest because public spawn:true explicitly rejects test runners. */
function program(mode: 'baseline' | 'observed'): Promise<IProgramResult> {
  /** One real executable entry supplies both the parent and spawned child branches. */
  const entry = fileURLToPath(new URL('./fixtures/program.mjs', import.meta.url))
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [entry, mode], { timeout: 40_000 }, (error, stdout, stderr) => {
      if (error) {
        /** Original child failure retains its native identity and actual redacted fixture reports. */
        Object.defineProperty(error, 'fixtureReports', { value: stderr })
        reject(error)
        return
      }
      try {
        if (stderr.trim()) console.info(stderr.trim())
        /** JSON is the standalone parent result boundary, never a retained probe-event clone. */
        resolve(JSON.parse(stdout) as IProgramResult)
      } catch (cause) {
        reject(cause)
      }
    })
  })
}

it('actual traffic crosses signed/encrypted parent-child-worker hops with live services, both carrier directions and unchanged business results', async () => {
  /** The business baseline executes in three genuine hosts with no devtools instances. */
  const baseline = await program('baseline')
  /** Real-host collector close is separate from the directly supported Core observation scope. */
  const observed = await program('observed')
  expect(baseline.result).toBe(42)
  expect(observed.result).toBe(baseline.result)
  expect(observed.afterCollectorClose).toBe(baseline.result)
  for (const run of [baseline, observed]) {
    expect(run.parentPid).not.toBe(run.childPid)
    expect(run.workerPid).toBe(run.childPid)
    expect(run.workerThreadId).toBeGreaterThan(0)
  }
  expect(observed.scope).toBe('managed-business-and-direct-Core')
  expect(baseline.collectorInstallations).toEqual({ parent: false, child: false, worker: false })
  expect(observed.collectorInstallations).toEqual({ parent: true, child: true, worker: true })
  expect(observed.core?.events).toBeGreaterThan(0)
  expect(observed.core?.frameEvents).toBeGreaterThan(0)
  expect(observed.core?.protectedEvents).toBeGreaterThan(0)
  expect(observed.core?.localFrameDiffersFromProtected).toBe(true)
  expect(observed.core?.orderedTimeline).toBe(true)
  expect(observed.core?.recordingEvents).toBeGreaterThan(0)
  expect(observed.core?.recordingSequencePreserved).toBe(true)
  expect(observed.core?.metadataContentHidden).toBe(true)
  expect(observed.core?.result).toBe(41)
  expect(observed.core?.afterCollectorClose).toBe(41)
  expect(observed.trace?.hops).toHaveLength(2)
  expect(observed.trace?.hops.map((hop) => hop.method).sort()).toEqual(
    [FixtureMethod.cascade, FixtureMethod.increment].sort()
  )
  for (const hop of observed.trace!.hops) {
    expect(hop.stages).toEqual(
      expect.arrayContaining(['envelope', 'encoded', 'frame', 'protected', 'carrier'])
    )
    expect(hop.outboundCarriers).toBeGreaterThan(0)
    expect(hop.inboundCarriers).toBeGreaterThan(0)
    expect(hop.frameContentDiffers).toBe(true)
  }
  expect(observed.trace?.orderedTimeline).toBe(true)
  expect(observed.trace?.recordingEvents).toBeGreaterThan(0)
  expect(observed.trace?.recordingSequencePreserved).toBe(true)
  expect(observed.trace?.selfFiltered).toBe(true)
  console.info(
    JSON.stringify({
      acceptance: 'end-to-end',
      managedBusiness: baseline.result,
      afterCollectorClose: observed.afterCollectorClose,
      directCore: observed.core,
      trace: observed.trace
    })
  )
}, 90_000)
