import { describe, expect, it } from 'vitest'
import * as root from '../../src/index.js'
import * as processEntry from '../../src/process/index.js'

describe('A12 process subpath exports', () => {
  it('keeps the exact runtime surface out of the root entry', () => {
    const expected = [
      'BootstrapVia',
      'DrainedStream',
      'OrphanProbeResult',
      'ParentLossExitCode',
      'ProcessCapability',
      'ProcessLimit',
      'StderrMode',
      'StdinMode',
      'StdoutMode',
      'createParentLossGuard',
      'createPrewarmPool',
      'createProcessSupervisor',
      'reclaimOrphanProcesses'
    ]
    expect(Object.keys(processEntry).sort()).toEqual(expected)
    for (const name of expected) expect(Object.hasOwn(root, name)).toBe(false)
    expect(root.SupervisionErrorCode.orphanReclaimFailed).toBe('ORPHAN_RECLAIM_FAILED')
    expect(root.SupervisionErrorText.orphanReclaimFailed).toBeTruthy()
  })
})
