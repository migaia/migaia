import { describe, expect, it } from 'vitest'
import { createWindowsJobProcessLauncher } from '../../src/process/adapters/windows-job.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'

describe('platform cleanup evidence boundary', () => {
  it('[A11] unsupported Windows launcher never starts user code', async () => {
    const launcher = createWindowsJobProcessLauncher()
    const launched = launcher.launch(
      {
        command: 'must-not-run',
        args: [],
        env: { inherit: [], set: {} },
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    await expect(launched).rejects.toMatchObject({ code: RpcProcessErrorCode.connectFailed })
  })
})
