import { expect, it } from 'vitest'
import { attachErrorIdentity } from '../src/error.ts'

it('attaches identity to original native TypeError and AggregateError without changing causes', () => {
  /** Original producer failures remain reachable by exact identity. */
  const cause = new Error('cause'),
    first = new Error('first'),
    second = new Error('second')
  /** Native constructors preserve their original parameter and collection semantics. */
  const aggregate = new AggregateError([first, second], 'message', { cause })
  /** A typed validation error must not become a generic Error at the boundary. */
  const validation = new TypeError('message', { cause })
  expect(attachErrorIdentity(aggregate, { source: 'fixture', code: 'AGGREGATE' })).toBe(aggregate)
  expect(attachErrorIdentity(validation, { source: 'fixture', code: 'INVALID' })).toBe(validation)
  expect(aggregate).toBeInstanceOf(AggregateError)
  expect(validation).toBeInstanceOf(TypeError)
  expect(aggregate.errors[0]).toBe(first)
  expect(aggregate.errors[1]).toBe(second)
  expect(aggregate.cause).toBe(cause)
  expect(validation.cause).toBe(cause)
  expect(aggregate.message).toBe('message')
  expect(validation.message).toBe('message')
  expect(aggregate).toMatchObject({ source: 'fixture', code: 'AGGREGATE' })
  expect(validation).toMatchObject({ source: 'fixture', code: 'INVALID' })
  expect(aggregate.stack).toBeTruthy()
  expect(validation.stack).toBeTruthy()
})
