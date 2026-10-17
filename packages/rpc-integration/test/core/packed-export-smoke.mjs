import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { parseSync } from 'oxc-parser'

const integrationDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const repositoryRoot = resolve(integrationDirectory, '../..')
/** Canonical Core assertions and digest-pinned fixtures remain with their physical owner. */
const packageDirectory = join(repositoryRoot, 'packages/rpc-core')
/** Five lockstep artifacts are installed without an umbrella package. */
const rpcOwners = ['rpc-contract', 'rpc-core', 'rpc-process', 'rpc-threads', 'rpc-browser']
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-rpc-packed-'))
const extractDirectory = join(smokeDirectory, 'extract')
const consumerDirectory = join(smokeDirectory, 'consumer')
const packageDependencies = [
  'capability',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'plugin-host',
  'serialize',
  'supervision',
  'utils'
]
/** Resolve every declared public path from all five real packed manifests. */
const publicSubpaths = rpcOwners.flatMap((owner) => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'packages', owner, 'package.json'), 'utf8')
  )
  return Object.keys(manifest.exports).map((subpath) => `${manifest.name}${subpath.slice(1)}`)
})
/** Retired Core aliases still fail as unexported subpaths of an actually installed owner. */
const obsoleteSubpaths = [
  './browser',
  './memory',
  './message-port',
  './web-worker',
  './wire',
  './middleware/protocol',
  './middleware/chunk',
  './features/chunk',
  './internal/chunk-attachment'
]
/**
 * Packs rpc, resolves it from a clean consumer directory, and checks both every declared public
 * subpath and the removed legacy adapter paths.
 */
async function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(consumerDirectory, { recursive: true })
    const dependencyDirectory = join(extractDirectory, 'node_modules', '@migaia')
    const consumerDependencyDirectory = join(consumerDirectory, 'node_modules', '@migaia')
    mkdirSync(dependencyDirectory, { recursive: true })
    mkdirSync(consumerDependencyDirectory, { recursive: true })
    for (const owner of [...packageDependencies, ...rpcOwners]) {
      installPackedDependency(dependencyDirectory, owner)
      symlinkSync(join(dependencyDirectory, owner), join(consumerDependencyDirectory, owner), 'dir')
    }
    const packedPackages = Object.fromEntries(
      rpcOwners.map((owner) => [owner, join(dependencyDirectory, owner)])
    )
    const packedPackage = packedPackages['rpc-core']
    assertPackedOwnerManifests(packedPackages)
    console.log('CHECK five-packed-artifacts PASS')
    assertIdentityObserverDeclarationsHidden(packedPackage)
    console.log('CHECK identity-observer-hidden PASS')
    assertDefineFeatureDocumentation(packedPackage)
    console.log('CHECK define-feature-docs PASS')
    assertPackedCoreRuntimeHidden(consumerDirectory)
    console.log('CHECK composed-runtime-hidden PASS')
    assertPackedLegacyEnvelopeRejection(consumerDirectory)
    console.log('CHECK legacy-envelope-rejection PASS')
    assertPackedLegacyEnvelopePerturbation(
      consumerDirectory,
      join(packedPackages['rpc-contract'], 'dist/contract/v1/normalize.js')
    )
    console.log('CHECK contract-normalize PASS')
    const canonicalProtocolPath = join(packedPackage, 'dist/core/middleware/canonical-protocol.js')
    assertPackedLegacyCodecRejection(consumerDirectory, canonicalProtocolPath)
    console.log('CHECK legacy-codec-rejection PASS')
    assertPackedLegacyCodecPerturbation(consumerDirectory, canonicalProtocolPath)
    console.log('CHECK canonical-protocol PASS')
    assertPackedLegacyRootAliasPerturbation(packedPackage, consumerDirectory)
    console.log('CHECK root-entry PASS')
    assertPackedCanonicalFeatureRoutePerturbation(packedPackage, consumerDirectory)
    console.log('CHECK canonical-chunk PASS')
    await assertPackedSelectiveBrowserImport(
      consumerDirectory,
      packedPackage,
      packedPackages['rpc-contract']
    )
    console.log('CHECK selective-browser PASS')
    const consumerModule = join(consumerDirectory, 'smoke.mjs')
    const typeContract = join(consumerDirectory, 'type-contract.ts')
    const typeConfig = join(consumerDirectory, 'tsconfig.json')
    writeFileSync(
      typeContract,
      readFileSync(
        resolve(integrationDirectory, 'test/core/fixtures/packed/type-contract.ts'),
        'utf8'
      ),
      'utf8'
    )
    writeFileSync(
      typeConfig,
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2023',
          strict: true,
          skipLibCheck: true,
          noEmit: true
        },
        include: ['type-contract.ts']
      }),
      'utf8'
    )
    execFileSync(resolve(repositoryRoot, 'node_modules/.bin/tsc'), ['-p', typeConfig], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    })
    console.log('CHECK type-contract-tsc PASS')
    writeFileSync(consumerModule, createSmokeModule(), 'utf8')
    execFileSync(process.execPath, [consumerModule], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

/** Ensures the public `./core` subpath never leaks the unchecked composition implementation. */
function assertPackedCoreRuntimeHidden(consumerDirectory) {
  const probe = join(consumerDirectory, 'core-runtime-hidden.mjs')
  writeFileSync(
    probe,
    [
      "import * as core from '@migaia/rpc-core/composed'",
      "if ('createComposedEndpointRuntime' in core)",
      "  throw new Error('packed core exposed unchecked composition runtime')"
    ].join('\n'),
    'utf8'
  )
  execFileSync(process.execPath, [probe], { cwd: consumerDirectory, stdio: 'inherit' })
}

/** Rejects three retired WebRPC semantic shapes through the packed rpc-contract normalizer. */
function assertPackedLegacyEnvelopeRejection(
  consumerDirectory,
  kinds = ['request', 'chunk', 'variation']
) {
  const probe = join(consumerDirectory, 'legacy-envelope-probe.mjs')
  writeFileSync(
    probe,
    [
      "import { normalizeRpcEnvelope } from '@migaia/rpc-contract'",
      'const legacy = [',
      "  { kind: 'request', taskId: 'old-request', version: '1', data: null },",
      "  { kind: 'chunk', taskId: 'old-chunk', index: 0, total: 1, data: null },",
      "  { kind: 'variation', variation: 'abort', taskId: 'old-abort', senderId: 'a', targetId: 'b', data: null }",
      ']',
      'for (const value of legacy.filter((candidate) => process.argv[2] === candidate.kind)) {',
      '  try { normalizeRpcEnvelope(value) } catch (error) {',
      "    if (error?.code === 'INVALID_ENVELOPE') continue",
      '    throw error',
      '  }',
      "  throw new Error('Legacy envelope unexpectedly normalized: ' + value.kind)",
      '}'
    ].join('\n'),
    'utf8'
  )
  for (const kind of kinds)
    execFileSync(process.execPath, [probe, kind], { cwd: consumerDirectory, stdio: 'pipe' })
}

/** Makes only the packed normalizer accept retired shapes and requires the unchanged oracle to fail. */
function assertPackedLegacyEnvelopePerturbation(consumerDirectory, normalizerPath) {
  const original = readFileSync(normalizerPath, 'utf8')
  const target =
    "export function normalizeRpcEnvelope(value, options) {\n    const record = snapshotRpcRecord(value, '', RpcEnvelopeViolation.type);"
  const replacement = target.replace(
    '    const record =',
    "    if (value && typeof value === 'object' && ('taskId' in value || value.kind === 'chunk' || value.variation === 'abort')) return value;\n    const record ="
  )
  if (!original.includes(target))
    throw new Error('Packed rpc-contract normalizer mutation anchor is unavailable')
  try {
    writeFileSync(normalizerPath, original.replace(target, replacement), 'utf8')
    for (const kind of ['request', 'chunk', 'variation']) {
      let failed = false
      try {
        assertPackedLegacyEnvelopeRejection(consumerDirectory, [kind])
      } catch (error) {
        if (String(error.stderr ?? '').includes(`Legacy envelope unexpectedly normalized: ${kind}`))
          failed = true
        else throw error
      }
      if (!failed) throw new Error(`Legacy ${kind} oracle accepted the mutated packed normalizer`)
    }
  } finally {
    writeFileSync(normalizerPath, original, 'utf8')
  }
  assertPackedLegacyEnvelopeRejection(consumerDirectory)
}

/** Rejects the retired codec callback descriptor before either callback can be reached. */
function assertPackedLegacyCodecRejection(consumerDirectory, canonicalProtocolPath) {
  const probe = join(consumerDirectory, 'legacy-codec-probe.mjs')
  writeFileSync(
    probe,
    [
      `import { canonicalProtocol } from ${JSON.stringify(pathToFileURL(canonicalProtocolPath).href)}`,
      'let callbacks = 0',
      'const legacy = {',
      '  encode() { callbacks += 1; return undefined },',
      '  decode() { callbacks += 1; return undefined }',
      '}',
      'try {',
      '  canonicalProtocol(legacy)',
      "  throw new Error('Legacy codec configuration was accepted')",
      '} catch (error) {',
      "  if (error?.message === 'Legacy codec configuration was accepted') throw error",
      "  if (error?.code !== 'INVALID_CONFIG') throw error",
      "  if (callbacks !== 0) throw new Error('Legacy codec callbacks executed before rejection')",
      '}'
    ].join('\n'),
    'utf8'
  )
  execFileSync(process.execPath, [probe], { cwd: consumerDirectory, stdio: 'pipe' })
}

/**
 * Allows only the packed codec owner to admit the retired descriptor, then restores its exact
 * bytes.
 */
function assertPackedLegacyCodecPerturbation(consumerDirectory, canonicalProtocolPath) {
  const original = readFileSync(canonicalProtocolPath, 'utf8')
  const target =
    "    if (!descriptor ||\n        typeof descriptor !== 'object' ||\n        typeof readProtocolNormalize(descriptor) !== 'function')"
  const replacement = "    if (!descriptor || typeof descriptor !== 'object')"
  if (!original.includes(target))
    throw new Error('Packed canonical protocol mutation anchor is unavailable')
  let observed = false
  try {
    writeFileSync(canonicalProtocolPath, original.replace(target, replacement), 'utf8')
    try {
      assertPackedLegacyCodecRejection(consumerDirectory, canonicalProtocolPath)
    } catch (error) {
      if (String(error.stderr ?? '').includes('Legacy codec configuration was accepted')) {
        observed = true
      } else {
        throw error
      }
    }
  } finally {
    writeFileSync(canonicalProtocolPath, original, 'utf8')
  }
  if (!observed) throw new Error('Legacy codec oracle accepted the mutated packed protocol owner')
  assertPackedLegacyCodecRejection(consumerDirectory, canonicalProtocolPath)
}

/**
 * Restores the retired root export only inside the extracted packed package and proves its
 * behavior.
 */
function assertPackedLegacyRootAliasPerturbation(packedPackage, consumerDirectory) {
  /** Preserved retired owner source used only to perturb the extracted packed package. */
  const fixture = JSON.parse(
    readFileSync(
      resolve(integrationDirectory, 'test/core/fixtures/packed/legacy-chunk-owner.json'),
      'utf8'
    )
  )
  if (createHash('sha256').update(fixture.source).digest('hex') !== fixture.sha256)
    throw new Error('Packed legacy chunk fixture digest drifted')
  /**
   * Digest-pinned retired owner with its pre-layering import names bound to the renamed core
   * exports (rpc-layering BC2), so the perturbation still loads against the current packed dist.
   */
  const legacyChunkSource = fixture.source
    .replace(
      'import { WebRpcError, WebRpcErrorCode }',
      'import { RpcError as WebRpcError, RpcCoreErrorCode as WebRpcErrorCode }'
    )
    .replace(
      'import { WebRpcFirstPartyRoleSchema }',
      'import { RpcFirstPartyRoleSchema as WebRpcFirstPartyRoleSchema }'
    )
    .replace('import { WebRpcSharedKey }', 'import { RpcPortName as WebRpcSharedKey }')
  if (legacyChunkSource.includes('import { WebRpc'))
    throw new Error('Packed legacy chunk fixture imports an unmapped pre-layering name')
  /** Packed files whose exact bytes establish the root-export sensitivity baseline. */
  const rootPath = join(packedPackage, 'dist/core/index.js')
  const canonicalChunkPath = join(packedPackage, 'dist/core/middleware/canonical-chunk.js')
  const sharedKeysPath = join(packedPackage, 'dist/core/internal/plugin-shared-keys.js')
  const roleSchemaPath = join(packedPackage, 'dist/core/internal/plugin-contract.js')
  /** Original packed bytes restored in `finally` so the next oracle observes the real package. */
  const root = readFileSync(rootPath)
  const sharedKeys = readFileSync(sharedKeysPath)
  const roleSchema = readFileSync(roleSchemaPath)
  if (existsSync(canonicalChunkPath))
    throw new Error('Packed canonical chunk owner unexpectedly exists before restoration')
  const sharedKeysSource = sharedKeys.toString('utf8')
  const roleSchemaSource = roleSchema.toString('utf8')
  /** Stable anchors that ensure this probe changes only the retired owner contract. */
  const sharedAnchor = "outboundAttachment: 'outboundAttachment'"
  const roleAnchor = "'middleware-finalize': Object.freeze({"
  if (!sharedKeysSource.includes(sharedAnchor) || !roleSchemaSource.includes(roleAnchor))
    throw new Error('Packed root-alias restoration anchors are unavailable')
  /** Derived packed metadata used solely for the temporary retired-owner restoration. */
  const restoredSharedKeys = `${sharedKeysSource.replace(
    sharedAnchor,
    `${sharedAnchor},\n    chunk: 'chunk'`
  )}`
  const restoredRoleSchema = roleSchemaSource.replace(
    roleAnchor,
    `chunk: Object.freeze({\n        sharedProvides: Object.freeze([RpcPortName.chunk]),\n        sharedConsumes: Object.freeze([]),\n        sharedOptionalConsumes: Object.freeze([])\n    }),\n    ${roleAnchor}`
  )
  /** Child-process entry that observes root exports without sharing the parent ESM cache. */
  const probe = join(consumerDirectory, 'legacy-root-alias-probe.mjs')
  /** Cache-busting suffix for each independent root export observation. */
  let probeVersion = 0
  /** Asserts the root export visibility expected before, during, or after the perturbation. */
  const assertRootChunkAbsent = (expectPresent) => {
    probeVersion += 1
    writeFileSync(
      probe,
      [
        `import * as root from ${JSON.stringify(`${pathToFileURL(rootPath).href}?${probeVersion}`)}`,
        "if ('chunk' in root) {",
        "  process.stderr.write('Packed root chunk export is present\\n')",
        '  process.exit(1)',
        '}'
      ].join('\n'),
      'utf8'
    )
    try {
      execFileSync(process.execPath, [probe], { cwd: consumerDirectory, stdio: 'pipe' })
    } catch (error) {
      const stderr = String(error.stderr ?? '').trim()
      if (expectPresent && stderr === 'Packed root chunk export is present') return
      throw error
    }
    if (expectPresent) throw new Error('Packed root chunk export was not observed')
  }
  assertRootChunkAbsent(false)
  try {
    writeFileSync(sharedKeysPath, restoredSharedKeys, 'utf8')
    writeFileSync(roleSchemaPath, restoredRoleSchema, 'utf8')
    writeFileSync(canonicalChunkPath, legacyChunkSource, 'utf8')
    writeFileSync(
      rootPath,
      `${root.toString('utf8')}\nexport { canonicalChunk as chunk } from './middleware/canonical-chunk.js'\n`,
      'utf8'
    )
    assertRootChunkAbsent(true)
    probeVersion += 1
    writeFileSync(
      probe,
      [
        `import * as root from ${JSON.stringify(`${pathToFileURL(rootPath).href}?${probeVersion}`)}`,
        `import { RpcPortName } from ${JSON.stringify(pathToFileURL(sharedKeysPath).href)}`,
        'const installed = root.chunk({ chunkSize: 4 }).install()',
        'const chunk = installed.shared[RpcPortName.chunk]',
        "if (JSON.stringify(chunk.split('abcdefgh', 4)) !== JSON.stringify(['abcd', 'efgh']))",
        "  throw new Error('Restored root chunk export did not install the exact split capability')"
      ].join('\n'),
      'utf8'
    )
    execFileSync(process.execPath, [probe], { cwd: consumerDirectory, stdio: 'pipe' })
  } finally {
    writeFileSync(rootPath, root)
    writeFileSync(sharedKeysPath, sharedKeys)
    writeFileSync(roleSchemaPath, roleSchema)
    if (existsSync(canonicalChunkPath)) rmSync(canonicalChunkPath)
  }
  if (
    !readFileSync(rootPath).equals(root) ||
    !readFileSync(sharedKeysPath).equals(sharedKeys) ||
    !readFileSync(roleSchemaPath).equals(roleSchema)
  )
    throw new Error('Packed root-alias restoration did not preserve exact original bytes')
  assertRootChunkAbsent(false)
}

/** Proves that the compiled canonical feature rejects an injected retired chunk route. */
function assertPackedCanonicalFeatureRoutePerturbation(packedPackage, consumerDirectory) {
  /** Actual compiled feature file whose install body is the only mutation target. */
  const canonicalFeaturePath = join(packedPackage, 'dist/core/features/canonical-chunk.js')
  /** Original bytes retained for byte-exact restoration after the adversarial installation. */
  const original = readFileSync(canonicalFeaturePath)
  const source = original.toString('utf8')
  /** Exact compiled install statement that causally bounds the injected legacy route. */
  const anchor = 'const prepared = core.featureExpose.getPrepared();'
  if (!source.includes(anchor))
    throw new Error('Packed canonical feature route mutation anchor is unavailable')
  /** One-line perturbation that makes the real canonical feature claim the retired route. */
  const mutated = source.replace(
    anchor,
    `${anchor}\n        core.featureExpose.getKernel().registerRoute('chunk', () => undefined);`
  )
  /** Fresh child-process probe that preserves the packed outbound-to-canonical dependency path. */
  const probe = join(consumerDirectory, 'canonical-feature-route-probe.mjs')
  /** Exact stderr marker emitted only for the expected production parity rejection. */
  const expectedFailure =
    'Packed canonical chunk feature retained forbidden legacy chunk route authority'
  /** Runs a fresh composed installation and distinguishes the intended mutant rejection. */
  const run = (expectFailure) => {
    writeFileSync(
      probe,
      [
        "import { createClientEndpoint } from '@migaia/rpc-core/client'",
        "import { connect, protocol, codec } from '@migaia/rpc-core'",
        "import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'",
        "import { createStringFramer } from '@migaia/rpc-contract/framing'",
        "import { defineJsonCodec } from '@migaia/serialize/codecs/json'",
        'const [transport] = createMemoryTransportPair()',
        'try {',
        '  const endpoint = await createClientEndpoint(',
        "    { id: 'packed-canonical-feature-route', transport, framer: createStringFramer(), middlewares: [protocol(), codec(defineJsonCodec({ version: 1 })), connect({ transport })] },",
        '  )',
        "  if ('chunk' in endpoint) throw new Error('Canonical feature leaked a root chunk surface')",
        '  await endpoint.dispose()',
        "  if (process.argv[2] === 'mutated') throw new Error('Injected canonical feature route was not rejected')",
        '} catch (error) {',
        "  if (process.argv[2] === 'mutated' && error?.source === '@migaia/rpc/core' && error?.code === 'INVALID_CONFIG' && error?.message === 'endpoint module token is invalid') {",
        `    process.stderr.write(${JSON.stringify(`${expectedFailure}\n`)})`,
        '    process.exit(1)',
        '  }',
        '  throw error',
        '}'
      ].join('\n'),
      'utf8'
    )
    try {
      execFileSync(process.execPath, [probe, expectFailure ? 'mutated' : 'baseline'], {
        cwd: consumerDirectory,
        stdio: 'pipe'
      })
    } catch (error) {
      if (expectFailure && String(error.stderr ?? '').trim() === expectedFailure) return
      throw error
    }
    if (expectFailure) throw new Error('Injected canonical feature route was not rejected')
  }
  run(false)
  try {
    writeFileSync(canonicalFeaturePath, mutated, 'utf8')
    if (
      !readFileSync(canonicalFeaturePath, 'utf8').includes(
        "core.featureExpose.getKernel().registerRoute('chunk', () => undefined);"
      )
    )
      throw new Error('Packed canonical feature route mutation was not written')
    run(true)
  } finally {
    writeFileSync(canonicalFeaturePath, original)
  }
  if (!readFileSync(canonicalFeaturePath).equals(original))
    throw new Error(
      'Packed canonical feature route restoration did not preserve exact original bytes'
    )
  run(false)
}

/** Bundles one packed public import and executes its observable result in a fresh Chromium page. */
async function assertPackedSelectiveBrowserImport(
  consumerDirectory,
  packedPackage,
  packedContract
) {
  const browserEntry = join(consumerDirectory, 'selective-browser-entry.mjs')
  const browserBundle = join(consumerDirectory, 'selective-browser-bundle.js')
  const browserMetadata = join(consumerDirectory, 'selective-browser-metafile.json')
  writeFileSync(
    browserEntry,
    [
      "import { isRpcError } from '@migaia/rpc-core'",
      "globalThis.__migaiaSelectiveImport = isRpcError({ code: 'SELECTIVE_BROWSER_PROBE' })"
    ].join('\n'),
    'utf8'
  )
  execFileSync(
    resolveEsbuildBinary(),
    [
      browserEntry,
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--log-level=warning',
      `--outfile=${browserBundle}`,
      `--metafile=${browserMetadata}`
    ],
    { cwd: consumerDirectory, stdio: 'inherit' }
  )
  const metadata = JSON.parse(readFileSync(browserMetadata, 'utf8'))
  const output = Object.entries(metadata.outputs).find(
    ([path]) => resolve(consumerDirectory, path) === browserBundle
  )?.[1]
  if (!output || typeof output !== 'object' || !('inputs' in output))
    throw new Error('Selective browser bundle has no esbuild output graph')
  const retainedInputs = Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => resolve(consumerDirectory, path))
  const coreDist = `${resolve(packedPackage, 'dist/core')}/`
  const contractDist = `${resolve(packedContract, 'dist/contract')}/`
  if (!retainedInputs.some((path) => path.startsWith(coreDist)))
    throw new Error('Selective browser bundle omitted retained rpc core input')
  if (retainedInputs.some((path) => path.startsWith(contractDist)))
    throw new Error('Selective browser bundle retained rpc contract input')

  let browser
  let context
  try {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    const page = await context.newPage()
    await page.addScriptTag({ path: browserBundle })
    const result = await page.evaluate(() => globalThis.__migaiaSelectiveImport)
    if (result !== true) throw new Error('Selective packed browser import did not produce true')
  } finally {
    try {
      await context?.close()
    } finally {
      await browser?.close()
    }
  }
}

/** Resolves the already-installed esbuild binary without consulting a registry or network source. */
function resolveEsbuildBinary() {
  const packageStore = join(repositoryRoot, 'node_modules/.pnpm')
  const esbuildDirectory = readdirSync(packageStore).find((entry) => entry.startsWith('esbuild@'))
  const binary = esbuildDirectory
    ? join(packageStore, esbuildDirectory, 'node_modules/esbuild/bin/esbuild')
    : ''
  if (!binary || !existsSync(binary)) throw new Error('Installed esbuild binary is unavailable')
  return binary
}

/** Verifies the complete root-reachable public feature documentation graph with TypeScript symbols. */
function assertDefineFeatureDocumentation(packedPackage) {
  const roots = [
    resolve(packageDirectory, 'src/core/index.ts'),
    resolve(packageDirectory, 'dist/core/index.d.ts'),
    join(packedPackage, 'dist/core/index.d.ts')
  ]
  const manifests = roots.map((path) => readFeatureDocumentationManifest(path))
  if (JSON.stringify(manifests[0]) !== JSON.stringify(manifests[1]))
    throw new Error('Built root feature documentation manifest drifted from source')
  if (JSON.stringify(manifests[1]) !== JSON.stringify(manifests[2]))
    throw new Error('Packed root feature documentation manifest drifted from built declarations')

  const negativeDirectory = mkdtempSync(join(smokeDirectory, 'feature-doc-negative-'))
  try {
    const fixtureDist = join(negativeDirectory, 'dist')
    const fixtureRoot = join(fixtureDist, 'core/index.d.ts')
    const fixtureFeature = join(fixtureDist, 'core/feature.d.ts')
    cpSync(join(packedPackage, 'dist'), fixtureDist, { recursive: true })
    const originalFeature = readFileSync(fixtureFeature, 'utf8')
    if (
      JSON.stringify(readFeatureDocumentationManifest(fixtureRoot)) !== JSON.stringify(manifests[2])
    )
      throw new Error('Complete packed feature documentation fixture drifted before mutation')
    writeFileSync(fixtureFeature, originalFeature.replace(/\/\*\*[\s\S]*?\*\//gu, ''), 'utf8')
    expectFeatureDocumentationFailure(
      fixtureRoot,
      'comment-stripped declaration',
      'Feature documentation missing for public symbol: defineFeature'
    )
    writeFileSync(fixtureFeature, originalFeature, 'utf8')
    if (
      JSON.stringify(readFeatureDocumentationManifest(fixtureRoot)) !== JSON.stringify(manifests[2])
    )
      throw new Error('Complete packed feature documentation fixture did not recover')
    writeFileSync(fixtureRoot, 'export {}\n', 'utf8')
    expectFeatureDocumentationFailure(
      fixtureRoot,
      'missing root export',
      'Feature documentation root export missing: defineFeature'
    )
  } finally {
    rmSync(negativeDirectory, { recursive: true, force: true })
  }
}

/**
 * Parses one source or declaration file for the documentation manifest.
 *
 * @param {string} path Absolute `.ts` or `.d.ts` path.
 * @returns {{
 *   path: string
 *   text: string
 *   program: import('oxc-parser').Program
 *   comments: import('oxc-parser').Comment[]
 * }}
 */
function parseDocumentationFile(path) {
  const text = readFileSync(path, 'utf8')
  const { program, comments } = parseSync(path, text)
  return { path, text, program, comments }
}

/**
 * Resolves one relative module specifier the way the matching tree is laid out: declarations
 * resolve to `.d.ts` siblings, sources to `.ts` sources.
 *
 * @param {string} fromFile Importing file.
 * @param {string} specifier Relative specifier as written.
 * @returns {string} Existing target file.
 * @throws {Error} When the specifier is bare or no matching file exists.
 */
function resolveDocumentationModule(fromFile, specifier) {
  if (!specifier.startsWith('.'))
    throw new Error(`Feature documentation import is not relative: ${specifier}`)
  const base = resolve(dirname(fromFile), specifier)
  const candidates = fromFile.endsWith('.d.ts')
    ? [base.replace(/\.(?:js|ts)$/u, '.d.ts')]
    : [base.replace(/\.js$/u, '.ts'), base]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`Feature documentation import is unresolved: ${specifier}`)
  return found
}

/** Name written by an import/export specifier side (`Identifier` or string `Literal`). */
function specifierName(node) {
  return node.type === 'Identifier' ? node.name : node.value
}

/** Names declared by one declaration node, for the declaration kinds the manifest reads. */
function declaredNames(declaration) {
  if (declaration.type === 'VariableDeclaration')
    return declaration.declarations.flatMap((item) =>
      item.id.type === 'Identifier' ? [item.id.name] : []
    )
  return declaration.id?.type === 'Identifier' ? [declaration.id.name] : []
}

/**
 * Follows the export graph from one file to every declaration of an exported name. Overloads are
 * separate declarations of the same name.
 *
 * @param {string} path File whose export is requested.
 * @param {string} name Exported name.
 * @param {Set<string>} [seen] Visited `file#name` pairs; stops `export *` cycles.
 * @returns {{
 *       file: ReturnType<typeof parseDocumentationFile>
 *       declarations: { statement: any; node: any }[]
 *     }
 *   | undefined}
 */
function findExportedDeclarations(path, name, seen = new Set()) {
  if (seen.has(`${path}#${name}`)) return undefined
  seen.add(`${path}#${name}`)
  const file = parseDocumentationFile(path)
  /** Finds a same-file declaration or import binding of a locally re-exported name. */
  const findLocal = (local) => {
    const declarations = []
    for (const statement of file.program.body) {
      const node =
        statement.type === 'ExportNamedDeclaration' && statement.declaration
          ? statement.declaration
          : statement
      if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers)
          if (specifier.local.name === local)
            return findExportedDeclarations(
              resolveDocumentationModule(path, node.source.value),
              specifier.type === 'ImportSpecifier' ? specifierName(specifier.imported) : 'default',
              seen
            )
      } else if (declaredNames(node).includes(local)) declarations.push({ statement, node })
    }
    return declarations.length > 0 ? { file, declarations } : undefined
  }
  const declarations = []
  for (const statement of file.program.body) {
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) {
        if (declaredNames(statement.declaration).includes(name))
          declarations.push({ statement, node: statement.declaration })
        continue
      }
      for (const specifier of statement.specifiers) {
        if (specifierName(specifier.exported) !== name) continue
        const local = specifierName(specifier.local)
        return statement.source
          ? findExportedDeclarations(
              resolveDocumentationModule(path, statement.source.value),
              local,
              seen
            )
          : findLocal(local)
      }
    }
    if (statement.type === 'ExportAllDeclaration' && statement.exported === null) {
      const found = findExportedDeclarations(
        resolveDocumentationModule(path, statement.source.value),
        name,
        seen
      )
      if (found) return found
    }
  }
  return declarations.length > 0 ? { file, declarations } : undefined
}

/**
 * Reads the JSDoc block written directly before one node: its description and its `@tag` blocks.
 *
 * @param {ReturnType<typeof parseDocumentationFile>} file Parsed file holding the node.
 * @param {{ start: number }} node Statement or member the comment documents.
 * @returns {{ description: string; tags: { name: string; text: string }[] }}
 */
function readJSDoc(file, node) {
  const comment = file.comments
    .filter(
      (candidate) =>
        candidate.type === 'Block' &&
        candidate.value.startsWith('*') &&
        candidate.end <= node.start &&
        /^\s*$/u.test(file.text.slice(candidate.end, node.start))
    )
    .at(-1)
  if (!comment) return { description: '', tags: [] }
  const lines = comment.value
    .slice(1)
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/u, ''))
  const firstTag = lines.findIndex((line) => line.startsWith('@'))
  const description = (firstTag < 0 ? lines : lines.slice(0, firstTag)).join(' ')
  const tags = []
  for (const line of firstTag < 0 ? [] : lines.slice(firstTag)) {
    const tag = /^@(\w+)\s*(.*)$/u.exec(line)
    if (tag) tags.push({ name: tag[1], text: tag[2] })
    else if (tags.length > 0) tags.at(-1).text += ` ${line}`
  }
  return {
    description: normalizeJSDocComment(description),
    tags: tags.map((tag) => ({ name: tag.name, text: normalizeJSDocComment(tag.text) }))
  }
}

/**
 * Extracts a stable public-symbol and overload documentation manifest through the root export
 * graph.
 */
function readFeatureDocumentationManifest(rootPath) {
  if (!existsSync(rootPath))
    throw new Error(`Feature documentation root is unreadable: ${rootPath}`)
  const names = ['defineFeature', 'IRpcFeatureDefinition', 'IRpcFeature', 'IRpcFeatureSurface']
  const manifest = {}
  for (const name of names) {
    const exported = findExportedDeclarations(rootPath, name)
    if (!exported) throw new Error(`Feature documentation root export missing: ${name}`)
    const docs = exported.declarations.map(({ statement }) => readJSDoc(exported.file, statement))
    const documentation = [...new Set(docs.map((doc) => doc.description).filter(Boolean))].join(' ')
    if (!documentation) throw new Error(`Feature documentation missing for public symbol: ${name}`)
    const tags = Object.fromEntries(
      docs
        .flatMap((doc) => doc.tags)
        .map((tag) => [tag.name, tag.text])
        .sort(([left], [right]) => left.localeCompare(right))
    )
    if (name === 'defineFeature') {
      const overloads = exported.declarations.filter(
        ({ node }) => node.type === 'TSDeclareFunction'
      )
      if (overloads.length !== 2)
        throw new Error(`defineFeature overload count drifted in ${rootPath}`)
      const overloadManifest = overloads.map(({ statement, node }) => {
        const doc = readJSDoc(exported.file, statement)
        const overloadTags = Object.fromEntries(
          doc.tags
            .map((tag) => [tag.name, tag.text])
            .sort(([left], [right]) => left.localeCompare(right))
        )
        /** `@param name - text` and `@typeParam name - text` both split on the first word. */
        const named = (tagName) =>
          doc.tags
            .filter((tag) => tag.name === tagName)
            .map((tag) => {
              const parsed = tag.text.match(/^([^\s-]+)\s*-?\s*(.*)$/u)
              return { name: parsed?.[1] ?? '', documentation: parsed?.[2] ?? '' }
            })
        const parameters = named('param')
        const typeParameters = named('typeParam')
        const expectedParameters = node.params.map((parameter) =>
          exported.file.text
            .slice(parameter.start, parameter.typeAnnotation?.start ?? parameter.end)
            .replace(/\??\s*$/u, '')
        )
        if (
          !doc.description ||
          JSON.stringify(parameters.map((parameter) => parameter.name)) !==
            JSON.stringify(expectedParameters) ||
          parameters.some((parameter) => !parameter.documentation) ||
          JSON.stringify(typeParameters.map((parameter) => parameter.name)) !==
            JSON.stringify(
              node.typeParameters?.params.map((parameter) => parameter.name.name) ?? []
            ) ||
          typeParameters.some((parameter) => !parameter.documentation) ||
          !['remarks', 'returns', 'throws'].every((tag) => overloadTags[tag])
        )
          throw new Error(`defineFeature overload documentation is incomplete in ${rootPath}`)
        return {
          documentation: doc.description,
          parameters,
          tags: overloadTags,
          typeParameters
        }
      })
      manifest[name] = { documentation, tags, overloads: overloadManifest }
    } else {
      manifest[name] = { documentation, tags }
    }
  }
  const config = findExportedDeclarations(rootPath, 'IRpcFactoryConfig')
  if (!config) throw new Error('Feature documentation root export missing: IRpcFactoryConfig')
  const declaration = config.declarations.find(({ node }) => node.type === 'TSTypeAliasDeclaration')
  const property = declaration?.node.typeAnnotation.members?.find(
    (member) =>
      member.type === 'TSPropertySignature' &&
      config.file.text.slice(member.key.start, member.key.end) === 'features'
  )
  const configurationDocumentation = property ? readJSDoc(config.file, property).description : ''
  const propertyType = property?.typeAnnotation
    ? config.file.text.slice(
        property.typeAnnotation.typeAnnotation.start,
        property.typeAnnotation.typeAnnotation.end
      )
    : ''
  if (!property || !configurationDocumentation || !propertyType.includes('TFeatures'))
    throw new Error(`Feature configuration documentation is incomplete in ${rootPath}`)
  manifest.IRpcFactoryConfig = {
    documentation: configurationDocumentation,
    type: propertyType
  }
  return manifest
}

/** Requires the same root-graph validator to reject a deliberately invalid declaration surface. */
function expectFeatureDocumentationFailure(rootPath, label, expectedMessage) {
  try {
    readFeatureDocumentationManifest(rootPath)
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) return
    throw error
  }
  throw new Error(`Feature documentation validator accepted ${label}`)
}

/** Collapses JSDoc whitespace so source and emitted declarations compare equal. */
function normalizeJSDocComment(comment) {
  return comment.replace(/\s+/gu, ' ').trim()
}

/** Rejects packed declaration or export-map leakage of package-test identity observers. */
function assertIdentityObserverDeclarationsHidden(packedPackage) {
  const declaration = readFileSync(
    join(packedPackage, 'dist/core/internal/test-observer.d.ts'),
    'utf8'
  )
  const packageJson = JSON.parse(readFileSync(join(packedPackage, 'package.json'), 'utf8'))
  const forbiddenNames = [
    'registerInboundIdentityReleaseObservation',
    'recordInboundIdentityRelease',
    'readInboundIdentityReleaseObservation'
  ]
  if (forbiddenNames.some((name) => declaration.includes(name)))
    throw new Error('Packed identity observer declaration leaked a callable')
  if (Object.hasOwn(packageJson.exports, './core/internal/test-observer'))
    throw new Error('Packed identity observer internal subpath is exported')
}

/** Packs each runtime dependency and installs only its extracted tarball in the isolated consumer. */
function installPackedDependency(dependencyDirectory, dependency) {
  const packageDirectory = resolve(repositoryRoot, `packages/${dependency}`)
  const packagePath = packDependency(packageDirectory, dependency)
  const extractionDirectory = join(smokeDirectory, `extract-${dependency}`)
  mkdirSync(extractionDirectory, { recursive: true })
  execFileSync('tar', ['-xzf', packagePath, '-C', extractionDirectory])
  renameSync(join(extractionDirectory, 'package'), join(dependencyDirectory, dependency))
}

/** Creates the consumer module used to force Node's package export-map resolution. */
function createSmokeModule() {
  const publicImports = [
    ...publicSubpaths.map(
      (specifier) =>
        `{ const publicModule = await import('${specifier}'${specifier === '@migaia/rpc-contract/schema/wire-error' ? ", { with: { type: 'json' } }" : ''}); ${specifier === '@migaia/rpc-contract/schema/wire-error' ? "if (Object.keys(publicModule).length !== 1 || !('default' in publicModule)) throw new Error('Native wire-error schema must expose only its default JSON value');" : ''} if ('assertRpcModuleInstance' in publicModule) throw new Error('Private instance helper is publicly exported: ${specifier}'); process.stdout.write('SUBPATH ${specifier} ' + Object.keys(publicModule).length + '\\n'); }`
    ),
    "process.stdout.write('CHECK subpath-imports PASS\\n');"
  ].join('\n')
  const obsoleteImports = obsoleteSubpaths
    .map((subpath) => `await expectNotExported('@migaia/rpc-core${subpath.slice(1)}');`)
    .join('\n')
  return `
const capabilityTopology = await import('@migaia/capability/graph/topology');
if (typeof capabilityTopology.buildCapabilityTopology !== 'function')
  throw new Error('Packed capability topology export missing');
const packedTopology = capabilityTopology.buildCapabilityTopology(
  [{ id: 'packed-topology', dependencies: [], ordinal: 0 }],
  () => { throw new Error('Unexpected unknown provider'); },
  () => { throw new Error('Unexpected cycle'); },
  () => { throw new Error('Unexpected invalid topology'); }
);
if (packedTopology.ordered[0]?.id !== 'packed-topology')
  throw new Error('Packed capability topology execution failed');

const obsoleteSpecifiers = new Set(${JSON.stringify(obsoleteSubpaths.map((subpath) => `@migaia/rpc-core${subpath.slice(1)}`))});

async function expectNotExported(specifier) {
  if (!obsoleteSpecifiers.has(specifier))
    throw new Error('Unexpected removed-subpath probe: ' + specifier);
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    throw error;
  }
  throw new Error('Obsolete rpc subpath unexpectedly resolved: ' + specifier);
}

${publicImports}
${obsoleteImports}
process.stdout.write('CHECK obsolete-subpaths PASS\\n');
try {
  await import('@migaia/rpc');
  throw new Error('Retired umbrella package unexpectedly resolved');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const assert = (await import('node:assert/strict')).default;
const { createPeerPair } = await import('@migaia/rpc-core/testing');
const pairReports = [];
let pairEffects = 0;
const pair = await createPeerPair({
  a: { provide: { double: (value) => value * 2 } },
  b: { provide: { echo: (value) => value, count: () => ++pairEffects } },
  report: (error) => pairReports.push(error)
});
try {
  assert.equal(await pair.b.request('double', 2), 4);
  const backing = new Uint8Array([9, 1, 2, 8]).buffer;
  const copied = await pair.a.request('echo', { backing, view: new Uint8Array(backing, 1, 2) });
  assert.ok(copied.backing instanceof ArrayBuffer);
  assert.ok(copied.view instanceof Uint8Array);
  assert.notEqual(copied.backing, backing);
  assert.equal(copied.view.byteOffset, 1);
  assert.deepEqual([...copied.view], [1, 2]);
  assert.equal(backing.byteLength, 4);
  await assert.rejects(pair.a.request('echo', backing, { transfer: [backing] }), { code: 'CAPABILITY_UNSUPPORTED' });
  assert.equal(backing.byteLength, 4);
  const steps = [{ method: 'count' }, { method: 'count' }];
  const grouped = await pair.a.group(steps, { idempotencyKey: 'packed-pair-group' });
  assert.deepEqual(grouped.map((step) => step.state), ['success', 'success']);
  assert.equal((await pair.a.outcome('packed-pair-group')).state, 'done');
  await pair.a.group(steps, { idempotencyKey: 'packed-pair-group' });
  assert.equal(pairEffects, 2);
  assert.equal((await pair.a.describe()).connections[0].carrier, 'Memory');
  assert.deepEqual(pairReports, []);
} finally {
  await Promise.all([pair.a.close(), pair.b.close()]);
}
process.stdout.write('CHECK runtime-peer-pair PASS\\n');
try {
  await expectNotExported('@migaia/rpc-core/not-a-legacy-subpath');
  throw new Error('Unrelated import failure was accepted as a legacy subpath');
} catch (error) {
  if (error?.message !== 'Unexpected removed-subpath probe: @migaia/rpc-core/not-a-legacy-subpath')
    throw error;
}

const processExports = await import('@migaia/rpc-process');
const threadExports = await import('@migaia/rpc-threads');
for (const name of ['createProcessPeer', 'createProcessPlugin'])
  assert.equal(typeof processExports[name], 'function', '[R14-A10] packed process factory');
for (const name of ['createThreadPeer', 'createThreadPlugin'])
  assert.equal(typeof threadExports[name], 'function', '[R14-A10] packed thread factory');
for (const name of ['createProcessHost', 'createServeProcessHost', 'createServeProcessPlugin', 'createThreadHost', 'createServeThreadHost', 'createServeThreadPlugin'])
  assert.equal(name in processExports || name in threadExports, false, '[R14-A10] retired factory absent: ' + name);
const root = await import('@migaia/rpc-core');
const clientPreset = await import('@migaia/rpc-core/client');
const providerPreset = await import('@migaia/rpc-core/provider');
const memory = await import('@migaia/rpc-core/adapters/memory');
const [clientTransport] = memory.createMemoryTransportPair();
const [providerTransport] = memory.createMemoryTransportPair();
const [fullTransport] = memory.createMemoryTransportPair();
const middleware = root.connect();
const packedFeature = root.defineFeature(() => ({ packedCustom: () => 'packed-custom' }));
try {
  await root.createEndpoint({
    id: 'packed-legacy-shape',
    transport: clientTransport,
    middlewares: [{ name: 'legacy', install() {} }]
  });
  throw new Error('Packed legacy middleware shape was accepted');
} catch (error) {
  if (error?.code !== 'INVALID_CONFIG') throw error;
}
const client = await clientPreset.createClientEndpoint({
  id: 'packed-client',
  transport: clientTransport,
  middlewares: [middleware]
});
const provider = await providerPreset.createProviderEndpoint({
  id: 'packed-provider',
  transport: providerTransport,
  middlewares: [middleware]
});
const full = await root.createEndpoint({
  id: 'packed-full',
  transport: fullTransport,
  middlewares: [middleware],
  features: [packedFeature]
});
if (typeof client.send !== 'function' || typeof provider.provide !== 'function')
  throw new Error('Packed selected preset surface missing runtime capability');
if (
  typeof full.send !== 'function' ||
  typeof full.provide !== 'function' ||
  typeof full.connect !== 'object' ||
  typeof full.discovery !== 'object'
)
  throw new Error('Packed full surface does not match its declared capabilities');
if (full.packedCustom() !== 'packed-custom')
  throw new Error('Packed root custom feature runtime projection failed');
if ('connect' in provider || 'discovery' in provider)
  throw new Error('Packed provider surface leaked unselected capabilities');
await client.dispose();
await provider.dispose();
await full.dispose();
`
}

/** Creates an isolated tarball for one workspace runtime dependency. */
function packDependency(packageDirectory, dependency) {
  const packDirectory = join(smokeDirectory, `pack-${dependency}`)
  mkdirSync(packDirectory, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0]))) {
    throw new Error(`Expected exactly one ${dependency} tarball, found ${tarballs.length}`)
  }
  return join(packDirectory, tarballs[0])
}

/** Assert the actual artifacts' names, exact lockstep peers and complete ordinary emitted entries. */
function assertPackedOwnerManifests(packedPackages) {
  const expectedPeers = {
    'rpc-contract': [],
    'rpc-core': ['@migaia/rpc-contract'],
    'rpc-process': ['@migaia/rpc-contract', '@migaia/rpc-core'],
    'rpc-threads': ['@migaia/rpc-contract', '@migaia/rpc-core'],
    'rpc-browser': ['@migaia/rpc-core']
  }
  for (const [owner, directory] of Object.entries(packedPackages)) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (
      manifest.name !== `@migaia/${owner}` ||
      manifest.version !==
        JSON.parse(readFileSync(join(repositoryRoot, 'packages/rpc-contract/package.json'), 'utf8'))
          .version ||
      manifest.private !== true
    )
      throw new Error(`Unexpected packed owner identity: ${owner}`)
    const rpcPeers = Object.keys(manifest.peerDependencies ?? {})
      .filter((peer) => peer.startsWith('@migaia/rpc-'))
      .sort()
    if (JSON.stringify(rpcPeers) !== JSON.stringify(expectedPeers[owner]))
      throw new Error(`Packed dependency direction or required peers drifted: ${owner}`)
    for (const [peer, version] of Object.entries(manifest.peerDependencies ?? {}))
      if (peer.startsWith('@migaia/rpc-') && version !== manifest.version)
        throw new Error(`Packed peer is not exact lockstep: ${owner} ${peer}=${version}`)
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      if (subpath.includes('/internal/') || subpath.includes('spi'))
        throw new Error(`Packed owner exposes a private entry: ${owner}${subpath}`)
      /** The public JSON schema resolves its own JSON type; every code entry has a declaration. */
      const targetFields =
        owner === 'rpc-contract' && subpath === './schema/wire-error'
          ? ['default']
          : ['types', 'default']
      for (const field of targetFields)
        if (typeof entry[field] !== 'string' || !existsSync(join(directory, entry[field])))
          throw new Error(`Missing packed ${field} target: ${owner}${subpath}`)
    }
  }
}

main()
