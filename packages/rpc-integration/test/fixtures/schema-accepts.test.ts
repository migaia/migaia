import { expect, it } from 'vitest'
import { acceptsSchema } from './schema-accepts.ts'

/** Unique-items rule shared by every case below. */
const unique = { type: 'array', uniqueItems: true }

/** Deep duplicates are found regardless of object key order; distinct items stay accepted. */
function uniqueItems(): void {
  expect(acceptsSchema(unique, [1, 2, 3])).toBe(true)
  expect(acceptsSchema(unique, [1, 2, 1])).toBe(false)
  expect(
    acceptsSchema(unique, [
      { a: 1, b: [2] },
      { b: [2], a: 1 }
    ])
  ).toBe(false)
  expect(acceptsSchema(unique, [{ a: 1 }, { a: 2 }, { b: 1 }])).toBe(true)
  expect(
    acceptsSchema(unique, [
      [1, 2],
      [2, 1]
    ])
  ).toBe(true)
  expect(acceptsSchema(unique, ['1', 1])).toBe(true)
}
it('detects deep duplicate items in one pass without key-order sensitivity', uniqueItems)
