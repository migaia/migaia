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
  'packages/web-rpc/test/adapters/rtc-data-channel.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/rtc-data-channel.test.ts',
  'packages/web-rpc/test/adapters/window-source-proof.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/window-source-proof.test.ts',
  'packages/web-rpc/test/adapters/worker-lifecycle.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/worker-lifecycle.test.ts',
  'packages/web-rpc/test/adapters/worker-metadata.test.ts':
    'packages/rpc-plugin-browser/test/browser/adapters/worker-metadata.test.ts',
  'packages/web-rpc/test/architecture.test.ts': 'packages/rpc-host/test/core/architecture.test.ts',
  'packages/web-rpc/test/composed-fanout-contract.test.ts':
    'packages/rpc-host/test/core/composed-fanout-contract.test.ts',
  'packages/web-rpc/test/composed-receiver-identity.test.ts':
    'packages/rpc-host/test/core/composed-receiver-identity.test.ts',
  'packages/web-rpc/test/composed-remote-cancellation.test.ts':
    'packages/rpc-host/test/core/composed-remote-cancellation.test.ts',
  'packages/web-rpc/test/construction-hooks.test.ts':
    'packages/rpc-host/test/core/construction-hooks.test.ts',
  'packages/web-rpc/test/contract-endpoint.test.ts':
    'packages/rpc-host/test/core/contract-endpoint.test.ts',
  'packages/web-rpc/test/custom-feature.test.ts':
    'packages/rpc-host/test/core/custom-feature.test.ts',
  'packages/web-rpc/test/discovery-attachment-boundaries.test.ts':
    'packages/rpc-host/test/core/discovery-attachment-boundaries.test.ts',
  'packages/web-rpc/test/duplicate-owner-contract.test.ts':
    'packages/rpc-host/test/core/duplicate-owner-contract.test.ts',
  'packages/web-rpc/test/errors.test.ts': 'packages/rpc-host/test/core/errors.test.ts',
  'packages/web-rpc/test/internal/async-control.test.ts':
    'packages/rpc-host/test/core/internal/async-control.test.ts',
  'packages/web-rpc/test/internal/chunk.test.ts':
    'packages/rpc-host/test/core/internal/chunk.test.ts',
  'packages/web-rpc/test/internal/contract.test.ts':
    'packages/rpc-host/test/core/internal/contract.test.ts',
  'packages/web-rpc/test/internal/outbound-sender.test.ts':
    'packages/rpc-host/test/core/internal/outbound-sender.test.ts',
  'packages/web-rpc/test/internal/provider-admission.test.ts':
    'packages/rpc-host/test/core/internal/provider-admission.test.ts',
  'packages/web-rpc/test/internal/provider-executor-result.test.ts':
    'packages/rpc-host/test/core/internal/provider-executor-result.test.ts',
  'packages/web-rpc/test/internal/provider.test.ts':
    'packages/rpc-host/test/core/internal/provider.test.ts',
  'packages/web-rpc/test/internal/resource-scope.test.ts':
    'packages/rpc-host/test/core/internal/resource-scope.test.ts',
  'packages/web-rpc/test/internal/safe-value.test.ts':
    'packages/rpc-host/test/core/internal/safe-value.test.ts',
  'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts':
    'packages/rpc-host/test/core/internal/web-rpc-plugin-host.test.ts',
  'packages/web-rpc/test/middleware/chunk.test.ts':
    'packages/rpc-host/test/core/middleware/chunk.test.ts',
  'packages/web-rpc/test/middleware/contract.test.ts':
    'packages/rpc-host/test/core/middleware/contract.test.ts',
  'packages/web-rpc/test/middleware/middleware.test.ts':
    'packages/rpc-host/test/core/middleware/middleware.test.ts',
  'packages/web-rpc/test/middleware/timeout.test.ts':
    'packages/rpc-host/test/core/middleware/timeout.test.ts',
  'packages/web-rpc/test/plugin-host/topology-adapter.test.ts':
    'packages/rpc-host/test/core/plugin-host/topology-adapter.test.ts',
  'packages/web-rpc/test/provider-event-delegate.test.ts':
    'packages/rpc-host/test/core/provider-event-delegate.test.ts',
  'packages/web-rpc/test/provider-production-seam.test.ts':
    'packages/rpc-host/test/core/provider-production-seam.test.ts',
  'packages/web-rpc/test/time-port.test.ts': 'packages/rpc-host/test/core/time-port.test.ts',
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts':
    'packages/rpc-host/test/core/tree-shaking/retained-allocation-attribution.test.ts',
  'packages/web-rpc/test/tree-shaking/slim-attachment-hardening.test.ts':
    'packages/rpc-host/test/core/tree-shaking/slim-attachment-hardening.test.ts',
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts':
    'packages/rpc-host/test/core/tree-shaking/static-composition-contracts.test.ts',
  'packages/web-rpc/test/wire.test.ts': 'packages/rpc-host/test/core/wire.test.ts'
}
/** Repository-relative result names distinguish matching titles in different package owners. */
const repositoryRoot = resolve(packageRoot, '../..')
/**
 * Migrated receiver files deleted with the removed modules they exercised; their business is
 * covered at public entries.
 */

/** Exact receiver fullNames preserve migrated business; missing reception still fails. */
const currentCaseReceivers: Readonly<Record<string, readonly string[]>> = {
  // These canonical-owner receivers follow the existing migration receipts; removed SDK-only predicates remain retired.
  'packages/web-rpc/test/duplicate-owner-contract.test.ts::projection and public lifecycle surface projection avoids last-write-wins merge and returns the exact Host Promise':
    [
      'packages/rpc-host/test/host/core-baseline.test.ts::public close shares one Promise and retires concurrent calls with one lifecycle error',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::cold native Host disposal preserves the original Promise before any installation'
    ],
  'packages/web-rpc/test/duplicate-owner-contract.test.ts::candidate-specific duplicate-owner contracts delegates rollback ownership to one PluginHost':
    [
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/duplicate-owner-contract.test.ts::candidate-specific duplicate-owner contracts keeps diagnostic cleanup at the Host disposal boundary':
    [
      'packages/rpc-host/test/host/core-baseline.test.ts::public failed close preserves its completion identity and original native cleanup cause'
    ],
  'packages/web-rpc/test/errors.test.ts::error boundary helpers does not let a hostile code getter escape':
    [
      'packages/rpc-contract/test/error-format/boundary-helpers.test.ts::error boundary helpers reports a hostile code getter as PROPERTY_READ_FAILED with the original cause'
    ],
  'packages/web-rpc/test/errors.test.ts::error boundary helpers keeps protocol-family error codes distinct':
    [
      'packages/rpc-contract/test/error-format/boundary-helpers.test.ts::error boundary helpers keeps protocol-family error codes distinct'
    ],
  'packages/web-rpc/test/errors.test.ts::error boundary helpers keeps the (source, code) contract: 38 unique codes and a constant source':
    [
      'packages/rpc-contract/test/error-format/boundary-helpers.test.ts::error boundary helpers keeps unique registered codes and a constant source'
    ],
  'packages/web-rpc/test/errors.test.ts::error boundary helpers tagWebRpcError keeps the native runtime type while attaching (source, code)':
    [
      'packages/rpc-contract/test/error-format/boundary-helpers.test.ts::error boundary helpers tagRpcError keeps the native runtime type while attaching (source, code)'
    ],
  'packages/web-rpc/test/errors.test.ts::error boundary helpers uses standard AbortError/TimeoutError names for cross-realm type checks':
    [
      'packages/rpc-contract/test/error-format/boundary-helpers.test.ts::error boundary helpers uses standard AbortError/TimeoutError names for cross-realm type checks'
    ],
  'packages/web-rpc/test/internal/contract.test.ts::contract error normalization does not let hostile issue getters replace the stable schema error':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::contract error normalization does not let hostile issue getters replace the stable schema error'
    ],
  'packages/web-rpc/test/internal/contract.test.ts::contract error normalization falls back when the issues collection itself is hostile':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::contract error normalization falls back when the issues collection itself is hostile'
    ],
  'packages/web-rpc/test/internal/contract.test.ts::contract error normalization ignores absent and non-parser schemas and executes valid parsers':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::contract error normalization ignores absent and non-parser schemas and executes valid parsers'
    ],
  'packages/web-rpc/test/internal/contract.test.ts::contract error normalization snapshots normal schema issues and filters hostile path elements':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::contract error normalization snapshots normal schema issues and filters hostile path elements'
    ],
  'packages/web-rpc/test/internal/contract.test.ts::contract error normalization uses a stable fallback for errors without issue arrays':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::contract error normalization uses a stable fallback for errors without issue arrays'
    ],
  'packages/web-rpc/test/internal/provider-admission.test.ts::ProviderAdmissionRegistry enforces global and per-peer limits and releases leases':
    [
      'packages/rpc-host/test/plugins/limits/provider-admission.test.ts::ProviderAdmissionRegistry enforces global and per-peer limits and releases leases'
    ],
  'packages/web-rpc/test/internal/provider-admission.test.ts::ProviderAdmissionRegistry rejects non-positive or unsafe admission limits':
    [
      'packages/rpc-host/test/plugins/limits/provider-admission.test.ts::ProviderAdmissionRegistry rejects non-positive or unsafe admission limits'
    ],
  'packages/web-rpc/test/internal/provider.test.ts::provider registry ownership rejects duplicate providers and clears every callback table':
    [
      'packages/rpc-host/test/dispatch/provider-catalog.test.ts::clears the sole provider index and its pending reservations on repeated close'
    ],
  'packages/web-rpc/test/internal/resource-scope.test.ts::ResourceScope reaches zero after concurrent releaseAll callers share one result':
    [
      'packages/rpc-host/test/host/resource-lifecycle.test.ts::shares the public close Promise and releases an asynchronous resource exactly once'
    ],
  'packages/web-rpc/test/internal/resource-scope.test.ts::ResourceScope releases critical transport resources before application disposers':
    [
      'packages/rpc-host/test/host/resource-lifecycle.test.ts::releases actual transport resources before application flow disposers'
    ],
  'packages/web-rpc/test/internal/resource-scope.test.ts::ResourceScope releases reverse order and aggregates failures':
    [
      'packages/rpc-host/test/host/resource-lifecycle.test.ts::releases actual native resources in reverse order and collects exactly one failure'
    ],
  'packages/web-rpc/test/internal/resource-scope.test.ts::ResourceScope shares the release promise across concurrent callers':
    [
      'packages/rpc-host/test/host/resource-lifecycle.test.ts::shares the public close Promise and releases an asynchronous resource exactly once'
    ],
  'packages/web-rpc/test/internal/safe-value.test.ts::safe-value utilities accepts only safe integer values':
    ['packages/utils/test/safe-value-primitives.test.ts::accepts only safe integer values'],
  'packages/web-rpc/test/internal/safe-value.test.ts::safe-value utilities contains hostile property getters':
    [
      'packages/rpc-contract/test/error-format/guarded-read-policy.test.ts::contains hostile property getters'
    ],
  'packages/web-rpc/test/internal/safe-value.test.ts::safe-value utilities contains hostile string conversion and preserves tuple boundaries':
    [
      'packages/rpc-contract/test/error-format/safe-string-report.test.ts::contains hostile string conversion and preserves tuple boundaries'
    ],
  'packages/web-rpc/test/internal/safe-value.test.ts::safe-value utilities returns a null-prototype dictionary for attacker-controlled keys':
    [
      'packages/utils/test/safe-value-primitives.test.ts::returns a null-prototype dictionary for attacker-controlled keys'
    ],
  'packages/web-rpc/test/internal/safe-value.test.ts::safe-value utilities reuses the canonical intrinsic brand across realms and subclasses':
    [
      'packages/utils/test/bytes.test.ts::reuses the canonical intrinsic brand across realms and subclasses'
    ],
  'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts::WebRPC PluginHost shell keeps fixed kernel-to-activation order and prevents activation after rollback':
    [
      'packages/plugin-host/test/async-setup-rollback.test.ts::async setup installation rolls setup resources back in reverse order and retains the primary cause'
    ],
  'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts::WebRPC PluginHost shell preserves async and direct-host synchronous rollback identities':
    [
      'packages/plugin-host/test/install-failure-detail.test.ts::PluginHost install failure detail preserves async primary and two rollback identities in reverse order when diagnostic throws',
      'packages/plugin-host/test/install-failure-detail.test.ts::PluginHost install failure detail publishes immutable sync detail and resolves final rollback identities after completion'
    ],
  'packages/web-rpc/test/internal/web-rpc-plugin-host.test.ts::WebRPC PluginHost shell uses typed shared symbols and one host rollback transaction':
    [
      'packages/plugin-host/test/async-setup-rollback.test.ts::async setup installation rolls setup resources back in reverse order and retains the primary cause',
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/middleware/chunk.test.ts::canonical framing contract does not retain the former root chunk middleware export':
    [
      'packages/rpc-host/test/plugins/chunk/unicode.test.ts::canonical framing contract does not retain the former root chunk middleware export'
    ],
  'packages/web-rpc/test/middleware/chunk.test.ts::canonical framing contract frames and reassembles unicode without a WebRPC middleware splitter':
    [
      'packages/rpc-host/test/plugins/chunk/unicode.test.ts::canonical framing contract frames and reassembles unicode without a WebRPC middleware splitter'
    ],
  'packages/web-rpc/test/middleware/contract.test.ts::contract plugin exposes schema validation through the typed shared result':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::Core contract validation exposes schema validation through the typed shared result'
    ],
  'packages/web-rpc/test/middleware/contract.test.ts::contract plugin preserves a __proto__ schema method as an own key':
    [
      'packages/rpc-host/test/plugins/schema/validate.test.ts::Core contract validation preserves a __proto__ schema method as an own key'
    ],
  'packages/web-rpc/test/middleware/middleware.test.ts::middleware capabilities rejects invalid middleware configuration during installation':
    [
      'packages/rpc-host/test/features/timeout-config.test.ts::public timeout feature configuration rejects the original negative duration before installation'
    ],
  'packages/web-rpc/test/middleware/middleware.test.ts::middleware capabilities rejects null built-in middleware descriptors with INVALID_CONFIG':
    [
      'packages/rpc-host/test/features/timeout-config.test.ts::public timeout feature configuration rejects the original null descriptor with INVALID_CONFIG'
    ],
  'packages/web-rpc/test/middleware/middleware.test.ts::middleware capabilities rejects unreadable timeout descriptors with INVALID_CONFIG':
    [
      'packages/rpc-host/test/features/timeout-config.test.ts::public timeout feature configuration rejects the original unreadable descriptor with INVALID_CONFIG'
    ],
  'packages/web-rpc/test/middleware/timeout.test.ts::timeout middleware resolves per-call override before middleware default':
    [
      'packages/rpc-host/test/host/core-public.test.ts::executes installed timeout output and per-call options, honors false and rejects numeric policy syntax'
    ],
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts::retained and allocation attribution exercises composed discovery and chunk settlement through the shared kernel':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::preserves the original long echo payload through two real eight-unit chunk peers'
    ],
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts::retained and allocation attribution keeps multi-receiver fanout isolated and settles an aborted request once':
    [
      'packages/rpc-host/test/host/core-routing.test.ts::RPC namespace routing uses scalar single-target calls and null-prototype zero/multiple-target settlements',
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable leaves zero active providers after a local signal.abort() fired synchronously right after send()'
    ],
  'packages/web-rpc/test/tree-shaking/retained-allocation-attribution.test.ts::retained and allocation attribution rejects an unauthenticated chunk before allocating assembly, operation, or expiry timer':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::rejects a forged business signature after real chunk assembly and admits a fresh trusted control'
    ],
  'packages/web-rpc/test/tree-shaking/slim-attachment-hardening.test.ts::slim attachment hostile equivalence cancels a pending request on caller abort and endpoint disposal':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable leaves zero active providers after a local signal.abort() fired synchronously right after send()'
    ],
  'packages/web-rpc/test/tree-shaking/slim-attachment-hardening.test.ts::slim attachment hostile equivalence rejects a hostile abort signal with the original cause before sending':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::preserves hostile caller listener failure cause and cleanup before any business write'
    ],
  'packages/web-rpc/test/tree-shaking/slim-attachment-hardening.test.ts::slim attachment hostile equivalence routes caller abort through the verified provider variation owner':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::preserves started-before-abort and the original cancelled provider result through public namespaces'
    ],
  'packages/web-rpc/test/tree-shaking/static-composition-contracts.test.ts::static composition contracts executes a recursive provider request through distinct slim runtimes':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::preserves the original object echo between two independent public hosts'
    ],
  // Existing phase and owner receipts retain these public business receivers; retired private facets receive no credit.
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix production seam preserves canonical owner timing and identities':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real transaction baseline: provider RPC and public boundary execute before projection checks':
    [
      'packages/rpc-host/test/dispatch/provider-entry-source.test.ts::real transaction baseline: provider RPC executes through its public namespace'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real transaction: provider success and endpoint-local disposal remain stable':
    [
      'packages/rpc-host/test/dispatch/provider-isolation-baseline.test.ts::public provider registration isolation baseline retains provider results and the second registration after closing the first namespace'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real provider security baseline rejects a forged receiver without execution':
    [
      'packages/rpc-host/test/dispatch/provider-entry-source.test.ts::real provider security baseline rejects a forged receiver without execution'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real provider response baseline preserves native provider error code and residue':
    [
      'packages/rpc-host/test/dispatch/provider-entry-source.test.ts::real provider response baseline preserves native provider error code and cause chain'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real provider abort baseline preserves caller terminal reason and releases controller':
    [
      'packages/rpc-host/test/call/provider-cancellation-baseline.test.ts::public provider cancellation baseline preserves the caller DOMException cause and releases the running provider'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix config snapshot baseline reads the provider object once before installation':
    [
      'packages/rpc-host/test/dispatch/provider-input-snapshot.test.ts::retains one captured provider after public source mutation'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix later invalid provider entry preserves primary failure and terminal residue':
    [
      'packages/rpc-host/test/dispatch/provider-registration.test.ts::rejects the later invalid provider entry and keeps a fresh registration independent',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real provider snapshot reads outer config and every provider entry once':
    [
      'packages/rpc-host/test/dispatch/provider-input-snapshot.test.ts::retains three captured providers and their results after public source mutation'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix actual provider endpoint isolation and terminal removal preserve independent identity':
    [
      'packages/rpc-host/test/dispatch/provider-isolation-baseline.test.ts::public provider registration isolation baseline removes only the closed provider registration and retains both close Promise identities'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix provider cancellation reuses the existing verified abort path and releases terminal state':
    [
      'packages/rpc-host/test/call/provider-cancellation-baseline.test.ts::public provider cancellation baseline repeated caller abort preserves the cause, releases work and retains its one provider'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix hostile provider-map getter at first position preserves failedName and original cause':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix hostile provider-map getter at middle position preserves failedName and original cause':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix hostile provider-map getter at last position preserves failedName and original cause':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/duplicate-owner-rollback.test.ts::rolls back native resources and public publication without replacing the install cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed provider verifies receiver admission before execution':
    [
      'packages/rpc-host/test/dispatch/provider-ingress-results.test.ts::accepted provider ingress checks receiver identity before a second execution'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed replay ledger suppresses duplicate task execution':
    [
      'packages/rpc-host/test/dispatch/provider-admission-replay.test.ts::installed replay suppresses a completed task repeated at actual ingress'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed dispatch-only execution sends no response':
    [
      'packages/rpc-host/test/dispatch/provider-ingress-results.test.ts::accepted notify executes once without any correlated physical terminal'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed missing provider returns the canonical not-found response':
    [
      'packages/rpc-host/test/dispatch/provider-ingress-results.test.ts::accepted physical ingress returns the original missing-provider error code'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed reentrant duplicate request remains idempotent':
    [
      'packages/rpc-host/test/dispatch/provider-admission-replay.test.ts::installed replay preserves one execution for the original reentrant task'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix concurrent Host endpoints preserve endpoint-local provider identity':
    [
      'packages/rpc-host/test/dispatch/provider-isolation-baseline.test.ts::public provider registration isolation baseline keeps concurrent provider executions on their original endpoint-local identities'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed async provider rejection preserves terminal controller residue':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::async provider failure preserves raw reporting and the correlated INTERNAL code'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host-installed transfer overflow preserves the native provider failure code':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::provider transfer overflow preserves the native contract failure graph and report'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real Host admission rejects forged source, sender, receiver, and cross-endpoint frames':
    [
      'packages/rpc-host/test/dispatch/provider-registration.test.ts::keeps the original execution and single terminal after foreign route and source ingress'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix concurrent duplicate requests preserve replay response uniqueness and controller release':
    [
      'packages/rpc-host/test/dispatch/provider-admission-replay.test.ts::concurrent task replay executes once and sends one terminal on its original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real Host admission capacity rejects one of 65 concurrent unique tasks and releases all':
    [
      'packages/rpc-host/test/dispatch/provider-admission-replay.test.ts::native admission rejects one of65 unique calls and releases all64 running providers'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real Host schema failure preserves serialized native identity and residue':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::params schema failure preserves the serialized native family and parser cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix late provider rejection reports the original error and releases operation state':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::async provider failure preserves raw reporting and the correlated INTERNAL code'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix canonical endpoint disposal preserves Promise identity and terminal provider residue':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::provider failure preserves INTERNAL and complete RPC Root close identity and completion'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix two real Host transactions isolate cross-endpoint and post-removal requests':
    [
      'packages/rpc-host/test/dispatch/provider-registration.test.ts::isolates two original provider endpoints and prevents execution or replies after removal',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix synchronous provider failure preserves raw report identity and terminal release':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::sync provider failure preserves raw reporting and the correlated INTERNAL code'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix post-terminal late resolve has no response and leaves no provider state':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::post-terminal late resolve preserves reports and sends no response'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix post-terminal late reject reports the distinct raw primary without a response':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::post-terminal late reject preserves reports and sends no response'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix result schema failure retains raw cause in serialized error graph':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::result schema failure preserves the serialized native family and parser cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix synchronous provider WebRPC error serializes primary and cause across the real seam':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::sync provider RpcError preserves the primary graph, native cause and exact report',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix asynchronous provider WebRPC error serializes primary and cause across the real seam':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::async provider RpcError preserves the primary graph, native cause and exact report',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix post-terminal late WebRPC rejection reports native cause identity without response':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::post-terminal late native-reject preserves reports and sends no response'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix invalid provider transfer shape preserves native contract failure and release':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::provider transfer shape preserves the native contract failure graph and report'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix params schema failure preserves exact parser cause in serialized graph':
    [
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::params schema failure preserves the serialized native family and parser cause'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix transfer overflow preserves native failure identity and requires serialized error graph':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/dispatch/provider-result-error-baseline.test.ts::provider transfer overflow preserves the native contract failure graph and report'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix providerCancellation aborts an active Host-installed task by task id':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::active repeated caller cancellation aborts the original provider exactly once'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix providerCancellation rejects cross-endpoint task control and isolates release':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::caller cancellation stays isolated between two independently installed provider Hosts'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix providerCancellation after completion is idempotent and preserves Host disposal identity':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix repeated same-tick providerCancellation aborts one controller exactly once':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::active repeated caller cancellation aborts the original provider exactly once'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix providerCancellation late resolve emits no response and releases canonical state':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::caller cancellation late resolve emits only its CANCELLED terminal and no failure report'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix providerCancellation late reject reports the raw error without a second response':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::caller cancellation late reject reports the original error with only its CANCELLED terminal'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix caller primitive abort reason remains exact on the endpoint-owned path':
    [
      'packages/rpc-host/test/call/provider-cancellation-baseline.test.ts::public provider cancellation baseline preserves the primitive caller cause and both original namespace close Promises'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix real provider completion releases one identity admission lease before terminal disposal':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix repeated shared-port cancellation and late settlement release one identity lease':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix provider failure releases one identity admission lease and preserves the raw report':
    [
      'packages/rpc-host/test/dispatch/provider-admission-release-baseline.test.ts::reports the original provider failure once with INTERNAL through its public diagnostic owner',
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix duplicate identity observation registration uses tokens and unregisters fail-closed':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix built declarations and package exports hide the identity observer callables':
    [
      'packages/rpc-host/test/host/exports.test.ts::publishes exactly the final Host package entries and runtime symbols'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix owned provider transport closes once after successful canonical disposal':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix borrowed provider transport remains open after repeated canonical disposal':
    [
      'packages/rpc-plugin-browser/test/browser/plugin.test.ts::runs bidirectional scalar and stream calls over a borrowed window source',
      'packages/rpc-plugin-browser/test/browser/plugin.test.ts::runs bidirectional scalar and stream calls over a borrowed shared source',
      'packages/rpc-plugin-browser/test/browser/plugin.test.ts::runs bidirectional scalar and stream calls over a borrowed rtc source'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix unchanged discovery/control consumers run through the ordered provider bridge transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix provider and adjacent-consumer artifacts expose the final removed provider-bridge boundary':
    [
      'packages/rpc-host/test/host/exports.test.ts::publishes exactly the final Host package entries and runtime symbols'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix chunk is an explicitly inventoried provider-bridge consumer with canonical assembly ownership':
    [
      'packages/rpc-host/test/dispatch/provider-control-cleanup.test.ts::sends the original non-empty Unicode payload through the actual chunk provider path'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix terminal disposal leaves no provider-bridge compatibility installation':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix superseded missing-member injection has no internal export seam':
    [
      'packages/rpc-host/test/host/exports.test.ts::publishes exactly the final Host package entries and runtime symbols'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix superseded prototype injection has no packed deep-import seam':
    [
      'packages/rpc-host/test/host/exports.test.ts::publishes exactly the final Host package entries and runtime symbols'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix cross-endpoint final composition has no compatibility publication':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::separate native Hosts keep consumer ping absent and both disposal identities without failures'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix Host disposal removes all final outbound compatibility residue':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix composed discovery schedules and clears its exact timer through the endpoint time port':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix admitted-unpublished control publication fails with the same Host transaction evidence':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::releases authentication/connect resources in exact reverse order once',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix terminal control disposal removes narrow shared state exactly once':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix successful control transaction preserves canonical cleanup and repeated Host Promise identity':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix canonical control endpoint disposal exposes the same stable Host and endpoint Promises':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix canonical control ping abort and timeout preserve peer and terminal isolation':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix canonical control endpoint translates two cleanup leaves on one transaction':
    [
      'packages/rpc-host/test/dispatch/provider-control-cleanup.test.ts::factory Root close preserves two acquired cleanup errors and reverse release order'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix concurrent reused control modules preserve independent endpoint snapshots':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix disposed control endpoint rejects a later operation without reviving state':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix control abort and disposal race leaves no late pending state':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix late control delivery after timeout cannot resettle or revive terminal state':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix endpoint time owner advances control timeout and clears its exact timer':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix keeps one-way sender pending empty and releases receiver admission after physical delivery':
    [
      'packages/rpc-host/test/call/one-way-delivery.test.ts::one-way delivery does not wait for business or emit a response and releases its provider lease'
    ],
  'packages/web-rpc/test/provider-production-seam.test.ts::provider production-seam matrix preserves a physical one-way rejection before a later delivery':
    [
      'packages/rpc-host/test/call/one-way-delivery.test.ts::one-way physical rejection preserves its exact cause before a later real delivery'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary classifies unchunked authentication 'rejects asynchronously' as AUTHENTICATION_FAILED":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that rejects asynchronously before any physical write'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary classifies unchunked authentication 'returns an invalid encoded value' as AUTHENTICATION_FAILED":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that returns an invalid encoded value before any physical write'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary classifies unchunked authentication 'throws synchronously' as AUTHENTICATION_FAILED":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that throws synchronously before any physical write'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary does not send framed messages when authentication 'rejects asynchronously'":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that rejects asynchronously before any physical write'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary does not send framed messages when authentication 'returns an invalid encoded value'":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that returns an invalid encoded value before any physical write'
    ],
  "packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary does not send framed messages when authentication 'throws synchronously'":
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::classifies original outbound authentication that throws synchronously before any physical write'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary does not send when the selected codec rejects before framing':
    [
      'packages/rpc-host/test/call/outbound-encode-baseline.test.ts::rejects the original codec failure selected codec failed before any physical write'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary encodes once and sends every frame produced by the selected framer':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary keeps an authentication failure reachable through the sender boundary':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::keeps the original locally owned authentication failure identity through a public request'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary keeps the owned transfer snapshot through caller mutation and exposes the physical failure cause':
    [
      'packages/rpc-host/test/call/outbound-transfer-baseline.test.ts::keeps the owned transfer snapshot through caller mutation and exposes the physical failure cause'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary normalizes a synchronous transport throw into a rejected promise':
    [
      'packages/rpc-host/test/host/fanout-operations.test.ts::host direct-target broadcast operations notify transfers an actual native backing through postMessage and preserves native write failure cause'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary preserves a semantic encode error before framing':
    [
      'packages/rpc-host/test/call/outbound-encode-baseline.test.ts::preserves a semantic encode error before framing'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary rejects a codec failure before send':
    [
      'packages/rpc-host/test/call/outbound-encode-baseline.test.ts::rejects a codec serialization failure before send'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary reports one semantic encode failure before framing or transport send':
    [
      'packages/rpc-host/test/call/outbound-encode-baseline.test.ts::rejects the original codec failure frame encode failed before any physical write'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary reports transport failure when any selected frame send fails':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::reports transport failure from an actual negotiated chunk fragment write'
    ],
  'packages/web-rpc/test/internal/outbound-sender.test.ts::outbound sender encoded type boundary snapshots transfer once and sends the owned list only on the unchunked frame':
    [
      'packages/rpc-host/test/call/outbound-transfer-baseline.test.ts::snapshots transfer once and sends the owned list only on the unchunked frame'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization dispatches events to an explicit peer or every peer except the sender':
    [
      'packages/rpc-host/test/host/core-public.test.ts::context dispatchTo keeps explicit targeting and excludes its original sender from default peers'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization executes dispatch-only providers without emitting responses':
    [
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners executes a dispatch-only provider once without emitting a response'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization maps provider schema exceptions and invalid dispatch ids without leaking controllers':
    [
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners preserves schema exceptions and releases the exact completed invocation identity',
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners preserves dispatch-id exceptions and releases the exact completed invocation identity'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization releases admission and identity when params validation fails':
    [
      'packages/rpc-host/test/dispatch/provider-results.test.ts::releases admission and the original request identity when params validation fails'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization releases admission even when validation failure response cannot be sent':
    [
      'packages/rpc-host/test/dispatch/provider-results.test.ts::releases same-session capacity when the validation error reply write fails'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization returns a stable failure when no provider owns the method':
    [
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners returns the original stable failure when no provider owns the method'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization sends branded provider failures without exposing params':
    [
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners preserves an explicit failure code/message without returning private input'
    ],
  'packages/web-rpc/test/internal/provider-executor-result.test.ts::ProviderExecutor result normalization sends branded success data and a frozen transfer snapshot':
    [
      'packages/rpc-host/test/dispatch/core-owners.test.ts::C2 ProviderDispatcher / Forwarder / StreamChannel owners unwraps only its own success and sends the original frozen transfer snapshot'
    ],
  'packages/web-rpc/test/discovery-attachment-boundaries.test.ts::discovery attachment boundary semantics proves response-wins and dispose-wins terminal races without late re-settlement':
    [
      'packages/rpc-host/test/host/core-baseline.test.ts::public close shares one Promise and retires concurrent calls with one lifecycle error'
    ],
  // Pure contracts retain the original portable/error assertions under the current package boundary.
  'packages/rpc-contract/test/acceptance.test.ts::architecture and export boundary publishes only runtime-neutral root/framing exports and dependencies':
    [
      'packages/rpc-contract/test/contract/acceptance.test.ts::pure contract acceptance publishes runtime-neutral contract/protocol exports and native feature types with an explicit dependency allowlist'
    ],
  // Current metadata reads and supported portable admission replace the retired envelope snapshot facade.
  'packages/rpc-contract/test/acceptance.test.ts::hostile normalization snapshots every envelope getter once and fails closed with causes':
    [
      'packages/rpc-contract/test/core-wire.test.ts::single RPC wire profile validates original metadata and retains business key order and binary identity',
      'packages/rpc-host/test/contract/preserve-contract.test.ts::retains the exact original payload getter failure through current preparation',
      'packages/rpc-contract/test/control/envelope-admission.test.ts::rejects unsupported kinds before routing and refuses the original accessor payload'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::portable vectors accepts canonical values and rejects the complete forbidden matrix':
    [
      'packages/rpc-contract/test/contract/acceptance.test.ts::pure contract acceptance accepts canonical values and rejects the complete forbidden matrix'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::serialized error graphs preserves foreign realm identity, stack, cause order, and aggregate errors':
    [
      'packages/rpc-contract/test/contract/acceptance.test.ts::pure contract acceptance preserves foreign realm identity, stack, cause order, and aggregate errors'
    ],
  // Fragmentation moved to the optional chunk owner with the original business assertions intact.
  'packages/rpc-contract/test/acceptance.test.ts::framing matrix covers empty, exact-boundary, fragmentation, order, duplicate, and limits':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions covers empty, exact-boundary, fragmentation, order, duplicate, and limits'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::framing matrix prepares native ingress once without reflecting opaque custom frames':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::preserves single frame-field reads and the exact native getter failure',
      'packages/rpc-contract/test/api-audit.test.ts::keeps custom physical data opaque at the canonical carrier shell boundary'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::framing races and cleanup expires missing fragments and rejects late completion without rebuilding state':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions expires missing fragments and rejects late completion without rebuilding state'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::framing races and cleanup isolates sources, bounds concurrency, and keeps cleanup failures secondary':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions isolates sources, bounds concurrency, and keeps cleanup failures secondary'
    ],
  'packages/rpc-contract/test/acceptance.test.ts::framing races and cleanup keeps NUL-delimited source/message pairs collision-free and drains resources':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions keeps NUL-delimited source/message pairs collision-free and drains resources'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract reassembles ordered strings and isolates source keys':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions reassembles ordered strings and isolates source keys'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract rejects a complete carrier from the wrong fixed framer profile':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions rejects a complete carrier from the wrong fixed framer profile'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract rejects out-of-order and over-limit binary fragments before semantic decoding':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions rejects out-of-order and over-limit binary fragments before semantic decoding'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract reports expiration and bounds terminal history after an assembly timeout':
    [
      'packages/rpc-host/test/plugins/chunk/contract-preservation.test.ts::migrated chunk contract assertions reports expiration and bounds terminal history after an assembly timeout'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract round-trips a bounded serialized error graph without replacing native types':
    [
      'packages/rpc-contract/test/contract/contract.test.ts::rpc-contract pure business boundary round-trips a bounded serialized error graph without replacing native types'
    ],
  'packages/rpc-contract/test/contract.test.ts::rpc-contract snapshots hostile envelope fields and rejects unsupported shapes':
    [
      'packages/rpc-contract/test/contract/contract.test.ts::rpc-contract pure business boundary rejects non-portable caller values',
      'packages/rpc-contract/test/core-wire.test.ts::single RPC wire profile validates original metadata and retains business key order and binary identity',
      'packages/rpc-contract/test/control/envelope-admission.test.ts::rejects unsupported kinds before routing and refuses the original accessor payload'
    ],
  // Exhaustive narrowing follows the sole supported semantic profile; retired descriptor APIs receive no credit.
  'packages/rpc-contract/test/types.test.ts::rpc-contract declarations preserves descriptor literals and exhaustive envelope narrowing':
    [
      'packages/rpc-contract/test/contract/types.test.ts::rpc-contract declarations preserves sole-profile literals and exhaustive semantic frame narrowing'
    ],
  // Native target identity survives on SDK control; the removed pingAll map presentation receives no credit.
  'packages/web-rpc/test/composed-fanout-contract.test.ts::composed sendAll/pingAll fanout contract pingAll keys results by the tagged fanoutDeliveryKey shape and tolerates a __proto__ target':
    [
      'packages/rpc-host/test/core/composed-fanout-contract.test.ts::composed sendAll/pingAll fanout contract SDK control ping retains the accepted __proto__ target identity'
    ],
  'packages/web-rpc/test/composed-remote-cancellation.test.ts::composed remote cancellation on caller-side settlement notifies the remote and leaves zero active controllers after a local timeoutMs expiry':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable notifies the remote and leaves zero active providers after a complete timeout expires'
    ],
  'packages/web-rpc/test/composed-remote-cancellation.test.ts::composed remote cancellation on caller-side settlement notifies the remote and leaves zero active controllers after a local signal.abort() fired synchronously right after send()':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable leaves zero active providers after a local signal.abort() fired synchronously right after send()'
    ],
  'packages/web-rpc/test/contract-endpoint.test.ts::contract endpoint pipeline uses paired public endpoints for request-response, codec/framer work, frame protection, and disposal':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::preserves contract endpoint roundtrips and protection before actual writes'
    ],
  'packages/web-rpc/test/plugin-host/topology-adapter.test.ts::capability topology adapter preserves transitive order while keeping one installer path':
    [
      'packages/rpc-host/test/host/native-topology-baseline.test.ts::native capability topology preserves transitive order while keeping one installer path'
    ],
  'packages/web-rpc/test/plugin-host/topology-adapter.test.ts::capability topology adapter rejects undefined native dependencies and retired arrays before installation':
    [
      'packages/rpc-host/test/host/native-topology-baseline.test.ts::native capability topology rejects undefined native dependencies before invoking their factory'
    ],
  'packages/web-rpc/test/wire.test.ts::wire boundary rejects empty method names at entry': [
    'packages/rpc-host/test/host/middleware-calls.test.ts::validates method names and admits a dotted public method'
  ],
  'packages/web-rpc/test/wire.test.ts::wire boundary rejects non-string and empty methods': [
    'packages/rpc-host/test/host/middleware-calls.test.ts::validates method names and admits a dotted public method'
  ],
  // Late construction diagnostics retain once-only reporting and the original Error, without hooks DTOs.
  'packages/web-rpc/test/construction-hooks.test.ts::real construction diagnostic reporter delivers the exact late install error after factory rejection and Host rollback':
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
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts owns provider feature disposal once on success and rollback':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts accepts absent optional authentication and rejects absent required connect':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned success once, borrowed success zero, and repeats Host dispose Promise':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned success once, borrowed success zero, and repeats Host dispose Promise'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned transport once and leaves borrowed authentication partial failure closed':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned transport once and leaves borrowed authentication partial failure closed'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts closes owned transport once and leaves borrowed connect partial failure closed':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::closes owned transport once and leaves borrowed connect partial failure closed'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts invokes async uniqueTargetId factory during production finalization and preserves result':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps activation primary while ordered owned close cleanup remains reachable':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::keeps activation primary while ordered owned close cleanup remains reachable'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts leaves no activation, shared, extension, registry, kernel, or projection residue':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves authentication protect transform primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves authentication unprotect transform primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves each hostile authentication cleanup AggregateError children and outer order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves each hostile authentication cleanup AggregateError children and outer order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves each hostile connect cleanup AggregateError children and outer order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves each hostile connect cleanup AggregateError children and outer order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves hostile async uniqueTargetId factory primary and cause through finalizer':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves hostile authentication config getter primary and cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::preserves the original authentication configuration getter cause at the public factory'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves install primary and exact AggregateError rollback identities/order':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::preserves install primary and exact AggregateError rollback identities/order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native authentication async failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native authentication sync failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native connect async failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native connect sync failure identity':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C032 closes an actually acquired native resource once when preparation rejects'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves one transport close owner through the canonical factory':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::preserves one transport close owner through the canonical factory'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves transport close failure cause and repeated Host dispose Promise identity':
    [
      'packages/rpc-host/test/host/core-baseline.test.ts::public failed close preserves its completion identity and original native cleanup cause'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts publishes authentication and connect through typed Host shared ports':
    [
      'packages/rpc-host/test/host/middleware-auth-connect.test.ts::preserves original authentication transform order and values through actual provider delivery'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts records unified successful and rollback teardown order with stable repeated disposal':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C038 later native failure preserves primary and releases the original callbacks once',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C038 native success preserves callback identities and stable final completion'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts releases authentication/connect resources in exact reverse order once':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::releases authentication/connect resources in exact reverse order once'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts repeats legacy endpoint disposal without a second transport release':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::repeats endpoint disposal without a second transport release'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts runs production authentication encrypt-sign and verify-decrypt with exact published identity':
    [
      'packages/rpc-host/test/host/middleware-auth-connect.test.ts::preserves original authentication transform order and values through actual provider delivery'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted native abort key publishes to downstream and removes exactly once':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted native timeout key publishes to downstream and removes exactly once':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts composed operation abort preserves exact caller reason and terminal residue':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hostile timeout config keeps the original getter cause and native config error':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::complete timeout capture retains the original hostile getter cause and one read'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native abort async hostile install preserves the primary and zero residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts operation abort-first barrier chooses one terminal identity and clears late provider state':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts operation timeout-first barrier remains terminal after a late caller abort':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts pre-aborted composed construction preserves exact reason identity':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::pre-aborted public construction retains the original caller reason'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production root cleanup owns same-tick cancellation terminality':
    [
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::pre-aborted public construction retains the original caller reason'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real abort-first operation reports a late provider rejection and drains residue':
    [
      'packages/rpc-host/test/dispatch/provider-signal-terminal.test.ts::caller cancellation late reject reports the original error with only its CANCELLED terminal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation abort-first preserves its terminal outcome after the other signal',
      'packages/rpc-host/test/host/middleware-construction-lifetime.test.ts::public operation timeout-first preserves its terminal outcome after the other signal'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native abort late reject reports distinct primary while caller reason remains terminal':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real admitted native timeout late reject reports distinct primary while caller reason remains terminal':
    [
      'packages/rpc-host/test/host/installation-late-failure.test.ts::keeps caller cancellation terminal before reporting the original late setup failure'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted abort publication is endpoint-local and rollback-removable':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts admitted timeout publication is endpoint-local and rollback-removable':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts during-install abort is terminal and post-success abort is inert':
    [
      'packages/rpc-plugin-process/test/process/bootstrap-source.test.ts::releases a late actual bootstrap after cancellation'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts generic PluginHost accepts an arbitrary feature outside first-party role schema':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::generic PluginHost accepts an arbitrary feature outside first-party role schema'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected abort native-role failure preserves identity and residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected timeout async rejection preserves primary and full rollback residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts injected timeout native-role failure preserves identity and residue':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native timeout install snapshots only after factory creation':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout install snapshots only after factory creation',
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout config getter is read once and legacy middleware remains callable'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native timeout snapshot survives post-install mutation':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout snapshot survives post-install mutation'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real inventory admits a non-reserved native plugin with an arbitrary feature':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::real inventory admits a non-reserved native plugin with an arbitrary feature'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout config getter is read once and legacy middleware remains callable':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::native timeout install snapshots only after factory creation',
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout config getter is read once and legacy middleware remains callable'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts timeout snapshots its configuration in receiver-free order':
    [
      'packages/rpc-host/test/host/middleware-timeout-snapshot.test.ts::timeout snapshots its configuration in receiver-free order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts hooks and UUID snapshots preserve receiver, retry freshness, and async install barrier':
    [
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::injected timeout async rejection preserves primary and full rollback residue',
      'packages/rpc-host/test/host/middleware-async-rollback.test.ts::native abort async hostile install preserves the primary and zero residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native hooks publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native ping publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid publication is endpoint-local and removed on rollback/dispose':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native uuid publication is endpoint-local and terminal removal is exact':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts real ping factory has no config reads and publishes one frozen endpoint-local enablement':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts independent hooks trace proves failed retry, async barrier, and mutation isolation':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts independent uuid trace proves failed retry, async barrier, and mutation isolation':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped hooks publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped ping publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native-shaped uuid publication and endpoint disposal share one composed transaction':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::C117 preserves both owned flow cleanup failures on the native disposal boundary'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy hooks partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy hooks partial rollback is reverse-once with exact cleanup children'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy ping partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy ping partial rollback is reverse-once with exact cleanup children'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts baseline: legacy uuid partial rollback is reverse-once with exact cleanup children':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::baseline: legacy uuid partial rollback is reverse-once with exact cleanup children'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts conditional ping enablement and heartbeat cleanup remain legacy-equivalent':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'hooks' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'hooks' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'ping' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'ping' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'uuid' 'async' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  "packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts native 'uuid' 'sync' install failure preserves primary and zero residue":
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts production framer seam retains boundary and cleanup ownership':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles',
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts selected framers remain endpoint-local across concurrent production batches':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts captures object middleware install and metadata at definition time':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::captures object middleware install and metadata at definition time'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps dynamic native middleware keys isolated across concurrent Hosts':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps dynamic native middleware keys isolated across concurrent Hosts'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts normalizes object middleware through the native installation path':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::normalizes object middleware through the native installation path'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts publishes dynamic native middleware keys before activation':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::publishes dynamic native middleware keys before activation'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects explicit empty object publicKeys with a nonempty extension':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts rejects explicit empty object sharedProvides before ingress':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts retains WebRPC owned-resource cleanup for native Middleware':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::retains WebRPC owned-resource cleanup for native Middleware'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts selects an object middleware transport without a factory transport':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::selects an object middleware transport without a factory transport'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts accepts absent optional protocol and contract providers at the exact production seam':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts drives every production role through one injected batch with identities and no residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts invokes the captured middleware install once with an undefined receiver':
    [
      'packages/rpc-host/test/host/middleware-native-feature-identity.test.ts::retains WebRPC owned-resource cleanup for native Middleware'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps a fresh native Host transaction isolated after an actual install failure':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C021 preserves a failed native primary and recovers an independent fresh subscription'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps production shared publication isolated between endpoint Hosts':
    [
      'packages/rpc-host/test/host/middleware-subscription-lifetime.test.ts::C017 keeps two actual native subscriptions isolated when the left Host retires'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts keeps the admitted install after post-snapshot mutation':
    [
      'packages/rpc-host/test/host/middleware-definition-capture.test.ts::keeps the admitted install after post-snapshot mutation'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preflights the production inventory and rejects static/runtime claim mismatches before Host mutation':
    [
      'packages/rpc-host/test/host/middleware-cold-definition.test.ts::C015 keeps a real native carrier untouched while its SDK definition is cold',
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when activation fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when feature:outbound fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when kernel fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves primary and rollback identities when middleware:connect fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves custom protocol/contract behavior and read order through the production seam':
    [
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles',
      'packages/rpc-host/test/host/middleware-selected-wire.test.ts::keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native contract install async identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native contract install sync identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native protocol install async identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts preserves native protocol install sync identity and rollback residue':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when activation fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when feature:outbound fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when kernel fails',
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves primary and rollback identities when middleware:connect fails'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::atomic middleware and claim contracts releases native protocol resources exactly once on success and failure, and preserves factory disposal identity':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::releases native protocol resources exactly once on success and failure, and preserves factory disposal identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix supporting endpoint seam: send/RPC retains endpoint and disposal Promise identity':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::public send retains its canonical result and disposal Promise identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound cleanup proves exact order, failure identity, and terminal idempotence':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 composed native boundary preserves both cleanup leaves and one completion',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 native cleanup retains all four original leaves in the actual close order',
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::C140 native success releases all three original resources and empties actual owners'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix caller cancellation preserves native cause and clears outbound pending state':
    [
      'packages/rpc-host/test/call/public-cancellation.test.ts::public request cancellation through the canonical CallTable leaves zero active providers after a local signal.abort() fired synchronously right after send()'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix hostile outbound authentication preserves native source/code/cause identity':
    [
      'packages/rpc-host/test/plugins/auth/middleware-outbound.test.ts::hostile outbound authentication preserves native source/code/cause identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix primitive native Feature installation reaches terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix undefined native Feature installation reaches terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix no-disposer native Feature installation has one terminal Host Promise':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native Feature result disposer runs once at terminal cleanup':
    [
      'packages/rpc-host/test/host/middleware-close-owner.test.ts::native flow result disposer runs once at terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native Feature install failure rolls back without retaining Host residue':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::native Feature install failure rolls back without retaining Host residue'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix native result cleanup failure preserves identity and terminal Promise identity':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix later native failure rolls back earlier owned resources in reverse order':
    [
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::later native failure rolls back earlier owned resources in reverse order'
    ],
  // Synthetic observer-fault dimension NoPASS; require native memoization and actual cleanup only, without claiming that old diagnostic callback ran.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix throwing cleanup observer is diagnostic-only and cannot alter disposal':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound install does not subscribe or activate before final activation':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C123 keeps native installation pending and business gated until final commit'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix the untransformed native capability Feature activates one receiver':
    [
      'packages/rpc-host/test/host/middleware-native-activation.test.ts::C124 installs one actual native carrier receiver and keeps its subscription active'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound typed ports are endpoint-local and never shared by identity':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix supporting baseline: endpoint construction owns target snapshot before outbound activation':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::real outbound send and broadcast preserve canonical results'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix real outbound send and RPC fanout preserve canonical results':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::real outbound send and broadcast preserve canonical results'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix outbound dispose is host-owned, idempotent, and rejects later sends canonically':
    [
      'packages/rpc-host/test/host/middleware-calls.test.ts::outbound close is host-owned, idempotent, and rejects later sends canonically'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix later activation failure rolls back outbound publication and leaves zero subscription residue':
    [
      'packages/rpc-host/test/host/native-port-lifecycle.test.ts::later activation failure rolls back outbound publication and leaves zero subscription residue'
    ],
  // Keeps the public missing-source business with HOST_TRANSPORT_MISSING; old private INVALID_CONFIG input/code receives NoPASS.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix rejects a missing transport before Host construction':
    [
      'packages/rpc-host/test/host/core-public.test.ts::rejects absent or duplicate transport namespaces before any native open'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix selected class transport retains its private method receiver':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix selected transport getters run once when top-level transport shadows a plugin':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::outbound feature production-seam matrix top-level transport shadows one plugin transport before subscription':
    [
      'packages/rpc-host/test/host/middleware-transport-selection.test.ts::subscribes each selected actual carrier exactly once'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions publishes and removes the real discovery resolver in one Host transaction':
    [
      'packages/rpc-host/test/dispatch/provider-disposal-baseline.test.ts::installed native Host disposal preserves its Promise and removes the original subscription'
    ],
  // Synthetic discovery fault dimension NoPASS; preserve same-native completion and genuine cleanup leaves without replaying removed fault injection.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions preserves the real discovery cleanup error identity and terminal residue':
    [
      'packages/rpc-host/test/host/middleware-cleanup-boundaries.test.ts::native result cleanup failure preserves identity and terminal Promise identity',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C146 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C147 preserves native terminal cleanup',
      'packages/rpc-host/test/host/middleware-native-installation.test.ts::RPC-TEST-FB075BDD690B-C148 preserves native terminal cleanup'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions preserves the shared canonical Host and endpoint disposal Promise on cleanup failure':
    [
      'packages/rpc-host/test/host/native-disposal-settlement.test.ts::native cleanup failure retains shared completion and empties actual RPC resource tables'
    ],
  // Exact original business is received by these existing actual cases; runtime still must pass. Exact removed input/role/translator facets receive no old-node credit.
  'packages/web-rpc/test/middleware-ports.test.ts::discovery Host transactions rolls back a published discovery resolver when a later real Host participant fails':
    [
      'packages/rpc-host/test/host/middleware-native-rollback-order.test.ts::preserves the complete later asynchronous native participant failure and disposal identity'
    ]
}

/** Map each frozen title to all required current receiver cases. */
function migratedTitles(title: string): readonly string[] {
  const [file, name] = title.split('::')
  if (
    Object.hasOwn(currentCaseReceivers, title) ||
    file === 'packages/rpc-contract/test/acceptance.test.ts' ||
    file === 'packages/rpc-contract/test/contract.test.ts' ||
    file === 'packages/rpc-contract/test/types.test.ts' ||
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
    .replace('BroadcastChannel adapter ', 'BroadcastChannel native owner ')
    .replace('dedicated-worker adapter lifecycle ', 'dedicated-worker native lifecycle ')
    .replace('shared-worker adapter lifecycle ', 'shared-worker native lifecycle ')
    .replace('service-worker adapter lifecycle ', 'service-worker native lifecycle ')
    .replace('worker adapter source metadata ', 'worker native source admission ')
    .replace('provider event dispatch delegate ', '')
    .replace('endpoint-local time port ', 'canonical endpoint timer resources ')
    .replace(
      'preserves configured peers while bounding learned peers and translating cleanup leaves',
      'preserves cleanup leaves when translating disposal failures'
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
  it('keeps every frozen legacy file and title passed', () => {
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
    expect(expected.filter((title) => actual.get(title) !== 'passed')).toEqual([])
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
