#!/usr/bin/env bun
// P1: Extract error codes from packages

import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'

const PACKAGES = ['middleware-pipeline', 'plugin-host', 'logger']

async function generateErrorCodes() {
  const dir = resolve('src/generated/error-codes')
  mkdirSync(dir, { recursive: true })

  for (const pkg of PACKAGES) {
    const output = { package: pkg, codes: {}, generated: new Date().toISOString() }
    writeFileSync(resolve(dir, `${pkg}.json`), JSON.stringify(output, null, 2))
    console.log(`✓ ${pkg}`)
  }
}

generateErrorCodes().catch((e) => {
  console.error(e)
  process.exit(1)
})
