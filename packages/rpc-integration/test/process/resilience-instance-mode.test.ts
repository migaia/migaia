import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProcessPluginDescriptor } from '../../../rpc-plugin-process/dist/process/plugin/index.js'
import { acceptsSchema, type ISchemaRule } from '../fixtures/schema-accepts.js'

/** The published schema is the independent structure check for instance mode. */
const schema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../rpc-plugin-process/schema/process-plugin-descriptor.schema.json'
    ),
    'utf8'
  )
) as ISchemaRule & { $defs: Record<string, ISchemaRule> }
/** A previously valid shared descriptor isolates the instance-mode change. */
const base = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../schema/vectors/process-plugin-descriptor.json'),
    'utf8'
  )
).cases.find((entry: { id: string }) => entry.id === 'spawn-native-stdin').value

describe('process resilience instance mode', () => {
  it('accepts per-connection in Schema and the canonical parser', () => {
    const input = { ...base, instanceMode: 'per-connection' }
    expect(acceptsSchema(schema, input, schema), 'schema per-connection').toBe(true)
    expect(parseProcessPluginDescriptor(input)).toMatchObject({ instanceMode: 'per-connection' })
  })
})
