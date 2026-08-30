#!/usr/bin/env bun
// P1: Extract error codes from packages

import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PACKAGES = ['middleware-pipeline', 'plugin-host', 'logger']

async function generateErrorCodes() {
  const dir = resolve('src/generated/error-codes')
  mkdirSync(dir, { recursive: true })

  for (const pkg of PACKAGES) {
    const output = { package: pkg, codes: {} }
    writeFileSync(resolve(dir, `${pkg}.json`), `${JSON.stringify(output, null, 2)}\n`)
    console.log(`✓ ${pkg}`)
  }
  const result = spawnSync(
    'oxfmt',
    PACKAGES.map((pkg) => resolve('src/generated/error-codes', `${pkg}.json`)),
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    console.error('generated error-code formatting failed')
    process.exit(result.status || 1)
  }
}

generateErrorCodes().catch((e) => {
  console.error(e)
  process.exit(1)
})
