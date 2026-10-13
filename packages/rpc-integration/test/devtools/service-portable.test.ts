import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { ServicePortableFixture } from './fixtures/service-portable.mjs'

/** Standalone assertions report only real remote results and fully classified native warnings. */
type IServicePortableReceipt = Readonly<{
  acceptance: string
  exposed: boolean
  queryEvents: number
  watchEvents: number
  recordingEvents: number
  calls: number
  errorGraphRestored: boolean
  byteBrandsPortable: boolean
  classAndFunctionsPortable: boolean
  metadataContentHidden: boolean
  reports: readonly Readonly<{
    classification: string
    source: string | null
    code: string | null
    name: string
    reason: string | null
    message: string
    capability: string | null
    level: string | null
    kind: string | null
  }>[]
}>

/** Execute the supported standalone entry because spawn:true rejects a test-runner entry. */
function runServicePortable(mode: string): Promise<IServicePortableReceipt> {
  /** Both actual parent and child run this one canonical fixture entry. */
  const entry = fileURLToPath(new URL('./fixtures/service-portable.mjs', import.meta.url))
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [entry, mode], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        Object.defineProperty(error, 'fixtureReports', { value: stderr })
        reject(error)
        return
      }
      try {
        if (stderr.trim()) console.info(stderr.trim())
        // SC9(b): parse the standalone receipt, not an alternate service serialization path.
        resolve(JSON.parse(stdout) as IServicePortableReceipt)
      } catch (cause) {
        reject(cause)
      }
    })
  })
}

for (const mode of Object.values(ServicePortableFixture.modes)) {
  it(`[A5] real Process service query/watch/stats/describe/record.stop are portable with ${mode} content`, async () => {
    /** Child assertions exercise native bytes/errors and class/function conversion at the service. */
    const receipt = await runServicePortable(mode)
    expect(receipt.acceptance).toBe(ServicePortableFixture.acceptance)
    expect(receipt.exposed).toBe(mode === ServicePortableFixture.modes.exposed)
    expect(receipt.queryEvents).toBe(4)
    expect(receipt.watchEvents).toBe(4)
    expect(receipt.recordingEvents).toBe(4)
    expect(receipt.calls).toBe(2)
    expect(receipt.errorGraphRestored).toBe(true)
    expect(receipt.byteBrandsPortable).toBe(receipt.exposed)
    expect(receipt.classAndFunctionsPortable).toBe(receipt.exposed)
    expect(receipt.metadataContentHidden).toBe(!receipt.exposed)
    for (const report of receipt.reports) {
      expect(report.classification).toBe(ServicePortableFixture.reportClassification.warning)
      expect(report.source).toBeTruthy()
      expect(report.code).toBeTruthy()
      expect(report.name).toBeTruthy()
      expect(report.message).toBeTruthy()
    }
  }, 40_000)
}
