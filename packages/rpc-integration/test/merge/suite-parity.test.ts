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
  // SC3/BC3: only the deleted private timeout callback/error-factory ordering has no producer.
  'packages/web-rpc/test/internal/async-control.test.ts::async control contains synchronous timeout callbacks and observes diagnostics',
  'packages/web-rpc/test/internal/async-control.test.ts::async control starts the timeout side effect before settling the timeout',
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
  'packages/web-rpc/test/internal-ownership-boundaries.test.ts::internal ownership boundary semantics expires learned peer knowledge while retaining configured-peer semantics',
  // RPC-TEST-FB075BDD690B-C042 BC3 NoPASS: BC3: exact deleted RpcPortName/shared-output publication lookup, object identity, string alias or terminal getPort behavior; no current port/role registry is reintroduced.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admits exactly one authentication provider, rejects forged keys, and isolates removal',
  // RPC-TEST-FB075BDD690B-C042 BC3 NoPASS: BC3: exact deleted RpcPortName/shared-output publication lookup, object identity, string alias or terminal getPort behavior; no current port/role registry is reintroduced.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admits exactly one connect provider, rejects forged keys, and isolates removal',
  // RPC-TEST-FB075BDD690B-C030 BC3 NoPASS: Only four old sharedProvides/required/optional sharedConsumes declarations; canonical auth/transport/flow interfaces replace these keys.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts declares required connect and optional authentication shared consumption',
  // RPC-TEST-FB075BDD690B-C035 BC3 NoPASS: Manual discoveryMode, receiverSelector, identifier, uniqueTargetId and exact shared connect object are removed SDK configuration/publication ports. The direct selector invocation on [] and its one-call/input-array ass...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts executes production connect discovery, selection, fixed unique target, and identity',
  // RPC-TEST-FB075BDD690B-C043 BC3 NoPASS: C0 aggregate records the old injected required-port projection callback; all of its nested observation belongs to the removed SDK shape. ChildA002 is separately retained in the inventory.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects admitted-but-unpublished authentication runtime output before activation',
  // RPC-TEST-FB075BDD690B-C043 BC3 NoPASS: C0 aggregate records the old injected required-port projection callback; all of its nested observation belongs to the removed SDK shape. ChildA002 is separately retained in the inventory.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects admitted-but-unpublished connect runtime output before activation',
  // RPC-TEST-FB075BDD690B-C041 BC3 NoPASS: The assertion is tied to old authentication-at-install/connect-at-factory metadata capture, old protect(x,endpoint-context) or direct captured connect identifier invocation/undefined receiver. Those SDK input and phas...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts snapshots authentication at install and connect at factory with one read and receiver semantics',
  // RPC-TEST-FB075BDD690B-C054 BC3 NoPASS: Five readFile/source-regex assertions inspect removed composed/kernel/bootstrap close branches; no close behavior executes. Does not retire any real close-once/error/Promise business oracle.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects a second composed close owner after legacy cleanup deletion',
  // RPC-TEST-FB075BDD690B-C067 BC3 NoPASS: Only private timeout getPort existence and two endpoint-local object identities; no deadline, timer or isolation behavior is exercised. Complete timeout instances replace that publication.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts actual timeout publication is present and isolated per endpoint',
  // RPC-TEST-FB075BDD690B-C087 BC3 NoPASS: Injects old native install result ports:{} and checks deleted downstream claim parity/private getPort. The PLUGIN_INSTALL_FAILED wrapper belongs to that removed publication failure scenario; no general rollback/cause ...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted-but-unpublished abort output fails downstream claim parity',
  // RPC-TEST-FB075BDD690B-C087 BC3 NoPASS: Injects old native install result ports:{} and checks deleted downstream claim parity/private getPort. The PLUGIN_INSTALL_FAILED wrapper belongs to that removed publication failure scenario; no general rollback/cause ...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted-but-unpublished timeout output fails downstream claim parity',
  // RPC-TEST-FB075BDD690B-C077 BC3 NoPASS: Exact private createConstructionControl.signal.reason identity is deleted SDK surface. Current public construction reason is tested separately, without counting the private control identity as PASS.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts construction cancellation preserves the caller reason identity',
  // RPC-TEST-FB075BDD690B-C088 BC3 NoPASS: BC3: direct duplicate timeout/abort sharedProvides admission record and old private preflight input; no new negative config is made.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts duplicate abort providers are rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C088 BC3 NoPASS: BC3: direct duplicate timeout/abort sharedProvides admission record and old private preflight input; no new negative config is made.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts duplicate timeout providers are rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C057 BC3 NoPASS: middleware-finalize.sharedOptionalConsumes is the deleted middleware role/claim schema.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts finalize declares timeout and abort as explicit optional consumers',
  // RPC-TEST-FB075BDD690B-C086 BC3 NoPASS: Exact preflightFeatureClaims admission.sharedProvides hostile getter and snapshot/no-install/no-IO branch are removed native-role descriptor input under BC3; original RpcConfigurationError/INVALID_CONFIG/cause in this...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile first-party metadata preserves the thrown Error as cause',
  // RPC-TEST-FB075BDD690B-C085 BC3 NoPASS: Forged shared claims use removed role names and package-symbol metadata; all error/zero-residue/count checks follow a direct private preflight call without dispatch. Does not retire current real SDK definition validat...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects a forged abort symbol cancellation shared claim',
  // RPC-TEST-FB075BDD690B-C085 BC3 NoPASS: Forged shared claims use removed role names and package-symbol metadata; all error/zero-residue/count checks follow a direct private preflight call without dispatch. Does not retire current real SDK definition validat...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects a forged timeout string cancellation shared claim',
  // RPC-TEST-FB075BDD690B-C055 BC3 NoPASS: Frozen timeout Middleware object is the deleted install-plugin representation; R8/BC3 replaces it with an executable call feature, not that Middleware.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout and abort factories expose native Host plugins',
  // RPC-TEST-FB075BDD690B-C062 BC3 NoPASS: capabilities.set regex targets deleted core/middleware/timeout.ts; timeout implementation now belongs to the R8 call feature.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout and abort middleware do not write the legacy capability registry',
  // RPC-TEST-FB075BDD690B-C056 BC3 NoPASS: sharedProvides timeout key described the deleted second Host publication table.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout and abort publish typed shared ports in one Host batch',
  // RPC-TEST-FB075BDD690B-C097 BC3 NoPASS: Seven source-substring/regex checks for Store Worker/old host runtime assembly names, numeric timeout syntax and abort()/timeout() roots. No Worker behavior executes; actual direct-consumer behavior remains in separat...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts Store Worker direct consumers retain both cancellation middleware factories',
  // RPC-TEST-FB075BDD690B-C066 BC3 NoPASS: Only frozen no-config abort middleware factory object identity/name. Abort is intrinsic Host call semantics in SDD3.5; no abort is performed in this case.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts abort no-config factory is receiver-free, frozen, and endpoint-local',
  // RPC-TEST-FB075BDD690B-C059 BC3 NoPASS: providerCancellation shared-key equality pins a retired internal publication name.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts abort reuses the authorized provider-cancellation shared key',
  // RPC-TEST-FB075BDD690B-C060 BC3 NoPASS: Exact old timeout install scope.signal===batch.construction.signal is a removed SDK construction-control identity. A public Host lifecycle signal is not claimed to be that private control.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts composed Host installs receive the canonical construction control',
  // RPC-TEST-FB075BDD690B-C076 BC3 NoPASS: Exact deleted createConstructionControl/runConstructionInstall input, absolute deadlineAt/remaining and injected fake time port timer/disposal counts are BC3 NoPASS. Current complete per-call timeout business is verif...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts construction control keeps one absolute fake-time deadline and idempotent close',
  // RPC-TEST-FB075BDD690B-C061 BC3 NoPASS: Absence of constructionController text only checks the deleted endpoint-bootstrap compatibility file; actual construction signal identity remains protected by retained C060.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts legacy non-deferred construction controller remains an isolated compatibility branch',
  // RPC-TEST-FB075BDD690B-C078 BC3 NoPASS: Only asserts the retired src/core/endpoint.ts file does not exist. Contrary to title, no operation or late cancellation is executed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts operation owner remains singular while late cancellation is observed',
  // RPC-TEST-FB075BDD690B-C083 BC3 NoPASS: Only absence of optional private timeout/abort shared key after installation. No timeout/abort business observed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts optional absent abort key stays absent without residue',
  // RPC-TEST-FB075BDD690B-C083 BC3 NoPASS: Only absence of optional private timeout/abort shared key after installation. No timeout/abort business observed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts optional absent timeout key stays absent without residue',
  // RPC-TEST-FB075BDD690B-C058 BC3 NoPASS: Negative WebRpcPortName.abort source regex inspects the retired outbound-attachment file.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts outbound consumes the finalized prepared abort boolean, not the shared enablement port',
  // RPC-TEST-FB075BDD690B-C091 BC3 NoPASS: Root-approved exact old timeout/abort injected result {extension,ports,dispose} race/gate and its role-specific residue are BC3 NoPASS. The original result.dispose call count is not relabeled as a different native own...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native abort late resolve disposes its result once without diagnostic requirement',
  // RPC-TEST-FB075BDD690B-C091 BC3 NoPASS: Root-approved exact old timeout/abort injected result {extension,ports,dispose} race/gate and its role-specific residue are BC3 NoPASS. The original result.dispose call count is not relabeled as a different native own...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native timeout late resolve disposes its result once without diagnostic requirement',
  // RPC-TEST-FB075BDD690B-C082 BC3 NoPASS: Reserved middleware:timeout/abort sharedProvides spoof rejected by deleted role preflight. Its INVALID_CONFIG/type/no-cause/zero-mutation checks are specific to that removed metadata language; no supported public call...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real inventory rejects reserved middleware:abort spoof before Host mutation',
  // RPC-TEST-FB075BDD690B-C082 BC3 NoPASS: Reserved middleware:timeout/abort sharedProvides spoof rejected by deleted role preflight. Its INVALID_CONFIG/type/no-cause/zero-mutation checks are specific to that removed metadata language; no supported public call...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real inventory rejects reserved middleware:timeout spoof before Host mutation',
  // RPC-TEST-FB075BDD690B-C074 BC3 NoPASS: Exact same-tick construction.timeoutMs0 plus pre-aborted injected batch, its native wrapper/kernel completion and physical counter projection belong to removed construction SDK input. Only the independently supported ...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts same-tick zero deadline and caller abort have one terminal outcome and no residue',
  // RPC-TEST-FB075BDD690B-C073 BC3 NoPASS: Exact deleted createConstructionControl/runConstructionInstall input, absolute deadlineAt/remaining and injected fake time port timer/disposal counts are BC3 NoPASS. Current complete per-call timeout business is verif...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts zero and already-expired fake deadlines create no timer and clean once',
  // RPC-TEST-FB075BDD690B-C112 BC3 NoPASS: Duplicates removed hooks/ping/uuid sharedProvides descriptor into private role preflight; no current native install or supported provider duplicate operation is executed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks duplicate provider is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C114 BC3 NoPASS: Forged package symbol in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks forged package symbol is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C113 BC3 NoPASS: Forged string key in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks forged string key is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C112 BC3 NoPASS: Duplicates removed hooks/ping/uuid sharedProvides descriptor into private role preflight; no current native install or supported provider duplicate operation is executed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping duplicate provider is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C114 BC3 NoPASS: Forged package symbol in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping forged package symbol is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C113 BC3 NoPASS: Forged string key in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping forged string key is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C112 BC3 NoPASS: Duplicates removed hooks/ping/uuid sharedProvides descriptor into private role preflight; no current native install or supported provider duplicate operation is executed.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid duplicate provider is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C114 BC3 NoPASS: Forged package symbol in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid forged package symbol is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C113 BC3 NoPASS: Forged string key in removed role sharedProvides language; private preflight throw + unchanged snapshot only. Not a current wire/auth authority test.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid forged string key is rejected before Host mutation',
  // RPC-TEST-FB075BDD690B-C101 BC3 NoPASS: Only source regex for retired core/middleware/{hooks,ping}.ts and IRpcPlugin text; no operation executes. Hooks is explicitly deleted by SDD3.5.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts owning hooks file has no legacy registry write and is a native plugin',
  // RPC-TEST-FB075BDD690B-C101 BC3 NoPASS: Only source regex for retired core/middleware/{hooks,ping}.ts and IRpcPlugin text; no operation executes. Hooks is explicitly deleted by SDD3.5.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts owning ping file has no legacy registry write and is a native plugin',
  // RPC-TEST-FB075BDD690B-C101 BC3 NoPASS: Only source regex for retired core/middleware/{hooks,ping}.ts and IRpcPlugin text; no operation executes. Hooks is explicitly deleted by SDD3.5.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts owning uuid file has no legacy registry write and is a native plugin',
  // RPC-TEST-FB075BDD690B-C099 BC3 NoPASS: Exact middleware-finalize optional nine-key descriptor arrays; canonical Host has no middleware-finalizer role.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production finalizer exposes the exact nine-key optional schema',
  // RPC-TEST-FB075BDD690B-C098 BC3 NoPASS: Exact old hooks/ping/uuid role inventory schema provides/consumes/optional arrays; no hook, ping or ID behavior is invoked.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production inventory exposes the exact hooks role schema',
  // RPC-TEST-FB075BDD690B-C098 BC3 NoPASS: Exact old hooks/ping/uuid role inventory schema provides/consumes/optional arrays; no hook, ping or ID behavior is invoked.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production inventory exposes the exact ping role schema',
  // RPC-TEST-FB075BDD690B-C098 BC3 NoPASS: Exact old hooks/ping/uuid role inventory schema provides/consumes/optional arrays; no hook, ping or ID behavior is invoked.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production inventory exposes the exact uuid role schema',
  // RPC-TEST-FB075BDD690B-C107 BC3 NoPASS: This exact hostile listeners/onHookError/generate getter input, cutoff/receiver, native wrapper error and no-mutation/no-IO snapshot branch belong to removed hooks/UUID factory configuration under BC3. The specific ne...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile hooks snapshot getter listeners preserves exact cutoff and residue',
  // RPC-TEST-FB075BDD690B-C107 BC3 NoPASS: This exact hostile listeners/onHookError/generate getter input, cutoff/receiver, native wrapper error and no-mutation/no-IO snapshot branch belong to removed hooks/UUID factory configuration under BC3. The specific ne...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile hooks snapshot getter onHookError preserves exact cutoff and residue',
  // RPC-TEST-FB075BDD690B-C107 BC3 NoPASS: This exact hostile listeners/onHookError/generate getter input, cutoff/receiver, native wrapper error and no-mutation/no-IO snapshot branch belong to removed hooks/UUID factory configuration under BC3. The specific ne...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile uuid snapshot getter generate preserves exact cutoff and residue',
  // RPC-TEST-FB075BDD690B-C119 BC3 NoPASS: BC3: removed hooks.listeners/uuid.generate option getters and their conditional native-role activation/subscription cutoff. No supported replacement getter or phase is invented; generic native installation errors rema...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile hooks configuration preserves primary/cause and leaves zero activation residue',
  // RPC-TEST-FB075BDD690B-C119 BC3 NoPASS: BC3: removed hooks.listeners/uuid.generate option getters and their conditional native-role activation/subscription cutoff. No supported replacement getter or phase is invented; generic native installation errors rema...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile uuid configuration preserves primary/cause and leaves zero activation residue',
  // RPC-TEST-FB075BDD690B-C100 BC3 NoPASS: Frozen role schema arrays plus ping enable marker own key/descriptor and finalizer eight optional keys. Ping now intrinsic lifecycle control; this case never sends a ping.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts package role schema and ping port shape are frozen exact contracts',
  // RPC-TEST-FB075BDD690B-C103 BC3 NoPASS: Exact removed hooks/UUID/ping factory capture, scope/variation metadata, frozen enablement and private shared-port publication are NoPASS. No replacement public negative or fabricated port is created.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real production builder snapshots hook/uuid factories at install',
  // RPC-TEST-FB075BDD690B-C102 BC3 NoPASS: installPluginForLegacy source regex targets the deleted endpoint-bootstrap bridge. BC3/3.7/3.8 require that bridge to be absent, not a new compatibility implementation.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts no owning middleware file retains the removed compatibility installer',
  // RPC-TEST-FB075BDD690B-C020 BC3 NoPASS: Exact endpoint-capabilities required providerCancellation port omission and INVALID_CONFIG cause are generated by the deleted required-shared-output validator. BC3 deletes that input and failure scenario; no current e...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts fails closed when a production required shared provider omits its runtime output',
  // RPC-TEST-FB075BDD690B-C022 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. primary is generated by injectRuntim...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves activation runtime reject identity and removes all prior shared output',
  // RPC-TEST-FB075BDD690B-C022 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. primary is generated by injectRuntim...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves activation runtime throw identity and removes all prior shared output',
  // RPC-TEST-FB075BDD690B-C025 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. Missing protocol/contract shared tok...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects admitted contract runtime shared omission before activation with identity',
  // RPC-TEST-FB075BDD690B-C025 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. Missing protocol/contract shared tok...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects admitted protocol runtime shared omission before activation with identity',
  // RPC-TEST-FB075BDD690B-C019 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. Accessor provide is injected into th...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects an accessor runtime public output before projection escape and rolls back the production batch',
  // RPC-TEST-FB075BDD690B-C012 BC3 NoPASS: Only preflightFeatureClaims fixed kernel/middleware/activation descriptors; no call or native resource is exercised. Valid/invalid role metadata belongs to the deleted second-assembly SDK.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects fixed-role claim mismatches before Host mutation',
  // RPC-TEST-FB075BDD690B-C001 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. Null/primitive were returned only by...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects injected native activation null output through the existing Host rollback path',
  // RPC-TEST-FB075BDD690B-C001 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. Null/primitive were returned only by...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects injected native activation primitive output through the existing Host rollback path',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime activation-mismatch output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime extra-public output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime extra-shared output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime missing-public output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime route-mismatch output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C018 BC3 NoPASS: BC3: removed injected native-role/runtime output input and its conditional activation/publication validation; no current negative configuration or synthetic native role is created. extra-shared/wrong-shared-value/miss...
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects production runtime wrong-shared-value output with exact primary and zero residue',
  // RPC-TEST-FB075BDD690B-C016 BC3 NoPASS: Exact protocol/contract descriptor sharedProvides and host.getPort shape, including protocol version1, are deleted. No normalizer or schema business is invoked.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts routes protocol and contract through typed Host shared ports without legacy registry writes',
  // RPC-TEST-FB075BDD690B-C143 BC3 NoPASS: BC2/3: original selected legacy codec/middleware order encode→encrypt→sign→transport is replaced by revision13 §3.3 envelope.outbound before codec encode; old combined sequence cannot remain a supported requirement. C...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix real outbound order is encode then encrypt then sign then transport send',
  // RPC-TEST-FB075BDD690B-C145 BC3 NoPASS: Only exact old descriptor root publicKeys and Object.keys(old composed endpoint) projection. No actual request/send/group/outcome or close result is asserted.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix descriptor four-key claims remain distinct from seven-key final projection',
  // RPC-TEST-FB075BDD690B-C120 BC3 NoPASS: Only exact endpoint-capabilities role route/publicKeys/private shared port inventory. Root calls move to namespaces; variation and old outbound shared-port SDK are deleted.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound inventory claims exact narrow shared ports',
  // RPC-TEST-FB075BDD690B-C121 BC3 NoPASS: Only absence of old outboundAttachment sharedProvides flag; no resource disposal executes.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound result uses Host-owned disposal without legacy blanket escape',
  // RPC-TEST-FB075BDD690B-C122 BC3 NoPASS: Only frozen private outboundOperations/inboundIdentity/variationCoordinator ports and stable getPort references/absence of outboundAttachment. No send, identity verification, admission or disposal executes. Three help...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound publishes typed operations and identity ports in one Host batch',
  // RPC-TEST-FB075BDD690B-C127 BC3 NoPASS: Hostile getter exists only on deleted private createComposedEndpoint targetIds configuration. Exact INVALID_CONFIG+cause and read1 are that removed input field scenario; no supported new Host/Namespace option has this...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix hostile outbound target getter fails before activation with original cause',
  // RPC-TEST-FB075BDD690B-C129 BC3 NoPASS: All three original variants inject removed id/version/encodedType codecs or input/outputEncodedType framers into the old composition constructor. Their specific unknown-to-string compatibility rejection has no current...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix directed unknown producers reject concrete string sinks before subscribe',
  // RPC-TEST-FB075BDD690B-C128 BC3 NoPASS: The exact legacy encodedType producer/sink compatibility branch (including concrete-authentication coercion permitting subscribe) and its native-framer/codec/transport input descriptors were removed. This NoPASS is co...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native framed output needs an opaque sink or concrete authentication before subscribe',
  // RPC-TEST-FB075BDD690B-C135 BC3 NoPASS: The old CAPABILITY_CONFLICT for two differently named transport plugins is the explicitly removed host-wide mutual exclusion. It must not be replaced by the distinct same-namespace rejection.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects duplicate plugin transports before either transport subscribes',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected codec empty id before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected codec invalid encoded type before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected codec noncallable decode before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected codec noncallable encode before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected codec zero version before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer empty id before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer invalid input domain before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer invalid output domain before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer noncallable accept before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer noncallable close before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer noncallable frame before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected framer zero version before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected protocol empty id before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected protocol noncallable normalize before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected protocol throwing id getter before subscribe',
  // RPC-TEST-FB075BDD690B-C132 BC3 NoPASS: INVALID_CONFIG is produced only by private createRuntimeEndpointComposition selected protocol/codec/framer descriptor grammar; new carrier four-stage codec and fixed protocol do not accept this input record. No public...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects invalid selected protocol zero version before subscribe',
  // RPC-TEST-FB075BDD690B-C131 BC3 NoPASS: The zero calls are to injected legacy descriptor.frame/accept callbacks during old constructor snapshot, not business provider execution. Neither callback is a supported current carrier codec stage; current handshake ...
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix selected descriptor getters run once without framing during construction',
  // RPC-TEST-FB075BDD690B-C158 BC3 NoPASS: Direct private createRuntimeEndpointComposition disposal with synthetic cleanup faults; no same-name mapping to Root/native close.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions preserves ordered route, replay, and registry cleanup leaves from one composed endpoint',
  // Historical protocol factory: SC3/BC2/BC3 NoPASS, needs review. Removed normalize getter/pre-read input; the retained C027 cause/subscription atoms have their own exact BC2/3 disposition.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native protocol hostile configuration cause identity and zero residue',
  // Historical contract factory: SC3/BC3 NoPASS, needs review. Removed contract.version getter/install-role error and its conditional ingress/debug cutoff; current wire/schema errors remain required.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native contract hostile configuration cause identity and zero residue',
  // RPC-TEST-FB075BDD690B-C045 BC3 NoPASS: deleted connect configuration getter/input; the current Auth factory is not a substitute for that removed connect variant.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves hostile connect config getter primary and cause identity'
])

/** Exact receiver fullNames preserve migrated business; missing reception still fails. */
const currentCaseReceivers: Readonly<Record<string, readonly string[]>> = {
  // Late construction diagnostics retain once-only reporting and the original Error, without hooks DTOs.
  'packages/web-rpc/test/construction-hooks.test.ts::real construction diagnostic reporter delivers the exact late install error after factory rejection and Host rollback':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  // R7/BC3 removes the old listener fanout; its exact two callback errors are NoPASS.
  'packages/web-rpc/test/construction-hooks.test.ts::real construction diagnostic reporter isolates sync and async listener failures while preserving late delivery':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  'packages/web-rpc/test/construction-hooks.test.ts::real construction diagnostic reporter does not report a pre-settlement primary install failure as a late diagnostic':
    [
      'packages/rpc-host/test/host/native-installation-errors.test.ts::classifies the original native flow setup failure without replacing its Error'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control settles on timeout and ignores late operation completion':
    [
      'packages/utils/test/promise.test.ts::retains the deadline terminal after the original operation fulfills late'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control does not start a lazy operation after pre-cancellation':
    [
      'packages/utils/test/promise.test.ts::does not start a direct abort race after native pre-cancellation'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control does not start an operation after synchronous signal cancellation':
    [
      'packages/utils/test/promise.test.ts::promise primitives stops signal admission after synchronous cancellation in raceWithAbort'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control does not register later signals after an earlier synchronous abort':
    [
      'packages/utils/test/promise.test.ts::promise primitives stops signal admission after synchronous cancellation in raceWithAbort'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control starts the operation only after control checks':
    [
      'packages/utils/test/promise.test.ts::does not start a direct abort race after native pre-cancellation'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control rolls back earlier signal listeners when a later registration fails':
    [
      'packages/utils/test/promise.test.ts::removes the earlier race listener once when a later signal registration fails'
    ],
  'packages/web-rpc/test/internal/async-control.test.ts::async control observes race listener cleanup failures without replacing the result':
    [
      'packages/utils/test/promise.test.ts::retains the race result and exact host diagnostic when its cleanup reporter throws'
    ],
  // RPC-TEST-FB075BDD690B-C039: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts owns provider feature disposal once on success and rollback':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C031: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts accepts absent optional authentication and rejects absent required connect':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // RPC-TEST-FB075BDD690B-C044: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned success once, borrowed success zero, and repeats Host dispose Promise':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned success once, borrowed success zero, and repeats Host dispose Promise'
    ],
  // RPC-TEST-FB075BDD690B-C050: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned transport once and leaves borrowed authentication partial failure closed':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned transport once and leaves borrowed authentication partial failure closed'
    ],
  // RPC-TEST-FB075BDD690B-C050: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned transport once and leaves borrowed connect partial failure closed':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned transport once and leaves borrowed connect partial failure closed'
    ],
  // RPC-TEST-FB075BDD690B-C036: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts invokes async uniqueTargetId factory during production finalization and preserves result':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C052: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps activation primary while ordered owned close cleanup remains reachable':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::keeps activation primary while ordered owned close cleanup remains reachable'
    ],
  // RPC-TEST-FB075BDD690B-C053: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts leaves no activation, shared, extension, registry, kernel, or projection residue':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C046: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves authentication protect transform primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // RPC-TEST-FB075BDD690B-C046: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves authentication unprotect transform primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // RPC-TEST-FB075BDD690B-C048: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves each hostile authentication cleanup AggregateError children and outer order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves each hostile authentication cleanup AggregateError children and outer order'
    ],
  // RPC-TEST-FB075BDD690B-C048: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves each hostile connect cleanup AggregateError children and outer order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves each hostile connect cleanup AggregateError children and outer order'
    ],
  // RPC-TEST-FB075BDD690B-C037: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves hostile async uniqueTargetId factory primary and cause through finalizer':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C045: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves hostile authentication config getter primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::preserves the original authentication configuration getter cause at the public factory'
    ],
  // RPC-TEST-FB075BDD690B-C047: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves install primary and exact AggregateError rollback identities/order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves install primary and exact AggregateError rollback identities/order'
    ],
  // RPC-TEST-FB075BDD690B-C032: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native authentication async failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // RPC-TEST-FB075BDD690B-C032: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native authentication sync failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // RPC-TEST-FB075BDD690B-C032: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native connect async failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // RPC-TEST-FB075BDD690B-C032: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native connect sync failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // RPC-TEST-FB075BDD690B-C033: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves one transport close owner through the canonical factory':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::preserves one transport close owner through the canonical factory'
    ],
  // RPC-TEST-FB075BDD690B-C051: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves transport close failure cause and repeated Host dispose Promise identity':
    [
      'packages/rpc-host/test/host/core-baseline.test.ts::public failed close preserves its completion identity and original native cleanup cause'
    ],
  // RPC-TEST-FB075BDD690B-C029: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts publishes authentication and connect through typed Host shared ports':
    [
      'packages/rpc-host/test/host/middleware-auth-connect.test.ts::preserves original authentication transform order and values through actual provider delivery'
    ],
  // RPC-TEST-FB075BDD690B-C038: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts records unified successful and rollback teardown order with stable repeated disposal':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C038 later native failure preserves primary and releases the original callbacks once',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C038 native success preserves callback identities and stable final completion'
    ],
  // RPC-TEST-FB075BDD690B-C049: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts releases authentication/connect resources in exact reverse order once':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::releases authentication/connect resources in exact reverse order once'
    ],
  // RPC-TEST-FB075BDD690B-C040: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts repeats legacy endpoint disposal without a second transport release':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::repeats endpoint disposal without a second transport release'
    ],
  // RPC-TEST-FB075BDD690B-C034: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts runs production authentication encrypt-sign and verify-decrypt with exact published identity':
    [
      'packages/rpc-host/test/host/middleware-auth-connect.test.ts::preserves original authentication transform order and values through actual provider delivery'
    ],
  // RPC-TEST-FB075BDD690B-C079: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted native abort key publishes to downstream and removes exactly once':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C079: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted native timeout key publishes to downstream and removes exactly once':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C075: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts composed operation abort preserves exact caller reason and terminal residue':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // RPC-TEST-FB075BDD690B-C070: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile timeout config keeps the original getter cause and native config error':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::complete timeout capture retains the original hostile getter cause and one read'
    ],
  // RPC-TEST-FB075BDD690B-C093: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native abort async hostile install preserves the primary and zero residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // RPC-TEST-FB075BDD690B-C094: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts operation abort-first barrier chooses one terminal identity and clears late provider state':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // RPC-TEST-FB075BDD690B-C095: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts operation timeout-first barrier remains terminal after a late caller abort':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // RPC-TEST-FB075BDD690B-C071: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts pre-aborted composed construction preserves exact reason identity':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::pre-aborted public construction retains the original caller reason'
    ],
  // RPC-TEST-FB075BDD690B-C090: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production root cleanup owns same-tick cancellation terminality':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::pre-aborted public construction retains the original caller reason'
    ],
  // RPC-TEST-FB075BDD690B-C096: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real abort-first operation reports a late provider rejection and drains residue':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::caller cancellation late reject reports the original error with only its CANCELLED terminal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // RPC-TEST-FB075BDD690B-C092: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native abort late reject reports distinct primary while caller reason remains terminal':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  // RPC-TEST-FB075BDD690B-C092: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native timeout late reject reports distinct primary while caller reason remains terminal':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  // RPC-TEST-FB075BDD690B-C084: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted abort publication is endpoint-local and rollback-removable':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C084: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted timeout publication is endpoint-local and rollback-removable':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C072: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts during-install abort is terminal and post-success abort is inert':
    [
      'packages/rpc-plugin-process/test/process/bootstrap-source.test.ts::releases a late actual bootstrap after cancellation'
    ],
  // RPC-TEST-FB075BDD690B-C080: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts generic PluginHost accepts an arbitrary feature outside first-party role schema':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::generic PluginHost accepts an arbitrary feature outside first-party role schema'
    ],
  // RPC-TEST-FB075BDD690B-C068: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected abort native-role failure preserves identity and residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // RPC-TEST-FB075BDD690B-C069: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected timeout async rejection preserves primary and full rollback residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // RPC-TEST-FB075BDD690B-C068: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected timeout native-role failure preserves identity and residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // RPC-TEST-FB075BDD690B-C064: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native timeout install snapshots only after factory creation':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout install snapshots only after factory creation',
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout config getter is read once and legacy middleware remains callable'
    ],
  // RPC-TEST-FB075BDD690B-C089: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native timeout snapshot survives post-install mutation':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout snapshot survives post-install mutation'
    ],
  // RPC-TEST-FB075BDD690B-C081: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real inventory admits a non-reserved native plugin with an arbitrary feature':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::real inventory admits a non-reserved native plugin with an arbitrary feature'
    ],
  // RPC-TEST-FB075BDD690B-C063: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout config getter is read once and legacy middleware remains callable':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout install snapshots only after factory creation',
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout config getter is read once and legacy middleware remains callable'
    ],
  // RPC-TEST-FB075BDD690B-C065: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout snapshots its configuration in receiver-free order':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout snapshots its configuration in receiver-free order'
    ],
  // RPC-TEST-FB075BDD690B-C105: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hooks and UUID snapshots preserve receiver, retry freshness, and async install barrier':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // RPC-TEST-FB075BDD690B-C109: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C111: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C109: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C111: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C109: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C111: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C108: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real ping factory has no config reads and publishes one frozen endpoint-local enablement':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // RPC-TEST-FB075BDD690B-C106: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts independent hooks trace proves failed retry, async barrier, and mutation isolation':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C106: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts independent uuid trace proves failed retry, async barrier, and mutation isolation':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C117: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped hooks publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // RPC-TEST-FB075BDD690B-C117: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped ping publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // RPC-TEST-FB075BDD690B-C117: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped uuid publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // RPC-TEST-FB075BDD690B-C116: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy hooks partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy hooks partial rollback is reverse-once with exact cleanup children'
    ],
  // RPC-TEST-FB075BDD690B-C116: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy ping partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy ping partial rollback is reverse-once with exact cleanup children'
    ],
  // RPC-TEST-FB075BDD690B-C116: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy uuid partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy uuid partial rollback is reverse-once with exact cleanup children'
    ],
  // RPC-TEST-FB075BDD690B-C110: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts conditional ping enablement and heartbeat cleanup remain legacy-equivalent':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'hooks' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'hooks' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'ping' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'ping' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'uuid' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C115: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'uuid' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C118: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production framer seam retains boundary and cleanup ownership':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles',
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline'
    ],
  // RPC-TEST-FB075BDD690B-C104: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts selected framers remain endpoint-local across concurrent production batches':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles'
    ],
  // RPC-TEST-FB075BDD690B-C006: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts captures object middleware install and metadata at definition time':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::captures object middleware install and metadata at definition time'
    ],
  // RPC-TEST-FB075BDD690B-C009: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps dynamic native middleware keys isolated across concurrent Hosts':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps dynamic native middleware keys isolated across concurrent Hosts'
    ],
  // RPC-TEST-FB075BDD690B-C004: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts normalizes object middleware through the native installation path':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::normalizes object middleware through the native installation path'
    ],
  // RPC-TEST-FB075BDD690B-C002: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts publishes dynamic native middleware keys before activation':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::publishes dynamic native middleware keys before activation'
    ],
  // RPC-TEST-FB075BDD690B-C007: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects explicit empty object publicKeys with a nonempty extension':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // RPC-TEST-FB075BDD690B-C008: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects explicit empty object sharedProvides before ingress':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // RPC-TEST-FB075BDD690B-C003: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts retains WebRPC owned-resource cleanup for native Middleware':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::retains WebRPC owned-resource cleanup for native Middleware'
    ],
  // RPC-TEST-FB075BDD690B-C005: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts selects an object middleware transport without a factory transport':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::selects an object middleware transport without a factory transport'
    ],
  // RPC-TEST-FB075BDD690B-C024: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts accepts absent optional protocol and contract providers at the exact production seam':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles'
    ],
  // RPC-TEST-FB075BDD690B-C014: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts drives every production role through one injected batch with identities and no residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C010: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts invokes the captured middleware install once with an undefined receiver':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::retains WebRPC owned-resource cleanup for native Middleware'
    ],
  // RPC-TEST-FB075BDD690B-C021: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps a fresh native Host transaction isolated after an actual install failure':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C021 preserves a failed native primary and recovers an independent fresh subscription'
    ],
  // RPC-TEST-FB075BDD690B-C017: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps production shared publication isolated between endpoint Hosts':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C017 keeps two actual native subscriptions isolated when the left Host retires'
    ],
  // RPC-TEST-FB075BDD690B-C011: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps the admitted install after post-snapshot mutation':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation'
    ],
  // RPC-TEST-FB075BDD690B-C015: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preflights the production inventory and rejects static/runtime claim mismatches before Host mutation':
    [
      'packages/rpc-host/test/host/middleware-cold-definition.test.ts::C015 keeps a real native carrier untouched while its SDK definition is cold',
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // RPC-TEST-FB075BDD690B-C013: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when activation fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails'
    ],
  // RPC-TEST-FB075BDD690B-C013: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when feature:outbound fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails'
    ],
  // RPC-TEST-FB075BDD690B-C013: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when kernel fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails'
    ],
  // RPC-TEST-FB075BDD690B-C013: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when middleware:connect fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C023: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves custom protocol/contract behavior and read order through the production seam':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles',
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline'
    ],
  // RPC-TEST-FB075BDD690B-C026: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native contract install async identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C026: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native contract install sync identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C026: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native protocol install async identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C026: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native protocol install sync identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // RPC-TEST-FB075BDD690B-C028: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts releases native protocol resources exactly once on success and failure, and preserves factory disposal identity':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // RPC-TEST-FB075BDD690B-C141: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix supporting endpoint seam: send/RPC retains endpoint and disposal Promise identity':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::public send retains its canonical result and disposal Promise identity'
    ],
  // RPC-TEST-FB075BDD690B-C140: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound cleanup proves exact order, failure identity, and terminal idempotence':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 composed native boundary preserves both cleanup leaves and one completion',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 native cleanup retains all four original leaves in the actual close order',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 native success releases all three original resources and empties actual owners'
    ],
  // RPC-TEST-FB075BDD690B-C142: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix caller cancellation preserves native cause and clears outbound pending state':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable leaves zero active providers after a local signal.abort() fired synchronously right after send()'
    ],
  // RPC-TEST-FB075BDD690B-C144: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix hostile outbound authentication preserves native source/code/cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // RPC-TEST-FB075BDD690B-C146: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix primitive native Feature installation reaches terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C147: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix undefined native Feature installation reaches terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C148: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix no-disposer native Feature installation has one terminal Host Promise':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C149: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native Feature result disposer runs once at terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C150: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native Feature install failure rolls back without retaining Host residue':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // RPC-TEST-FB075BDD690B-C151: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native result cleanup failure preserves identity and terminal Promise identity':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity'
    ],
  // RPC-TEST-FB075BDD690B-C153: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix later native failure rolls back earlier owned resources in reverse order':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // RPC-TEST-FB075BDD690B-C152: BC3 synthetic observer-fault dimension NoPASS; require native memoization and actual cleanup only, without claiming that old diagnostic callback ran.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix throwing cleanup observer is diagnostic-only and cannot alter disposal':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C123: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound install does not subscribe or activate before final activation':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C123 keeps native installation pending and business gated until final commit'
    ],
  // RPC-TEST-FB075BDD690B-C124: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix the untransformed native capability Feature activates one receiver':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // RPC-TEST-FB075BDD690B-C125: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound typed ports are endpoint-local and never shared by identity':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  // RPC-TEST-FB075BDD690B-C126: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix supporting baseline: endpoint construction owns target snapshot before outbound activation':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::real outbound send and broadcast preserve canonical results'
    ],
  // RPC-TEST-FB075BDD690B-C137: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix real outbound send and RPC fanout preserve canonical results':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::real outbound send and broadcast preserve canonical results'
    ],
  // RPC-TEST-FB075BDD690B-C138: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound dispose is host-owned, idempotent, and rejects later sends canonically':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::outbound close is host-owned, idempotent, and rejects later sends canonically'
    ],
  // RPC-TEST-FB075BDD690B-C139: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix later activation failure rolls back outbound publication and leaves zero subscription residue':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::later activation failure rolls back outbound publication and leaves zero subscription residue'
    ],
  // RPC-TEST-FB075BDD690B-C136: BC1/BC3 keeps the public missing-source business with HOST_TRANSPORT_MISSING; old private INVALID_CONFIG input/code receives NoPASS.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects a missing transport before Host construction':
    [
      'packages/rpc-host/test/host/core-public.test.ts::BC1 rejects absent or duplicate transport namespaces before any native open'
    ],
  // RPC-TEST-FB075BDD690B-C134: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix selected class transport retains its private method receiver':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // RPC-TEST-FB075BDD690B-C133: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix selected transport getters run once when top-level transport shadows a plugin':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // RPC-TEST-FB075BDD690B-C130: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix top-level transport shadows one plugin transport before subscription':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // RPC-TEST-FB075BDD690B-C154: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions publishes and removes the real discovery resolver in one Host transaction':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  // RPC-TEST-FB075BDD690B-C156: BC3 synthetic discovery fault dimension NoPASS; preserve same-native completion and genuine cleanup leaves without replaying removed fault injection.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions preserves the real discovery cleanup error identity and terminal residue':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // RPC-TEST-FB075BDD690B-C157: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions preserves the shared canonical Host and endpoint disposal Promise on cleanup failure':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::native cleanup failure retains shared completion and empties actual RPC resource tables'
    ],
  // RPC-TEST-FB075BDD690B-C155: Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions rolls back a published discovery resolver when a later real Host participant fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves the complete later asynchronous native participant failure and disposal identity'
    ]
}

/** Map each non-retired frozen title to all required current receiver cases. */
function migratedTitles(title: string): readonly string[] {
  const [file, name] = title.split('::')
  if (retiredSuites.has(file.split('/').at(-1) ?? '') || retiredLayeringTitles.has(title)) return []
  if (
    file === 'packages/web-rpc/test/middleware-ports.test.ts' ||
    file === 'packages/web-rpc/test/internal/async-control.test.ts' ||
    file === 'packages/web-rpc/test/construction-hooks.test.ts'
  ) {
    /** Missing/unfinished reception fails before a ghost legacy file can enter the real child. */
    const receivers = currentCaseReceivers[title]
    expect(Array.isArray(receivers), title).toBe(true)
    return receivers ?? []
  }
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
  return [`${path}::${mappedName}`]
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
    const expected = [...legacyTitles.contract, ...legacyTitles.core].flatMap(migratedTitles)
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
