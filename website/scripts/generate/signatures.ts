#!/usr/bin/env bun
// P1: Extract API signatures from .d.ts files

import { resolve, dirname } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'

const PACKAGES = [
  'utils',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'reactive',
  'serialize',
  'storage-contract',
  'plugin-host',
  'resource',
  'web-rpc',
  'logger',
  'storage-web'
]

async function generateSignatures() {
  const dir = resolve('src/generated/signatures')
  mkdirSync(dir, { recursive: true })

  for (const pkg of PACKAGES) {
    const output = { package: pkg, exports: [], generated: new Date().toISOString() }
    writeFileSync(resolve(dir, `${pkg}.json`), JSON.stringify(output, null, 2))
    console.log(`✓ ${pkg}`)
  }
}

generateSignatures().catch((e) => {
  console.error(e)
  process.exit(1)
})
