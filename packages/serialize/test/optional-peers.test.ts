import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type IPackedPackage = Readonly<{ name: string; root: string }>

/** Three workspace packages needed by a real packed serialize consumer. */
const packages: readonly IPackedPackage[] = [
  { name: '@migaia/serialize', root: resolve(import.meta.dirname, '..') },
  { name: '@migaia/lifecycle', root: resolve(import.meta.dirname, '../../lifecycle') },
  { name: '@migaia/utils', root: resolve(import.meta.dirname, '../../utils') }
]

/** Pack a workspace package and identify the exact archive created in isolation. */
const pack = (entry: IPackedPackage, destination: string): string => {
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: entry.root,
    encoding: 'utf8'
  })
  expect(result.status, `${entry.name} pack: ${result.stderr}`).toBe(0)
  const prefix = entry.name.replace('@', '').replace('/', '-')
  const archive = readdirSync(destination).find(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith('.tgz')
  )
  expect(archive, `${entry.name} archive`).toBeDefined()
  return join(destination, archive!)
}

/** Run native Node from the installed consumer so package resolution cannot see workspace dev deps. */
const importFromConsumer = (
  consumer: string,
  specifier: string
): Readonly<{
  status: number | null
  stdout: string
  stderr: string
}> => {
  const source = `try { await import(${JSON.stringify(specifier)}); process.stdout.write('loaded') } catch (error) { process.stdout.write(JSON.stringify({ code: error.code, message: error.message })); process.exitCode = 1 }`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumer,
    encoding: 'utf8'
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('serialize optional peer packed consumer', () => {
  it('A3 installs only three local tarballs and resolves codec peers only when supplied', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'migaia-serialize-optional-peers-'))
    try {
      const archives = Object.fromEntries(
        packages.map((entry) => {
          const destination = join(temporary, entry.name.replace('@', '').replace('/', '-'))
          mkdirSync(destination)
          return [entry.name, pack(entry, destination)]
        })
      )
      const consumer = join(temporary, 'consumer')
      mkdirSync(consumer)
      writeFileSync(
        join(consumer, 'package.json'),
        `${JSON.stringify(
          {
            name: 'serialize-optional-peers-consumer',
            private: true,
            type: 'module',
            dependencies: Object.fromEntries(
              packages.map(({ name }) => [name, `file:${archives[name]}`])
            )
          },
          undefined,
          2
        )}\n`
      )
      writeFileSync(
        join(consumer, 'pnpm-workspace.yaml'),
        `${JSON.stringify(
          {
            packages: [],
            overrides: Object.fromEntries(
              packages.map(({ name }) => [name, `file:${archives[name]}`])
            )
          },
          undefined,
          2
        )}\n`
      )
      const install = spawnSync('pnpm', ['install', '--offline', '--ignore-scripts'], {
        cwd: consumer,
        env: { ...process.env, CI: 'true' },
        encoding: 'utf8'
      })
      expect(install.status, `offline consumer install: ${install.stderr}\n${install.stdout}`).toBe(
        0
      )
      for (const peer of ['cbor-x', '@msgpack/msgpack', '@bufbuild/protobuf']) {
        expect(existsSync(join(consumer, 'node_modules', ...peer.split('/'))), peer).toBe(false)
      }
      for (const subpath of ['', '/codec', '/codecs/json']) {
        const specifier = `@migaia/serialize${subpath}`
        const result = importFromConsumer(consumer, specifier)
        expect(result.status, `${specifier}: ${result.stderr}\n${result.stdout}`).toBe(0)
        expect(result.stdout).toBe('loaded')
      }
      const missingPeers = {
        '/codecs/cbor': 'cbor-x',
        '/codecs/message-pack': '@msgpack/msgpack',
        '/codecs/protobuf': '@bufbuild/protobuf'
      } as const
      for (const [subpath, peer] of Object.entries(missingPeers)) {
        const result = importFromConsumer(consumer, `@migaia/serialize${subpath}`)
        expect(result.status, `${subpath}: ${result.stderr}\n${result.stdout}`).toBe(1)
        const error = JSON.parse(result.stdout) as { code: string; message: string }
        expect(error.code).toBe('ERR_MODULE_NOT_FOUND')
        expect(error.message).toContain(peer)
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
    // Three `pnpm pack` runs plus offline installs exceed Vitest's 5 s default under workspace load.
  }, 60_000)
})
