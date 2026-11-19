import { describe, expect, it } from 'vitest'
import { schemaType } from '../src/types/schema-type.ts'

describe('schemaType', () => {
  it.each([
    ['string', { type: 'string' }, 'string'],
    ['integer', { type: 'integer' }, 'number'],
    ['type list', { type: ['string', 'null'] }, 'string | null'],
    ['nullable', { type: 'boolean', nullable: true }, 'boolean | null'],
    ['array', { type: 'array', items: { type: 'number' } }, 'readonly (number)[]'],
    [
      'object with optional key',
      { type: 'object', properties: { a: { type: 'string' }, b: {} }, required: ['a'] },
      '{ readonly "a": string; readonly "b"?: unknown }'
    ],
    [
      'additional properties',
      { type: 'object', additionalProperties: { type: 'number' } },
      '{ readonly [key: string]: number }'
    ],
    ['closed empty object', { type: 'object', additionalProperties: false }, '{}'],
    ['open empty object', { type: 'object' }, 'Readonly<Record<string, unknown>>'],
    ['enum', { enum: ['a', 1, null] }, '"a" | 1 | null'],
    ['const', { const: 'x' }, '"x"'],
    ['anyOf', { anyOf: [{ type: 'string' }, { type: 'number' }] }, '(string) | (number)'],
    ['oneOf', { oneOf: [{ const: 1 }] }, '(1)'],
    [
      'allOf',
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'string' } } }
        ]
      },
      '({ readonly "a"?: string }) & ({ readonly "b"?: string })'
    ],
    ['unknown keyword only', { pattern: 'x' }, 'unknown'],
    ['not an object', 3, 'unknown'],
    [
      'hostile key',
      { type: 'object', properties: { 'a-b': { type: 'string' } } },
      '{ readonly "a-b"?: string }'
    ],
    ['hostile enum', { enum: ['*/'] }, '"*/"']
  ])('%s', (_name, schema, expected) => {
    expect(schemaType(schema)).toBe(expected)
  })
})
