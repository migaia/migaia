import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ReplaceStrategy } from '@migaia/supervision'
import { describe, expect, it } from 'vitest'
import { REMOTE_NAME_PATTERN } from '../../src/remote/contract.js'
import { parseProcessPluginDescriptor } from '../../src/process/plugin/descriptor.js'
import { ProcessPluginInstanceMode, ProcessPluginWire } from '../../src/process/plugin/constants.js'
import { acceptsSchema, type ISchemaRule } from '../fixtures/schema-accepts.js'

/** The published schema is checked as an independent structural contract. */
const schema = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../schema/process-plugin-descriptor.schema.json'),
    'utf8'
  )
) as ISchemaRule & { $defs: Record<string, ISchemaRule> }
/** Both layers receive exactly the same published examples. */
const vectors = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../schema/vectors/process-plugin-descriptor.json'),
    'utf8'
  )
) as {
  cases: {
    id: string
    value: unknown
    schemaValid: boolean
    semanticValid: boolean
    field?: string
    code?: string
  }[]
}

describe('process plugin descriptor', () => {
  it('[A10] mirrors the canonical name and enum domains', () => {
    expect(schema.$defs.name?.pattern).toBe(REMOTE_NAME_PATTERN)
    expect(schema.$defs.strategy?.enum).toEqual(Object.values(ReplaceStrategy))
    expect(schema.$defs.instanceMode?.enum).toEqual(Object.values(ProcessPluginInstanceMode))
    expect(schema.$defs.spawnByte?.properties).toMatchObject({
      wire: { enum: Object.values(ProcessPluginWire) }
    })
  })

  it.each(vectors.cases)('[A10] $id checks Schema structure and parser semantics', (vector) => {
    expect(acceptsSchema(schema, vector.value, schema)).toBe(vector.schemaValid)
    if (vector.semanticValid) {
      const parsed = parseProcessPluginDescriptor(vector.value)
      expect(Object.isFrozen(parsed)).toBe(true)
      return
    }
    /** A missing rejection remains observable outside the catch block. */
    let caught: unknown
    try {
      parseProcessPluginDescriptor(vector.value)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TypeError)
    expect(caught).toMatchObject({ code: vector.code ?? 'PROCESS_PLUGIN_INVALID_OPTION' })
    if (vector.field) expect(caught).toMatchObject({ detail: { field: vector.field } })
  })

  it('[A10] sorts and freezes the two normalized host catalog entries', () => {
    const input = vectors.cases.find((vector) => vector.id === 'host-spawn')!.value
    const result = parseProcessPluginDescriptor(input) as {
      catalog: Record<string, { features: unknown }>
    }
    expect(Object.keys(result.catalog)).toEqual(['p', 'q'])
    expect(Object.isFrozen(result.catalog)).toBe(true)
    expect(Object.isFrozen(result.catalog.p?.features)).toBe(true)
  })

  it('[A10] does not carry an untrusted getter secret into the parser error chain', () => {
    const secret = 'descriptor-private-token'
    const input = { descriptorVersion: 1 }
    Object.defineProperty(input, 'runtime', {
      enumerable: true,
      get() {
        throw new Error(secret)
      }
    })
    /** The getter's original error is hostile input, not a safe diagnostic cause. */
    let caught: unknown
    try {
      parseProcessPluginDescriptor(input)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'PROCESS_PLUGIN_INVALID_OPTION' })
    expect((caught as Error).cause).toBeUndefined()
    expect(String(caught)).not.toContain(secret)
    expect(JSON.stringify(caught)).not.toContain(secret)
  })

  it.each([
    ['deployment.spec.args', [1], 'deployment.spec.args'],
    ['deployment.spec.cwd', '', 'deployment.spec.cwd'],
    ['deployment.spec.env.inherit', [1], 'deployment.spec.env.inherit'],
    ['deployment.spec.env.set', { BAD: 1 }, 'deployment.spec.env.set.BAD'],
    ['deployment.spec.stdio.stdin', 'unknown', 'deployment.spec.stdio.stdin'],
    ['deployment.spec.stdio.stdout', 'unknown', 'deployment.spec.stdio.stdout'],
    ['deployment.spec.stdio.stderr', 'unknown', 'deployment.spec.stdio.stderr'],
    ['deployment.spec.limits', { memoryBytes: 0 }, 'deployment.spec.limits.memoryBytes'],
    ['deployment.spec.permissions', [1], 'deployment.spec.permissions'],
    ['deployment.spec.bootstrap.fd', 3, 'deployment.spec.bootstrap.fd'],
    ['deployment.budget.overflow', 'unknown', 'deployment.budget.overflow'],
    ['deployment.budget.queueTimeoutMs', 0, 'deployment.budget.queueTimeoutMs'],
    ['deployment.budget.launchRate', { max: 0, windowMs: 1 }, 'deployment.budget.launchRate.max'],
    [
      'deployment.budget.launchRate',
      { max: 1, windowMs: 0 },
      'deployment.budget.launchRate.windowMs'
    ]
  ] as const)(
    '[A10] rejects malformed persisted field %s before creating a process',
    (path, value, field) => {
      /** A valid published vector is changed at one exact persisted field. */
      const source = vectors.cases.find((vector) => vector.id === 'spawn-native-stdin')!.value
      const input = structuredClone(source) as Record<string, unknown>
      const parts = path.split('.')
      let owner: Record<string, unknown> = input
      for (const part of parts.slice(0, -1)) owner = owner[part] as Record<string, unknown>
      owner[parts.at(-1)!] = value
      expect(acceptsSchema(schema, input, schema)).toBe(false)
      expect(() => parseProcessPluginDescriptor(input)).toThrowError(
        expect.objectContaining({
          code: 'PROCESS_PLUGIN_INVALID_OPTION',
          detail: { field: `descriptor.${field}` }
        })
      )
    }
  )
})
