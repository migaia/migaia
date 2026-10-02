import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { acceptsSchema } from '../fixtures/schema-accepts.js'
import {
  RemoteCatalogLimit,
  normalizeRemoteContract,
  normalizeRemoteControlShape,
  normalizeRemoteHostCatalog,
  REMOTE_METHOD_MAX_LENGTH,
  REMOTE_METHOD_MODES,
  REMOTE_NAME_PATTERN
} from '../../src/remote/contract.js'
import { RpcRemoteLayerErrorText } from '../../src/remote/error-text.js'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'

/** Narrow JSON Schema keyword set used by the checked protocol document. */
type ISchema = Record<string, unknown>

/** Schema and vectors are shipped protocol assets, not test-only fixtures. */
const schema = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../schema/remote-contract.schema.json'), 'utf8')
) as ISchema & { $defs: Record<string, ISchema> }
/** Application contract accept/reject examples. */
const contractVectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../schema/vectors/remote-contract.json'), 'utf8')
) as { contracts: { id: string; value: unknown; schemaValid: boolean; semanticValid: boolean }[] }
/** Host catalog and reserved control shape examples. */
const hostVectors = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../schema/vectors/remote-host-control.json'),
    'utf8'
  )
) as {
  catalogs: { id: string; value: unknown; schemaValid: boolean; semanticValid: boolean }[]
  controls: {
    id: string
    definition: Parameters<typeof normalizeRemoteControlShape>[0]
    value: unknown
    schemaValid: boolean
    semanticValid: boolean
  }[]
}

/** Checks a semantic normalization without obscuring the native error code. */
function normalized(check: () => unknown): boolean {
  try {
    check()
    return true
  } catch (error) {
    expect((error as { code?: string }).code).toBe(RpcRemoteLayerErrorCode.contractInvalid)
    return false
  }
}

describe('A1 remote contract and Schema', () => {
  it('mirrors the stable name grammar and method declarations', () => {
    const definitions = schema.$defs
    expect((definitions.name as ISchema).pattern).toBe(REMOTE_NAME_PATTERN)
    expect((definitions.name as ISchema).maxLength).toBe(40)
    expect(
      ((definitions.method as ISchema).properties as Record<string, ISchema>).mode?.enum
    ).toEqual(REMOTE_METHOD_MODES)
    expect(REMOTE_METHOD_MAX_LENGTH).toBe(122)
  })

  it.each(contractVectors.contracts)('$id: contract schema and normalizer agree', (vector) => {
    expect(acceptsSchema(schema.$defs.contract!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteContract(vector.value))).toBe(vector.semanticValid)
  })

  it.each(hostVectors.catalogs)(
    '$id: catalog structure and semantic key check differ as specified',
    (vector) => {
      expect(acceptsSchema(schema.$defs.catalog!, vector.value)).toBe(vector.schemaValid)
      expect(normalized(() => normalizeRemoteHostCatalog(vector.value))).toBe(vector.semanticValid)
    }
  )

  it.each(hostVectors.controls)('$id: reserved control schema and semantic checks', (vector) => {
    expect(acceptsSchema(schema.$defs[vector.definition]!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteControlShape(vector.definition, vector.value))).toBe(
      vector.semanticValid
    )
  })
})

describe('K194 bounded catalog admission', () => {
  it('rejects over-limit tables before invoking their entry getters', () => {
    /** Rejected catalog entries must never reach portable normalization or resolver inputs. */
    const read = vi.fn(() => null)
    /** Count is one over the frozen plugin bound; enumerable getters prove traversal order. */
    const oversized = Object.create(null) as Record<string, unknown>
    for (let index = 0; index <= RemoteCatalogLimit.pluginsPerCatalog; index++)
      Object.defineProperty(oversized, `p${index}`, { enumerable: true, get: read })
    expect(() => normalizeRemoteHostCatalog(oversized)).toThrow(
      expect.objectContaining({
        code: RpcRemoteLayerErrorCode.contractInvalid,
        detail: { path: '$.catalog', limit: 'pluginsPerCatalog', max: 64 }
      })
    )
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['catalog', 'feature', 'method', 'unknown'])(
    'redacts a long %s key in bounded detail',
    (location) => {
      /** Unique input marker must never be reflected by a diagnostic path. */
      const key = 'unsafe.' + 'x'.repeat(100000)
      const method = { mode: 'request', idempotent: false }
      const value = { schemaVersion: 1, plugin: 'p', features: { f: { methods: { m: method } } } }
      const input =
        location === 'catalog'
          ? { [key]: value }
          : location === 'feature'
            ? { ...value, features: { [key]: { methods: { m: method } } } }
            : location === 'method'
              ? { ...value, features: { f: { methods: { [key]: method } } } }
              : { ...value, [key]: true }
      try {
        if (location === 'catalog') normalizeRemoteHostCatalog(input)
        else normalizeRemoteContract(input)
        expect.fail('invalid key accepted')
      } catch (error) {
        const detail = (error as { detail: { path: string } }).detail
        expect(detail.path).toContain(RpcRemoteLayerErrorText.invalidPathSegment)
        expect(detail.path.length).toBeLessThanOrEqual(RemoteCatalogLimit.detailPathChars)
        expect(detail.path).not.toContain(key)
      }
    }
  )

  it('reads admitted getters once and retains their original failure locally', () => {
    const original = new Error('local getter failure')
    const read = vi.fn(() => {
      throw original
    })
    const input = {
      schemaVersion: 1,
      plugin: 'p',
      get features() {
        return read()
      }
    }
    expect(() => normalizeRemoteContract(input)).toThrow(
      expect.objectContaining({ cause: original })
    )
    expect(read).toHaveBeenCalledTimes(1)
  })
})
