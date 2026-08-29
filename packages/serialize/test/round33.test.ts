import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

type IInstalledPackage = {
  readonly name: string
  readonly root: string
}

type IBundleLedger = ReadonlySet<string>

/** Repository package root used to create fresh packed consumer fixtures. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
/** Serialize package root under test. */
const serializeRoot = resolve(repositoryRoot, 'packages/serialize')
/** Packed package roots required to resolve serialize's workspace dependencies normally. */
const packageRoots = [
  { name: '@migaia/serialize', root: serializeRoot },
  { name: '@migaia/lifecycle', root: resolve(repositoryRoot, 'packages/lifecycle') },
  { name: '@migaia/utils', root: resolve(repositoryRoot, 'packages/utils') }
] as const

/** Create one packed tarball and return its exact temporary path. */
const packPackage = (packageRoot: string, destination: string): string => {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: packageRoot,
    stdio: 'pipe'
  })
  const packageName = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    readonly name: string
  }
  const archive = readdirSync(destination).find(
    (entry) =>
      entry.startsWith(packageName.name.replace('/', '-').replace('@', '')) &&
      entry.endsWith('.tgz')
  )
  if (archive === undefined) throw new Error(`missing packed archive for ${packageName.name}`)
  return join(destination, archive)
}

/** Install packed serialize, lifecycle and utils artifacts into an isolated consumer. */
const installPackedConsumer = (
  consumerRoot: string,
  serializeArchive: string,
  lifecycleArchive: string,
  utilsArchive: string
): void => {
  writeFileSync(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'serialize-core-packed-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@migaia/serialize': `file:${serializeArchive}`,
          '@migaia/lifecycle': `file:${lifecycleArchive}`,
          '@migaia/utils': `file:${utilsArchive}`
        }
      },
      undefined,
      2
    )}\n`,
    'utf8'
  )
  writeFileSync(
    join(consumerRoot, 'pnpm-workspace.yaml'),
    `${JSON.stringify(
      {
        packages: [],
        overrides: {
          '@migaia/lifecycle': `file:${lifecycleArchive}`,
          '@migaia/utils': `file:${utilsArchive}`
        }
      },
      undefined,
      2
    )}\n`,
    'utf8'
  )
  execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true' },
    stdio: 'pipe'
  })
}

/** Normalize Vite module IDs to exact package-relative ledger entries. */
const normalizeModuleId = (
  moduleId: string,
  consumerRoot: string,
  installedPackages: readonly IInstalledPackage[]
): string => {
  const cleanId = moduleId.split('?')[0]
  const resolvedId = cleanId.startsWith('/') ? realpathSync(cleanId) : cleanId
  for (const installed of installedPackages) {
    if (resolvedId === installed.root || resolvedId.startsWith(`${installed.root}/`))
      return `${installed.name}/${relative(installed.root, resolvedId).replaceAll('\\', '/')}`
  }
  const entryRoot = resolve(consumerRoot)
  if (resolvedId.startsWith(`${entryRoot}/`)) return `app/${relative(entryRoot, resolvedId)}`
  return resolvedId
}

/** Build one packed consumer entry and capture every module in its Rollup chunk graph. */
const buildLedger = async (
  consumerRoot: string,
  entryName: string,
  source: string,
  installedPackages: readonly IInstalledPackage[]
): Promise<IBundleLedger> => {
  const entryPath = join(consumerRoot, entryName)
  writeFileSync(entryPath, source, 'utf8')
  const retained = new Set<string>()
  await build({
    configFile: false,
    logLevel: 'silent',
    root: consumerRoot,
    plugins: [
      {
        name: 'serialize-packed-retained-module-ledger',
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue
            for (const moduleId of Object.keys(output.modules))
              retained.add(normalizeModuleId(moduleId, consumerRoot, installedPackages))
          }
        }
      }
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: entryPath, formats: ['es'], fileName: basename(entryName, '.js') }
    }
  })
  return new Set([...retained].sort())
}

describe('Round33 packed serialize core boundary', () => {
  it('SER-T33-01 records exact stream and non-stream retained module ledgers', async () => {
    const smokeRoot = mkdtempSync(join(tmpdir(), 'migaia-serialize-core-packed-'))
    try {
      const archives = packageRoots.map(({ root }) => packPackage(root, smokeRoot))
      const consumerRoot = join(smokeRoot, 'consumer')
      const serializeArchive = archives[0]
      const lifecycleArchive = archives[1]
      const utilsArchive = archives[2]
      if (
        serializeArchive === undefined ||
        lifecycleArchive === undefined ||
        utilsArchive === undefined
      )
        throw new Error('packed dependency archive missing')
      mkdirSync(consumerRoot, { recursive: true })
      installPackedConsumer(consumerRoot, serializeArchive, lifecycleArchive, utilsArchive)
      const installedPackages = packageRoots.map(({ name }) => ({
        name,
        root: realpathSync(join(consumerRoot, 'node_modules', ...name.split('/')))
      }))
      const streamLedger = await buildLedger(
        consumerRoot,
        'stream-entry.js',
        "import { encodeStream } from '@migaia/serialize/core'; export { encodeStream };\n",
        installedPackages
      )
      const coreLedger = await buildLedger(
        consumerRoot,
        'core-entry.js',
        "import { bytesToBase64 } from '@migaia/serialize/core'; export { bytesToBase64 };\n",
        installedPackages
      )

      const forbiddenLifecycle =
        /@migaia\/lifecycle\/dist\/(?:index|scope|scheduler|generation|quiescence|disposal)/
      expect([...streamLedger].filter((moduleId) => forbiddenLifecycle.test(moduleId))).toEqual([])
      expect(
        [...coreLedger].filter((moduleId) => moduleId.startsWith('@migaia/lifecycle/'))
      ).toEqual([])
      expect(
        [...streamLedger].filter((moduleId) => moduleId.startsWith('@migaia/lifecycle/'))
      ).toEqual(
        [...streamLedger].filter((moduleId) => moduleId.startsWith('@migaia/lifecycle/')).sort()
      )
      expect(streamLedger).toContain('@migaia/lifecycle/dist/abort.js')
      expect(streamLedger).toContain('@migaia/lifecycle/dist/abort-factory.js')
      expect(streamLedger).toContain('@migaia/serialize/dist/stream.js')
      expect(streamLedger).toContain('@migaia/serialize/dist/signal.js')
    } finally {
      rmSync(smokeRoot, { recursive: true, force: true })
    }
  }, 120_000)
})
