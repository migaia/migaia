import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { configDefaults } from 'vitest/config'
import { StandardCapability } from '@migaia/supervision'
import { ProcessCapability } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { createBunProcessLauncher } from '@migaia/rpc/process/adapters/bun-spawn'
import { createWindowsJobProcessLauncher } from '@migaia/rpc/process/adapters/windows-job'
import { createElectronUtilityProcessLauncher } from '@migaia/rpc/process/adapters/electron-utility-process'
import { createNodeThreadLauncher } from '@migaia/rpc/threads/adapters/node'
import { createDenoThreadLauncher } from '@migaia/rpc/threads/adapters/deno'
import { createBrowserThreadLauncher } from '@migaia/rpc/threads/adapters/browser'

/** The same unpackaged admission gate runs before the real business and performance runners. */
const admission = await import(
  new URL('./fixtures/conformance-toolchains.mjs', import.meta.url).href
)
/** Vitest loads configuration outside the source/test TypeScript project. */
const { default: defaultConfig } = await import(
  new URL('../../vitest.config.ts', import.meta.url).href
)
/** Repository root is resolved from this tracked test, never from workspace-local documentation. */
const repository = fileURLToPath(new URL('../../../../', import.meta.url))

/** Produce exact D1 version output without launching, installing or downloading a tool. */
function atMinimum(tool: string) {
  return { path: `/installed/${tool}`, output: admission.ConformanceToolchainMinimum[tool] }
}

describe('conformance toolchain and platform evidence boundaries', () => {
  it('[A11] admits every exact minimum and a higher patch, retaining executable and raw version', () => {
    /** The injected inspector has the same boundary as the real read-only probe. */
    const inspect = vi.fn(atMinimum)
    /** Equality is supported; lower-tool compatibility is never assumed. */
    const equal = admission.admitConformanceToolchains({ inspect })
    expect(equal.accepted).toBe(true)
    expect(equal.tools).toHaveLength(6)
    for (const row of equal.tools) {
      expect(row.status).toBe(admission.ConformanceAdmissionStatus.accepted)
      expect(row.path).toBe(`/installed/${row.tool}`)
      expect(row.version).toBe(row.minimum)
      expect(row.output).toBe(row.minimum)
    }
    /** A greater patch must compare numerically, not as a string. */
    const higher = admission.admitConformanceToolchains({
      inspect: (tool: string) => ({
        path: `/installed/${tool}`,
        output: admission.ConformanceToolchainMinimum[tool]
          .split('.')
          .map((part: string, index: number) => (index === 2 ? Number(part) + 1 : part))
          .join('.')
      })
    })
    expect(higher.accepted).toBe(true)
    expect(inspect).toHaveBeenCalledTimes(6)
  })

  it.each(Object.keys(admission.ConformanceToolchainMinimum))(
    '[A11] rejects lower or missing %s before launch with no install or download recovery',
    (target) => {
      /** A failed admission must prevent the subsequent real-runner launch branch. */
      const launch = vi.fn()
      for (const missing of [false, true]) {
        /** The real gate runs before the same accepted-only launch branch used by consumers. */
        const receipt = admission.admitConformanceToolchains({
          inspect: (tool: string) =>
            tool !== target
              ? atMinimum(tool)
              : missing
                ? undefined
                : { path: `/installed/${tool}`, output: '0.0.0' }
        })
        if (receipt.accepted) launch()
        expect(receipt.accepted).toBe(false)
        expect(receipt.tools.find((row: { tool: string }) => row.tool === target).status).toBe(
          missing
            ? admission.ConformanceAdmissionStatus.missing
            : admission.ConformanceAdmissionStatus.lower
        )
      }
      expect(launch).not.toHaveBeenCalled()
    }
  )

  it('[A11] probes only executable paths and versions, with no install or download commands', () => {
    /** Trace the real inspector rather than unused synthetic recovery callbacks. */
    const commands: { command: string; args: string[] }[] = []
    for (const tool of Object.keys(admission.ConformanceToolchainMinimum)) {
      admission.inspectInstalledToolchain(tool, {
        execute: (command: string, args: string[]) => {
          commands.push({ command, args })
          return command === '/usr/bin/which'
            ? `/installed/${args[0]}\n`
            : admission.ConformanceToolchainMinimum[tool]
        }
      })
    }
    expect(commands).toHaveLength(11)
    expect(commands.filter((row) => row.command === '/usr/bin/which')).toHaveLength(5)
    for (const row of commands.filter((entry) => entry.command !== '/usr/bin/which'))
      expect(row.args.at(-1)).toMatch(/^(?:--version|version)$/)
    expect(
      commands.some((row) =>
        row.args.some((arg) => ['install', 'download', 'build', 'add', 'exec'].includes(arg))
      )
    ).toBe(false)
  })

  it('[A11] records actual installed versions and paths without compilation or installation', () => {
    /** This receipt comes from installed executables, not the synthetic minimum-version fixture. */
    const actual = admission.admitConformanceToolchains()
    expect(actual.accepted, JSON.stringify(actual)).toBe(true)
    for (const row of actual.tools) {
      expect(row.path).toMatch(/^\//)
      expect(existsSync(row.path)).toBe(true)
      expect(row.output).toContain(row.version)
      expect(row.status).toBe(admission.ConformanceAdmissionStatus.accepted)
    }
  })

  it('[A11] preserves offline builds, standard-library peers and default conformance exclusion', () => {
    /** Rust builds through the maintained runner into a system temporary target directory. */
    const rust = readFileSync(new URL('./peers/rust/run.sh', import.meta.url), 'utf8')
    expect(rust).toContain('cargo build --release --offline --locked')
    expect(rust).toContain('TMPDIR')
    /** Empty dependency tables are allowed; dependency entries are not. */
    const manifest = readFileSync(new URL('./peers/rust/Cargo.toml', import.meta.url), 'utf8')
    for (const section of manifest.matchAll(
      /^\[(?:.*\.)?(?:dependencies|dev-dependencies|build-dependencies)\]([^[]*)/gm
    ))
      expect(
        section[1]!.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'))
      ).toEqual([])
    /** Go's runner disables toolchain downloads and uses no module dependencies. */
    const go = readFileSync(new URL('./peers/go/run.sh', import.meta.url), 'utf8')
    expect(go).toContain('GOTOOLCHAIN=local')
    expect(go).toContain('GO111MODULE=off')
    expect(go).toContain('TMPDIR')
    expect(existsSync(new URL('./peers/go/go.mod', import.meta.url))).toBe(false)
    /** Python's own AST identifies top-level imports against this installed stdlib. */
    const python = execFileSync(
      'python3',
      [
        '-B',
        '-c',
        "import ast,json,sys,sysconfig,importlib.util,pathlib; p=pathlib.Path(sys.argv[1]); files=sorted(p.parent.glob('*.py')); names=sorted({name for f in files for n in ast.walk(ast.parse(f.read_text())) for name in ([alias.name.split('.')[0] for alias in n.names] if isinstance(n,ast.Import) else [n.module.split('.')[0]] if isinstance(n,ast.ImportFrom) else [])} - {f.stem for f in files}); root=pathlib.Path(sysconfig.get_path('stdlib')).resolve(); print(json.dumps([{'name':n,'stdlib': n in sys.builtin_module_names or (importlib.util.find_spec(n) is not None and importlib.util.find_spec(n).origin is not None and (importlib.util.find_spec(n).origin in ('built-in','frozen') or pathlib.Path(importlib.util.find_spec(n).origin).resolve().is_relative_to(root) and 'site-packages' not in importlib.util.find_spec(n).origin))} for n in names]))",
        fileURLToPath(new URL('./peers/python/peer.py', import.meta.url))
      ],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
    )
    expect(JSON.parse(python).every((row: { stdlib: boolean }) => row.stdlib)).toBe(true)
    expect(existsSync(new URL('./peers/python/__pycache__', import.meta.url))).toBe(false)
    expect(defaultConfig.test.exclude).toEqual([
      ...configDefaults.exclude,
      'test/process/conformance*.test.ts',
      'test/merge/suite-parity.test.ts'
    ])
    /** All package dependency sets remain identical to the frozen pre-I20 preparation commit. */
    const packages = execFileSync('git', ['ls-files', 'packages/*/package.json'], {
      cwd: repository,
      encoding: 'utf8'
    })
      .trim()
      .split('\n')
    for (const path of packages) {
      const before = JSON.parse(
        execFileSync('git', ['show', `be19788:${path}`], { cwd: repository, encoding: 'utf8' })
      )
      const after = JSON.parse(readFileSync(new URL(path, `file://${repository}`), 'utf8'))
      for (const key of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies'
      ])
        expect(after[key], `${path} ${key}`).toEqual(before[key])
    }
  })

  it('[A9] preserves actual capability admission without upgrading unrun platform guarantees', () => {
    for (const launcher of [createNodeProcessLauncher(), createBunProcessLauncher()])
      expect(launcher.capabilities).toMatchObject({
        termination: 'unsupported',
        [StandardCapability.faultIsolation]: 'enforced',
        [ProcessCapability.bootstrapStdin]: 'enforced',
        [ProcessCapability.bootstrapFd]: 'unsupported'
      })
    expect(Object.values(createWindowsJobProcessLauncher().capabilities)).toEqual(
      expect.arrayContaining(['unsupported'])
    )
    expect(
      Object.values(createWindowsJobProcessLauncher().capabilities).every(
        (level) => level === 'unsupported'
      )
    ).toBe(true)
    expect(createElectronUtilityProcessLauncher().capabilities).toMatchObject({
      termination: 'unsupported',
      [ProcessCapability.bootstrapStdin]: 'unsupported',
      [ProcessCapability.bootstrapFd]: 'unsupported'
    })
    expect(createNodeThreadLauncher().capabilities).toMatchObject({
      termination: 'enforced',
      'exit-observation': 'enforced',
      'heap-limit': 'enforced'
    })
    for (const launcher of [
      createDenoThreadLauncher({ report: vi.fn() }),
      createBrowserThreadLauncher({ report: vi.fn() })
    ])
      expect(launcher.capabilities).toMatchObject({
        termination: 'unsupported',
        'exit-observation': 'unsupported'
      })
    /**
     * These tracked fixtures locate future platform work; existence itself does not prove runtime
     * PASS.
     */
    for (const path of [
      '../threads/platform-capabilities.test.ts',
      '../threads/fixtures/web-runtime-parent.mjs',
      './platform-capabilities.test.ts',
      './platform-cleanup.test.ts'
    ])
      expect(existsSync(new URL(path, import.meta.url))).toBe(true)
  })
})
