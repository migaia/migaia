import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

/** Installed TypeScript is resolved locally; this harness never invokes a package downloader. */
const require = createRequire(import.meta.url)

/** D1 freezes these tool minima; Rust and Cargo are recorded independently. */
export const ConformanceToolchainMinimum = Object.freeze({
  python: '3.9.6',
  rust: '1.96.0',
  cargo: '1.96.0',
  go: '1.26.4',
  node: '24.16.0',
  typescript: '6.0.2'
})

/** Stable fixture admission outcomes distinguish absent tools from unsupported lower versions. */
export const ConformanceAdmissionStatus = Object.freeze({
  accepted: 'accepted',
  missing: 'environment-failure',
  lower: 'version-below-minimum',
  invalid: 'invalid-version'
})

/**
 * Read one already installed executable's version without building or installing anything.
 *
 * @param {string} tool D1 tool identifier.
 * @param {{ execute?: typeof execFileSync }} [options] Read-only execution boundary for command
 *   tracing.
 * @returns {{ path: string; output: string } | undefined} Executable and raw version, or an absent
 *   tool.
 */
export function inspectInstalledToolchain(tool, options = {}) {
  /** Tests trace this exact command boundary; no installation or download path exists. */
  const execute = options.execute ?? execFileSync
  try {
    if (tool === 'typescript') {
      /** The local compiler path also serves as the receipt's executable identity. */
      const path = require.resolve('typescript/bin/tsc')
      return {
        path,
        output: execute(process.execPath, [path, '--version'], { encoding: 'utf8' })
      }
    }
    /** Version probes have fixed commands and arguments, never shell interpolation. */
    const command = {
      python: 'python3',
      rust: 'rustc',
      cargo: 'cargo',
      go: 'go',
      node: 'node'
    }[tool]
    if (!command) return undefined
    /** Resolve the exact executable admitted by the PATH used by the fixture runner. */
    const path = execute('/usr/bin/which', [command], { encoding: 'utf8' }).trim()
    return {
      path,
      output: execute(path, tool === 'go' ? ['version'] : ['--version'], {
        encoding: 'utf8',
        env: { ...process.env, GOTOOLCHAIN: 'local', PYTHONDONTWRITEBYTECODE: '1' }
      })
    }
  } catch {
    // Absence is an explicit admission failure, not a swallowed product error or an install trigger.
    return undefined
  }
}

/**
 * Admit all D1 tools before any peer launch. Failure returns a receipt and performs no recovery.
 *
 * @param {{ inspect?: (tool: string) => { path: string; output: string } | undefined }} [options]
 *   Read-only version probe, injectable for lower/missing fixtures.
 * @returns {{
 *   accepted: boolean
 *   tools: {
 *     tool: string
 *     minimum: string
 *     path?: string
 *     version?: string
 *     output?: string
 *     status: string
 *   }[]
 * }}
 *   Complete admission receipt.
 */
export function admitConformanceToolchains(options = {}) {
  /** Every invocation finishes all read-only probes so the failure receipt names every missing tool. */
  const inspect = options.inspect ?? inspectInstalledToolchain
  /** No download, install, build or peer launch occurs in this function. */
  const tools = Object.entries(ConformanceToolchainMinimum).map(([tool, minimum]) => {
    /** Preserve the raw installed version as well as the numeric comparison result. */
    const observed = inspect(tool)
    if (!observed) return { tool, minimum, status: ConformanceAdmissionStatus.missing }
    /** All supported tools print a three-component version; prerelease compatibility is unverified. */
    const matched = observed.output.match(/(\d+)\.(\d+)\.(\d+)(?![\d.-])/)
    if (!matched) return { tool, minimum, ...observed, status: ConformanceAdmissionStatus.invalid }
    /** Lexicographic numeric comparison preserves major/minor/patch boundaries. */
    const actual = matched.slice(1, 4).map(Number)
    /** D1 has exactly three numeric components for every admitted tool. */
    const required = minimum.split('.').map(Number)
    /** The first unequal version component decides admission. */
    const difference = actual.findIndex((value, index) => value !== required[index])
    return {
      tool,
      minimum,
      ...observed,
      version: matched[0],
      status:
        difference === -1 || actual[difference] > required[difference]
          ? ConformanceAdmissionStatus.accepted
          : ConformanceAdmissionStatus.lower
    }
  })
  return {
    accepted: tools.every((row) => row.status === ConformanceAdmissionStatus.accepted),
    tools
  }
}
