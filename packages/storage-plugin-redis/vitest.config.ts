import { configDefaults, defineConfig } from 'vitest/config'

/** Bun's real test harness is invoked explicitly by its native runtime. */
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'test/runtime/**'] } })
