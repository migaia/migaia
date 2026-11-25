import { afterAll, afterEach } from 'vitest'
import { collections } from './collections.ts'

/** Release every collection allocated by each test case even if the test or disposal throws. */
afterEach(() => collections.release())

/** Final sweep after the test file finishes. */
afterAll(() => collections.release())
