import type { IObjectPathTuple } from '../object-path.js'

/**
 * Reads a previously validated object path without allocating diagnostic probe objects. Missing and
 * blocked paths collapse to `undefined`; host getter and Proxy failures propagate.
 */
export function readObjectPathSegments(object: unknown, segments: IObjectPathTuple): unknown {
  let current = object
  for (let index = 0; index < segments.length; index++) {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function'))
      return undefined
    const key = segments[index]
    if (!Reflect.has(current, key)) return undefined
    current = Reflect.get(current, key, current)
  }
  return current
}
