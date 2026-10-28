import { describe, expect, it } from 'vitest'
import { CONFIG_DELETE, combineConfig, ownConfig } from '../src/config.ts'

describe('config primitives', () => {
  it('retains one accumulator while synchronous conflicts observe current contents', () => {
    /** Frozen input proves descriptor preservation cannot make the private builder unwritable. */
    const shared = Object.freeze([1])
    /** Both keys in the first source must keep the same builder through every later concat. */
    const first = ownConfig({ items: shared, alias: shared })
    /** Callback observations are snapshots, while retained references remain live until completion. */
    const observed: unknown[][] = []
    /** Each callback receives the same private array rather than a newly copied prefix. */
    const retained: unknown[][] = []
    /** Scalar conflicts exercise the synchronous decision that made strict final observation cyclic. */
    const combined = combineConfig(
      [
        first,
        ownConfig({ items: 0 }),
        ownConfig({ items: [3] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: [5] })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ left }) => {
          observed.push([...(left as unknown[])])
          retained.push(left as unknown[])
          return { kind: 'left' }
        }
      }
    )
    expect(observed).toEqual([[1], [1, 3]])
    expect(retained[0]).toBe(retained[1])
    expect(retained[0]).toEqual([1, 3, 5])
    expect(combined.items).toEqual([1, 3, 5])
    expect(combined.alias).toBe(combined.items)
    expect(combined.items).not.toBe(retained[0])
    expect(first.items).toEqual([1])
    expect(Object.getOwnPropertyDescriptor(first.items, 'length')?.writable).toBe(false)
  })

  it('keeps sparse index merges and retained aliases across multiple sources', () => {
    /** Initial aliases must follow index replacement and deletion on one frozen-input builder. */
    const shared = Object.freeze([1, 2, 3])
    /** A sparse incoming array changes only its present index, preserving earlier holes. */
    const later: number[] = []
    later[2] = 5
    /** The retained reference sees the final builder; copied observations preserve callback timing. */
    const retained: unknown[][] = []
    /** Hole presence is separately observable from an explicit undefined value. */
    const observed: { entries: unknown[]; firstPresent: boolean }[] = []
    /** All source arrays remain unchanged while the final owned graph shares its output alias. */
    const first = ownConfig({ items: shared, alias: shared })
    /** Index strategy remains synchronous and never copies an accumulated prefix. */
    const combined = combineConfig(
      [
        first,
        ownConfig({ items: 0 }),
        ownConfig({ items: [CONFIG_DELETE, 4] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: later })
      ],
      {
        strategies: { array: 'mergeByIndex' },
        onConflict: ({ left }) => {
          retained.push(left as unknown[])
          observed.push({
            entries: [...(left as unknown[])],
            firstPresent: 0 in (left as unknown[])
          })
          return { kind: 'left' }
        }
      }
    )
    expect(observed).toEqual([
      { entries: [1, 2, 3], firstPresent: true },
      { entries: [undefined, 4, 3], firstPresent: false }
    ])
    expect(retained[0]).toBe(retained[1])
    expect(retained[0]).toEqual([undefined, 4, 5])
    expect(0 in retained[0]).toBe(false)
    expect(combined.items).toEqual([undefined, 4, 5])
    expect(0 in (combined.items as unknown[])).toBe(false)
    expect(combined.alias).toBe(combined.items)
    expect(combined.items).not.toBe(retained[0])
    expect(first.items).toEqual([1, 2, 3])
    expect(later.length).toBe(3)
    expect(later[2]).toBe(5)
    expect(0 in later).toBe(false)
  })

  it('joins incoming aliases to the private accumulator without changing sources', () => {
    /** The right source supplies both an array alias and an element alias into the same graph. */
    const entry = { value: 2 }
    /** Frozen right arrays must never become the object receiving later in-place appends. */
    const rightItems = Object.freeze([entry])
    /** The later source must extend both the old left alias and the new right alias. */
    const right = ownConfig({ items: rightItems, rightAlias: rightItems, entry })
    /** Shared array identity survives a graph-edge cycle admitted by existing ownership. */
    const firstItems: unknown[] = [1]
    firstItems.push(firstItems)
    /** Source-local aliases are rebased before incoming elements are cloned. */
    const combined = combineConfig(
      [ownConfig({ items: firstItems, leftAlias: firstItems }), right, ownConfig({ items: [3] })],
      { strategies: { array: 'concat' } }
    )
    expect(combined.leftAlias).toBe(combined.items)
    expect(combined.rightAlias).toBe(combined.items)
    expect((combined.items as unknown[])[1]).toBe(combined.items)
    expect((combined.items as unknown[])[2]).toBe(combined.entry)
    expect((combined.items as unknown[])[3]).toBe(3)
    expect(right.items).toEqual([{ value: 2 }])
    expect(right.items[0]).toBe(right.entry)
    expect(Object.getOwnPropertyDescriptor(right.items, 'length')?.writable).toBe(false)
  })

  it('preserves holes until concat reaches the same shared accumulator', () => {
    /** Different path policies can visit the same builder through its two aliases in one source. */
    const shared = [1, 2]
    /** A later sparse write creates a gap which concat must densify without rescanning the prefix. */
    const sparse: number[] = []
    sparse[5] = 5
    /** The root's key order deliberately applies the index strategy before concat. */
    const combined = combineConfig(
      [
        ownConfig({ indexed: shared, appended: shared }),
        ownConfig({ indexed: [CONFIG_DELETE], appended: [3] }),
        ownConfig({ indexed: sparse, appended: [6] })
      ],
      {
        pathRules: [
          { prefix: ['indexed'], strategies: { array: 'mergeByIndex' } },
          { prefix: ['appended'], strategies: { array: 'concat' } }
        ]
      }
    )
    expect(combined.indexed).toBe(combined.appended)
    expect(combined.indexed).toEqual([undefined, 2, 3, undefined, undefined, 5, 6])
    expect(Object.keys(combined.indexed as unknown[])).toEqual(['0', '1', '2', '3', '4', '5', '6'])
  })

  it('privately adopts selected arrays and preserves untouched descriptor flags', () => {
    /** The resolver can select either an owned incoming array or a separate frozen replacement. */
    const right = ownConfig({ items: Object.freeze([2]), untouched: Object.freeze([9]) })
    /** A replacement is copied before later concat; the caller keeps its frozen source unchanged. */
    const replacement = Object.freeze([4])
    /** Scalar replacement ends the previous builder's lifetime instead of mutating old references. */
    const discarded: unknown[][] = []
    /** Explicit right and value decisions retain their source-ordered synchronous meaning. */
    const combined = combineConfig(
      [
        ownConfig({ items: 0 }),
        right,
        ownConfig({ items: [3] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: [5] })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ left, right: incoming }) => {
          if (!Array.isArray(left)) return { kind: 'right' }
          discarded.push(left)
          return incoming === 0 ? { kind: 'value', value: replacement } : { kind: 'left' }
        }
      }
    )
    expect(discarded[0]).toEqual([2, 3])
    expect(combined.items).toEqual([4, 5])
    expect(right.items).toEqual([2])
    expect(replacement).toEqual([4])
    expect(Object.getOwnPropertyDescriptor(combined.untouched, 'length')?.writable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(combined.untouched, '0')?.writable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(combined.items, 'length')?.writable).toBe(true)
  })

  it('preserves the default Array species result for custom prototypes', () => {
    /** Rich-runtime data can carry a custom prototype while still using the standard Array slice. */
    const prototype = Object.create(Array.prototype) as { tag?: string }
    prototype.tag = 'custom-prototype'
    /** Index merging previously discarded this inherited tag through default slice species. */
    const items = [1]
    Object.setPrototypeOf(items, prototype)
    /** A distinct untouched array verifies this normalization belongs only to actual merging. */
    const untouched = [3]
    Object.setPrototypeOf(untouched, prototype)
    /** Both roots use the same accepted rich-runtime profile. */
    const combined = combineConfig(
      [
        ownConfig({ items, untouched }, { profile: 'richRuntime' }),
        ownConfig({ items: [2] }, { profile: 'richRuntime' })
      ],
      { strategies: { array: 'mergeByIndex' } }
    )
    expect(combined.items).toEqual([2])
    expect(Object.getPrototypeOf(combined.items)).toBe(Array.prototype)
    expect('tag' in (combined.items as unknown[])).toBe(false)
    expect((combined.untouched as { tag?: string }).tag).toBe('custom-prototype')
    expect((Object.getPrototypeOf(items) as { tag?: string }).tag).toBe('custom-prototype')
  })

  it('captures arrays inside resolver-selected records before nested conflicts', () => {
    /** Selecting this record must not lend its source array to the next nested callback. */
    const items = Object.freeze([1])
    /** A sibling alias must enter the same private builder at the record-selection boundary. */
    const selected = ownConfig({ branch: { items, alias: items } })
    /** The nested callback observes a current prefix and retains it until later concat completes. */
    let retained: unknown[] | undefined
    /** Capturing a selected object uses the same graph clone and existing source-order resolver. */
    const combined = combineConfig(
      [
        ownConfig({ branch: 0 }),
        selected,
        ownConfig({ branch: { items: 0 } }),
        ownConfig({ branch: { items: [2] } })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ path, left }) => {
          if (path.length === 1) return { kind: 'right' }
          expect(left).toEqual([1])
          retained = left as unknown[]
          return { kind: 'left' }
        }
      }
    )
    /** Publication retains graph aliases while separating the final root from callback builders. */
    const branch = combined.branch as { items: unknown[]; alias: unknown[] }
    expect(retained).toEqual([1, 2])
    expect(retained).not.toBe(selected.branch.items)
    expect(branch.items).toEqual([1, 2])
    expect(branch.items).toBe(branch.alias)
    expect(branch.items).not.toBe(retained)
    expect(selected.branch.items).toEqual([1])
    expect(selected.branch.items).toBe(selected.branch.alias)
  })

  it('bounds concat when a callback places its retained builder into a later source', () => {
    /** The callback deliberately creates a source-to-builder alias after ownership was established. */
    const later = ownConfig({ items: [] as unknown[] })
    /** This reference must receive the finite result without appending during a live self-iteration. */
    let retained: unknown[] | undefined
    /** A self-alias snapshots only its actual incoming entries, never every ordinary source prefix. */
    const combined = combineConfig([ownConfig({ items: [1] }), ownConfig({ items: 0 }), later], {
      strategies: { array: 'concat' },
      onConflict: ({ left }) => {
        retained = left as unknown[]
        later.items = retained
        return { kind: 'left' }
      }
    })
    expect(retained).toEqual([1, 1])
    expect(later.items).toBe(retained)
    expect(combined.items).toEqual([1, 1])
    expect(combined.items).not.toBe(retained)
  })
})
