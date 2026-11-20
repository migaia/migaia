import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partom } from './run.ts'

/** Report entry fields read here. */
type IEntry = {
  readonly component: string
  readonly props: string[]
  readonly variants: Record<string, string[]>
  readonly uncertain: string[]
  readonly wrappers?: string[]
  readonly exportName?: string
}

describe('extract wrapped components (A9)', () => {
  it('unwraps memo, forwardRef, React.* and configured wrappers; leaves other HOCs opaque', () => {
    const out = mkdtempSync(join(tmpdir(), 'partom-wrappers-'))
    try {
      const run = partom('extract-wrappers', [
        'extract',
        'button.tsx',
        'tag.tsx',
        'card.tsx',
        'row.tsx',
        '--out',
        out
      ])
      expect(run.code, run.stderr).toBe(0)
      const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
        .components as IEntry[]
      const byName = new Map(report.map((entry) => [entry.component, entry]))
      expect(byName.get('Button')).toMatchObject({
        wrappers: ['memo', 'forwardRef'],
        exportName: 'default'
      })
      expect(byName.get('Button')?.props).toContain('label')
      expect(byName.get('Tag')).toMatchObject({
        wrappers: ['React.memo', 'React.forwardRef'],
        variants: { tone: ['neutral', 'danger'] }
      })
      expect(byName.get('Tag')?.props).toEqual(expect.arrayContaining(['tone', 'text']))
      expect(byName.get('Card')).toMatchObject({
        wrappers: ['withTheme', 'memo'],
        props: ['title']
      })
      expect(byName.get('Row')).toMatchObject({ props: [], uncertain: ['hoc-opaque'] })
      expect(byName.has('RowContext')).toBe(false)
      expect(readFileSync(join(out, 'button.part.ts'), 'utf8')).toContain('import Button from "../')
      expect(readFileSync(join(out, 'card.part.ts'), 'utf8')).toContain('import { Card } from')
      expect(readFileSync(join(out, 'card.part.ts'), 'utf8')).toContain(
        'bindReactComponent(cardPart, Card,'
      )
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
