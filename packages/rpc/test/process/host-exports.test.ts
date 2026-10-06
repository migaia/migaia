import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createProcessPeer,
  createProcessPlugin,
  type IProcessHostRegistrations
} from '../../src/process/index.js'

describe('process Host public root', () => {
  it('[A8] exposes factories and types through process without adding a Host deep path', async () => {
    /** The built module is the same process entry consumed by the packed 40-path check. */
    const built = await import('../../dist/process/index.js')
    expect(built.createProcessPeer).toBeTypeOf('function')
    expect(built.createProcessPlugin).toBeTypeOf('function')
    expect(createProcessPeer).toBeTypeOf('function')
    expect(createProcessPlugin).toBeTypeOf('function')
    /** Ordinary consumers infer options from the root factories without retired Host declarations. */
    type IPeerOptions = Parameters<typeof createProcessPeer>[0]
    /** The same Plugin constructor covers both source roles through its public signature. */
    type IPluginOptions = Parameters<typeof createProcessPlugin>[0]
    const client: (options: IPeerOptions) => Promise<object> = createProcessPeer
    const service: (options: IPluginOptions) => object = createProcessPlugin
    const registrations: IProcessHostRegistrations | undefined = undefined
    expect(client).toBe(createProcessPeer)
    expect(service).toBe(createProcessPlugin)
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
