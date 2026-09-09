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

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageDirectory, '../..')
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-packed-'))
const extractDirectory = join(smokeDirectory, 'extract')
const consumerDirectory = join(smokeDirectory, 'consumer')
const packageDependencies = [
  'capability',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'plugin-host',
  'rpc-contract',
  'serialize',
  'utils'
]
const publicSubpaths = [
  './core',
  './client',
  './provider',
  './full',
  './features/outbound',
  './features/provider',
  './features/discovery',
  './features/control',
  './features/one-way',
  './transport-constants',
  './adapters/window',
  './adapters/message-port',
  './adapters/web-worker',
  './adapters/broadcast-channel',
  './adapters/memory',
  './adapters/shared-worker',
  './adapters/service-worker',
  './adapters/rtc-data-channel',
  './adapters/web-transport'
]
const obsoleteSubpaths = [
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
 * Packs web-rpc, resolves it from a clean consumer directory, and checks both every declared public
 * subpath and the removed legacy adapter paths.
 */
async function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', pack(), '-C', extractDirectory])
    const packedPackage = join(extractDirectory, 'package')
    assertIdentityObserverDeclarationsHidden(packedPackage)
    assertDefineFeatureDocumentation(packedPackage)
    mkdirSync(consumerDirectory, { recursive: true })
    const dependencyDirectory = join(extractDirectory, 'node_modules', '@migaia')
    const consumerDependencyDirectory = join(consumerDirectory, 'node_modules', '@migaia')
    mkdirSync(dependencyDirectory, { recursive: true })
    mkdirSync(consumerDependencyDirectory, { recursive: true })
    symlinkSync(packedPackage, join(consumerDependencyDirectory, 'web-rpc'), 'dir')
    for (const dependency of packageDependencies) {
      installPackedDependency(dependencyDirectory, dependency)
      symlinkSync(
        join(dependencyDirectory, dependency),
        join(consumerDependencyDirectory, dependency),
        'dir'
      )
    }
    assertPackedLegacyEnvelopeRejection(consumerDirectory)
    assertPackedLegacyEnvelopePerturbation(
      consumerDirectory,
      join(dependencyDirectory, 'rpc-contract', 'dist/v1/normalize.js')
    )
    const canonicalProtocolPath = join(packedPackage, 'dist/middleware/canonical-protocol.js')
    assertPackedLegacyCodecRejection(consumerDirectory, canonicalProtocolPath)
    assertPackedLegacyCodecPerturbation(consumerDirectory, canonicalProtocolPath)
    assertPackedLegacyRootAliasPerturbation(packedPackage, consumerDirectory)
    assertPackedCanonicalFeatureRoutePerturbation(packedPackage, consumerDirectory)
    await assertPackedSelectiveBrowserImport(
      consumerDirectory,
      packedPackage,
      join(dependencyDirectory, 'rpc-contract')
    )
    const consumerModule = join(consumerDirectory, 'smoke.mjs')
    const typeContract = join(consumerDirectory, 'type-contract.ts')
    const typeConfig = join(consumerDirectory, 'tsconfig.json')
    writeFileSync(
      typeContract,
      readFileSync(resolve(packageDirectory, 'test/fixtures/packed/type-contract.ts'), 'utf8'),
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
    writeFileSync(consumerModule, createSmokeModule(), 'utf8')
    execFileSync(process.execPath, [consumerModule], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
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
    'export function normalizeRpcEnvelope(value) {\n    const normalized = normalizePortable(value);'
  const replacement = `${target}\n    if (value && typeof value === 'object' && ('taskId' in value || value.kind === 'chunk' || value.variation === 'abort')) return value;`
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
    readFileSync(resolve(packageDirectory, 'test/fixtures/packed/legacy-chunk-owner.json'), 'utf8')
  )
  if (createHash('sha256').update(fixture.source).digest('hex') !== fixture.sha256)
    throw new Error('Packed legacy chunk fixture digest drifted')
  /** Packed files whose exact bytes establish the root-export sensitivity baseline. */
  const rootPath = join(packedPackage, 'dist/index.js')
  const canonicalChunkPath = join(packedPackage, 'dist/middleware/canonical-chunk.js')
  const sharedKeysPath = join(packedPackage, 'dist/internal/plugin-shared-keys.js')
  const roleSchemaPath = join(packedPackage, 'dist/internal/plugin-contract.js')
  /** Original packed bytes restored in `finally` so the next oracle observes the real package. */
  const root = readFileSync(rootPath)
  const sharedKeys = readFileSync(sharedKeysPath)
  const roleSchema = readFileSync(roleSchemaPath)
  if (existsSync(canonicalChunkPath))
    throw new Error('Packed canonical chunk owner unexpectedly exists before restoration')
  const sharedKeysSource = sharedKeys.toString('utf8')
  const roleSchemaSource = roleSchema.toString('utf8')
  /** Stable anchors that ensure this probe changes only the retired owner contract. */
  const sharedAnchor = "outboundAttachment: Symbol('web-rpc.shared.outbound-attachment')"
  const roleAnchor = "'middleware-finalize': Object.freeze({"
  if (!sharedKeysSource.includes(sharedAnchor) || !roleSchemaSource.includes(roleAnchor))
    throw new Error('Packed root-alias restoration anchors are unavailable')
  /** Derived packed metadata used solely for the temporary retired-owner restoration. */
  const restoredSharedKeys = sharedKeysSource.replace(
    sharedAnchor,
    `${sharedAnchor},\n    chunk: Symbol('web-rpc.shared.chunk')`
  )
  const restoredRoleSchema = roleSchemaSource.replace(
    roleAnchor,
    `chunk: Object.freeze({\n        sharedProvides: Object.freeze([WebRpcSharedKey.chunk]),\n        sharedConsumes: Object.freeze([]),\n        sharedOptionalConsumes: Object.freeze([])\n    }),\n    ${roleAnchor}`
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
    writeFileSync(canonicalChunkPath, fixture.source, 'utf8')
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
        `import { WebRpcSharedKey } from ${JSON.stringify(pathToFileURL(sharedKeysPath).href)}`,
        'const installed = root.chunk({ chunkSize: 4 }).install()',
        'const chunk = installed.shared[WebRpcSharedKey.chunk]',
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
  const canonicalFeaturePath = join(packedPackage, 'dist/features/canonical-chunk.js')
  /** Original bytes retained for byte-exact restoration after the adversarial installation. */
  const original = readFileSync(canonicalFeaturePath)
  const source = original.toString('utf8')
  /** Exact compiled install statement that causally bounds the injected legacy route. */
  const anchor =
    'const attachment = new WebRpcCanonicalChunkAttachment(kernel, prepared.options.components?.framer);'
  if (!source.includes(anchor))
    throw new Error('Packed canonical feature route mutation anchor is unavailable')
  /** One-line perturbation that makes the real canonical feature claim the retired route. */
  const mutated = source.replace(
    anchor,
    `${anchor}\n    kernel.registerRoute('chunk', () => undefined);`
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
        "import { createComposedEndpoint } from '@migaia/web-rpc/core'",
        "import { outbound } from '@migaia/web-rpc/features/outbound'",
        "import { connect, protocol, codec } from '@migaia/web-rpc'",
        "import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'",
        "import { createStringFramer } from '@migaia/rpc-contract/framing'",
        "import { defineJsonCodec } from '@migaia/serialize/codecs/json'",
        'const [transport] = createMemoryTransportPair()',
        'try {',
        '  const endpoint = await createComposedEndpoint(',
        "    { id: 'packed-canonical-feature-route', transport, framer: createStringFramer(), middlewares: [protocol(), codec(defineJsonCodec({ version: 1 })), connect({ transport })] },",
        '    [outbound()]',
        '  )',
        "  if ('chunk' in endpoint) throw new Error('Canonical feature leaked a root chunk surface')",
        '  await endpoint.dispose()',
        "  if (process.argv[2] === 'mutated') throw new Error('Injected canonical feature route was not rejected')",
        '} catch (error) {',
        "  if (process.argv[2] === 'mutated' && error?.source === '@migaia/web-rpc' && error?.code === 'INVALID_CONFIG' && error?.message === 'endpoint module token is invalid') {",
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
        "kernel.registerRoute('chunk', () => undefined);"
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
  packedRpcContract
) {
  const browserEntry = join(consumerDirectory, 'selective-browser-entry.mjs')
  const browserBundle = join(consumerDirectory, 'selective-browser-bundle.js')
  const browserMetadata = join(consumerDirectory, 'selective-browser-metafile.json')
  writeFileSync(
    browserEntry,
    [
      "import { isWebRpcError } from '@migaia/web-rpc'",
      "globalThis.__migaiaSelectiveImport = isWebRpcError({ code: 'SELECTIVE_BROWSER_PROBE' })"
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
  const webRpcDist = `${resolve(packedPackage, 'dist')}/`
  const rpcContractDist = `${resolve(packedRpcContract, 'dist')}/`
  if (!retainedInputs.some((path) => path.startsWith(webRpcDist)))
    throw new Error('Selective browser bundle omitted retained web-rpc input')
  if (retainedInputs.some((path) => path.startsWith(rpcContractDist)))
    throw new Error('Selective browser bundle retained rpc-contract input')

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
    resolve(packageDirectory, 'src/index.ts'),
    resolve(packageDirectory, 'dist/index.d.ts'),
    join(packedPackage, 'dist/index.d.ts')
  ]
  const manifests = roots.map((path) => readFeatureDocumentationManifest(path))
  if (JSON.stringify(manifests[0]) !== JSON.stringify(manifests[1]))
    throw new Error('Built root feature documentation manifest drifted from source')
  if (JSON.stringify(manifests[1]) !== JSON.stringify(manifests[2]))
    throw new Error('Packed root feature documentation manifest drifted from built declarations')

  const negativeDirectory = mkdtempSync(join(smokeDirectory, 'feature-doc-negative-'))
  try {
    const fixtureDist = join(negativeDirectory, 'dist')
    const fixtureRoot = join(fixtureDist, 'index.d.ts')
    const fixtureFeature = join(fixtureDist, 'feature.d.ts')
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
  const names = [
    'defineFeature',
    'IWebRpcFeatureDefinition',
    'IWebRpcFeatureInstallScope',
    'IWebRpcFeature',
    'IWebRpcFeatureSurface'
  ]
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
        const typeParameter = overloadTags.typeParam?.match(/^([^\s-]+)\s*-\s*(.+)$/u)
        const expectedParameters = declaration.parameters.map((parameter) =>
          parameter.name.getText()
        )
        if (
          !overloadDocumentation ||
          JSON.stringify(parameters.map((parameter) => parameter.name)) !==
            JSON.stringify(expectedParameters) ||
          parameters.some((parameter) => !parameter.documentation) ||
          !typeParameter ||
          typeParameter[1] !== 'TSurface' ||
          !typeParameter[2] ||
          !['remarks', 'returns', 'throws'].every((tag) => overloadTags[tag])
        )
          throw new Error(`defineFeature overload documentation is incomplete in ${rootPath}`)
        return {
          documentation: overloadDocumentation,
          parameters,
          tags: overloadTags,
          typeParameters: [{ name: typeParameter[1], documentation: typeParameter[2] }]
        }
      })
      manifest[name] = { documentation, tags, overloads: overloadManifest }
    } else {
      manifest[name] = { documentation, tags }
    }
  }
  const configExport = exports.get('IWebRpcFactoryConfig')
  if (!configExport)
    throw new Error('Feature documentation root export missing: IWebRpcFactoryConfig')
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
  manifest.IWebRpcFactoryConfig = {
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
  const declaration = readFileSync(join(packedPackage, 'dist/internal/test-observer.d.ts'), 'utf8')
  const packageJson = JSON.parse(readFileSync(join(packedPackage, 'package.json'), 'utf8'))
  const forbiddenNames = [
    'registerInboundIdentityReleaseObservation',
    'recordInboundIdentityRelease',
    'readInboundIdentityReleaseObservation'
  ]
  if (forbiddenNames.some((name) => declaration.includes(name)))
    throw new Error('Packed identity observer declaration leaked a callable')
  if (Object.hasOwn(packageJson.exports, './internal/test-observer'))
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
    "await import('@migaia/web-rpc');",
    ...publicSubpaths.map((subpath) => `await import('@migaia/web-rpc${subpath.slice(1)}');`)
  ].join('\n')
  const obsoleteImports = obsoleteSubpaths
    .map((subpath) => `await expectNotExported('@migaia/web-rpc${subpath.slice(1)}');`)
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

const obsoleteSpecifiers = new Set(${JSON.stringify(obsoleteSubpaths.map((subpath) => `@migaia/web-rpc${subpath.slice(1)}`))});

async function expectNotExported(specifier) {
  if (!obsoleteSpecifiers.has(specifier))
    throw new Error('Unexpected removed-subpath probe: ' + specifier);
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      typeof error?.message === 'string' &&
      error.message.includes("Cannot find module '" + specifier + "'")
    )
      return;
    throw error;
  }
  throw new Error('Legacy web-rpc subpath unexpectedly resolved: ' + specifier);
}

${publicImports}
${obsoleteImports}
try {
  await expectNotExported('@migaia/web-rpc/not-a-legacy-subpath');
  throw new Error('Unrelated import failure was accepted as a legacy subpath');
} catch (error) {
  if (error?.message !== 'Unexpected removed-subpath probe: @migaia/web-rpc/not-a-legacy-subpath')
    throw error;
}

const root = await import('@migaia/web-rpc');
const clientPreset = await import('@migaia/web-rpc/client');
const providerPreset = await import('@migaia/web-rpc/provider');
const memory = await import('@migaia/web-rpc/adapters/memory');
const [clientTransport] = memory.createMemoryTransportPair();
const [providerTransport] = memory.createMemoryTransportPair();
const [fullTransport] = memory.createMemoryTransportPair();
const middleware = root.connect();
let packedFeatureReleases = 0;
const packedFeature = root.defineFeature({
  key: 'packed-custom',
  claims: { publicKeys: ['packedCustom'] },
  install: ({ own }) => {
    own({}, () => {
      packedFeatureReleases += 1;
    });
    return { packedCustom: () => 'packed-custom' };
  }
});
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
const core = await import('@migaia/web-rpc/core');
const providerFeature = await import('@migaia/web-rpc/features/provider');
const discoveryFeature = await import('@migaia/web-rpc/features/discovery');
const oneWayFeature = await import('@migaia/web-rpc/features/one-way');
const tuple = await core.createComposedEndpoint(
  { id: 'packed-public-tuple', transport: fullTransport, middlewares: [middleware] },
  [providerFeature.provider(), discoveryFeature.discovery()]
);
if (typeof client.send !== 'function' || typeof provider.provide !== 'function')
  throw new Error('Packed selected preset surface missing runtime capability');
if (typeof oneWayFeature.oneWay !== 'function')
  throw new Error('Packed one-way feature export missing runtime factory');
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
const tupleKeys = Object.keys(tuple).sort().join(',');
if (tupleKeys !== 'connect,discovery,dispatch,dispatchAll,dispose,hooks,on,provide,send,sendAll')
  throw new Error('Packed public tuple runtime keys do not match its selected capabilities: ' + tupleKeys);
await client.dispose();
await provider.dispose();
await full.dispose();
await tuple.dispose();
if (packedFeatureReleases !== 1)
  throw new Error('Packed custom feature resource was not disposed exactly once');
`
}

/** Packs the current package and returns the generated tarball path. */
function pack() {
  const packDirectory = join(smokeDirectory, 'pack')
  mkdirSync(packDirectory, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0]))) {
    throw new Error(`Expected exactly one web-rpc tarball, found ${tarballs.length}`)
  }
  return join(packDirectory, tarballs[0])
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

main()
