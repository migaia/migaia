import { describe, expect, it } from 'vitest'
import { SupervisionErrorCode } from '../../src/index.js'
import { StderrMode, StdinMode, StdoutMode } from '../../src/process/index.js'
import { validateProcessSpec } from '../../src/process/spec.js'

describe('A2 closed process specification', () => {
  it('rejects undeclared fields and malformed bootstrap without exposing payload', () => {
    const base = {
      command: '/bin/tool',
      args: [],
      env: { inherit: [], set: {} },
      stdio: { stdin: StdinMode.ignore, stdout: StdoutMode.drain, stderr: StderrMode.drain }
    }
    validateProcessSpec(base)
    const cases = [
      [{ ...base, shell: true }, 'shell', TypeError],
      [{ ...base, command: '' }, 'command', TypeError],
      [{ ...base, limits: { memoryBytes: 0 } }, 'limits.memoryBytes', RangeError],
      [
        { ...base, bootstrap: { via: 'fd', fd: 3, payload: 'secret-marker' } },
        'bootstrap.payload',
        TypeError
      ]
    ] as const
    for (const [spec, field, Constructor] of cases) {
      try {
        validateProcessSpec(spec)
        throw new Error('expected invalid specification')
      } catch (error) {
        expect(error).toBeInstanceOf(Constructor)
        expect(error).toMatchObject({ code: SupervisionErrorCode.invalidOption, detail: { field } })
        expect(JSON.stringify(error)).not.toContain('secret-marker')
      }
    }
  })
})
