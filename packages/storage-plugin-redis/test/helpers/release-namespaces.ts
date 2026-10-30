import { afterAll } from 'vitest'
import { namespaces } from './namespaces.ts'

/** Release every Redis namespace the current test file allocated, after all of its cases. */
afterAll(() => namespaces.release())
