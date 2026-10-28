import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Every package test uses the shared built-dependency freshness boundary. */
export default defineConfig(withDistFreshness())
