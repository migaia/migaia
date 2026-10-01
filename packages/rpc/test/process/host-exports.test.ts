import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createProcessHost,
  createServeProcessHost,
  type IProcessHost,
  type IProcessHostOptions,
  type IProcessHostRegistrations,
  type IProcessServeHostOptions
} from '../../src/process/index.js'

describe('process Host public root', () => {
  it('[A8] exposes factories and types through process without adding a Host deep path', async () => {
    /** The built module is the same process entry consumed by the packed 40-path check. */
    const built = await import('../../dist/process/index.js')
    expect(built.createProcessHost).toBeTypeOf('function')
    expect(built.createServeProcessHost).toBeTypeOf('function')
    expect(createProcessHost).toBeTypeOf('function')
    expect(createServeProcessHost).toBeTypeOf('function')
    /** The checked signatures also prove named options remain consumable from the public root. */
    const client: (options: IProcessHostOptions) => IProcessHost = createProcessHost
    const service: (options: IProcessServeHostOptions) => Promise<{ close(): Promise<void> }> =
      createServeProcessHost
    const registrations: IProcessHostRegistrations | undefined = undefined
    expect(client).toBe(createProcessHost)
    expect(service).toBe(createServeProcessHost)
    expect(registrations).toBeUndefined()
    /** Only the established root and adapters are published; private assembly remains hidden. */
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    )
    expect(manifest.exports['./process']).toBeDefined()
    expect(manifest.exports['./process/host']).toBeUndefined()
    expect(manifest.exports['./process/host/*']).toBeUndefined()
  })
})
