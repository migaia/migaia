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
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import ts from 'typescript'

const integrationDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const repositoryRoot = resolve(integrationDirectory, '../..')
/** Canonical Core assertions and digest-pinned fixtures remain with their physical owner. */
const packageDirectory = join(repositoryRoot, 'packages/rpc-core')
/** Six lockstep artifacts are installed without an umbrella package. */
const rpcOwners = [
  'rpc-contract',
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-bridge-jsonrpc',
  'rpc-browser'
]
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
/** Resolve every declared public path from all six real packed manifests. */
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
    console.log('CHECK six-packed-artifacts PASS')
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
    await assertPackedDuplicateInstances(packedPackages, consumerDirectory)
    console.log('CHECK six-owner-duplicate-instances PASS')
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
 * Extracts a stable public-symbol and overload documentation manifest through the root export
 * graph.
 */
function readFeatureDocumentationManifest(rootPath) {
  const program = ts.createProgram([rootPath], {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(rootPath)
  if (!source) throw new Error(`Feature documentation root is unreadable: ${rootPath}`)
  const root = checker.getSymbolAtLocation(source)
  if (!root) throw new Error(`Feature documentation root has no module symbol: ${rootPath}`)
  const exports = new Map(
    checker.getExportsOfModule(root).map((symbol) => [symbol.getName(), symbol])
  )
  const names = ['defineFeature', 'IRpcFeatureDefinition', 'IRpcFeature', 'IRpcFeatureSurface']
  const manifest = {}
  for (const name of names) {
    const exported = exports.get(name)
    if (!exported) throw new Error(`Feature documentation root export missing: ${name}`)
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
    if (!documentation) throw new Error(`Feature documentation missing for public symbol: ${name}`)
    const tags = Object.fromEntries(
      symbol
        .getJsDocTags(checker)
        .map((tag) => [tag.name, normalizeJSDocComment(tag.text)])
        .sort(([left], [right]) => left.localeCompare(right))
    )
    if (name === 'defineFeature') {
      const declarationPath = symbol.declarations?.[0]?.getSourceFile().fileName
      const declarationSource = declarationPath
        ? ts.createSourceFile(
            declarationPath,
            readFileSync(declarationPath, 'utf8'),
            ts.ScriptTarget.ES2023,
            true
          )
        : undefined
      const overloads =
        declarationSource?.statements.filter(
          (declaration) => ts.isFunctionDeclaration(declaration) && declaration.body === undefined
        ) ?? []
      if (overloads.length !== 2)
        throw new Error(`defineFeature overload count drifted in ${rootPath}`)
      const overloadManifest = overloads.map((declaration) => {
        const documentationNodes = ts.getJSDocCommentsAndTags(declaration).filter(ts.isJSDoc)
        const overloadDocumentation = normalizeJSDocComment(
          documentationNodes.map((node) => node.comment ?? '').join(' ')
        )
        const documentationTags = documentationNodes.flatMap((node) => node.tags ?? [])
        const overloadTags = Object.fromEntries(
          documentationTags
            .map((tag) => [tag.tagName.text, normalizeJSDocComment(tag.comment)])
            .sort(([left], [right]) => left.localeCompare(right))
        )
        const parameters = documentationTags.filter(ts.isJSDocParameterTag).map((tag) => ({
          name: tag.name.getText(),
          documentation: normalizeJSDocComment(tag.comment)
        }))
        const typeParameters = documentationTags
          .filter((tag) => tag.tagName.text === 'typeParam')
          .map((tag) => {
            const parsed = normalizeJSDocComment(tag.comment).match(/^([^\s-]+)\s*-\s*(.+)$/u)
            return {
              name: parsed?.[1] ?? '',
              documentation: parsed?.[2] ?? ''
            }
          })
        const expectedParameters = declaration.parameters.map((parameter) =>
          parameter.name.getText()
        )
        if (
          !overloadDocumentation ||
          JSON.stringify(parameters.map((parameter) => parameter.name)) !==
            JSON.stringify(expectedParameters) ||
          parameters.some((parameter) => !parameter.documentation) ||
          JSON.stringify(typeParameters.map((parameter) => parameter.name)) !==
            JSON.stringify(
              declaration.typeParameters?.map((parameter) => parameter.name.text) ?? []
            ) ||
          typeParameters.some((parameter) => !parameter.documentation) ||
          !['remarks', 'returns', 'throws'].every((tag) => overloadTags[tag])
        )
          throw new Error(`defineFeature overload documentation is incomplete in ${rootPath}`)
        return {
          documentation: overloadDocumentation,
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
  const configExport = exports.get('IRpcFactoryConfig')
  if (!configExport) throw new Error('Feature documentation root export missing: IRpcFactoryConfig')
  const config =
    configExport.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(configExport)
      : configExport
  const declaration = config.declarations?.find(ts.isTypeAliasDeclaration)
  const property = declaration?.type.members?.find(
    (member) => ts.isPropertySignature(member) && member.name.getText() === 'features'
  )
  const configurationDocumentation = property
    ? ts
        .displayPartsToString(
          ts
            .getJSDocCommentsAndTags(property)
            .flatMap((node) =>
              ts.isJSDoc(node) ? [{ text: node.comment ?? '', kind: 'text' }] : []
            )
        )
        .trim()
    : ''
  if (!property || !configurationDocumentation || !property.type?.getText().includes('TFeatures'))
    throw new Error(`Feature configuration documentation is incomplete in ${rootPath}`)
  manifest.IRpcFactoryConfig = {
    documentation: configurationDocumentation,
    type: property.type.getText()
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

/** Normalizes TypeScript's string-or-display-part JSDoc representation for manifest comparison. */
function normalizeJSDocComment(comment) {
  if (typeof comment === 'string') return comment.replace(/\s+/gu, ' ').trim()
  return ts
    .displayPartsToString(comment ?? [])
    .replace(/\s+/gu, ' ')
    .trim()
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
        `{ const publicModule = await import('${specifier}'); if ('assertRpcModuleInstance' in publicModule) throw new Error('Private instance helper is publicly exported: ${specifier}'); process.stdout.write('SUBPATH ${specifier} ' + Object.keys(publicModule).length + '\\n'); }`
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
    'rpc-bridge-jsonrpc': ['@migaia/rpc-contract', '@migaia/rpc-core', '@migaia/rpc-process'],
    'rpc-browser': ['@migaia/rpc-core']
  }
  for (const [owner, directory] of Object.entries(packedPackages)) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (
      manifest.name !== `@migaia/${owner}` ||
      manifest.version !== '0.0.7' ||
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
      if (
        subpath.includes('/internal/') ||
        subpath.includes('spi') ||
        subpath.includes('module-instance')
      )
        throw new Error(`Packed owner exposes a private entry: ${owner}${subpath}`)
      for (const field of ['types', 'default'])
        if (
          typeof entry[field] !== 'string' ||
          entry[field].includes('/internal/module-instance') ||
          !existsSync(join(directory, entry[field]))
        )
          throw new Error(`Missing packed ${field} target: ${owner}${subpath}`)
    }
    const helper = join(directory, 'dist/internal/module-instance.js')
    const mapPath = `${helper}.map`
    if (
      !existsSync(helper) ||
      !existsSync(mapPath) ||
      existsSync(helper.replace(/\.js$/u, '.d.ts'))
    )
      throw new Error(
        `Missing private emitted instance helper/map, or leaked declaration: ${owner}`
      )
    const sourceMap = JSON.parse(readFileSync(mapPath, 'utf8'))
    if (
      !sourceMap.mappings ||
      !sourceMap.sourcesContent?.some((source) =>
        source?.includes('export function assertRpcModuleInstance')
      )
    )
      throw new Error(`Private helper has no actual inline compiler map: ${owner}`)
    const visitDeclarations = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) visitDeclarations(path)
        else if (
          entry.name.endsWith('.d.ts') &&
          readFileSync(path, 'utf8').includes('assertRpcModuleInstance')
        )
          throw new Error(`Public declaration leaks private instance helper: ${path}`)
      }
    }
    visitDeclarations(join(directory, 'dist'))
  }
}

/** Actual ordinary entry targets are resolved from the corresponding packed export map. */
function packedResourceEntry(owner, directory) {
  const subpath = {
    'rpc-contract': './framing',
    'rpc-core': './adapters/memory',
    'rpc-process': '.',
    'rpc-threads': '.',
    'rpc-bridge-jsonrpc': '.',
    'rpc-browser': './adapters/broadcast-channel'
  }[owner]
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const target = manifest.exports[subpath]?.default
  if (!target) throw new Error(`Missing ordinary resource constructor entry: ${owner}${subpath}`)
  return pathToFileURL(join(directory, target)).href
}

/**
 * Build different-version artifacts from the real source through the existing compiler hook. Only
 * isolated scratch copies change version; published/worktree manifests and baselines stay intact.
 */
async function buildDifferentVersionArtifacts(consumerDirectory) {
  const root = join(smokeDirectory, 'different-version-build')
  const modules = join(root, 'node_modules')
  const scope = join(modules, '@migaia')
  mkdirSync(scope, { recursive: true })
  for (const entry of readdirSync(join(repositoryRoot, 'node_modules')))
    if (entry !== '@migaia')
      symlinkSync(join(repositoryRoot, 'node_modules', entry), join(modules, entry), 'dir')
  for (const dependency of packageDependencies)
    symlinkSync(
      join(consumerDirectory, 'node_modules/@migaia', dependency),
      join(scope, dependency),
      'dir'
    )
  const directories = {}
  for (const owner of rpcOwners) {
    const original = join(repositoryRoot, 'packages', owner)
    const directory = join(root, 'packages', owner)
    mkdirSync(directory, { recursive: true })
    cpSync(join(original, 'src'), join(directory, 'src'), { recursive: true })
    cpSync(join(original, 'tsconfig.build.json'), join(directory, 'tsconfig.build.json'))
    const manifest = JSON.parse(readFileSync(join(original, 'package.json'), 'utf8'))
    manifest.version = '0.0.8'
    for (const section of ['peerDependencies', 'devDependencies'])
      for (const name of Object.keys(manifest[section] ?? {}))
        if (name.startsWith('@migaia/rpc-'))
          manifest[section][name] = section === 'peerDependencies' ? '0.0.8' : 'workspace:0.0.8'
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2))
    symlinkSync(directory, join(scope, owner), 'dir')
    directories[owner] = directory
  }
  const builder = join(root, 'build.mjs')
  writeFileSync(
    builder,
    [
      `import { emitRpcWithInstanceGuard } from ${JSON.stringify(pathToFileURL(join(repositoryRoot, 'scripts/rpc-instance-emit.mjs')).href)}`,
      `for (const directory of ${JSON.stringify(Object.values(directories))}) {`,
      '  const status = emitRpcWithInstanceGuard(directory)',
      "  if (status !== 0) throw new Error('Different-version actual compiler emit failed: ' + directory)",
      '}'
    ].join('\n')
  )
  execFileSync(process.execPath, [builder], { cwd: root, stdio: 'inherit' })
  for (const directory of Object.values(directories)) {
    const helper = readFileSync(join(directory, 'dist/internal/module-instance.js'), 'utf8')
    if (!helper.includes('const version = "0.0.8"'))
      throw new Error('Different-version fixture did not rebuild the private helper')
  }
  return directories
}

/** Six compiled owner constructors are exercised in independent processes, using held native I/O. */
async function assertPackedDuplicateInstances(packedPackages, consumerDirectory) {
  const probe = join(consumerDirectory, 'duplicate-owner.mjs')
  writeFileSync(probe, createDuplicateOwnerProbe(), 'utf8')
  const variants = await buildDifferentVersionArtifacts(consumerDirectory)
  for (const owner of rpcOwners) {
    const copyDirectory = join(smokeDirectory, 'duplicate-artifacts', owner, 'same-version')
    mkdirSync(join(copyDirectory, '..'), { recursive: true })
    cpSync(packedPackages[owner], copyDirectory, { recursive: true })
    symlinkSync(
      join(consumerDirectory, 'node_modules'),
      join(copyDirectory, '../node_modules'),
      'dir'
    )
    const first = packedResourceEntry(owner, packedPackages[owner])
    for (const [mode, secondDirectory] of [
      ['same-version', copyDirectory],
      ['different-version', variants[owner]]
    ])
      execFileSync(
        process.execPath,
        [
          '--enable-source-maps',
          probe,
          owner,
          first,
          packedResourceEntry(owner, secondDirectory),
          mode
        ],
        {
          cwd: consumerDirectory,
          stdio: 'inherit'
        }
      )
  }
  const sameCopy = join(consumerDirectory, 'same-core-copy.mjs')
  writeFileSync(
    sameCopy,
    `
import assert from 'node:assert/strict'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { createRemoteRetryPort } from '@migaia/rpc-core/remote'
import { createPeerPair } from '@migaia/rpc-core/testing'
import { systemScheduler } from '@migaia/utils/scheduler'
const transports = createMemoryTransportPair()
const events = { current: () => ({ generation: 1, active: true }), onLeave: () => () => undefined, whenReady: async () => 1 }
const retry = createRemoteRetryPort({ events, scheduler: systemScheduler, report: (error) => { throw error } })
assert.equal(await retry.dispatch({ events, generation: 1, method: 'echo', mode: 'request', idempotent: false, sendOnce: () => Promise.resolve(42) }), 42)
const pair = await createPeerPair({ a: { provide: {} }, b: { provide: { echo: (value) => value } }, report: (error) => { throw error } })
try { assert.equal(await pair.a.request('echo', 42), 42) }
finally { await Promise.all([pair.a.close(), pair.b.close()]); transports[0].close(); transports[1].close() }
`,
    'utf8'
  )
  execFileSync(process.execPath, [sameCopy], { cwd: consumerDirectory, stdio: 'inherit' })
}

/**
 * The small probe uses actual public compiled constructors, not a private assertion export.
 * Collection allocations and raw callbacks observe whether the rejected copy acquires any
 * resource.
 */
function createDuplicateOwnerProbe() {
  return `
import assert from 'node:assert/strict'
import { MessageChannel, BroadcastChannel, Worker, parentPort, workerData } from 'node:worker_threads'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'

const request = workerData ?? { owner: process.argv[2], first: process.argv[3], second: process.argv[4], mode: process.argv[5] }
const { owner, first, second, mode } = request
// A foreign-language peer uses the selected artifact's ordinary lockstep Contract peer.
// In the independent realm, the different-version Bridge must not mix with consumer Contract.
const resolvePeer = createRequire(first)
const { acceptRpcHandshake, normalizeRpcEnvelope, RpcRouteProfile } = await import(pathToFileURL(resolvePeer.resolve('@migaia/rpc-contract')).href)
const { createJsonRpcFrameDecoder, encodeJsonRpcFrame } = await import(pathToFileURL(resolvePeer.resolve('@migaia/rpc-contract/framing/jsonrpc')).href)
const api = await import(first)
const resources = []
const counts = { collections: 0, native: 0, getters: 0 }
let inOwnerOperation = false
function acquire(operation, observe) { inOwnerOperation = observe; try { return operation() } finally { inOwnerOperation = false } }

async function construct(selected, observe = false) {
  if (owner === 'rpc-contract') {
    const framer = await acquire(() => selected.createStringFramer(observe ? { get chunkSize() { counts.getters++; return 1024 } } : undefined), observe)
    return { checkpoint: (text) => assert.deepEqual(framer.frame(text, { messageId: 'packed' }), [text]), close: () => framer.close() }
  }
  if (owner === 'rpc-core') {
    const [left, right] = await acquire(() => selected.createMemoryTransportPair(), observe)
    return { checkpoint: async (text) => { const result = new Promise((resolve) => { const remove = right.subscribe((message) => { remove(); resolve(message.data) }) }); await left.send(text); assert.equal(await result, text) }, close: () => left.close() }
  }
  if (owner === 'rpc-browser') {
    const name = 'packed-browser-' + randomUUID()
    const raw = new BroadcastChannel(name)
    const peer = new BroadcastChannel(name)
    resources.push(() => { raw.close(); peer.close() })
    const add = raw.addEventListener
    raw.addEventListener = (event, listener, options) => { if (observe) counts.native++; return Reflect.apply(add, raw, [event, listener, options]) }
    const transport = await acquire(() => selected.createBroadcastChannelTransport(raw), observe)
    // The public transport borrows its channel; the held raw resources close in finally.
    return { checkpoint: async (text) => { const result = new Promise((resolve) => peer.addEventListener('message', (event) => resolve(event.data), { once: true })); await transport.send(text); assert.equal(await result, text) }, close: () => undefined }
  }
  if (owner === 'rpc-process' || owner === 'rpc-threads') {
    const ports = new MessageChannel()
    resources.push(() => { ports.port1.close(); ports.port2.close() })
    let channel
    if (owner === 'rpc-threads') {
      const options = { get scheduler() { if (observe) counts.getters++; return systemScheduler } }
      channel = await acquire(() => selected.createNodeThreadChannel(ports.port1, 'packed-peer', options), observe)
    } else {
      const raw = {
        kind: 'message',
        send: (value) => ports.port1.postMessage(value),
        onMessage: (listener) => { if (observe) counts.native++; ports.port1.on('message', listener); return () => ports.port1.off('message', listener) },
        onClose: (listener) => { if (observe) counts.native++; ports.port1.on('close', listener); return () => ports.port1.off('close', listener) },
        close: () => ports.port1.close()
      }
      channel = await acquire(() => selected.createProcessTransport(raw, { peerId: 'packed-peer', scheduler: systemScheduler, report: (error) => { throw error }, ipc: { connectionId: 'packed', sessionId: 'packed', log: () => undefined }, staticAgreement: { local: { codec: 'identity', capabilities: ['batch@1'] }, peer: { codec: 'identity', capabilities: ['batch@1'] } } }), observe)
    }
    return { checkpoint: async (text) => { const result = new Promise((resolve) => ports.port2.once('message', resolve)); await channel.transport.send(text); assert.equal(await result, text) }, close: () => channel.close() }
  }
  if (owner === 'rpc-bridge-jsonrpc') {
    const incoming = new PassThrough()
    const outgoing = new PassThrough()
    resources.push(() => { incoming.destroy(); outgoing.destroy() })
    const decoder = createJsonRpcFrameDecoder()
    const capabilities = ['runtime-api@1', 'batch@1', 'jsonrpc-bridge@1', 'abort@1', 'wire-error@1']
    outgoing.on('data', (bytes) => {
      for (const message of decoder.push(bytes)) {
        const reply = message.method === 'migaia.hello'
          ? { reply: acceptRpcHandshake({ versions: [{ major: 1, minor: 1 }], codecs: ['json'], capabilities, peer: { id: 'peer', runtime: 'python' } }, message.params.hello).reply, methods: ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel'] }
          : message.params.args
        incoming.write(encodeJsonRpcFrame({ jsonrpc: '2.0', id: message.id, result: reply }))
      }
    })
    const raw = {
      kind: 'byte',
      write: (bytes) => new Promise((resolve, reject) => outgoing.write(bytes, (error) => error ? reject(error) : resolve())),
      onData: (listener) => { if (observe) counts.native++; incoming.on('data', listener); return () => incoming.off('data', listener) },
      onClose: (listener) => { if (observe) counts.native++; incoming.on('close', listener); return () => incoming.off('close', listener) },
      close: () => { incoming.destroy(); outgoing.destroy() }
    }
    const channel = await acquire(() => selected.createJsonRpcRemoteChannel({ byte: raw, peerId: 'peer', target: { kind: 'plugin', contract: { schemaVersion: 1, plugin: 'p', features: { f: { methods: { request: { mode: 'request', idempotent: true } } } } } }, offer: { versions: [{ major: 1, minor: 1 }], capabilities: [], peer: { id: 'client', runtime: 'node' } }, token: 'packed-test-token', scheduler: systemScheduler, wallClock: systemWallClock, ipc: { connectionId: 'packed', sessionId: 'packed', log: () => undefined }, report: (error) => { throw error } }), observe)
    return { checkpoint: async (text) => { const result = new Promise((resolve) => { const remove = channel.transport.subscribe((message) => { remove(); resolve(JSON.parse(message.data).data.payload) }) }); await channel.transport.send(JSON.stringify(normalizeRpcEnvelope({ kind: 'request', id: 'packed-' + text, method: 'p.f.request', data: { route: { profile: RpcRouteProfile, type: 'request', applicationVersion: '1.0.0', senderId: 'client', targetId: 'peer', receiverId: 'peer', sentAt: 0 }, payload: [text] } }))); assert.deepEqual(await result, [text]) }, close: () => channel.close() }
  }
  throw new Error('Unknown actual owner constructor: ' + owner)
}

const original = await construct(api)
try {
  await original.checkpoint('before')
  if (mode === 'realm') {
    await original.checkpoint('realm')
    parentPort.postMessage('realm-independent')
  } else {
    const other = await import(second)
    const NativeCollections = [globalThis.Map, globalThis.Set, globalThis.WeakMap, globalThis.WeakSet]
    const names = ['Map', 'Set', 'WeakMap', 'WeakSet']
    names.forEach((name, index) => { globalThis[name] = new Proxy(NativeCollections[index], { construct(target, args, newTarget) { if (inOwnerOperation) counts.collections++; return Reflect.construct(target, args, newTarget) } }) })
    let failure
    let unexpected
    try { unexpected = await construct(other, true) } catch (error) { failure = error }
    finally { names.forEach((name, index) => { globalThis[name] = NativeCollections[index] }) }
    await unexpected?.close()
    assert.equal(failure?.source, '@migaia/rpc/core')
    assert.equal(failure?.code, 'DUPLICATE_MODULE_INSTANCE')
    assert.equal(failure?.message, 'Duplicate @migaia/rpc module instance detected')
    assert.ok(failure instanceof Error)
    assert.deepEqual(counts, { collections: 0, native: 0, getters: 0 }, 'second owner must reject before resource acquisition')
    const helperURL = new URL(second)
    const suffix = '/dist/'
    const helperRoot = fileURLToPath(helperURL).slice(0, fileURLToPath(helperURL).lastIndexOf(suffix))
    const map = JSON.parse(readFileSync(helperRoot + '/dist/internal/module-instance.js.map', 'utf8'))
    const source = map.sourcesContent.find((value) => value.includes('const error = new Error('))
    const line = source.slice(0, source.indexOf('const error = new Error(')).split('\\n').length
    assert.ok(failure.stack.includes(helperRoot + '/src/internal/module-instance.ts:' + line + ':'), 'the rejected owner itself must use its true compiler source map')
    await original.checkpoint('after')
    const worker = new Worker(new URL(import.meta.url), { workerData: { owner, first: second, mode: 'realm' } })
    const workerResult = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
    const workerExit = new Promise((resolve, reject) => { worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Realm worker failed: ' + code))) })
    assert.equal(await workerResult, 'realm-independent')
    await workerExit
    process.stdout.write('DUPLICATE ' + owner + ' ' + mode + ' PASS\\n')
  }
} finally {
  await original.close()
  for (const close of resources.reverse()) close()
}
`
}

main()
