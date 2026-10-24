import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ReplaceStrategy } from '@migaia/supervision'
import { describe, expect, it } from 'vitest'
import { REMOTE_NAME_PATTERN } from '@migaia/rpc-host/plugin'
import { ProcessPluginWire } from '../../../rpc-plugin-process/dist/process/plugin/constants.js'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { acceptsSchema, type ISchemaRule } from '../fixtures/schema-accepts.js'

/** The published schema is checked as an independent structural contract. */
const schema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../rpc-plugin-process/schema/process-plugin-descriptor.schema.json'
    ),
    'utf8'
  )
) as ISchemaRule & { $defs: Record<string, ISchemaRule> }
/** Published examples independently exercise the shipped structural schema. */
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
  securityMutations: {
    id: string
    base: string
    path: string
    value: unknown
    schemaValid: boolean
    semanticValid: boolean
    field?: string
  }[]
}

/** Apply one published field mutation without repeating a full descriptor vector. */
function mutatedDescriptor(vector: (typeof vectors.securityMutations)[number]): unknown {
  const base = vectors.cases.find((candidate) => candidate.id === vector.base)
  if (!base) throw new Error(`Missing descriptor vector: ${vector.base}`)
  const input = structuredClone(base.value) as Record<string, unknown>
  const parts = vector.path.split('.')
  let owner: Record<string, unknown> = input
  for (const part of parts.slice(0, -1)) owner = owner[part] as Record<string, unknown>
  owner[parts.at(-1)!] = vector.value
  return input
}

describe('process plugin descriptor', () => {
  it('mirrors the canonical name and enum domains', () => {
    expect(schema.$defs.name?.pattern).toBe(REMOTE_NAME_PATTERN)
    expect(schema.$defs.strategy?.enum).toEqual(Object.values(ReplaceStrategy))
    expect(schema.$defs.instanceMode?.enum).toEqual(['shared', 'per-connection'])
    expect(schema.$defs.spawnByte?.properties).toMatchObject({
      wire: { enum: Object.values(ProcessPluginWire) }
    })
  })

  it.each(vectors.cases)('$id checks the published Schema structure', (vector) => {
    expect(acceptsSchema(schema, vector.value, schema)).toBe(vector.schemaValid)
  })

  it.each(vectors.securityMutations)('$id checks persisted-secret Schema structure', (vector) => {
    const input = mutatedDescriptor(vector)
    expect(acceptsSchema(schema, input, schema)).toBe(vector.schemaValid)
  })

  it('persists only an inherited env name and restores it in the child', async () => {
    /** The secret belongs to the launcher environment, never the persisted descriptor. */
    const key = 'MIGAI_DESCRIPTOR_TEST_SECRET'
    const secret = 'runtime-only-secret-72d1'
    const original = process.env[key]
    const input = mutatedDescriptor(
      vectors.securityMutations.find((item) => item.id === 'inherited-secret-reference')!
    ) as {
      deployment: { spec: { env: { inherit: string[] } } }
    }
    input.deployment.spec.env.inherit = [key]
    expect(acceptsSchema(schema, input, schema)).toBe(true)
    const directory = mkdtempSync(resolve(import.meta.dirname, 'descriptor-secret-'))
    try {
      const file = resolve(directory, 'plugin.json')
      writeFileSync(file, JSON.stringify(input))
      expect(readFileSync(file, 'utf8')).not.toContain(secret)
      process.env[key] = secret
      let output = ''
      const handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: ['-e', `process.stdout.write(process.env.${key} ?? '')`],
          env: { inherit: input.deployment.spec.env.inherit, set: {} },
          stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'ignore' }
        },
        {
          signal: new AbortController().signal,
          output(stream, chunk) {
            if (stream === 'stdout') output += new TextDecoder().decode(chunk)
          }
        }
      )
      expect(await handle.exited).toMatchObject({ code: 0 })
      expect(output).toBe(secret)
      expect(readFileSync(file, 'utf8')).not.toContain(secret)
    } finally {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an explicitly false nonSecret literal marker', () => {
    /** A valid descriptor changes only the public literal's required explicit opt-in. */
    const input = JSON.parse(
      JSON.stringify(vectors.cases.find((item) => item.id === 'spawn-native-stdin')!.value)
    )
    input.deployment.spec.env.set = { PUBLIC: { value: 'public', nonSecret: false } }
    expect(acceptsSchema(schema, input, schema)).toBe(false)
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
    'rejects malformed persisted field %s in the published Schema',
    (path, value, _field) => {
      /** A valid published vector is changed at one exact persisted field. */
      const source = vectors.cases.find((vector) => vector.id === 'spawn-native-stdin')!.value
      const input = structuredClone(source) as Record<string, unknown>
      const parts = path.split('.')
      let owner: Record<string, unknown> = input
      for (const part of parts.slice(0, -1)) owner = owner[part] as Record<string, unknown>
      owner[parts.at(-1)!] = value
      expect(acceptsSchema(schema, input, schema)).toBe(false)
    }
  )
})
