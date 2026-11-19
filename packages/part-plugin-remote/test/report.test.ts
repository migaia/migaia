import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { createPartHost, defineEffect, definePartPlugin } from '@migaia/part-host'
import { describe, expect, it } from 'vitest'
import { forwardPartErrors } from '../src/index.ts'
import { appPlugin, blueprint } from './support.ts'

/** Error with a classification, as a failing part would throw. */
function codedError(): Error {
  /** The error. */
  const error = new Error('render failed')
  Object.defineProperty(error, 'source', { value: 'app.view', enumerable: true })
  Object.defineProperty(error, 'code', { value: 'VIEW_BROKEN', enumerable: true })
  return error
}

describe('production error reporting', () => {
  it('writes one error entry with address, version, snapshot hash, source and code', async () => {
    /** Delivered log records. */
    const delivered: { level: string; args: readonly unknown[] }[] = []
    /** Memory log host. */
    const log = createLogHost({
      plugins: [
        levelPlugin(),
        defineOutputPlugin({
          name: 'memory',
          batchable: false,
          defaultFormat: 'plain',
          deliver: (records) => {
            for (const record of records)
              delivered.push({ level: record.entry.tag, args: record.entry.args })
          }
        })
      ]
    })
    /** Errors the host reported. */
    const reported: { source?: unknown; code?: unknown }[] = []
    /** Forwarder under test. */
    const forward = forwardPartErrors(log)
    /** Host whose `failing` effect throws for one node. */
    const host = await createPartHost({
      plugins: [
        appPlugin,
        definePartPlugin({
          name: 'failing',
          effects: [
            defineEffect({
              id: 'fail@1',
              run: () => {
                throw codedError()
              }
            })
          ]
        })
      ],
      onError: (error, info) => {
        reported.push(error as { source?: unknown; code?: unknown })
        forward(error, info)
      }
    })
    host.diagnostics.setContext({ version: 'v2', snapshot: 'sha256-x' })
    await host.blueprint.load(blueprint('page', 'p', { click: 'fail@1' }))
    await host.blueprint.load(blueprint('other', 'o'))
    await host.dispatch('page-button', 'click', undefined).catch(() => undefined)
    await log.flush()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.level).toBe('error')
    expect(delivered[0]?.args[0]).toMatchObject({
      address: 'page-button',
      version: 'v2',
      snapshot: 'sha256-x',
      source: reported[0]?.source,
      code: reported[0]?.code
    })
    expect(reported[0]?.code).toEqual(expect.any(String))
    expect(JSON.stringify(delivered[0]?.args[0])).not.toContain('"label"')
    await log.shutdown('manual')
    await host.dispose()
  })
})
