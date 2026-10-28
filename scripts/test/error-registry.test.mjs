import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkErrorRegistry,
  checkErrorRegistrySources,
  collectErrorRegistry,
  REGISTRY_END,
  REGISTRY_START,
  repositoryRoot,
  writeErrorRegistry
} from '../error-registry.mjs'

/**
 * Creates the smallest repository shape understood by the registry collector.
 *
 * @param {string} source Full declaration text parsed by the real collector.
 * @param {string} [directory] Package directory beneath the temporary packages root.
 * @returns {string} Temporary repository root owned by the caller.
 */
const createFixture = (source, directory = 'example', preserveDeclaration = false) => {
  const root = mkdtempSync(join(tmpdir(), 'migai-error-registry-'))
  const packageRoot = join(root, 'packages', directory)
  mkdirSync(join(packageRoot, 'src'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@migaia/example' }))
  writeFileSync(
    join(packageRoot, 'src/error-code.ts'),
    preserveDeclaration || source.includes('export const ERROR_SOURCE')
      ? source
      : `export const ERROR_SOURCE = 'fixture.example'\n${source}`
  )
  return root
}

test('rejects a code whose declaration has no descriptive JSDoc', () => {
  const root = createFixture("export const ExampleErrorCode = { broken: 'BROKEN' } as const\n")
  try {
    assert.throws(() => collectErrorRegistry(root), /missing descriptive JSDoc/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a present registry whose generated region is stale', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the example input is invalid. */\n  broken: 'BROKEN'\n} as const\n"
  )
  try {
    mkdirSync(join(root, 'docs/contracts'), { recursive: true })
    writeFileSync(
      join(root, 'docs/contracts/error-codes.md'),
      `# Registry\n${REGISTRY_START}\nstale\n${REGISTRY_END}\n`
    )
    assert.throws(() => checkErrorRegistry(root), /registry is stale/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts an absent ignored registry after validating declaration JSDoc', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the example input is invalid. */\n  broken: 'BROKEN'\n} as const\n"
  )
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    assert.doesNotThrow(() => checkErrorRegistry(root))
    assert.deepEqual(warnings, ['error registry is absent: docs/contracts/error-codes.md'])
  } finally {
    console.warn = originalWarn
    rmSync(root, { recursive: true, force: true })
  }
})

test('uses explicit layer domains independently of package names', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the root input is invalid. */\n  rootInvalid: 'ROOT_INVALID'\n} as const\n"
  )
  try {
    const packageRoot = join(root, 'packages/example')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/a' }))
    mkdirSync(join(packageRoot, 'src/x'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'src/x/error-code.ts'),
      "export const ERROR_SOURCE = 'fixture.a.custom'\nexport const LayerErrorCode = {\n  /** Raised when the layer input is invalid. */\n  layerInvalid: 'LAYER_INVALID'\n} as const\n"
    )
    assert.deepEqual(
      collectErrorRegistry(root).map(({ source, code }) => ({ source, code })),
      [
        { source: 'fixture.a.custom', code: 'LAYER_INVALID' },
        { source: 'fixture.example', code: 'ROOT_INVALID' }
      ]
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('maps RPC codes to their declarations and preserves capability graph ownership', () => {
  /** RPC contract and core code tables share one declaration file. */
  const rpcDeclarations = readFileSync(
    join(repositoryRoot, 'packages/rpc-contract/src/error-code.ts'),
    'utf8'
  )
  /** Codes declared by one named table in the RPC declaration file. */
  const tableCodes = (name) => {
    /** Start of this table's literal object. */
    const start = rpcDeclarations.indexOf(`export const ${name} = {`)
    assert.notEqual(start, -1, name)
    /** Table body, ending at its own `as const` terminator. */
    const body = rpcDeclarations.slice(start, rpcDeclarations.indexOf('} as const', start))
    return [...body.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*\s*:\s*'([A-Z][A-Z0-9_]*)'/gm)].map(
      (match) => match[1]
    )
  }
  const rows = collectErrorRegistry()
  const codes = (source) => rows.filter((row) => row.source === source).map((row) => row.code)
  assert.deepEqual(codes('rpc.contract'), tableCodes('RpcContractErrorCode').sort())
  assert.deepEqual(
    codes('rpc.endpoint'),
    [...tableCodes('RpcCoreErrorCode'), ...tableCodes('RpcAuthenticationRejectionReason')].sort()
  )
  /** The graph subpath owns exactly the codes its own declaration file lists. */
  const graphCodes = [
    ...readFileSync(
      join(repositoryRoot, 'packages/capability/src/graph/error-code.ts'),
      'utf8'
    ).matchAll(/^\s*[A-Za-z][A-Za-z0-9]*\s*:\s*'([A-Z][A-Z0-9_]*)'/gm)
  ].map((match) => match[1])
  assert.deepEqual(codes('capability.graph').sort(), graphCodes.sort())
  assert.deepEqual(codes('@migaia/rpc-contract'), [])
  assert.deepEqual(codes('@migaia/web-rpc'), [])
  assert.doesNotMatch(
    readFileSync(join(repositoryRoot, 'scripts/error-registry.mjs'), 'utf8'),
    /capability\/src\/graph/
  )
})

/** Lists every package-owned error-code declaration file below `directory`. */
const listErrorCodeFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    /** Absolute path of this directory entry. */
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listErrorCodeFiles(path)
    return entry.name === 'error-code.ts' ? [path] : []
  })

/** First sentence of the header JSDoc that precedes a file's first `export const`. */
const headerSentence = (text) => {
  /** Header comment body, when the file starts with one. */
  const body = text.slice(0, text.indexOf('export const')).match(/\/\*\*([\s\S]*?)\*\//)?.[1]
  if (body === undefined) return undefined
  /** Header text flattened to one line the way the generator flattens JSDoc. */
  const flat = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
  /** Index of the first sentence terminator. */
  const boundary = flat.search(/[。！？]|[.!?](?:\s|$)/)
  return (boundary < 0 ? flat : flat.slice(0, boundary + 1)).replaceAll('|', '\\|').trim()
}

test('attributes each entry JSDoc to its own code, never to the file header', () => {
  const root = createFixture(
    "/** Header sentence. */\nexport const ExampleErrorCode = {\n  /** Entry scenario. */\n  first: 'FIRST',\n  /** Second scenario. */\n  second: 'SECOND'\n} as const\n"
  )
  try {
    assert.deepEqual(
      collectErrorRegistry(root).map(({ code, scenario }) => ({ code, scenario })),
      [
        { code: 'FIRST', scenario: 'Entry scenario.' },
        { code: 'SECOND', scenario: 'Second scenario.' }
      ]
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a first code without JSDoc even when a file header precedes it', () => {
  const root = createFixture(
    "/** Header sentence. */\nexport const ExampleErrorCode = {\n  first: 'FIRST',\n  /** Second scenario. */\n  second: 'SECOND'\n} as const\n"
  )
  try {
    assert.throws(() => collectErrorRegistry(root), /error code FIRST is missing descriptive JSDoc/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lists every utils code with its own scenario and regenerates a checkable registry', () => {
  const rows = collectErrorRegistry()
  /** Declared utils code values, read from the canonical declaration file. */
  const utilsCodes = [
    ...readFileSync(join(repositoryRoot, 'packages/utils/src/error-code.ts'), 'utf8').matchAll(
      /^\s*[A-Za-z][A-Za-z0-9]*\s*:\s*'([A-Z][A-Z0-9_]*)'/gm
    )
  ].map((match) => match[1])
  /** Registry rows owned by the utils package. */
  const utilsRows = rows.filter((row) => row.source === 'foundation.utils')
  /** One registry row per declared code: no duplicates and none missing. */
  assert.equal(utilsRows.length, utilsCodes.length)
  assert.deepEqual(new Set(utilsRows.map((row) => row.code)), new Set(utilsCodes))
  /** Header first sentences of every error-code file in the repository. */
  const headers = new Set(
    listErrorCodeFiles(join(repositoryRoot, 'packages'))
      .map((file) => headerSentence(readFileSync(file, 'utf8')))
      .filter((sentence) => sentence !== undefined && sentence.length > 0)
  )
  assert.ok(headers.size > 0)
  assert.deepEqual(
    rows.filter((row) => headers.has(row.scenario)),
    []
  )
  /** Scratch repository that reuses the real packages with its own registry document. */
  const root = mkdtempSync(join(tmpdir(), 'migai-error-registry-live-'))
  try {
    symlinkSync(join(repositoryRoot, 'packages'), join(root, 'packages'), 'dir')
    mkdirSync(join(root, 'docs/contracts'), { recursive: true })
    writeFileSync(
      join(root, 'docs/contracts/error-codes.md'),
      `# Registry\n${REGISTRY_START}\nstale\n${REGISTRY_END}\n`
    )
    writeErrorRegistry(root)
    assert.doesNotThrow(() => checkErrorRegistry(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** All public registry modes must share the same source validation path. */
const sourceValidationModes = [checkErrorRegistrySources, checkErrorRegistry, writeErrorRegistry]

/**
 * Creates a real parser fixture with a usable local registry for the write mode.
 *
 * @param {string | undefined} source Optional declaration value; undefined omits the declaration.
 * @param {string} [directory] Package path used to distinguish the storage prefix exemption.
 * @returns {string} Temporary repository root owned by the caller.
 */
const sourceDomainFixture = (source, directory = 'example') => {
  /** Undefined exercises actual missing-source rejection or the storage fallback exemption. */
  const declaration = source === undefined ? '' : `export const ERROR_SOURCE = '${source}'\n`
  /** The package manifest deliberately differs from a valid semantic domain. */
  const root = createFixture(
    `${declaration}export const Code = {\n/** A source validation fixture scenario. */\ninvalid: 'INVALID_INPUT'\n} as const\n`,
    directory,
    true
  )
  mkdirSync(join(root, 'docs/contracts'), { recursive: true })
  writeFileSync(
    join(root, 'docs/contracts/error-codes.md'),
    `# Registry\n${REGISTRY_START}\n${REGISTRY_END}\n`
  )
  return root
}

/** Separate native cases ensure every declared mode executes even when the first is RED. */
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains missing declared source rejects in public mode ${modeIndex}`, () => {
    /** Each write-mode attempt owns a separate real document fixture. */
    const root = sourceDomainFixture(undefined)
    try {
      assert.throws(
        () => mode(root),
        (error) =>
          error.code === 'REGISTRY_SOURCE_MISSING' &&
          error.message.includes('packages/example/src/error-code.ts'),
        'SOURCE_DOMAIN_MISSING_SOURCE'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

/** Every disallowed shape or brand position is a distinct input in every public registry mode. */
const invalidDomains = [
  '',
  '@migaia/utils',
  'rpc/core',
  'rpcCore',
  'migaia.rpc',
  'migaia-core',
  'rpc.migaia.core',
  'premigaia',
  'Rpc.core',
  'rpc..core',
  'rpc.-x',
  'rpc_core',
  'rpc.x-',
  'rpc.x--y',
  '1rpc',
  'rpc.2'
]
/** Existing valid grammar remains accepted, including digits and more than three segments. */
const validDomains = [
  'rpc.transport.process',
  'micro-frontend.hub',
  'lifecycle',
  'rpc.v2',
  'rpc.transport.process.worker'
]
for (const value of invalidDomains)
  for (const [modeIndex, mode] of sourceValidationModes.entries())
    test(`source domains rejects ${JSON.stringify(value)} in public mode ${modeIndex}`, () => {
      /** Invalid input must stop in parsing before a registry write. */
      const root = sourceDomainFixture(value)
      try {
        assert.throws(
          () => mode(root),
          (error) =>
            error.code === 'REGISTRY_SOURCE_INVALID' &&
            error.message.includes('packages/example/src/error-code.ts') &&
            error.message.includes(JSON.stringify(value)),
          `SOURCE_DOMAIN_INVALID_SOURCE: ${JSON.stringify(value)}`
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
for (const value of validDomains)
  for (const [modeIndex, mode] of sourceValidationModes.entries())
    test(`source domains accepts ${value} in public mode ${modeIndex}`, () => {
      /** A matching generated region isolates source syntax from unrelated document staleness. */
      const root = sourceDomainFixture(value)
      try {
        writeErrorRegistry(root)
        assert.doesNotThrow(() => mode(root), `SOURCE_DOMAIN_VALID_SOURCE: ${value}`)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

/** The identical invalid value is exempt only below the exact packages/storage- prefix. */
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains accepts deferred storage prefix in public mode ${modeIndex}`, () => {
    /** This real parser input keeps the same invalid value used by the non-exempt cases. */
    const root = sourceDomainFixture('@migaia/utils', 'storage-x')
    try {
      writeErrorRegistry(root)
      assert.doesNotThrow(() => mode(root), 'SOURCE_DOMAIN_STORAGE_PREFIX_EXEMPT')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains rejects near storage prefix in public mode ${modeIndex}`, () => {
    /** Storagex is outside packages/storage- even though its name begins with storage. */
    const root = sourceDomainFixture('@migaia/utils', 'storagex')
    try {
      assert.throws(
        () => mode(root),
        (error) =>
          error.code === 'REGISTRY_SOURCE_INVALID' &&
          error.message.includes('packages/storagex/src/error-code.ts') &&
          error.message.includes(JSON.stringify('@migaia/utils')),
        'SOURCE_DOMAIN_STORAGE_PREFIX_ONLY'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

/** A package manifest cannot activate the exemption outside the storage directory prefix. */
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains rejects a storage manifest in a non-storage directory in public mode ${modeIndex}`, () => {
    /** Keep the illegal declaration under packages/example while changing only manifest identity. */
    const root = sourceDomainFixture('@migaia/utils')
    try {
      writeFileSync(
        join(root, 'packages/example/package.json'),
        JSON.stringify({ name: '@migaia/storage-x' })
      )
      assert.throws(
        () => mode(root),
        (error) =>
          error.code === 'REGISTRY_SOURCE_INVALID' &&
          error.message.includes('packages/example/src/error-code.ts') &&
          error.message.includes(JSON.stringify('@migaia/utils')),
        'SOURCE_DOMAIN_MANIFEST_NOT_EXEMPT'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

/** A nested source directory cannot activate the package-directory exemption. */
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains rejects a nested storage substring in public mode ${modeIndex}`, () => {
    /** The collector recursively scans this supported layer declaration in a non-storage package. */
    const root = sourceDomainFixture('@migaia/utils')
    try {
      /** Move the same declaration without changing its source value or owning manifest. */
      const nestedDirectory = join(root, 'packages/example/src/storage-x')
      mkdirSync(nestedDirectory)
      renameSync(
        join(root, 'packages/example/src/error-code.ts'),
        join(nestedDirectory, 'error-code.ts')
      )
      assert.throws(
        () => mode(root),
        (error) =>
          error.code === 'REGISTRY_SOURCE_INVALID' &&
          error.message.includes('packages/example/src/storage-x/error-code.ts') &&
          error.message.includes(JSON.stringify('@migaia/utils')),
        'SOURCE_DOMAIN_NESTED_STORAGE_NOT_EXEMPT'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

/** The temporary storage exemption preserves the old manifest fallback for missing declarations. */
for (const [modeIndex, mode] of sourceValidationModes.entries())
  test(`source domains accepts missing declared source under deferred storage prefix in public mode ${modeIndex}`, () => {
    /** The directory activates the exemption even when the manifest identity is non-storage. */
    const root = sourceDomainFixture(undefined, 'storage-x')
    try {
      writeErrorRegistry(root)
      assert.doesNotThrow(() => mode(root), 'SOURCE_DOMAIN_STORAGE_MISSING_EXEMPT')
      assert.deepEqual(
        checkErrorRegistrySources(root).map(({ source }) => source),
        ['@migaia/example'],
        'SOURCE_DOMAIN_STORAGE_FALLBACK_SOURCE'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

test('source domains known source readers contain no legacy error identities', () => {
  /**
   * These non-storage comparisons are independent witnesses; the deferred storage-plugin-browser reader stays
   * with its owner.
   */
  const readers = [
    ['packages/tray/src/runtime/create-runtime.ts', ".source === '@migaia/tray'"],
    ['packages/lifecycle/src/abort-factory.ts', ".source === '@migaia/lifecycle'"],
    ['packages/rpc-host/src/host/error-owner.ts', ".source === '@migaia/plugin-host'"]
  ]
  /** All known runtime comparisons must disappear, while package module specifiers stay valid. */
  const remaining = readers.filter(([file, literal]) =>
    readFileSync(join(repositoryRoot, file), 'utf8').includes(literal)
  )
  assert.deepEqual(remaining, [], 'SOURCE_DOMAIN_RUNTIME_READERS')
})

test('source domains cross-package readers reference owner constants instead of inlining migrated domains', () => {
  /** The included cross-package reader must import the owning package constant after migration. */
  const readers = [['packages/rpc-host/src/host/error-owner.ts', 'plugin.host']]
  /** A quoted new domain in this reader duplicates the owner's source contract. */
  const duplicated = readers.filter(([file, domain]) => {
    /** Public module specifiers retain package names and are not semantic domain literals. */
    const contents = readFileSync(join(repositoryRoot, file), 'utf8')
    return contents.includes(`'${domain}'`) || contents.includes(`"${domain}"`)
  })
  assert.deepEqual(duplicated, [], 'SOURCE_DOMAIN_INLINE_READER_DOMAINS')
})

test('attributes centralized code tables to their own semantic sources', () => {
  /** One canonical owner can declare multiple unchanged semantic domains. */
  const root = createFixture(
    `
/** Contract domain. @error-source fixture.contract */
export const ContractErrorCode = {
  /** Invalid contract input. */
  invalid: 'INVALID'
} as const
/** Endpoint domain. @error-source fixture.endpoint */
export const EndpointErrorCode = {
  /** Invalid endpoint input. */
  invalid: 'INVALID'
} as const
`,
    'example',
    true
  )
  try {
    assert.deepEqual(collectErrorRegistry(root), [
      { source: 'fixture.contract', code: 'INVALID', scenario: 'Invalid contract input.' },
      { source: 'fixture.endpoint', code: 'INVALID', scenario: 'Invalid endpoint input.' }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
