import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Node } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import legacyTitles from '../fixtures/legacy-test-titles.json'
import { parseSourceTree, type ISourceTree } from '../fixtures/source-tree.ts'

/** Root used by migrated Vitest suite and source-literal scan. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** All eight runtime owners and the private integration owner participate in the same oracle. */
const testOwners = [
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-pool',
  'rpc-plugin-devtools',
  'rpc-integration'
] as const
/** Exact file ownership from the package migration; CI never depends on ignored local scratch files. */
const migratedFiles: Readonly<Record<string, string>> = {
  'packages/rpc-contract/test/acceptance.test.ts':
    'packages/rpc-contract/test/contract/acceptance.test.ts',
  'packages/rpc-contract/test/contract.test.ts':
    'packages/rpc-contract/test/contract/contract.test.ts',
  'packages/rpc-contract/test/error-identity.test.ts':
    'packages/rpc-contract/test/contract/error-identity.test.ts',
  'packages/rpc-contract/test/types.test.ts': 'packages/rpc-contract/test/contract/types.test.ts',
  'packages/web-rpc/test/adapters/broadcast-channel.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/broadcast-channel.test.ts',
  'packages/web-rpc/test/adapters/memory.test.ts':
    'packages/rpc-host/test/core/adapters/memory.test.ts',
  'packages/web-rpc/test/adapters/message-port.test.ts':
    'packages/rpc-host/test/core/adapters/message-port.test.ts',
  'packages/web-rpc/test/adapters/rtc-data-channel.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/rtc-data-channel.test.ts',
  'packages/web-rpc/test/adapters/window-source-proof.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/window-source-proof.test.ts',
  'packages/web-rpc/test/adapters/worker-lifecycle.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/worker-lifecycle.test.ts',
  'packages/web-rpc/test/adapters/worker-metadata.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/worker-metadata.test.ts',
  'packages/web-rpc/test/architecture.test.ts': 'packages/rpc-host/test/core/architecture.test.ts',
  'packages/web-rpc/test/attachment-normalization.test.ts':
    'packages/rpc-host/test/core/attachment-normalization.test.ts',
  'packages/web-rpc/test/authentication.integration.test.ts':
    'packages/rpc-host/test/core/authentication.integration.test.ts',
  'packages/web-rpc/test/composed-fanout-contract.test.ts':
    'packages/rpc-host/test/core/composed-fanout-contract.test.ts',
  'packages/web-rpc/test/composed-ping-parity.test.ts':
    'packages/rpc-host/test/core/composed-ping-parity.test.ts',
  'packages/web-rpc/test/composed-receiver-identity.test.ts':
    'packages/rpc-host/test/core/composed-receiver-identity.test.ts',
  'packages/web-rpc/test/composed-remote-cancellation.test.ts':
    'packages/rpc-host/test/core/composed-remote-cancellation.test.ts',
  'packages/web-rpc/test/composed-variation-capability.test.ts':
    'packages/rpc-host/test/core/composed-variation-capability.test.ts',
  'packages/web-rpc/test/construction-hooks.test.ts':
    'packages/rpc-host/test/core/construction-hooks.test.ts',
  'packages/web-rpc/test/contract-endpoint.test.ts':
    'packages/rpc-host/test/core/contract-endpoint.test.ts',
  'packages/web-rpc/test/custom-feature.test.ts':
    'packages/rpc-host/test/core/custom-feature.test.ts',
  'packages/web-rpc/test/discovery-attachment-boundaries.test.ts':
    'packages/rpc-host/test/core/discovery-attachment-boundaries.test.ts',
  'packages/web-rpc/test/discovery-semantic-coverage.test.ts':
    'packages/rpc-host/test/core/discovery-semantic-coverage.test.ts',
  'packages/web-rpc/test/duplicate-owner-contract.test.ts':
    'packages/rpc-host/test/core/duplicate-owner-contract.test.ts',
  'packages/web-rpc/test/endpoint-kernel.test.ts':
    'packages/rpc-host/test/core/endpoint-kernel.test.ts',
  'packages/web-rpc/test/endpoint.observer.test.ts':
    'packages/rpc-host/test/core/endpoint.observer.test.ts',
  'packages/web-rpc/test/errors.test.ts': 'packages/rpc-host/test/core/errors.test.ts',
  'packages/web-rpc/test/event-subscriber-compat.test.ts':
    'packages/rpc-host/test/core/event-subscriber-compat.test.ts',
  'packages/web-rpc/test/hardening-regressions.spec.ts':
    'packages/rpc-host/test/core/hardening-regressions.spec.ts',
  'packages/web-rpc/test/internal-ownership-boundaries.test.ts':
    'packages/rpc-host/test/core/internal-ownership-boundaries.test.ts',
  'packages/web-rpc/test/internal/async-control.test.ts':
    'packages/rpc-host/test/core/internal/async-control.test.ts',
  'packages/web-rpc/test/internal/chunk.test.ts':
    'packages/rpc-host/test/core/internal/chunk.test.ts',
  'packages/web-rpc/test/internal/contract.test.ts':
    'packages/rpc-host/test/core/internal/contract.test.ts',
  'packages/web-rpc/test/internal/discovery-registry.test.ts':
    'packages/rpc-host/test/core/internal/discovery-registry.test.ts',
  'packages/web-rpc/test/internal/hooks.test.ts':
    'packages/rpc-host/test/core/internal/hooks.test.ts',
  'packages/web-rpc/test/internal/id.test.ts': 'packages/rpc-host/test/core/internal/id.test.ts',
  'packages/web-rpc/test/internal/identity.test.ts':
    'packages/rpc-host/test/core/internal/identity.test.ts',
  'packages/web-rpc/test/internal/listener-safety.test.ts':
    'packages/rpc-host/test/core/internal/listener-safety.test.ts',
  'packages/web-rpc/test/internal/message-listener-hub.test.ts':
    'packages/rpc-host/test/core/internal/message-listener-hub.test.ts',
  'packages/web-rpc/test/internal/operation-scope.test.ts':
    'packages/rpc-host/test/core/internal/operation-scope.test.ts',
  'packages/web-rpc/test/internal/outbound-sender.test.ts':
    'packages/rpc-host/test/core/internal/outbound-sender.test.ts',
  'packages/web-rpc/test/internal/peers.test.ts':
    'packages/rpc-host/test/core/internal/peers.test.ts',
  'packages/web-rpc/test/internal/pending.test.ts':
    'packages/rpc-host/test/core/internal/pending.test.ts',
  'packages/web-rpc/test/internal/provider-admission.test.ts':
    'packages/rpc-host/test/core/internal/provider-admission.test.ts',
  'packages/web-rpc/test/internal/provider-executor-result.test.ts':
    'packages/rpc-host/test/core/internal/provider-executor-result.test.ts',
  'packages/web-rpc/test/internal/provider.test.ts':
    'packages/rpc-host/test/core/internal/provider.test.ts',
  'packages/web-rpc/test/internal/replay.test.ts':
    'packages/rpc-host/test/core/internal/replay.test.ts',
  'packages/web-rpc/test/internal/request-replay-ledger.test.ts':
    'packages/rpc-host/test/core/internal/request-replay-ledger.test.ts',
  'packages/web-rpc/test/internal/resource-scope.test.ts':
    'packages/rpc-host/test/core/internal/resource-scope.test.ts',
  'packages/web-rpc/test/internal/safe-value.test.ts':
    'packages/rpc-host/test/core/internal/safe-value.test.ts',
  'packages/web-rpc/test/internal/settlement.test.ts':
    'packages/rpc-host/test/core/internal/settlement.test.ts',
  'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts':
    'packages/rpc-host/test/core/internal/web-rpc-plugin-host.test.ts',
  'packages/web-rpc/test/middleware-ports.test.ts':
    'packages/rpc-host/test/core/middleware-ports.test.ts',
  'packages/web-rpc/test/middleware/abort.test.ts':
    'packages/rpc-host/test/core/middleware/abort.test.ts',
  'packages/web-rpc/test/middleware/authentication.test.ts':
    'packages/rpc-host/test/core/middleware/authentication.test.ts',
  'packages/web-rpc/test/middleware/chunk.test.ts':
    'packages/rpc-host/test/core/middleware/chunk.test.ts',
  'packages/web-rpc/test/middleware/connect.test.ts':
    'packages/rpc-host/test/core/middleware/connect.test.ts',
  'packages/web-rpc/test/middleware/contract.test.ts':
    'packages/rpc-host/test/core/middleware/contract.test.ts',
  'packages/web-rpc/test/middleware/feature.test.ts':
    'packages/rpc-host/test/core/middleware/feature.test.ts',
  'packages/web-rpc/test/middleware/hooks.test.ts':
    'packages/rpc-host/test/core/middleware/hooks.test.ts',
  'packages/web-rpc/test/middleware/middleware.test.ts':
    'packages/rpc-host/test/core/middleware/middleware.test.ts',
  'packages/web-rpc/test/middleware/ping.test.ts':
    'packages/rpc-host/test/core/middleware/ping.test.ts',
  'packages/web-rpc/test/middleware/protocol.test.ts':
    'packages/rpc-host/test/core/middleware/protocol.test.ts',
  'packages/web-rpc/test/middleware/timeout.test.ts':
    'packages/rpc-host/test/core/middleware/timeout.test.ts',
  'packages/web-rpc/test/middleware/uuid.test.ts':
    'packages/rpc-host/test/core/middleware/uuid.test.ts',
  'packages/web-rpc/test/plugin-host/projection.test.ts':
    'packages/rpc-host/test/core/plugin-host/projection.test.ts',
  'packages/web-rpc/test/plugin-host/topology-adapter.test.ts':
    'packages/rpc-host/test/core/plugin-host/topology-adapter.test.ts',
  'packages/web-rpc/test/property.test.ts': 'packages/rpc-host/test/core/property.test.ts',
  'packages/web-rpc/test/provider-event-delegate.test.ts':
    'packages/rpc-host/test/core/provider-event-delegate.test.ts',
  'packages/web-rpc/test/provider-production-seam.test.ts':
    'packages/rpc-host/test/core/provider-production-seam.test.ts',
  'packages/web-rpc/test/root-disposal.test.ts':
    'packages/rpc-host/test/core/root-disposal.test.ts',
  'packages/web-rpc/test/storage-v2-t53-event-trace.test.ts':
    'packages/rpc-host/test/core/storage-v2-event-trace.test.ts',
  'packages/web-rpc/test/time-port.test.ts': 'packages/rpc-host/test/core/time-port.test.ts',
  'packages/web-rpc/test/topology-rollback.test.ts':
    'packages/rpc-host/test/core/topology-rollback.test.ts',
  'packages/web-rpc/test/transaction-contract.test.ts':
    'packages/rpc-host/test/core/transaction-contract.test.ts',
  'packages/web-rpc/test/tree-shaking/continuation-b01.red.test.ts':
    'packages/rpc-host/test/core/tree-shaking/continuation-retained-graph.test.ts',
  'packages/web-rpc/test/tree-shaking/core-retained-causal.test.ts':
    'packages/rpc-host/test/core/tree-shaking/core-retained-causal.test.ts',
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts':
    'packages/rpc-host/test/core/tree-shaking/retained-allocation-attribution.test.ts',
  'packages/web-rpc/test/tree-shaking/slim-attachment-hardening.test.ts':
    'packages/rpc-host/test/core/tree-shaking/slim-attachment-hardening.test.ts',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts':
    'packages/rpc-host/test/core/tree-shaking/static-composition-contracts.test.ts',
  'packages/web-rpc/test/type-contract.test.ts':
    'packages/rpc-host/test/core/type-contract.test.ts',
  'packages/web-rpc/test/wire.test.ts': 'packages/rpc-host/test/core/wire.test.ts',
  'packages/web-rpc/test/worker-deterministic.test.ts':
    'packages/rpc-host/test/core/worker-deterministic.test.ts'
}
/** Repository-relative result names distinguish matching titles in different package owners. */
const repositoryRoot = resolve(packageRoot, '../..')
/** Only retired historical custody suites may disappear from default test titles. */
const retiredSuites = new Set([
  'approved-migration-candidate.test.ts',
  'provenance.test.ts',
  'delivery-successor-transaction.test.ts',
  'intended-cost-custody.test.ts',
  'error-serialization.test.ts',
  // The corresponding private preset implementations and their exclusive cost harness were deleted.
  'core-retained-causal.test.ts',
  'continuation-b01.red.test.ts',
  'retained-inventory-equality.test.ts'
])
/** Exact historical titles retired by rpc-layering after deleting unused control code. */
const retiredLayeringTitles = new Set([
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix selected control roots keep dependencies private and disposal endpoint-local',
  // Exact old preset selection, alias and cost titles retire with their deleted implementations.
  'packages/web-rpc/test/composed-ping-parity.test.ts::composed root ping() parity root createEndpoint is the same value as createFullEndpoint',
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts::retained and allocation attribution binds pending byte drift to the current and historical retained graphs',
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts::retained and allocation attribution proves selected endpoint owner allocation is unique and attributable',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts accepts every pair with one canonical outbound dependency closure',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts constructs and disposes each remaining valid native singleton root',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts constructs and disposes the valid client singleton preset',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts constructs and disposes the valid provider singleton preset',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts observes the current root without treating historical cost custody as live identity',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts observes the exact full runtime allocation topology through the root factory',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts projects selected root keys from exposed metadata',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes feature: ../../src/features/canonical-chunk.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes feature: ../../src/features/control.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes feature: ../../src/features/discovery.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes feature: ../../src/features/outbound.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes feature: ../../src/features/provider.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes preset: ../../src/client.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes preset: ../../src/core.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes preset: ../../src/full.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts publishes preset: ../../src/provider.js',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts requires every baseline owner category to declare a non-empty owner list',
  'packages/web-rpc/test/type-contract.test.ts::factory type contract discriminates discovery mode and ping capability',

  // Unconsumed datagram-only carrier is deleted; reliable webTransportPlugin remains covered separately.
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter contains a reader acquisition failure at the transport boundary',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter contains an asynchronous reader failure at the transport boundary',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter declares its datagram reader and writer as owned',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter keeps the transport-owned reader across unsubscribe and resubscribe',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter returns reader release failures from close',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter shares the in-flight close promise',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter surfaces writer cleanup failure from close',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter treats a normal datagram EOF as terminal',
  'packages/web-rpc/test/adapters/web-transport.test.ts::WebTransport datagram adapter waits for the read owner and rejects operations after close',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry purges expired unordered aborts before applying its hard cap',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry deduplicates control tasks before they reach the wire owner',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry keeps variation admission in the control owner',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry does not consume variation quota when replay capacity is full',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry requires a boolean lease decision and skips tombstones when retain rejects',
  'packages/web-rpc/test/internal/async-control.test.ts::async control removes abort listeners when delay completes',
  'packages/web-rpc/test/internal/async-control.test.ts::async control rolls back earlier delay listeners when a later registration fails',
  'packages/web-rpc/test/internal/async-control.test.ts::async control observes delay listener cleanup failures without replacing the result',
  'packages/web-rpc/test/internal-ownership-boundaries.test.ts::internal ownership boundary semantics keeps control and variation admission duplicate-safe and expiry-aware',
  // Final-host reachability deletes these exact test-only owners; current lifecycle owners stay covered.
  'packages/web-rpc/test/internal/peers.test.ts::PeerRegistry bounds learned peers without evicting configured targets',
  'packages/web-rpc/test/internal/peers.test.ts::PeerRegistry clears all peer state at endpoint disposal',
  'packages/web-rpc/test/internal/peers.test.ts::PeerRegistry expires learned peers while retaining configured targets',
  'packages/web-rpc/test/internal/settlement.test.ts::settlement reports cleanup failure without replacing the primary result',
  'packages/web-rpc/test/internal/settlement.test.ts::settlement runs cleanup and settles only once',
  'packages/web-rpc/test/internal/settlement.test.ts::settlement still settles when cleanup throws',
  'packages/web-rpc/test/property.test.ts::property invariants keeps settlement exactly-once across arbitrary completion races',
  'packages/web-rpc/test/duplicate-owner-contract.test.ts::candidate-specific duplicate-owner contracts keeps peer leases in PeerRegistry',
  'packages/web-rpc/test/hardening-regressions.spec.ts::#1 splitUtf8 会产出超过 maxBytes 的分片，接收端必然拒收 chunk budget 小于最大 UTF-8 code point 时拒绝配置',
  'packages/web-rpc/test/internal-ownership-boundaries.test.ts::internal ownership boundary semantics expires learned peer knowledge while retaining configured-peer semantics'
])

/** Map each non-retired frozen title to its required current file and test name. */
function migratedTitle(title: string): string | undefined {
  const [file, name] = title.split('::')
  if (retiredSuites.has(file.split('/').at(-1) ?? '') || retiredLayeringTitles.has(title))
    return undefined
  /** The required owner is fixed by migration, never inferred from any matching report title. */
  const path = migratedFiles[file]
  expect(path, file).toBeDefined()
  const mappedName = name
    .replace(
      'preserves configured peers while bounding learned peers and translating cleanup leaves',
      'preserves cleanup leaves when translating disposal failures'
    )
    .replace(
      'publishes only runtime-neutral root/framing exports and dependencies',
      'publishes only runtime-neutral contract/framing exports with an explicit dependency allowlist'
    )
    .replace('tagWebRpcError keeps', 'tagRpcError keeps')
    .replace('38 unique codes', '22 unique codes')
    .replace('22 unique codes', '23 unique codes')
    .replace('23 unique codes', '24 unique codes')
    .replace('24 unique codes', '25 unique codes')
    .replace('25 unique codes', '26 unique codes')
    .replace('26 unique codes', '31 unique codes')
    // The title no longer carries a count, so registering a code does not rename the test.
    .replace(
      'keeps the (source, code) contract: 31 unique codes and a constant source',
      'keeps unique registered codes and a constant source'
    )
    .replace(
      'does not let a hostile code getter escape',
      'reports a hostile code getter as PROPERTY_READ_FAILED with the original cause'
    )
    .replace(
      'uses the canonical UNKNOWN code for untagged and cyclic errors alike',
      'uses the canonical UNKNOWN code for untagged errors and marks cyclic edges truncated'
    )
    .replace('a WebRpcLifecycleError', 'a RpcLifecycleError')
    .replace('real WebRpcPluginHost Promise', 'real RpcPluginHost Promise')
  return `${path}::${mappedName}`
}

/** Collect source files for a literal scan, excluding historical data snapshots. */
function testSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : testSources(path)
    return /\.(?:ts|mts|mjs|js)$/.test(entry.name) ? [path] : []
  })
}

/** One static string literal with the parsed file that gives it syntactic context. */
type IStringSite = {
  /** The `Literal` or substitution-free `TemplateLiteral` node. */
  readonly node: Node
  /** Literal content. */
  readonly text: string
  /** Parsed file holding the node. */
  readonly tree: ISourceTree
}

/** Statement-level nodes stop the search for an enclosing assertion call. */
function isStatement(node: Node): boolean {
  return /(?:Statement|Declaration)$/u.test(node.type)
}

/**
 * Retain each static literal's context so expected-absence data is not mistaken for an active
 * reader.
 */
function stringsIn(file: string): IStringSite[] {
  const tree = parseSourceTree(file, readFileSync(file, 'utf8'))
  /** Visit each descendant once and retain literal content, not surrounding syntax. */
  return tree.nodes.flatMap<IStringSite>((node) =>
    node.type === 'Literal' && typeof node.value === 'string'
      ? [{ node, text: node.value, tree }]
      : node.type === 'TemplateLiteral' && node.expressions.length === 0
        ? [{ node, text: node.quasis[0]!.value.cooked ?? '', tree }]
        : []
  )
}

/** These expressions actually resolve a module or filesystem location; comparison tables do not. */
function isReaderLiteral({ node, tree }: IStringSite): boolean {
  /** Immediate syntax distinguishes a real resolver argument from a historical comparison value. */
  const parent = tree.parentOf(node)
  if (!parent) return false
  if (
    parent.type === 'ImportDeclaration' ||
    parent.type === 'ExportNamedDeclaration' ||
    parent.type === 'ExportAllDeclaration' ||
    parent.type === 'TSImportType'
  )
    return true
  if (parent.type === 'ImportExpression') return parent.source === node
  if (parent.type === 'NewExpression')
    return tree.textOf(parent.callee) === 'URL' && parent.arguments[0] === node
  if (parent.type !== 'CallExpression' || parent.arguments[0] !== node) return false
  return /^(?:import|require|readFileSync|import\.meta\.glob|vi\.(?:mock|doMock|unmock|doUnmock))$/.test(
    tree.textOf(parent.callee)
  )
}

/** Explicit negative export/source assertions retain their historical absent-key inputs. */
function expectsAbsence({ node, tree }: IStringSite): boolean {
  for (let parent = tree.parentOf(node); parent; parent = tree.parentOf(parent)) {
    if (parent.type === 'CallExpression') {
      /** Negative assertion syntax keeps its exact absent source/export key meaningful. */
      const expression = tree.textOf(parent.callee)
      if (
        expression.includes('.not.') ||
        expression.includes('.rejects.') ||
        expression.endsWith('.toThrow') ||
        expression.endsWith('.toBeUndefined')
      )
        return true
      /** First argument of the assertion call. */
      const first = parent.arguments[0]
      if (
        /\.(?:toBe|toEqual)$/.test(expression) &&
        first?.type === 'Literal' &&
        first.value === false
      )
        return true
    }
    if (isStatement(parent))
      /** A `@ts-expect-error` statement asserts that its specifier no longer resolves. */
      return tree.leadingCommentsOf(parent).includes('@ts-expect-error')
  }
  return false
}

/** Exact current files may use either emitted .js specifiers or their TypeScript source targets. */
function readerExists(path: string): boolean {
  /** A Vite source glob must select real files rather than a nonexistent wildcard pathname. */
  const wildcard = path.search(/[?*{]/)
  if (wildcard !== -1) return globSync(path).length > 0
  return existsSync(path) || existsSync(path.replace(/\.js$/, '.ts'))
}

describe('migrated suite parity', () => {
  it('keeps every non-retired legacy file and title passed', () => {
    /** Frozen expectations choose exact owner files, including every current concern in those files. */
    const expected = [...legacyTitles.contract, ...legacyTitles.core]
      .map(migratedTitle)
      .filter((title): title is string => title !== undefined)
    /**
     * One child pool runs each actual legacy file once rather than repeating the whole new SDK
     * suite.
     */
    const files = [
      ...new Set(expected.map((title) => resolve(repositoryRoot, title.split('::')[0])))
    ]
    const run = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        join(packageRoot, 'vitest.suite-parity.config.ts'),
        '--reporter=json',
        '--coverage.enabled=false',
        ...files
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CI: '1', RPC_SUITE_PARITY_COLLECT: '1' }
      }
    )
    const report = JSON.parse(
      run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)
    ) as {
      testResults: {
        name: string
        message?: string
        assertionResults: { fullName: string; status: string; failureMessages?: string[] }[]
      }[]
    }
    /** Preserve the actual nested failure rather than only the last passing report rows. */
    const failures = report.testResults.flatMap((file) =>
      file.assertionResults
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          file: file.name,
          title: item.fullName,
          failures: item.failureMessages
        }))
    )
    expect(run.status, `${JSON.stringify(failures)}\n${run.stderr}`).toBe(0)
    const actual = new Map<string, string>(
      report.testResults.flatMap((file) =>
        file.assertionResults.map(
          (test) =>
            [`${relative(repositoryRoot, file.name)}::${test.fullName}`, test.status] as const
        )
      )
    )
    for (const title of expected) expect(actual.get(title), title).toBe('passed')
    // The single child collects exact current legacy files across all nine owners; package gates remain separate.
  }, 300_000)

  it('contains no stale source or export-key literals in migrated tests', () => {
    /**
     * Actual owner manifests are the closed public-entry oracle, including the new adapter
     * subpaths.
     */
    const exportsByOwner = new Map<string, Record<string, unknown>>(
      testOwners.map((owner) => [
        owner,
        (
          JSON.parse(
            readFileSync(join(repositoryRoot, 'packages', owner, 'package.json'), 'utf8')
          ) as {
            exports?: Record<string, unknown>
          }
        ).exports ?? {}
      ])
    )
    /** Keep every active obsolete reader visible, qualified by its actual test owner. */
    const stale: string[] = []
    for (const owner of testOwners) {
      for (const file of testSources(join(repositoryRoot, 'packages', owner, 'test'))) {
        for (const node of stringsIn(file)) {
          /** Literal spelling is kept exact for owner lookup and the eventual failure report. */
          const literal = node.text
          if (expectsAbsence(node)) continue
          /** Only real module/filesystem consumers must resolve relative paths and public exports. */
          const reader = isReaderLiteral(node)
          /** Public package names select their exact manifest rather than any other owner's key. */
          const bare = /^@migaia\/(rpc(?:-[a-z-]+)?)(\/.*)?$/.exec(literal)
          /**
           * Package-local source readers now include ordinary adapter entries and their private
           * owners.
           */
          const sourcePath = /^(?:\.\.?\/)*src\//.test(literal)
          /** The removed physical package roots remain invalid independently of a matching basename. */
          const oldSource = /packages\/(?:rpc|web-rpc)\/src\//.test(literal)
          /** A former flat source import is valid only when it resolves a real local helper. */
          const flatSource =
            /^\.\/(?:internal|adapters|features|middleware|wire|transport-constants|client|provider|full)(?:\/|$)/.test(
              literal
            )
          /**
           * Positive export-object assertions belong to this exact owner; ordinary payload keys do
           * not.
           */
          let exportKey = false
          /** Object property whose key is this literal, if any. */
          const keyOf = node.tree.parentOf(node.node)
          if (
            keyOf?.type === 'Property' &&
            !keyOf.shorthand &&
            keyOf.key === node.node &&
            literal.startsWith('./')
          ) {
            for (
              let parent: Node | undefined = keyOf;
              parent;
              parent = node.tree.parentOf(parent)
            ) {
              if (
                parent.type === 'CallExpression' &&
                /\.exports\).*\.(?:toMatchObject|toEqual)$/.test(node.tree.textOf(parent.callee))
              ) {
                exportKey = true
                break
              }
              if (isStatement(parent)) break
            }
          }
          if (
            (reader &&
              bare &&
              !Object.hasOwn(exportsByOwner.get(bare[1]) ?? {}, bare[2] ? '.' + bare[2] : '.')) ||
            oldSource ||
            (reader &&
              (sourcePath || flatSource) &&
              !readerExists(resolve(dirname(file), literal))) ||
            (exportKey && !Object.hasOwn(exportsByOwner.get(owner)!, literal))
          )
            stale.push(`${relative(repositoryRoot, file)}: ${literal}`)
        }
      }
    }
    expect(stale).toEqual([])
  })
})
