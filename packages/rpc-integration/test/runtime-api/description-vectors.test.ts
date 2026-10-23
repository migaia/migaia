import assert from 'node:assert/strict'
import { it } from 'vitest'
import vectors from '../../schema/vectors/runtime-description.json'
import { normalizeRuntimeDescription } from '../../../rpc-host/dist/remote/runtime-api/description.js'
import schemaVectors from '../../schema/vectors/description-schema.json'
import { createPeerPair } from '../../../rpc-host/dist/testing/index.js'
import {
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { normalizeRemoteContract } from '../../../rpc-host/dist/remote/contract.js'
import { readFileSync } from 'node:fs'
import { acceptsSchema, type ISchemaRule } from '../fixtures/schema-accepts.js'
import { serializeRpcError } from '@migaia/rpc-contract'

it('the separate v2 vectors admit generated directories and reject old versions, secret fields and duplicate modes', () => {
  for (const vector of vectors.valid) {
    assert.equal(normalizeRuntimeDescription(vector).schemaVersion, 2)
  }
  for (const vector of vectors.invalid) {
    assert.throws(() => normalizeRuntimeDescription(vector), { code: 'CONTRACT_INVALID' })
  }
})

it('shared schema descriptions execute the same per-case decisions as foreign peers', () => {
  for (const vector of schemaVectors.cases) {
    if (vector.valid) assert.equal(normalizeRuntimeDescription(vector.value).schemaVersion, 2)
    else
      assert.throws(() => normalizeRuntimeDescription(vector.value), { code: 'CONTRACT_INVALID' })
    console.log(`description-schema.json ${vector.id}: ${vector.valid ? 'accept' : 'reject'}`)
  }
  console.log(`description-schema.json: ${schemaVectors.cases.length} cases`)
})

it('provider schemas survive compilation and a real directory exchange and satisfy published schemas', async () => {
  /** Schema declarations are portable data on the original advanced provider contract. */
  const fields = {
    input: { type: 'number' },
    output: { type: 'string' },
    yield: { type: 'integer' }
  } as const
  /** Both ordinary and stream methods use their canonical mode and schema declarations. */
  const contract = normalizeRemoteContract({
    schemaVersion: 1,
    plugin: 'service',
    features: {
      api: {
        methods: {
          resize: { mode: 'request', idempotent: false, ...fields },
          rejectSchema: { mode: 'request', idempotent: false },
          values: { mode: 'async-generator', idempotent: false, yield: fields.yield }
        }
      }
    }
  })
  /** Published contract definitions also serve the catalog and reserved control schema references. */
  const published = JSON.parse(
    readFileSync(
      new URL('../../../rpc-contract/schema/remote-contract.schema.json', import.meta.url),
      'utf8'
    )
  ) as ISchemaRule & { $defs: Record<string, ISchemaRule> }
  assert.ok(acceptsSchema(published, contract, published))
  assert.ok(acceptsSchema(published.$defs.catalog!, { service: contract }, published))
  assert.ok(
    acceptsSchema(
      published.$defs.describeHost!,
      { schemaVersion: 1, catalog: { service: contract } },
      published
    )
  )
  /**
   * The existing memory pair creates the genuine provider and outbound owners and wire directory
   * handshake.
   */
  const pair = await createPeerPair({
    a: { provide: {} },
    b: {
      contract,
      provide: {
        service: {
          api: {
            resize: (value: number) => String(value),
            rejectSchema: () =>
              normalizeRemoteContract({
                schemaVersion: 1,
                plugin: 'service',
                features: {
                  api: {
                    methods: {
                      resize: {
                        mode: 'request',
                        idempotent: false,
                        input: {
                          get type() {
                            throw new TypeError('WIRE_SCHEMA_SENTINEL')
                          }
                        }
                      }
                    }
                  }
                }
              }),
            values: async function* () {
              yield 7
            }
          }
        }
      }
    },
    report: () => undefined
  })
  try {
    /**
     * Read only the accepted canonical receipt; no local describe projection can inject remote
     * methods.
     */
    const description = readRuntimePeerConnection(pair.a as unknown as IRuntimePeer).description!
    assert.deepEqual(
      description.methods.find((method) => method.name === 'service.api.resize')?.input,
      contract.features.api!.methods.resize!.input
    )
    assert.deepEqual(
      description.methods.find((method) => method.name === 'service.api.resize')?.output,
      contract.features.api!.methods.resize!.output
    )
    assert.deepEqual(
      description.methods.find((method) => method.name === 'service.api.values')?.yield,
      contract.features.api!.methods.values!.yield
    )
    assert.equal(await pair.a.request('service.api.resize', 8), '8')
    await assert.rejects(pair.a.request('service.api.rejectSchema'), (error) => {
      assert.equal(
        JSON.stringify(serializeRpcError(error, { report: () => undefined })).includes(
          'WIRE_SCHEMA_SENTINEL'
        ),
        false
      )
      return true
    })
    /** The published runtime schema validates the actual generation-bearing handshake output. */
    const schema = JSON.parse(
      readFileSync(
        new URL('../../../rpc-contract/schema/runtime-description.schema.json', import.meta.url),
        'utf8'
      )
    ) as ISchemaRule & { $defs: Record<string, ISchemaRule> }
    assert.ok(acceptsSchema(schema, description, schema))
  } finally {
    await Promise.all([pair.a.close(), pair.b.close()])
  }
})
