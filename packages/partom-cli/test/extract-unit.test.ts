import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractFile } from '../src/extract.ts'
import { TypesCollector } from '../src/types/collect.ts'
import { typesBody } from '../src/types/emit.ts'

/** Directory of the wrapper fixtures. */
const DIR = join(import.meta.dirname, 'fixtures', 'extract-wrappers')

describe('extractFile wrappers (in process)', () => {
  it('unwraps known and configured wrappers and refuses non-component calls', () => {
    /** Entries of every fixture file with `withTheme` configured. */
    const entries = ['button.tsx', 'tag.tsx', 'card.tsx', 'row.tsx'].flatMap((file) =>
      extractFile(join(DIR, file), { transparentWrappers: ['withTheme'] })
    )
    const byName = new Map(entries.map((entry) => [entry.component, entry]))
    expect(byName.get('Button')).toMatchObject({
      wrappers: ['memo', 'forwardRef'],
      exportName: 'default'
    })
    expect(byName.get('Tag')?.wrappers).toEqual(['React.memo', 'React.forwardRef'])
    expect(byName.get('Card')).toMatchObject({ wrappers: ['withTheme', 'memo'], props: ['title'] })
    expect(byName.get('Row')).toMatchObject({ uncertain: ['hoc-opaque'], props: [] })
    expect(byName.has('RowContext')).toBe(false)
  })

  it('treats an unconfigured project wrapper as an opaque higher-order component', () => {
    /** Card without `withTheme` configured. */
    const [card] = extractFile(join(DIR, 'card.tsx'))
    expect(card).toMatchObject({ component: 'Card', uncertain: ['hoc-opaque'], props: [] })
  })
})

describe('typesBody stores (in process)', () => {
  it('types schema store keys and opens stores without a schema', () => {
    /** Collected data with two stores and no blueprints. */
    const data = new TypesCollector().result(
      [],
      [
        { namespace: 'page' },
        {
          namespace: 'cart',
          schema: { type: 'object', properties: { total: { type: 'number' } } }
        },
        { namespace: 'misc' }
      ]
    )
    expect(data.stores.map((store) => store.namespace)).toEqual(['cart', 'misc'])
    const body = typesBody(data)
    expect(body).toContain('"cart.total": number')
    expect(body).toContain('[path: `misc.${string}`]: unknown')
  })
})
