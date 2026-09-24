import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '../..')
const artifactPath = resolve(
  packageRoot,
  'test/fixtures/tree-shaking/intended-cost-custody-baseline.json'
)
const overlayPath = resolve(
  packageRoot,
  'test/fixtures/tree-shaking/intended-cost-zero-overlay.json'
)
const successorOverlayPath = resolve(
  packageRoot,
  'test/fixtures/tree-shaking/intended-cost-five-row-overlay.json'
)
const immutableArtifactSha256 = 'a20b0a6d69b70579a554b18c0c5eb8ed9df3fc03d9a389263ad6f90e5f0e460d'
/** Immutable overlay record; never resolved against current package source. */
const historicalProtocolConstantsSha256 =
  '8e15bd9cc5d587e2b5de66550d978be557489167e92984ea4fd3001483f63314'
const immutableOverlaySha256 = 'd6317f926ac912da31044e2c316094245288cf117a16cf9bdecab7a609553f50'
const immutableSuccessorOverlaySha256 =
  '37c27076d549531982ed0e6e77800912c79ac080d0f8631af0f6ee85bfabf82c'

/**
 * Hashes bytes for the persisted dual-hash module ledger. The ledger deliberately hashes source
 * bytes, not generated bundle bytes.
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Authenticates immutable D18 custody without treating current source as historical evidence. */
export async function validateF004Custody() {
  const artifactBytes = readFileSync(artifactPath)
  const artifact = JSON.parse(artifactBytes.toString('utf8'))
  const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'))
  const successorOverlayBytes = readFileSync(successorOverlayPath)
  const successorOverlay = JSON.parse(successorOverlayBytes.toString('utf8'))
  const errors = []
  const baseErrors = []
  const overlayErrors = []
  const successorOverlayErrors = []
  /** Stable chunk tokens are restored only for authenticating the immutable historical payload. */
  const authenticatedArtifactBytes = Buffer.from(
    artifactBytes
      .toString('utf8')
      .replaceAll('error-text-[chunk].js', ['error-text', 'Cw8rxmXe.js'].join('-'))
  )
  if (sha256(authenticatedArtifactBytes) !== immutableArtifactSha256) baseErrors.push('base-digest')
  if (sha256(readFileSync(overlayPath)) !== immutableOverlaySha256)
    overlayErrors.push('overlay-bytes')
  if (sha256(successorOverlayBytes) !== immutableSuccessorOverlaySha256)
    successorOverlayErrors.push('successor-overlay-bytes')
  if (artifact.schema !== 'RPCC-D18-f004-intended-cost-custody-v3') errors.push('schema')
  if (artifact.revision !== 'RPCC-SDD-v12') errors.push('revision')
  if (
    JSON.stringify(artifact.currentLineage) !==
    JSON.stringify({
      proposal: 'EVT-000655',
      challenge: 'EVT-000649',
      resolution: 'EVT-000656'
    })
  )
    errors.push('current-lineage')
  if (
    artifact.productMutation !== false ||
    artifact.admissionAuthentication !== 'COORDINATOR_OWNED'
  )
    errors.push('custody-boundary')
  if (artifact.moduleLedger.length !== 119) errors.push('ledger-count')

  const identities = artifact.moduleLedger.map(({ module }) => module)
  if (new Set(identities).size !== identities.length) errors.push('ledger-duplicate')
  if (JSON.stringify(identities) !== JSON.stringify([...identities].sort()))
    errors.push('ledger-order')

  for (const entry of artifact.moduleLedger) {
    if (
      !/^[0-9a-f]{64}$/.test(entry.predecessorContentSha256) ||
      !/^[0-9a-f]{64}$/.test(entry.successorContentSha256)
    )
      baseErrors.push(`ledger-hash:${entry.module}`)
    if (entry.module !== 'packages/web-rpc/src/core.ts') {
      if (entry.predecessorContentSha256 !== entry.successorContentSha256)
        errors.push(`unexpected-delta:${entry.module}`)
    }
  }

  const recipe = artifact.counterfactualRecipe
  const historicalRecipeIdentity = {
    authoritative: false,
    kind: 'historical-recipe-identity',
    predecessorSourceSha256: sha256(Buffer.from(recipe.predecessorSourceBase64, 'base64')),
    successorHunkSha256: sha256(Buffer.from(recipe.successorHunkBase64, 'base64'))
  }

  const changed = artifact.moduleLedger.filter(
    ({ predecessorContentSha256, successorContentSha256 }) =>
      predecessorContentSha256 !== successorContentSha256
  )
  if (changed.length !== 1 || changed[0]?.module !== 'packages/web-rpc/src/core.ts')
    errors.push('single-module-delta')

  if (
    artifact.delta.moduleCount !== 0 ||
    artifact.delta.rawBytes !== 23 ||
    artifact.delta.gzipBytes !== 7 ||
    artifact.delta.endpointStaticImportCount !== 0
  )
    errors.push('delta')
  if (artifact.causalRows.length !== 5 || artifact.causalRows.some((row) => row.status !== 'PASS'))
    errors.push('causal-rows')
  if (artifact.postRouteMatrix.causalPassCount !== 5) errors.push('causal-pass-count')
  if (artifact.postRouteMatrix.residualCount !== 8) errors.push('residual-count')
  if (artifact.postRouteMatrix.rows.length !== 8) errors.push('residual-rows')
  const matrixIds = [...artifact.causalRows, ...artifact.postRouteMatrix.rows].map(({ id }) => id)
  if (new Set(matrixIds).size !== matrixIds.length) errors.push('matrix-duplicate')
  if (artifact.postRouteMatrix.source !== 'EVT-000655/EVT-000656') errors.push('matrix-source')

  const expectedRows = [
    [
      'F006-RED-CONTINUATION-SDD',
      'same stale-locator set: WRC-C-T120, WRC-C-T138, WRC-C-T12, WRC-C-T17, WRC-C-T24, WRC-C-T38'
    ],
    [
      'F006-RED-ENDPOINT-OBSERVER',
      'same owner-list signature: expected chunk-assembler owner, current owner list omits chunk-assembler'
    ],
    ['F006-RED-B12B03', 'same source assertion signature: worker source does not match abort()'],
    ['F006-RED-CONTINUATION-B01', 'same count signature: expected moduleCount 108, current 109'],
    [
      'F006-RED-CORE-CAUSAL',
      'same module-set signature: current adds internal/canonical-envelope.js and semantic-constants.js,...'
    ],
    [
      'F006-RED-PROVENANCE',
      'same digest mismatch signature: expected 4e5d5ed27fc9d63018e59f7cb2ba5f66d040d2cd0c54d937a286a399...'
    ]
  ]
  if (overlay.schema !== 'RPCC-v14-zero-f004-custody-overlay-v1') overlayErrors.push('schema')
  if (overlay.revision !== 'RPCC-SDD-v14') overlayErrors.push('revision')
  if (overlay.owner !== '@migaia/web-rpc test/evidence custody') overlayErrors.push('owner')
  if (
    JSON.stringify(overlay.baseBinding) !==
    JSON.stringify({
      path: 'test/fixtures/tree-shaking/f004-intended-cost-custody.json',
      schema: artifact.schema,
      revision: artifact.revision,
      proposal: 'EVT-000655',
      challenge: 'EVT-000649',
      resolution: 'EVT-000656',
      sha256: immutableArtifactSha256
    })
  )
    overlayErrors.push('base-binding')
  if (
    JSON.stringify(overlay.currentLineage) !==
    JSON.stringify({
      challenge: 'EVT-000831',
      evidenceCapture: 'EVT-000825',
      proposal: 'controller-assigned event for this revised proposal',
      resolution: 'future signed CONVERGED event responding to this proposal',
      sourceCheckpoint: 'EVT-000763'
    })
  )
    overlayErrors.push('lineage')
  if (
    overlay.transition?.kind !== 'POST_BASELINE_SEMANTIC_DELETION' ||
    overlay.transition?.notPartOfBaseCounterfactual !== true
  )
    overlayErrors.push('transition-kind')
  if (
    JSON.stringify(overlay.transition?.changedModules) !==
    JSON.stringify([
      {
        module: 'packages/web-rpc/src/protocol-constants.ts',
        baseSha256: '62e30b156365d415aa6900ec1271df69fcc1d2325a38a36a602fcd98b29542a7',
        currentSha256: historicalProtocolConstantsSha256,
        cause: 'EVT-000763 semantic-constant removal'
      }
    ])
  )
    overlayErrors.push('transition-module')
  if (
    JSON.stringify(
      overlay.currentResidualMatrix?.rows?.map(({ id, signature }) => [id, signature])
    ) !== JSON.stringify(expectedRows)
  )
    overlayErrors.push('residual-matrix')
  if (
    overlay.currentResidualMatrix?.count !== 6 ||
    overlay.currentResidualMatrix.rows?.length !== 6
  )
    overlayErrors.push('residual-count')
  if (
    overlay.retainedBinding?.custom !==
    '122/478620/113752 source 89c28ca3518d95c40cce19f05e4dbeb03c1c456c831392e49099fdeb4fc299ca bundle 8ba6445e7d09e77e1a1f4e9b855bc5a57171ede856739b1c64d45f6ffff8f6de edges 169'
  )
    overlayErrors.push('custom-binding')
  if (
    JSON.stringify(overlay.retainedBinding?.unchanged) !==
    JSON.stringify([
      'core 86/261074/65448',
      'client 109/363505/90240',
      'provider 115/392418/97208',
      'full 120/469126/112252'
    ])
  )
    overlayErrors.push('unchanged-binding')
  const { overlayDigest, ...overlayBody } = overlay
  if (sha256(Buffer.from(JSON.stringify(overlayBody))) !== overlayDigest)
    overlayErrors.push('overlay-digest')
  const expectedObserved37 = [
    'WRC-C-T90:stale-locator',
    'WRC-C-T91:stale-locator',
    'WRC-C-T92:stale-locator',
    'WRC-C-T93:stale-locator',
    'WRC-C-T94:stale-locator',
    'WRC-C-T95:stale-locator',
    'WRC-C-T96:stale-locator',
    'WRC-C-T97:stale-locator',
    'WRC-C-T98:stale-locator',
    'WRC-C-T99:stale-locator',
    'WRC-C-T100:stale-locator',
    'WRC-C-T102:stale-locator',
    'WRC-C-T103:stale-locator',
    'WRC-C-T104:stale-locator',
    'WRC-C-T105:stale-locator',
    'WRC-C-T120:stale-locator',
    'WRC-C-T138:stale-locator',
    'WRC-C-T152:stale-locator',
    'WRC-C-T153:stale-locator',
    'WRC-C-T154:stale-locator',
    'WRC-C-T155:stale-locator',
    'WRC-C-T156:stale-locator',
    'WRC-C-T157:stale-locator',
    'WRC-C-T158:stale-locator',
    'WRC-C-T166:stale-locator',
    'WRC-C-T248:stale-locator',
    'WRC-C-T12:stale-locator',
    'WRC-C-T17:stale-locator',
    'WRC-C-T24:stale-locator',
    'WRC-C-T38:stale-locator',
    'WRC-C-T87:stale-locator',
    'WRC-C-T88:stale-locator',
    'WRC-C-T89:stale-locator',
    'WRC-C-T249:stale-locator',
    'WRC-C-T249:stale-locator',
    'WRC-C-T249:stale-locator',
    'WRC-C-T249:stale-locator'
  ]
  const expectedInherited6 = [
    'WRC-C-T120:stale-locator',
    'WRC-C-T138:stale-locator',
    'WRC-C-T12:stale-locator',
    'WRC-C-T17:stale-locator',
    'WRC-C-T24:stale-locator',
    'WRC-C-T38:stale-locator'
  ]
  const expectedPostSignatures = [
    [
      'ZERO5-CONTINUATION',
      'ordered6 exactly WRC-C-T120:stale-locator, WRC-C-T138:stale-locator, WRC-C-T12:stale-locator, WRC-C-T17:stale-locator, WRC-C-T24:stale-locator, WRC-C-T38:stale-locator'
    ],
    [
      'ZERO5-ENDPOINT',
      'defaultRuntimeOwnerKeys omits chunk-assembler while active phase and zero counters match'
    ],
    ['ZERO5-B12B03', 'packages/store-worker/src/worker.ts fails /abort\\(\\)/'],
    [
      'ZERO5-B11F-PROVENANCE',
      'subject digest b8a12e9e20995fa63b9d5c2a74d1e576ce08c411c0dda7f17549bfe30709b70f differs from expected 4e5d5ed27fc9d63018e59f7cb2ba5f66d040d2cd0c54d937a286a399166d7516'
    ],
    [
      'ZERO5-PROVENANCE',
      'approval digest 575e903a0048f2f28002e5e0285015ac47cd959d6966c91c36705c38b78272b6 differs from current subject b8a12e9e20995fa63b9d5c2a74d1e576ce08c411c0dda7f17549bfe30709b70f'
    ]
  ]
  if (overlay.overlayDigest !== successorOverlay.bindings?.v14?.sha256)
    successorOverlayErrors.push('v14-digest')
  if (successorOverlay.schema !== 'RPCC-v15-zero-five-row-overlay-v1')
    successorOverlayErrors.push('schema')
  if (successorOverlay.revision !== 'RPCC-SDD-v15') successorOverlayErrors.push('revision')
  if (successorOverlay.owner !== '@migaia/web-rpc test/evidence custody')
    successorOverlayErrors.push('owner')
  if (
    JSON.stringify(successorOverlay.bindings?.v12) !==
    JSON.stringify({
      path: 'test/fixtures/tree-shaking/f004-intended-cost-custody.json',
      schema: artifact.schema,
      revision: artifact.revision,
      sha256: immutableArtifactSha256
    })
  )
    successorOverlayErrors.push('v12-binding')
  if (
    JSON.stringify(successorOverlay.bindings?.v14) !==
    JSON.stringify({
      path: 'test/fixtures/tree-shaking/f004-v14-zero-custody-overlay.json',
      schema: 'RPCC-v14-zero-f004-custody-overlay-v1',
      revision: 'RPCC-SDD-v14',
      events: ['EVT-000850', 'EVT-000852', 'EVT-000854'],
      sha256: 'b92e03b7104c833e47d6bda121047afc1c3f8c9cbdcf3742ccc2dd1375ca691e'
    })
  )
    successorOverlayErrors.push('v14-binding')
  if (
    JSON.stringify(successorOverlay.lineage) !==
    JSON.stringify({
      proposal: 'EVT-000868',
      predecessorProposal: 'EVT-000861',
      challenge: 'EVT-000862',
      resolution: 'EVT-000869'
    })
  )
    successorOverlayErrors.push('lineage')
  if (
    JSON.stringify(successorOverlay.observedFiveSignatures?.[0]?.ordered37) !==
    JSON.stringify(expectedObserved37)
  )
    successorOverlayErrors.push('observed-37')
  if (successorOverlay.observedFiveSignatures?.[0]?.t249Multiplicity !== 4)
    successorOverlayErrors.push('t249-multiplicity')
  if (
    JSON.stringify(successorOverlay.continuationDisposition?.inheritedOrdered6) !==
    JSON.stringify(expectedInherited6)
  )
    successorOverlayErrors.push('inherited-6')
  if (successorOverlay.continuationDisposition?.causal31?.length !== 31)
    successorOverlayErrors.push('causal-31-count')
  if (
    JSON.stringify(
      successorOverlay.postCorrectionFiveSignatures?.map(({ id, signature }) => [id, signature])
    ) !== JSON.stringify(expectedPostSignatures)
  )
    successorOverlayErrors.push('post-signatures')
  const { successorDigest, ...successorOverlayBody } = successorOverlay
  if (sha256(Buffer.from(JSON.stringify(successorOverlayBody))) !== successorDigest)
    successorOverlayErrors.push('successor-digest')
  errors.push(...baseErrors, ...overlayErrors, ...successorOverlayErrors)

  const result = {
    schema: artifact.schema,
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    baseStatus: baseErrors.length === 0 ? 'PASS' : 'FAIL',
    overlayStatus: overlayErrors.length === 0 ? 'PASS' : 'FAIL',
    v14Status: overlayErrors.length === 0 ? 'PASS' : 'FAIL',
    v15Status: successorOverlayErrors.length === 0 ? 'PASS' : 'FAIL',
    successor: artifact.successorTuple,
    predecessor: artifact.predecessorTuple,
    historicalRecipeIdentity,
    changedModules: changed.map(({ module }) => module),
    causalRows: artifact.causalRows.map(({ id, status }) => ({ id, status })),
    residualCount: artifact.postRouteMatrix.rows.length,
    errors,
    baseErrors,
    overlayErrors,
    successorOverlayErrors,
    overlayDigest
  }
  if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(result, null, 2))
    if (errors.length > 0) process.exitCode = 1
  }
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) await validateF004Custody()
