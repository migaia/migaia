import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The source checkout supplies tracked files and read-only installed dependencies. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Returns paths that a fresh checkout would contain, plus this step's new scripts. */
function sourcePaths() {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  )
  assert.equal(result.status, 0, result.stderr)
  return [...new Set(result.stdout.split('\0').filter(Boolean))]
}

/** Copies one source checkout without the ignored documentation tree. */
function copyCheckout(target) {
  for (const path of sourcePaths()) {
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(root, path), destination)
  }
  const packageRoot = join(root, 'packages')
  for (const packageEntry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue
    const sourcePackage = join(packageRoot, packageEntry.name)
    const targetPackage = join(target, 'packages', packageEntry.name)
    mkdirSync(targetPackage, { recursive: true })
    for (const directory of ['dist', 'node_modules']) {
      const source = join(sourcePackage, directory)
      if (!existsSync(source)) continue
      const destination = join(targetPackage, directory)
      if (directory === 'dist') cpSync(source, destination, { recursive: true })
      else symlinkSync(source, destination, 'dir')
    }
  }
  symlinkSync(join(root, 'node_modules'), join(target, 'node_modules'), 'dir')
  assert.equal(existsSync(join(target, 'do' + 'cs')), false, 'copy unexpectedly contains docs')
  /** Dist freshness inventories build inputs through Git even in the disposable copy. */
  const initialized = spawnSync('git', ['init', '-q'], { cwd: target, encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  appendFileSync(join(target, '.git', 'info', 'exclude'), '\n**/node_modules\n')
}

/** Runs a package's real Vitest entry point and preserves its output on failure. */
function runPackage(target, packageName, testPath) {
  const result = spawnSync(
    join(target, 'node_modules', '.bin', 'vitest'),
    ['run', testPath, '--reporter=verbose'],
    {
      cwd: join(target, 'packages', packageName),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  )
  assert.equal(
    result.status,
    0,
    `${packageName} exit ${result.status}\n${result.stdout.slice(-1800)}\n${result.stderr.slice(-1000)}`
  )
  return `${result.stdout}\n${result.stderr}`
}

/** Verifies the retained event-subscriber architecture assertions in the docless copy. */
function checkArchitecture(target, output) {
  const source = readFileSync(
    join(target, 'packages', 'event-subscriber', 'test', 'architecture.test.ts'),
    'utf8'
  )
  assert.match(output, /ES-T113/)
  assert.match(output, /ES-T114 uses explicit owner import graph/)
  assert.doesNotMatch(output, /ES-T114 audits every active/)
  for (const removed of ['assertSdd', 'ES-M11', 'const audit', 'sdd-validator'])
    assert.equal(source.includes(removed), false, `obsolete ${removed} remains`)
  for (const retained of ['IEventChannelSubscription', 'IEventHubSubscription'])
    assert.equal(source.includes(retained), true, `retained ${retained} is missing`)
  assert.equal(
    existsSync(join(target, 'packages', 'event-subscriber', 'test', 'sdd-validator.ts')),
    false
  )
}

/** Builds an independent temporary checkout and runs both affected package tests. */
function main() {
  const target = mkdtempSync(join(tmpdir(), 'migai-docs-independence-'))
  let failed = false
  try {
    copyCheckout(target)
    runPackage(target, 'serialize', 'test')
    const architectureOutput = runPackage(target, 'event-subscriber', 'test/architecture.test.ts')
    checkArchitecture(target, architectureOutput)
    process.stdout.write('DOCS_INDEPENDENCE PASS serialize event-subscriber\n')
  } catch (error) {
    failed = true
    process.stderr.write(`DOCS_INDEPENDENCE FAIL ${String(error)}\n`)
  } finally {
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (error) {
      failed = true
      process.stderr.write(`DOCS_INDEPENDENCE cleanup ${String(error)}\n`)
    }
  }
  if (failed) process.exitCode = 1
}

main()
