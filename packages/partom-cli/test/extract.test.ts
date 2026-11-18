import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { json, partom } from './run.ts'

/** Report entry fields the tests read. */
type IReportEntry = {
  readonly component: string
  readonly pattern?: string
  readonly basis?: string
  readonly variants: Record<string, string[]>
  readonly uncertain: string[]
  mapping: Record<string, unknown>
}

/** Fixture files of the extract project. */
const FILES = ['button.tsx', 'dialog.tsx', 'tabs.tsx', 'combobox.tsx', 'evil.tsx']

describe('extract', () => {
  it('drafts parts, infers patterns and keeps hostile names inert', () => {
    const out = mkdtempSync(join(tmpdir(), 'partom-extract-'))
    expect(partom('extract', ['extract', ...FILES, '--out', out]).code).toBe(0)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
      .components as IReportEntry[]
    const byName = new Map(report.map((entry) => [entry.component, entry]))
    expect(byName.get('Button')?.variants).toEqual({
      variant: ['default', 'destructive', 'outline', 'ghost'],
      size: ['default', 'sm', 'lg', 'icon']
    })
    expect(byName.get('Dialog')).toMatchObject({
      pattern: 'dialog',
      basis: expect.stringContaining('@radix-ui/react-dialog')
    })
    expect(byName.get('Tabs')).toMatchObject({ pattern: 'tabs' })
    expect(byName.get('Combobox')).toMatchObject({
      pattern: 'combobox',
      basis: expect.stringContaining('cmdk')
    })
    expect(byName.get('Evil')?.uncertain).toContain('prop "a-b" is not an identifier')
    const evil = readFileSync(join(out, 'evil.part.ts'), 'utf8')
    expect(evil).toContain(JSON.stringify('"}; process.exit(9); ({"'))
    expect(
      () =>
        new Function(
          evil
            .replace(/^import .*$/gm, '')
            .replace(/export /g, '')
            .replace(/definePart|bindReactComponent/g, 'Object')
        )
    ).not.toThrow()
  })

  it('probes every variant value and verifies the part rendering against the original', () => {
    const out = mkdtempSync(join(tmpdir(), 'partom-probe-'))
    expect(partom('extract', ['extract', 'button.tsx', '--out', out, '--probe']).code).toBe(0)
    const probes = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8')).probes as {
      props: Record<string, string>
      html: string
    }[]
    for (const variant of ['default', 'destructive', 'outline', 'ghost'])
      expect(
        probes.some((probe) => probe.props.variant === variant && probe.html.includes('<button'))
      ).toBe(true)
    const verified = partom('extract', ['extract', 'button.tsx', '--out', out, '--verify'])
    expect(verified.code).toBe(0)
    expect(json<{ differences: unknown[] }>(verified).differences).toEqual([])

    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as {
      components: IReportEntry[]
    }
    for (const entry of report.components) entry.mapping = { props: { variant: 'size' } }
    writeFileSync(join(out, 'report.json'), JSON.stringify(report))
    const broken = partom('extract', ['extract', 'button.tsx', '--out', out, '--verify'])
    expect(broken.code).toBe(1)
    expect(json<{ differences: unknown[] }>(broken).differences).toHaveLength(1)
  })
})
