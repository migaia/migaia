import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  digestProvenanceSubject,
  validateAuthorization
} from '../tree-shaking-authorization.mjs'
import { resolveCanonicalBuildConfig } from '../tree-shaking-canonical-build.mjs'

type IProvenance = {
  readonly approval: { readonly status: string; readonly approvalRecord: unknown }
  readonly subject: {
    readonly boundary: {
      readonly fixture: { readonly sha256: string }
      readonly lockfile: { readonly sha256: string }
      readonly manifests: readonly { readonly sha256: string }[]
      readonly retainedInputs: readonly { readonly kind: string; readonly sha256: string }[]
      readonly retainedInputCount: number
    }
    readonly tools: {
      readonly node: string
      readonly pnpm: string
      readonly vite: string
      readonly rolldown: string
      readonly esbuild: string
      readonly zlib: string
    }
    readonly resolvedBuildOptions: { readonly root: string; readonly build: object }
    readonly outputOptions: object
    readonly emitted: {
      readonly moduleCount: number
      readonly rawBytes: number
      readonly gzipBytes: number
      readonly bundleSha256: string
      readonly modules: readonly {
        readonly module: string
        readonly renderedSha256: string | null
        readonly sourceSha256: string | null
      }[]
    }
    readonly digest: string
  }
  readonly tuple: {
    readonly moduleCount: number
    readonly rawBytes: number
    readonly gzipBytes: number
  }
}

type IRecursiveFixture = { self?: IRecursiveFixture }

/** Runs provenance from either supported invocation root and preserves its JSON failure output. */
function readProvenance(cwd = resolve(import.meta.dirname, '../../../..')): IProvenance {
  const script = resolve(import.meta.dirname, '../tree-shaking-provenance.mjs')
  try {
    return JSON.parse(
      execFileSync(process.execPath, [script], {
        encoding: 'utf8',
        cwd,
        env: readCanonicalEnvironment()
      })
    ) as IProvenance
  } catch (error) {
    const output = error && typeof error === 'object' && 'stdout' in error ? error.stdout : ''
    return JSON.parse(String(output)) as IProvenance
  }
}

/** Removes Vitest worker markers so provenance sees the signed canonical environment. */
function readCanonicalEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== 'VITEST' && !key.startsWith('VITEST_') && key !== 'NODE_ENV'
    )
  )
}

describe('WRC-C-B11 retained provenance', () => {
  it('hashes cwd-independent inputs and accepts the exact approved decision', async () => {
    const report = readProvenance()
    const repeat = readProvenance()
    const packageInvocation = readProvenance(resolve(import.meta.dirname, '../..'))
    const { default: authority } = await import(
      '../fixtures/tree-shaking/baseline-authority.json',
      { with: { type: 'json' } }
    )
    expect(report.approval.status).toBe('approved')
    expect(report.approval.approvalRecord).toMatchObject({
      decisionId: 'WRC-C-B11-decision-20260827-04',
      keyId: 'coordinator-ed25519-7556143481d08058',
      digest: '93b3a88bd97a79efecf8ed2acc465e19576023fa5fb40bbf9af757e128ad0129'
    })
    expect(
      validateAuthorization(report.approval, report.subject, {
        oldTuple: { moduleCount: 53, rawBytes: 250129, gzipBytes: 61171 },
        newTuple: report.tuple,
        authority
      })
    ).toBeNull()
    expect(report.subject.boundary.retainedInputCount).toBe(report.subject.emitted.moduleCount)
    expect(report.subject.boundary.retainedInputs).toHaveLength(report.subject.emitted.moduleCount)
    expect(report.subject.boundary.retainedInputs[0]?.kind).toBe('retained-module')
    expect(report.subject.boundary.fixture.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.subject.boundary.lockfile.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.subject.boundary.manifests).toHaveLength(2)
    const { digest, ...subjectWithoutDigest } = report.subject
    expect(digest).toBe(digestProvenanceSubject(subjectWithoutDigest))
    expect(report.subject.emitted.bundleSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.subject.emitted.modules).toHaveLength(report.subject.emitted.moduleCount)
    expect(report.subject.emitted.modules.every((module) => module.renderedSha256)).toBe(true)
    expect(report.subject.emitted.modules.every((module) => module.sourceSha256)).toBe(true)
    expect(report.subject.tools.node).toMatch(/^v\d+/)
    expect(report.subject.tools.pnpm).toMatch(/^\d+\.\d+\.\d+$/)
    expect(report.subject.tools.vite).not.toBe('unavailable')
    expect(report.subject.tools.rolldown).not.toBe('unavailable')
    expect(report.subject.tools.esbuild).not.toBe('unavailable')
    expect(report.subject.tools.zlib).toBe(process.versions.zlib)
    expect(report.subject.resolvedBuildOptions.root).toMatch(/packages\/web-rpc$/)
    expect(repeat.subject.digest).toBe(report.subject.digest)
    expect(repeat.tuple).toEqual(report.tuple)
    expect(repeat.subject.emitted.bundleSha256).toBe(report.subject.emitted.bundleSha256)
    expect(repeat.subject.emitted.modules).toEqual(report.subject.emitted.modules)
    expect(packageInvocation.subject.digest).toBe(report.subject.digest)
    expect(packageInvocation.tuple).toEqual(report.tuple)
    expect(packageInvocation.subject.emitted.bundleSha256).toBe(report.subject.emitted.bundleSha256)
    expect(packageInvocation.subject.emitted.modules).toEqual(report.subject.emitted.modules)
    expect(JSON.stringify(report.subject.resolvedBuildOptions)).toContain(
      '[ephemeral:webSocketToken]'
    )
    expect(
      digestProvenanceSubject({ ...subjectWithoutDigest, outputOptions: { minify: true } })
    ).not.toBe(digest)

    const tokenOnlySubject = {
      ...subjectWithoutDigest,
      resolvedBuildOptions: {
        ...subjectWithoutDigest.resolvedBuildOptions,
        webSocketToken: '[ephemeral:webSocketToken]'
      }
    }
    expect(digestProvenanceSubject(tokenOnlySubject)).toBe(digest)
    expect(repeat.tuple).toEqual(report.tuple)
    expect(repeat.subject.emitted.bundleSha256).toBe(report.subject.emitted.bundleSha256)
    expect(repeat.subject.emitted.modules).toEqual(report.subject.emitted.modules)
    expect(
      digestProvenanceSubject({
        ...tokenOnlySubject,
        resolvedBuildOptions: {
          ...tokenOnlySubject.resolvedBuildOptions,
          server: { webSocketToken: 'output-affecting' }
        }
      })
    ).not.toBe(digest)

    const firstResolved = await resolveCanonicalBuildConfig()
    const secondResolved = await resolveCanonicalBuildConfig()
    expect(firstResolved.webSocketToken).toBeDefined()
    expect(secondResolved.webSocketToken).toBeDefined()
  })

  it('encodes hostile values, references, and collisions without locale-dependent ambiguity', () => {
    const cycle: IRecursiveFixture = {}
    cycle.self = cycle
    expect(canonicalJson(cycle)).toBe(
      '["object","n0",[["self",true,true,true,["reference","n0"]]]]'
    )
    expect(canonicalJson({ kept: undefined })).not.toBe(canonicalJson({}))
    expect(canonicalJson({ kept: NaN })).not.toBe(canonicalJson({ kept: null }))
    expect(() => canonicalJson({ kept: () => 1 })).toThrowError(TypeError)
    expect(canonicalJson({ kept: -0 })).not.toBe(canonicalJson({ kept: 0 }))
    expect(canonicalJson({ left: 'a,b', right: 'c=d' })).not.toBe(
      canonicalJson({ left: 'a', right: 'b,c=d' })
    )
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }))
    expect(canonicalJson({ values: [1, undefined, NaN] })).not.toBe(
      canonicalJson({ values: [1, null, null] })
    )
  })

  it('rejects unsupported, invalid, accessor, and hostile values without reading getters', () => {
    let getterReads = 0
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterReads += 1
        return 'secret'
      }
    })
    const hostile = new Proxy(
      { secret: 'hidden' },
      {
        get() {
          getterReads += 1
          throw new Error('getter-fired')
        }
      }
    )
    for (const value of [
      accessor,
      hostile,
      new Date(Number.NaN),
      new URL('https://example.test')
    ]) {
      expect(() => canonicalJson(value)).toThrowError(TypeError)
    }
    expect(getterReads).toBe(0)
    expect(() => canonicalJson(() => 1)).toThrowError(TypeError)
    expect(() => canonicalJson(Symbol('value'))).toThrowError(TypeError)
    const foreignDate = runInNewContext('new Date(0)') as Date
    expect(() => canonicalJson(foreignDate)).toThrowError(TypeError)
  })

  it('distinguishes host types, sparse arrays, order, and reference topology', () => {
    const shared = { value: 1 }
    const sharedGraph = { left: shared, right: shared }
    const duplicatedGraph = { left: { value: 1 }, right: { value: 1 } }
    expect(canonicalJson(sharedGraph)).not.toBe(canonicalJson(duplicatedGraph))
    expect(
      canonicalJson(
        new Map([
          ['a', 1],
          ['b', 2]
        ])
      )
    ).not.toBe(
      canonicalJson(
        new Map([
          ['b', 2],
          ['a', 1]
        ])
      )
    )
    expect(canonicalJson(new Set(['a', 'b']))).not.toBe(canonicalJson(new Set(['b', 'a'])))
    const sparse: unknown[] = []
    sparse.length = 1
    expect(canonicalJson([undefined])).not.toBe(canonicalJson(sparse))
    expect(canonicalJson(new Uint8Array([1, 2]))).not.toBe(canonicalJson(new Uint16Array([513])))
    expect(canonicalJson(new DataView(new Uint8Array([1, 2]).buffer))).not.toBe(
      canonicalJson(new Uint8Array([1, 2]))
    )
    expect(canonicalJson(new Date(0))).not.toBe(canonicalJson(new RegExp('1970')))
  })

  it('preserves backing-buffer aliases, view slices, built-in descriptors, and cross-container cycles', () => {
    const sharedBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const sharedViews = {
      first: new Uint8Array(sharedBuffer, 1, 2),
      second: new Uint8Array(sharedBuffer, 1, 2)
    }
    const distinctViews = {
      first: new Uint8Array(new Uint8Array([1, 2, 3]).buffer, 1, 2),
      second: new Uint8Array(new Uint8Array([1, 2, 3]).buffer, 1, 2)
    }
    expect(canonicalJson(sharedViews)).not.toBe(canonicalJson(distinctViews))

    const slicedView = new DataView(new Uint8Array([9, 1, 2, 9]).buffer, 1, 2)
    const equalBytesDifferentSlice = new DataView(new Uint8Array([1, 2]).buffer, 0, 2)
    expect(canonicalJson(slicedView)).not.toBe(canonicalJson(equalBytesDifferentSlice))

    const descriptorValues = [
      new Date(0),
      /value/g,
      new Map([['key', 'value']]),
      new Set(['value']),
      new ArrayBuffer(2),
      new DataView(new ArrayBuffer(2)),
      new Uint8Array(2)
    ]
    const descriptorVariant = (value: object): object => {
      Object.defineProperty(value, 'tag', {
        configurable: false,
        enumerable: true,
        value: 'custom',
        writable: false
      })
      return value
    }
    for (const value of descriptorValues) {
      const baseline = canonicalJson(value)
      expect(canonicalJson(descriptorVariant(value))).not.toBe(baseline)
    }

    const cycleBuffer = new ArrayBuffer(1)
    const cycleView = new Uint8Array(cycleBuffer)
    Object.defineProperty(cycleBuffer, 'peer', {
      configurable: true,
      enumerable: true,
      value: cycleView,
      writable: true
    })
    Object.defineProperty(cycleView, 'peer', {
      configurable: true,
      enumerable: true,
      value: cycleBuffer,
      writable: true
    })
    expect(
      canonicalJson({ map: new Map([['buffer', cycleBuffer]]), set: new Set([cycleView]) })
    ).toContain('["reference"')

    const crossContainerShared = new ArrayBuffer(1)
    const crossContainerDistinct = new ArrayBuffer(1)
    expect(
      canonicalJson({
        map: new Map([['buffer', crossContainerShared]]),
        set: new Set([crossContainerShared])
      })
    ).not.toBe(
      canonicalJson({
        map: new Map([['buffer', crossContainerDistinct]]),
        set: new Set([new ArrayBuffer(1)])
      })
    )
  })

  it('rejects bare, malformed, forged, stale, tuple-mismatched, and digest-mismatched approval', () => {
    const report = readProvenance()
    const options = {
      oldTuple: { moduleCount: 53, rawBytes: 250129, gzipBytes: 61171 },
      newTuple: report.tuple
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const authority = {
      schema: 'WRC-C-B11-approval-v2',
      algorithm: 'ed25519',
      authorityId: 'web-rpc-release-coordinator-v1',
      keyId: 'coordinator-key-2026-01',
      decisionId: 'WRC-C-B11-decision-20260824-01',
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      payloadDigest: report.subject.digest
    }
    const payload = {
      schema: 'WRC-C-B11-approval-v2',
      authorityId: authority.authorityId,
      keyId: authority.keyId,
      decisionId: authority.decisionId,
      issuedAt: '2026-08-24T12:00:00.000Z',
      rationale: 'Durable external review approved measured retained-size drift.',
      oldTuple: options.oldTuple,
      newTuple: options.newTuple,
      digest: report.subject.digest
    }
    const validRecord = {
      ...payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
      payload
    }
    const authorizedOptions = { ...options, authority }
    expect(validateAuthorization({ status: 'approved' }, report.subject, options)).toBeTruthy()
    expect(
      validateAuthorization({ status: 'approved', approvalRecord: {} }, report.subject, options)
    ).toBeTruthy()
    expect(
      validateAuthorization(
        { status: 'approved', approvalRecord: { ...validRecord, authorityId: 'forged-authority' } },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
    expect(
      validateAuthorization(
        {
          status: 'approved',
          approvalRecord: { ...validRecord, decisionId: 'WRC-C-B11-old-decision' }
        },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
    expect(
      validateAuthorization(
        { status: 'approved', approvalRecord: { ...validRecord, digest: '0'.repeat(64) } },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
    expect(
      validateAuthorization(
        {
          status: 'approved',
          approvalRecord: {
            ...validRecord,
            newTuple: { ...report.tuple, rawBytes: report.tuple.rawBytes + 1 }
          }
        },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
    expect(
      validateAuthorization(
        { status: 'approved', approvalRecord: validRecord },
        report.subject,
        authorizedOptions
      )
    ).toBeNull()
    for (const altered of [
      { authorityId: 'WEB-RPC-RELEASE-COORDINATOR-V1' },
      { authorityId: ' web-rpc-release-coordinator-v1' },
      { keyId: 'COORDINATOR-KEY-2026-01' },
      { keyId: 'coordinator-key-2026-01 ' },
      { decisionId: 'wrc-c-b11-decision-20260824-01' },
      { issuedAt: ' 2026-08-24T12:00:00.000Z' }
    ]) {
      expect(
        validateAuthorization(
          { status: 'approved', approvalRecord: { ...validRecord, ...altered } },
          report.subject,
          authorizedOptions
        )
      ).toBeTruthy()
    }
    expect(
      validateAuthorization(
        { status: 'approved', approvalRecord: { ...validRecord, signature: 'Zm9yZ2Vk' } },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
    expect(
      validateAuthorization(
        {
          status: 'approved',
          approvalRecord: { ...validRecord, payload: { ...payload, digest: '0'.repeat(64) } }
        },
        report.subject,
        authorizedOptions
      )
    ).toBeTruthy()
  })
})
