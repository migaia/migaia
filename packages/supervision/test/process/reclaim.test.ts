import { describe, expect, it } from 'vitest'
import { SupervisionErrorCode } from '../../src/index.js'
import { reclaimOrphanProcesses, type IProcessRecord } from '../../src/process/index.js'
import { memoryProcessLauncher } from './support/memory-process-launcher.js'
import { memoryRegistry } from './support/memory-registry.js'

describe('A8 prior-run orphan recovery', () => {
  it('never terminates a reused pid and collects each failed record', async () => {
    const registry = memoryRegistry()
    const records: IProcessRecord[] = [
      'alive',
      'gone',
      'reused',
      'terminate-fails',
      'probe-fails'
    ].map((id) => ({
      id,
      namespace: 'old',
      identity: { fingerprint: id, pid: 100 },
      launchedAt: 1
    }))
    for (const record of records) await registry.port.add(record)
    const launcher = memoryProcessLauncher()
    const terminated: string[] = []
    const failure = new Error('cannot terminate')
    const probeFailure = new Error('cannot probe')
    launcher.probe = async (record) => {
      if (record.id === 'probe-fails') throw probeFailure
      if (record.id === 'gone') return 'gone'
      if (record.id === 'reused') return 'reused'
      return 'alive'
    }
    launcher.terminateRecord = async (record) => {
      terminated.push(record.id)
      if (record.id === 'terminate-fails') throw failure
    }
    const reported: unknown[] = []
    const result = await reclaimOrphanProcesses({
      registry: registry.port,
      namespace: 'old',
      launcher,
      report: (error) => {
        reported.push(error)
      }
    })
    expect(terminated).toEqual(['alive', 'terminate-fails'])
    expect(result.terminated).toEqual(['alive'])
    expect(result.removed).toEqual(['alive', 'gone', 'reused'])
    expect([...registry.records.keys()]).toEqual(['terminate-fails', 'probe-fails'])
    expect(result.failures).toHaveLength(2)
    expect(result.failures.map((entry) => (entry.error as { code: string }).code)).toEqual([
      SupervisionErrorCode.orphanReclaimFailed,
      SupervisionErrorCode.orphanReclaimFailed
    ])
    expect((result.failures[0]!.error as Error).cause).toBe(failure)
    expect((result.failures[1]!.error as Error).cause).toBe(probeFailure)
    expect(reported).toHaveLength(2)
  })
})
