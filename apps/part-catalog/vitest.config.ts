import { defineConfig } from 'vitest/config'

/** Tests start the service as a Bun child process and talk to it with fetch. */
export default defineConfig({ test: { testTimeout: 120000, hookTimeout: 60000 } })
