import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('routes the Deno file adapter to the native Deno namespace', async () => {
  const calls: string[] = []
  vi.stubGlobal('Deno', {
    mkdir: async (path: string) => {
      calls.push(`mkdir ${path}`)
    },
    realPath: async (path: string) => path,
    readTextFile: async (path: string) => `text of ${path}`,
    writeTextFile: async (path: string) => {
      calls.push(`writeText ${path}`)
    },
    rename: async (from: string, to: string) => {
      calls.push(`rename ${from} ${to}`)
    },
    remove: async (path: string) => {
      calls.push(`remove ${path}`)
    }
  })
  const { fileIo } = await import('../src/fs/deno.ts')
  await fileIo.mkdir('/root/a')
  expect(await fileIo.readText('/root/a/file')).toBe('text of /root/a/file')
  await fileIo.writeText('/root/a/file', 'x')
  expect(calls).toEqual(['mkdir /root/a', 'writeText /root/a/file'])
})
