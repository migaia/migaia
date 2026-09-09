import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalJson,
  digestProvenanceSubject,
  validateAuthorization
} from '../tree-shaking-authorization.mjs'

/** Stable approval schema consumed by the production authorization validator. */
const approvalSchema = 'WRC-C-B11-approval-v2'
/** Published RFC8032 seed used only by the no-secret fixture rehearsal. */
const fixtureSeed = Buffer.from(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  'hex'
)
/** Published RFC8032 public key corresponding to the fixture seed. */
const fixturePublicBytes = Buffer.from(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  'hex'
)
/** Fixture-only private key reconstructed from the published RFC8032 seed. */
const fixturePrivateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), fixtureSeed]),
  format: 'der',
  type: 'pkcs8'
})
/** Fixture-only public key used to verify the published RFC8032 signature. */
const fixturePublicKey = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), fixturePublicBytes]),
  format: 'der',
  type: 'spki'
})
/** Exact installed filenames owned by this bounded delivery rehearsal. */
const targetNames = ['current-delivery-authority.json', 'current-delivery-approval.json']
/** Exact temporary filenames used for the two exclusive stage writes. */
const stageNames = [
  '.current-delivery-authority.v21.stage.json',
  '.current-delivery-approval.v21.stage.json'
]
/** Hard operation ceilings that make this helper fail-stop and auditable. */
const operationMaxima = { writes: 2, renames: 2, unlinks: 0, rollbacks: 0, retries: 0 }

/**
 * Returns the SHA-256 digest used by byte-level custody checks.
 *
 * @param {Buffer} bytes Bytes whose exact contents are hashed.
 * @returns {string} Lowercase hexadecimal SHA-256 digest.
 */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Serializes JSON through one structured writer and proves a real-LF byte round trip.
 *
 * @param {unknown} value Structured value to serialize.
 * @returns {Buffer} Canonical UTF-8 JSON bytes ending in one real LF.
 * @throws {TypeError} If the serialized bytes fail the structured-byte contract.
 */
export function serializeStructured(value) {
  /** Canonical structured bytes produced by the single serializer owner. */
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return parseStructured(bytes)
}

/**
 * Parses structured bytes while rejecting escaped trailing newlines and byte drift.
 *
 * @param {Buffer} bytes Serialized bytes to validate.
 * @returns {Buffer} The original bytes after validation.
 * @throws {TypeError | SyntaxError} If line termination, JSON, or byte round-trip validation fails.
 */
export function parseStructured(bytes) {
  if (bytes.at(-1) !== 0x0a || bytes.subarray(-2).equals(Buffer.from('\\n'))) {
    throw new TypeError('structured JSON requires one real LF')
  }
  /** Parsed value used to prove canonical serialization is byte-stable. */
  const value = JSON.parse(bytes.toString('utf8'))
  /** Re-serialized bytes compared against the supplied representation. */
  const roundTrip = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  if (!roundTrip.equals(bytes)) throw new TypeError('structured JSON byte round trip changed')
  return bytes
}

/**
 * Builds the public RFC8032 vector and production-valid nine-field approval payload.
 *
 * @param {{
 *   signingCanonicalizer?: (value: object) => string
 *   subjectBody?: object
 *   oldTuple?: object
 *   newTuple?: object
 * }} [options]
 *   Fixture inputs and optional alternate canonicalizer.
 * @returns {{
 *   approval: object
 *   authority: object
 *   oldTuple: object
 *   newTuple: object
 *   subject: object
 * }}
 *   Fixture authorization and its bound subject/tuples.
 */
export function createFixtureAuthorization({
  signingCanonicalizer = canonicalJson,
  subjectBody = { fixture: 'rpcc-v21', sequence: 1 },
  oldTuple = { moduleCount: 1, rawBytes: 2, gzipBytes: 3 },
  newTuple = { moduleCount: 4, rawBytes: 5, gzipBytes: 6 }
} = {}) {
  /** Subject digest bound into the signed authorization payload. */
  const digest = digestProvenanceSubject(subjectBody)
  /** Exact nine-field payload signed by the published fixture key. */
  const payload = {
    schema: approvalSchema,
    authorityId: 'fixture-authority',
    keyId: 'rfc8032-test-vector',
    decisionId: 'WRC-C-B11-RPCC-V21-PREFLIGHT',
    issuedAt: '2026-09-02T00:00:00.000Z',
    rationale: 'Public no-secret writer and verifier rehearsal.',
    oldTuple,
    newTuple,
    digest
  }
  /** RFC8032 signature over the selected canonical payload bytes. */
  const signature = sign(
    null,
    Buffer.from(signingCanonicalizer(payload)),
    fixturePrivateKey
  ).toString('base64')
  /** Authority record consumed by the production validator. */
  const authority = {
    schema: approvalSchema,
    algorithm: 'ed25519',
    authorityId: payload.authorityId,
    keyId: payload.keyId,
    publicKeyPem: fixturePublicKey.export({ format: 'pem', type: 'spki' }).toString(),
    decisionId: payload.decisionId,
    payloadDigest: digest,
    status: 'approved',
    reason: payload.rationale
  }
  /** Approval record containing the signed payload and signature. */
  const approval = {
    status: 'approved',
    approvalRecord: { ...payload, signature, payload }
  }
  return {
    approval,
    authority,
    oldTuple,
    newTuple,
    subject: { ...subjectBody, digest }
  }
}

/**
 * Runs the production validator against the fixture without generating a key.
 *
 * @param {{
 *   approval: object
 *   authority: object
 *   oldTuple: object
 *   newTuple: object
 *   subject: object
 * }} [fixture]
 *   Fixture authorization to validate.
 * @returns {string | null} Validator error text, or null when the authorization is valid.
 */
export function verifyFixtureAuthorization(fixture = createFixtureAuthorization()) {
  return validateAuthorization(fixture.approval, fixture.subject, {
    authority: fixture.authority,
    oldTuple: fixture.oldTuple,
    newTuple: fixture.newTuple
  })
}

/**
 * Reads exact bytes and reports whether each supplied custody hash still matches.
 *
 * @param {Record<string, string>} targets Absolute paths and expected SHA-256 digests.
 * @returns {Record<string, { bytes: Buffer; sha256: string; matches: boolean }>} Actual bytes and
 *   custody results.
 */
export function readExpectedHashes(targets) {
  return Object.fromEntries(
    Object.entries(targets).map(([path, expected]) => {
      const bytes = readFileSync(path)
      const digest = sha256(bytes)
      return [path, { bytes, sha256: digest, matches: digest === expected }]
    })
  )
}

/** Returns true only for an existing regular non-symlink path. */
function isRegularFile(path) {
  try {
    /** Unfollowed filesystem metadata used to reject symlink targets. */
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** Writes one stage with O_EXCL and records only the bounded write operation. */
function writeExclusive(path, bytes, ledger, shortWrite = false) {
  /** Exclusive descriptor preventing replacement of an existing stage. */
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    /** Full or intentionally truncated output used by the hostile short-write oracle. */
    const output = shortWrite ? bytes.subarray(0, Math.max(1, bytes.length >> 1)) : bytes
    writeSync(descriptor, output)
    ledger.writes += 1
  } finally {
    closeSync(descriptor)
  }
}

/** Authenticates both serialized artifacts through the production validator. */
function verifyPair(authorityBytes, approvalBytes, { subject, oldTuple, newTuple }) {
  try {
    /** Parsed authority record passed to the production validator. */
    const authority = JSON.parse(parseStructured(authorityBytes).toString('utf8'))
    /** Parsed approval record passed to the production validator. */
    const approval = JSON.parse(parseStructured(approvalBytes).toString('utf8'))
    if (authority.status !== 'approved' || approval.status !== 'approved') return false
    return (
      validateAuthorization(approval, subject, {
        authority,
        oldTuple,
        newTuple
      }) === null
    )
  } catch {
    return false
  }
}

/** Returns true only when lstat proves that a stage path is absent; all other outcomes are unsafe. */
function isAbsentPath(path) {
  try {
    lstatSync(path)
    return false
  } catch (error) {
    /** Filesystem error retained to distinguish proven absence from an unknown path state. */
    return error?.code === 'ENOENT'
  }
}

/** Returns exact hash equality for the two transaction targets. */
function targetHashes(root) {
  return Object.fromEntries(
    targetNames.map((name) => [name, sha256(readFileSync(join(root, name)))])
  )
}

/**
 * Compares a temporary root against a two-target hash tuple without mutation.
 *
 * @param {string} root Existing transaction root.
 * @param {Record<string, string>} expected Expected hashes keyed by target filename.
 * @returns {boolean} True only when root, both regular targets, and both hashes match.
 */
function hashesMatch(root, expected) {
  if (!isDirectory(root)) return false
  if (!targetNames.every((name) => isRegularFile(join(root, name)))) return false
  /** Current target hashes read only after structural path checks pass. */
  const hashes = targetHashes(root)
  return targetNames.every((name) => hashes[name] === expected[name])
}

/** Stops before the first write when a target or stage precondition is not provable. */
function checkPreconditions(root, oldHashes) {
  if (!isDirectory(root)) return 'invalid root path'
  if (!targetNames.every((name) => isRegularFile(join(root, name)))) {
    return 'target path is missing or not a regular non-symlink file'
  }
  if (!hashesMatch(root, oldHashes)) return 'prehash drift'
  if (stageNames.some((name) => !isAbsentPath(join(root, name)))) return 'existing stage'
  return null
}

/** Returns true only when a path is an existing non-symlink directory. */
function isDirectory(path) {
  try {
    /** Unfollowed root metadata used to reject symlink directories. */
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Executes D28's bounded transaction and fails closed after each allowed operation. The caller must
 * establish one quiescent writer and no consumer use before any future live invocation; this helper
 * does not provide process isolation.
 *
 * @param {string} root Existing non-symlink directory containing both target files.
 * @param {{
 *   authorityBytes: Buffer
 *   approvalBytes: Buffer
 *   subject: object
 *   oldTuple: object
 *   newTuple: object
 *   expectedOldHashes: Record<string, string>
 *   faultAt?: string | null
 *   shortWriteAt?: string | null
 * }} [options]
 *   Serialized authorization and exact precondition tuple.
 * @returns {object} Bounded operation result, ledger, maxima, and installed hashes when available.
 */
export function runBoundedTransaction(
  root,
  {
    authorityBytes,
    approvalBytes,
    subject,
    oldTuple,
    newTuple,
    expectedOldHashes,
    faultAt = null,
    shortWriteAt = null
  } = {}
) {
  /** Mutable audit ledger for the only operations this helper permits. */
  const ledger = { writes: 0, renames: 0, unlinks: 0, rollbacks: 0, retries: 0 }
  /** Precondition failure reason, if any, determined before the first write. */
  const precondition = expectedOldHashes
    ? checkPreconditions(root, expectedOldHashes)
    : 'expected old hashes required'
  if (precondition) {
    return { status: 'STOP', reason: precondition, ledger, maxima: operationMaxima }
  }
  /** Exact old target hashes reused for every later tuple recheck. */
  const oldHashes = expectedOldHashes
  if (
    !Buffer.isBuffer(authorityBytes) ||
    !Buffer.isBuffer(approvalBytes) ||
    !subject ||
    !oldTuple ||
    !newTuple ||
    !verifyPair(authorityBytes, approvalBytes, { subject, oldTuple, newTuple })
  ) {
    return {
      status: 'STOP',
      reason: 'authorization input invalid',
      ledger,
      maxima: operationMaxima
    }
  }
  writeExclusive(join(root, stageNames[0]), authorityBytes, ledger)
  if (faultAt === 'after-first-write') {
    return { status: 'STOP', reason: 'after-first-write', ledger, maxima: operationMaxima }
  }
  writeExclusive(join(root, stageNames[1]), approvalBytes, ledger, shortWriteAt === 'second')
  if (shortWriteAt === 'second') {
    return {
      status: 'STOP',
      reason: 'short-second-write',
      ledger,
      maxima: operationMaxima
    }
  }
  if (
    !verifyPair(readFileSync(join(root, stageNames[0])), readFileSync(join(root, stageNames[1])), {
      subject,
      oldTuple,
      newTuple
    })
  ) {
    return {
      status: 'STOP',
      reason: 'staged authorization invalid',
      ledger,
      maxima: operationMaxima
    }
  }
  if (!hashesMatch(root, oldHashes)) {
    return {
      status: 'STOP',
      reason: 'prehash drift before first rename',
      ledger,
      maxima: operationMaxima
    }
  }
  renameSync(join(root, stageNames[0]), join(root, targetNames[0]))
  ledger.renames += 1
  if (faultAt === 'after-first-rename') {
    return {
      status: 'STOP',
      reason: 'after-first-rename',
      ledger,
      maxima: operationMaxima
    }
  }
  /** Expected mixed tuple after the first ordered rename and before the second. */
  const mixedHashes = { ...oldHashes, [targetNames[0]]: sha256(authorityBytes) }
  if (!hashesMatch(root, mixedHashes)) {
    return {
      status: 'STOP',
      reason: 'tuple drift before second rename',
      ledger,
      maxima: operationMaxima
    }
  }
  renameSync(join(root, stageNames[1]), join(root, targetNames[1]))
  ledger.renames += 1
  /** Final installed-pair validation through the production validator. */
  const installed = verifyPair(
    readFileSync(join(root, targetNames[0])),
    readFileSync(join(root, targetNames[1])),
    { subject, oldTuple, newTuple }
  )
  return {
    status: installed ? 'PASS' : 'STOP',
    reason: installed ? null : 'installed authorization invalid',
    ledger,
    maxima: operationMaxima,
    installedHashes: targetHashes(root)
  }
}

/**
 * Delegates public fixture material through the single bounded transaction owner.
 *
 * @param {string} root Existing transaction root.
 * @param {{
 *   expectedOldHashes: Record<string, string>
 *   faultAt?: string | null
 *   shortWriteAt?: string | null
 *   fixture?: object
 * }} [options]
 *   Fixture and bounded fault controls.
 * @returns {object} The bounded transaction result.
 */
export function runFixtureTransaction(
  root,
  {
    expectedOldHashes,
    faultAt = null,
    shortWriteAt = null,
    fixture = createFixtureAuthorization()
  } = {}
) {
  /** Serialized fixture bytes are handed to the same bounded owner as future callers. */
  const authorityBytes = serializeStructured(fixture.authority)
  /** Serialized approval bytes are handed to the same bounded owner as future callers. */
  const approvalBytes = serializeStructured(fixture.approval)
  return runBoundedTransaction(root, {
    authorityBytes,
    approvalBytes,
    subject: fixture.subject,
    oldTuple: fixture.oldTuple,
    newTuple: fixture.newTuple,
    expectedOldHashes,
    faultAt,
    shortWriteAt
  })
}

/**
 * Runs fixture mode while proving protected repository bytes remain unchanged.
 *
 * @param {string} root Existing transaction root.
 * @param {Record<string, string>} protectedTargets Protected paths and expected hashes.
 * @param {object} [options] Options forwarded to the fixture transaction.
 * @returns {object} Transaction result plus before/after protected custody evidence.
 */
export function runFixturePreflight(root, protectedTargets, options = {}) {
  /** Protected custody snapshot captured before any fixture operation. */
  const before = readExpectedHashes(protectedTargets)
  /** Bounded transaction result from the single publication owner. */
  const result = runFixtureTransaction(root, options)
  /** Protected custody snapshot captured after the fixture operation. */
  const after = readExpectedHashes(protectedTargets)
  return {
    ...result,
    noSecret: true,
    keyGeneration: false,
    protectedUnchanged: Object.keys(before).every(
      (path) =>
        before[path].matches && after[path].matches && before[path].sha256 === after[path].sha256
    ),
    protectedBefore: before,
    protectedAfter: after
  }
}

export { canonicalJson, validateAuthorization }
