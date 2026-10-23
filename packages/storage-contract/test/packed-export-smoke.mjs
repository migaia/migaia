import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package whose public adapter and real dependencies are packed for isolated consumption. */
const contractDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Actual dependency closure includes serialize and its neutral lifecycle/utils dependencies. */
const packageDirectories = ['utils', 'lifecycle', 'serialize', 'storage-contract'].map((name) =>
  resolve(contractDirectory, '..', name)
)
/** Consumer resolves only extracted package tarballs, never workspace source or dist paths. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-contract-packed-'))

/**
 * Packs the real dependency closure and verifies public codec composition plus canonical byte
 * ownership.
 *
 * @returns {void} Completes when the isolated Node consumer exits successfully.
 * @throws {Error} When packing, package extraction, dependency wiring or consumer assertions fail.
 */
function main() {
  try {
    /** Tarballs and extracted packages stay in a private disposable consumer workspace. */
    const packDirectory = join(smokeDirectory, 'pack')
    /** Package extraction preserves normal package-root resolution. */
    const extractDirectory = join(smokeDirectory, 'extract')
    /** The consumer contains only a module marker, fixture and published-package links. */
    const consumerDirectory = join(smokeDirectory, 'consumer')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true })
    for (const directory of packageDirectories)
      execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd: directory,
        stdio: 'inherit'
      })
    /** Every input package must produce exactly one real tarball. */
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== packageDirectories.length)
      throw new Error(`Expected ${packageDirectories.length} tarballs, found ${tarballs.length}`)
    /** Extracted names are used only to wire each package's declared runtime dependencies. */
    const extracted = new Map()
    for (const directory of packageDirectories) {
      /** Package identity comes from its own metadata rather than a guessed tarball version. */
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      /** Pnpm replaces the scoped slash with a hyphen in packed archive names. */
      const prefix = metadata.name.replace('@', '').replace('/', '-') + '-'
      /** All four known names are distinct, so this lookup is bounded by the fixed closure. */
      const tarball = tarballs.find((entry) => entry.startsWith(prefix))
      if (!tarball) throw new Error(`Missing expected tarball for ${metadata.name}`)
      /** Each archive gets its own normal package root. */
      const target = join(extractDirectory, metadata.name.split('/')[1])
      mkdirSync(target, { recursive: true })
      execFileSync('tar', ['-xzf', join(packDirectory, tarball), '-C', target])
      extracted.set(metadata.name, join(target, 'package'))
    }
    for (const [name, directory] of extracted) {
      symlinkSync(directory, join(consumerDirectory, 'node_modules', name), 'dir')
      /** Wire only actual declared runtime dependencies after Node resolves each package realpath. */
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      for (const dependency of Object.keys(metadata.dependencies ?? {})) {
        /** Optional codec peers are not used by the public JSON composition being exercised. */
        const target = extracted.get(dependency)
        if (!target) throw new Error(`Unpacked runtime dependency ${dependency} of ${name}`)
        mkdirSync(join(directory, 'node_modules', '@migaia'), { recursive: true })
        symlinkSync(target, join(directory, 'node_modules', dependency), 'dir')
      }
    }
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'identity.mjs'),
      `import { fromValueCodec, defineStorageCapability, implement, provideCapabilities, hasStorageCapability, useStorageCapability, sql, createSqlTag, deriveStorageSqlQuery, blob, snapshotStorageBlobPut, snapshotStorageBlobGet, snapshotStorageBlobList, createStorageBlobObject, durableChangeFeed, orderStorageKeysByBytes, encodeStorageOrgStringPrefix, encodeOrderedStorageKey, decodeOrderedStorageKey, prefixStorageOrgKey, sparql, sparqlFragment, createSparqlTag, term, rdf, vector, DeleteCountMode, createStorageIteratorLifetime, createRecordQuery } from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { isArrayBuffer as utilsBuffer, isUint8Array as utilsBytes } from '@migaia/utils/bytes'
/** Independent resource bases exercise package-root capability reads without acquiring external clients. */
const createBase = () => ({
  backend: 'packed-fixture',
  capabilities: { syncRead: false, binary: false, records: false, transactions: false, iteration: false, secondaryIndexes: false, changeFeed: false, maxValueBytes: undefined, opaqueEntries: false },
  dispose: async () => undefined,
  [Symbol.asyncDispose]: async () => undefined
})
/** Authentic root exports retain the same original API after normal package extraction. */
const token = defineStorageCapability()('packed-read')
/** API identity proves both lookup paths share the original provider installation. */
const api = { read: () => 'packed' }
/** Provider setup exists only to exercise the actual package entry and identity contract. */
const store = provideCapabilities(createBase(), [implement(token, api)])
if (!hasStorageCapability(store, token) || useStorageCapability(store, token) !== store.use(token) || useStorageCapability(store, token) !== api) throw new Error('packed capability root export mismatch')
/** A frozen unprovided base must remain unmodified and report the same missing capability code. */
const raw = Object.freeze(createBase())
if (hasStorageCapability(raw, token) || Object.hasOwn(raw, 'use')) throw new Error('raw capability read mutated the base')
/** The real package-root error remains the declared unsupported failure rather than a missing export. */
let missing
try { useStorageCapability(raw, token) } catch (error) { missing = error }
if (missing?.source !== '@migaia/storage-contract' || missing.code !== 'UNSUPPORTED_CAPABILITY' || missing.backend !== 'packed-fixture' || Object.hasOwn(raw, 'use')) throw new Error('packed missing capability identity mismatch')
/** Admission callbacks fail if a token lookup unexpectedly performs native work. */
const noAdmissionIo = () => { throw new Error('capability admission performed I/O') }
/** Packed RDF/vector publication preserves exact native APIs without generic vector transactions. */
const vectorApi = { collection: noAdmissionIo }
const rdfApi = { add: noAdmissionIo, delete: noAdmissionIo, match: noAdmissionIo }
const semanticStore = provideCapabilities(createBase(), [implement(vector, vectorApi), implement(rdf, rdfApi)])
if (semanticStore.use(vector) !== vectorApi || semanticStore.use(rdf) !== rdfApi || DeleteCountMode.scroll !== 'scroll') throw new Error('packed semantic capability mismatch')
/** Packed native SPARQL keeps callable capability and pure fragment identities together. */
const preparedSparql = []
const sparqlApi = createSparqlTag({ select: async () => [], ask: prepare => { preparedSparql.push(prepare()); return Promise.resolve(true) }, construct: async () => [], update: async () => undefined })
const sparqlStore = provideCapabilities(createBase(), [implement(sparql, sparqlApi)])
const sparqlTemplate = Object.freeze(Object.assign(['ASK { ', ' }'], { raw: Object.freeze(['ASK { ', ' }']) }))
const pureTemplate = Object.freeze(Object.assign(['', ''], { raw: Object.freeze(['', '']) }))
const pureSparql = sparqlFragment(pureTemplate, term.literal('text'))
if (sparqlStore.use(sparql) !== sparqlApi || 'ask' in pureSparql || !(await sparqlApi(sparqlTemplate, pureSparql).ask()) || preparedSparql.length !== 1 || !preparedSparql[0].startsWith('ASK { ')) throw new Error('packed SPARQL native binding mismatch')
/** The packed-root author entry reuses one original cursor lifetime and cached main cleanup. */
let cursorClosed = 0
const cursorLifetime = createStorageIteratorLifetime({ close: async () => { cursorClosed++ }, report: console.error })
if ((await cursorLifetime.advance(async () => ({ done: false, value: 7 }))).value !== 7) throw new Error('packed cursor advance mismatch')
const cursorCleanup = cursorLifetime.dispose()
if (cursorCleanup !== cursorLifetime.dispose()) throw new Error('packed cursor cleanup Promise mismatch')
await cursorCleanup
await cursorLifetime.symbolic()
if (cursorClosed !== 1) throw new Error('packed cursor close count mismatch')
/** Query mutation dispatch reaches an actual packed-root draft without a root read fallback. */
const queryDraft = new Map([['a', { state: 'old' }], ['b', { state: 'keep' }]])
const queryMutation = createRecordQuery({
  pushdown: { source: 'packed-draft', operators: [], operations: [] },
  execute: noAdmissionIo,
  mutate: (request, run) => run({
    execute: () => {
      const entries = queryDraft.entries()
      const lifetime = createStorageIteratorLifetime({ close: async () => undefined, report: console.error })
      return { next: () => lifetime.advance(async () => entries.next()), dispose: lifetime.dispose, return: lifetime.returned, [Symbol.asyncDispose]: lifetime.symbolic, [Symbol.asyncIterator]() { return this } }
    },
    accept: key => queryDraft.delete(key)
  })
})
if (await queryMutation.where(row => row.state === 'old').delete() !== 1 || queryDraft.size !== 1 || !queryDraft.has('b')) throw new Error('packed query mutation mismatch')
/** Both organization byte helpers reuse canonical packed-root identities. */
const packedOrg = '12345678-1234-1234-1234-123456789abc'
const packedPrefix = encodeStorageOrgStringPrefix(packedOrg, 'a', 'packed-fixture')
const packedFullKey = encodeOrderedStorageKey(prefixStorageOrgKey(packedOrg, 'ab'), 'packed-fixture')
if (packedPrefix.some((byte, index) => byte !== packedFullKey[index])) throw new Error('packed organization prefix mismatch')
if (orderStorageKeysByBytes([2, 1], key => new Uint8Array([key])).join(',') !== '1,2') throw new Error('packed byte ordering mismatch')
/** Optional object/feed tokens expose only their own original native APIs after packing. */
const objectApi = { put: noAdmissionIo, get: noAdmissionIo, head: noAdmissionIo, remove: noAdmissionIo, list: noAdmissionIo, removeByPrefix: noAdmissionIo }
const feedApi = { readChanges: noAdmissionIo, tailChanges: noAdmissionIo }
const optionalStore = provideCapabilities(createBase(), [implement(blob, objectApi), implement(durableChangeFeed, feedApi)])
if (optionalStore.use(blob) !== objectApi || optionalStore.use(durableChangeFeed) !== feedApi || 'get' in optionalStore) throw new Error('packed independent capability mismatch')
/** Blob author helpers retain real input snapshots and original resource cleanup after packing. */
if (decodeOrderedStorageKey(encodeOrderedStorageKey('file', 'packed-fixture'), 'packed-fixture') !== 'file') throw new Error('packed ordered key reader mismatch')
const uploadBytes = new Uint8Array([3])
const upload = snapshotStorageBlobPut('file', uploadBytes, undefined, 'packed-fixture')
uploadBytes[0] = 9
if (upload.body[0] !== 3 || snapshotStorageBlobGet('file', { range: { start: 0, end: 0 } }, 'packed-fixture').options.range.end !== 0 || snapshotStorageBlobList(undefined, undefined, 'packed-fixture').limit !== 100) throw new Error('packed blob input mismatch')
let blobClosed = 0
const object = createStorageBlobObject({ key: 'file', size: 1, etag: 'native', updatedAt: 1, metadata: {} }, new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([3])); controller.close() } }), { close: async () => { blobClosed++ }, report: console.error })
if ((await object.bytes())[0] !== 3 || blobClosed !== 1) throw new Error('packed blob resource mismatch')
await object.dispose()
/** Standard SQL and derived terminals load through the same real packed package root. */
const sqlPromise = Promise.resolve([{ value: 1 }])
const nativeSql = createSqlTag({ dialect: 'sqlite', all: () => sqlPromise, get: async () => undefined, run: async () => ({ changes: 0 }) })
const sqlApi = { sql: nativeSql }
const sqlStore = provideCapabilities(createBase(), [implement(sql, sqlApi)])
if (sqlStore.use(sql) !== sqlApi) throw new Error('packed SQL capability identity mismatch')
const originalQuery = nativeSql\`SELECT 1\`
const derivedQuery = deriveStorageSqlQuery(originalQuery, { all: () => sqlPromise, get: async () => undefined, run: async () => ({ changes: 0 }) })
if (derivedQuery.all() !== sqlPromise || !Object.isFrozen(derivedQuery)) throw new Error('packed SQL terminal projection mismatch')
if (!utilsBuffer(new ArrayBuffer(1)) || !utilsBytes(new Uint8Array(1))) throw new Error('canonical byte owner mismatch')
const originalClone = globalThis.structuredClone
let cloneCalls = 0
globalThis.structuredClone = value => { cloneCalls += 1; return originalClone(value) }
const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))
let nested = { leaf: 'ok' }
for (let index = 0; index < 128; index += 1) nested = { next: nested }
const encoded = await codec.encode(nested)
if (cloneCalls !== 0 || !encoded.includes('"leaf":"ok"')) throw new Error('codec clone budget exceeded')
const restored = await codec.decode(await codec.encode(new Map([['roles', new Set(['read'])]])))
if (!(restored instanceof Map) || !(restored.get('roles') instanceof Set) || !restored.get('roles').has('read')) throw new Error('collection codec composition failed')
`,
      'utf8'
    )
    execFileSync(process.execPath, ['identity.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
