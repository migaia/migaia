import { describe, expect, it } from 'vitest'
import { json, partom } from './run.ts'

/** Shape of `doctor --json` output. */
type IOutput = {
  readonly issues: readonly {
    readonly rule: string
    readonly address: string
    readonly basis?: string
    readonly cause?: Record<string, unknown>
  }[]
  readonly rendered: readonly { readonly blueprintId: string; readonly status: string }[]
}

describe('doctor static checks', () => {
  it('passes a compliant project', () => {
    const run = partom('static-ok', ['doctor', '--json'])
    expect(run.code).toBe(0)
    expect(json<IOutput>(run).issues).toEqual([])
  })

  it('reports tabindex and dangling references and skips rendering', () => {
    const run = partom('static-bad', ['doctor', '--json'])
    expect(run.code).toBe(1)
    const output = json<IOutput>(run)
    expect(output.issues.map((issue) => issue.rule).sort()).toEqual([
      'aria.idref-exists',
      'behavior.tabindex'
    ])
    expect(output.rendered).toEqual([
      expect.objectContaining({ blueprintId: 'bad', status: 'skipped' })
    ])
  })

  it('rejects an invalid config with exit code 2', () => {
    const run = partom('config-bad', ['doctor', '--json'])
    expect(run.code).toBe(2)
    expect(JSON.parse(run.stderr.trim()).error).toEqual({
      name: 'Error',
      message: expect.any(String),
      source: 'part.cli',
      code: 'CONFIG_INVALID'
    })
  })
})

describe('doctor rendered checks', () => {
  it('finds no error on a conforming combobox and overlay', () => {
    const run = partom('rendered-ok', ['doctor', '--rendered', '--json'])
    expect(run.code).toBe(0)
    expect(json<IOutput>(run)).toEqual({
      issues: [],
      rendered: [{ blueprintId: 'good', status: 'checked' }]
    })
  })

  it('reports a combobox that does not open on ArrowDown against the APG pattern', () => {
    const run = partom('rendered-bad', ['doctor', '--rendered', '--json'])
    expect(run.code).toBe(1)
    const issues = json<IOutput>(run).issues
    expect(issues.length).toBeGreaterThan(0)
    expect(
      issues.every((issue) => issue.address === 'p/fruit' && issue.basis === 'APG combobox')
    ).toBe(true)
    const only = partom('rendered-bad', ['doctor', '--rendered', '--json', '--only', 'p/other'])
    expect(json<IOutput>(only).issues).toEqual([])
  })

  it('reports focus falling to the body after an overlay closes', () => {
    const run = partom('invariants-bad', ['doctor', '--rendered', '--json'])
    expect(run.code).toBe(1)
    expect(json<IOutput>(run).issues).toEqual([
      expect.objectContaining({
        rule: 'rendered.invariant',
        address: 'p/panel',
        messageKey: 'after closing, focus fell to the body'
      })
    ])
  })

  it('never falls back from an explicit browser path', () => {
    const run = partom('rendered-ok', [
      'doctor',
      '--rendered',
      '--json',
      '--browser',
      '/nonexistent/chrome'
    ])
    expect(run.code).toBe(2)
    expect(JSON.parse(run.stderr.trim()).error.code).toBe('BROWSER_NOT_FOUND')
  })
})
