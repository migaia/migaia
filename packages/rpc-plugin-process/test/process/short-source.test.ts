import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { describe, expect, it, vi } from 'vitest'
import { defaultRpcReporter } from '@migaia/rpc-host/plugin'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { lstat, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir, userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Type checking proves the convenient entry needs no report or detailed handshake options. */
type IMathApi = { math: { double(value: number): number }; child(): boolean; flags(): string[] }
/** Native parent fixture exercises true self-spawn outside Vitest's deliberately invalid main entry. */
const execute = promisify(execFile)
/** Exact URLs make fixtures independent of the test runner's cwd and module entry. */
const serviceEntry = new URL('./fixtures/short-service.ts', import.meta.url)
/** The fixture's main module owns both the self and relative-string paths. */
const parentEntry = fileURLToPath(new URL('./fixtures/short-parent.mjs', import.meta.url))

describe('short Process sources', () => {
  it('runs a TS child through the original launcher, handshake and typed request', async () => {
    const peer = await createRpcHost<IMathApi>({
      plugins: [processPlugin({ spawn: serviceEntry })]
    })
    try {
      expect(await peer.request('math.double', 21)).toBe(42)
      expect(await peer.request('child')).toBe(true)
    } finally {
      await peer.close()
    }
  })

  it('self-spawn guard prevents recursive launch and preserves runtime flags', async () => {
    const result = await execute(process.execPath, ['--no-warnings', parentEntry], {
      timeout: 10_000
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      value: 42,
      child: true,
      flags: ['--no-warnings']
    })
  })

  it('resolves a relative TS string against the main entry instead of cwd', async () => {
    const result = await execute(process.execPath, ['--no-warnings', parentEntry, 'relative'], {
      cwd: tmpdir(),
      timeout: 10_000
    })
    expect(JSON.parse(result.stdout)).toMatchObject({ value: 42, child: true })
  })

  it.skipIf(process.platform === 'win32')(
    'launches an exact absolute path from eval without replaying eval flags',
    async () => {
      /** Literal ?/# are legal Unix filename bytes, independent of URL query/fragment syntax. */
      const directory = await mkdtemp(join(tmpdir(), 'dx-absolute-'))
      /** The entry's exact filename catches accidental conversion through a raw URL string. */
      const entry = join(directory, 'entry?#.ts')
      /** Reuse the existing public child fixture instead of adding another launch implementation. */
      await writeFile(entry, `await import(${JSON.stringify(serviceEntry.href)})`)
      /**
       * The parent has no argv[1]; only the different entry and runtime flags should reach the
       * child.
       */
      const program = `Promise.all([import('@migaia/rpc-host'), import('@migaia/rpc-plugin-process')]).then(async ([{ createRpcHost }, { processPlugin }]) => {
      const peer = await createRpcHost({ plugins: [processPlugin({ spawn: ${JSON.stringify(entry)} })] });
      try { process.stdout.write(JSON.stringify({ value: await peer.request('math.double', 21), flags: await peer.request('flags') })); }
      finally { await peer.close(); }
    })`
      try {
        /**
         * --no-warnings remains a runtime flag; --eval and its program must be consumed by the
         * parent.
         */
        const result = await execute(process.execPath, ['--no-warnings', '--eval', program], {
          timeout: 10_000
        })
        expect(JSON.parse(result.stdout)).toEqual({ value: 42, flags: ['--no-warnings'] })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it('rejects self-spawn from a test-runner main entry before launching', async () => {
    await expect(
      createRpcHost({ plugins: [processPlugin({ spawn: true })] })
    ).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG'
    })
  })

  it('documents Node type stripping by preserving its original .js module-resolution diagnostic', async () => {
    /**
     * The raw runtime diagnostic is evidence for the documented loader requirement, not a
     * fabricated parent cause.
     */
    const entry = fileURLToPath(new URL('./fixtures/short-module-error.ts', import.meta.url))
    await expect(execute(process.execPath, [entry], { timeout: 10_000 })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('ERR_MODULE_NOT_FOUND')
    })
  })

  it.skipIf(process.platform === 'win32')(
    'waits for a named server and enforces owner-only socket permissions',
    async () => {
      const name = `dx-short-${randomUUID()}`
      const clientPromise = createRpcHost<IMathApi>({
        plugins: [processPlugin({ connect: { target: name }, connectTimeoutMs: 1000 })]
      })
      const server = await createRpcHost({
        provide: { math: { double: (value: number) => value * 2 } },
        plugins: [processPlugin({ listen: name })]
      })
      const client = await clientPromise
      try {
        expect(await client.request('math.double', 21)).toBe(42)
        const address = `/tmp/migaia-rpc-${userInfo().uid}/${createHash('sha256').update(name).digest('hex').slice(0, 24)}.sock`
        expect((await lstat(dirname(address))).mode & 0o777).toBe(0o700)
        expect((await lstat(address)).mode & 0o777).toBe(0o600)
        await expect(
          createRpcHost({ plugins: [processPlugin({ listen: name })] })
        ).rejects.toMatchObject({
          source: 'rpc.transport.process',
          code: 'PROCESS_CHANNEL_LISTEN_FAILED'
        })
      } finally {
        await client.close()
        await server.close()
      }
    }
  )

  it('never treats a TCP address as an unauthenticated named endpoint', async () => {
    await expect(
      createRpcHost({ plugins: [processPlugin({ connect: { target: 'tcp://127.0.0.1:1' } })] })
    ).rejects.toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_PLUGIN_INVALID_OPTION',
      detail: { field: 'token' }
    })
    await expect(
      createRpcHost({ plugins: [processPlugin({ listen: 'tcp://127.0.0.1:0' })] })
    ).rejects.toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_PLUGIN_INVALID_OPTION',
      detail: { field: 'token' }
    })
  })

  it.skipIf(process.platform === 'win32')(
    'can require a token between processes of the same OS user',
    async () => {
      const name = `dx-token-${randomUUID()}`
      const notices: unknown[] = []
      const server = await createRpcHost({
        provide: { math: { double: (value: number) => value * 2 } },
        report: (error) => {
          notices.push(error)
        },
        plugins: [processPlugin({ listen: name, token: 'same-user-application-secret' })]
      })
      try {
        await expect(
          createRpcHost({
            report: () => undefined,
            plugins: [processPlugin({ token: 'wrong-secret', connect: { target: name } })]
          })
        ).rejects.toBeInstanceOf(Error)
        expect(notices).toContainEqual(
          expect.objectContaining({
            source: 'rpc.transport.process',
            code: 'PROCESS_CHANNEL_AUTH_REJECTED'
          })
        )
        const client = await createRpcHost<IMathApi>({
          plugins: [
            processPlugin({ token: 'same-user-application-secret', connect: { target: name } })
          ]
        })
        try {
          expect(await client.request('math.double', 2)).toBe(4)
        } finally {
          await client.close()
        }
      } finally {
        await server.close()
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'stops waiting for a missing named server at its bounded deadline',
    async () => {
      await expect(
        createRpcHost({
          report: () => undefined,
          plugins: [
            processPlugin({
              connect: { target: `dx-missing-${randomUUID()}` },
              connectTimeoutMs: 30
            })
          ]
        })
      ).rejects.toBeInstanceOf(Error)
    }
  )
})

it('gives an explicit default reporter and its wrapper identical per-launch notices', async () => {
  const notices: unknown[] = []
  const capture = vi.spyOn(console, 'error').mockImplementation((error) => {
    notices.push(error)
  })
  try {
    for (const report of [defaultRpcReporter, (error: unknown) => defaultRpcReporter(error)]) {
      for (let index = 0; index < 2; index++) {
        const peer = await createRpcHost<IMathApi>({
          report,
          plugins: [processPlugin({ spawn: serviceEntry })]
        })
        await peer.close()
      }
    }
    const termination = notices.filter((error) => {
      const notice = error as { source?: string; code?: string; detail?: { capability?: string } }
      return (
        notice.source === 'supervision' &&
        notice.code === 'CAPABILITY_UNSUPPORTED' &&
        notice.detail?.capability === 'termination'
      )
    })
    expect(termination).toHaveLength(4)
  } finally {
    capture.mockRestore()
  }
})
