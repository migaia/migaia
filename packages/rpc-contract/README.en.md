# `@migaia/rpc-contract`

Contract defines one wire protocol, host/plugin/feature interfaces, portable values, and RPC-family errors. Host owns sessions, handshake, calls, providers, forwarding, and cancellation. Transport plugins own native connections, generations, codecs, and framing. Flow plugins and plugin-owned features implement optional capabilities.

This package owns no sessions, connections, pending tables, timers, or IO. Normally choose one transport kind per host; multiple namespaces are supported, but mixing transport kinds is not recommended.

[中文](./README.md) · [Protocol and usage guide](./USEGUIDE.en.md)

## Installation and entries

```bash
pnpm add @migaia/rpc-contract
```

| Entry                                    | Content                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Root                                     | Protocol, interface types, portable values, errors, and codes                              |
| `/protocol`                              | `migaia.rpc/2` types, constants, pure shape checks, and flat wire-error graphs             |
| `/interfaces`                            | Host, carrier, flow-plugin, and executing-feature interfaces                               |
| `/portable`                              | Portable normalization, snapshots, and native backing shape rules                          |
| `/errors`                                | Native error classes, identity properties, tree projection/restoration, and privacy checks |
| `/error-code`                            | The single RPC-family code table and source constants                                      |
| `/schema/protocol`, `/schema/wire-error` | Published JSON schemas                                                                     |

Every RPC package may declare a direct dependency on this package. `sideEffects: false` permits tree-shaking; importing only `/error-code` does not retain protocol, carrier codec, or portable execution paths.

```ts doc-test=check
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type {
  IRpcCarrier,
  IRpcFlowHooks,
  IRpcTimeoutFeature
} from '@migaia/rpc-contract/interfaces'

export const cancelled = RpcCoreErrorCode.cancelled
export type ITransportParts = Readonly<{
  carrier: IRpcCarrier
  hooks: IRpcFlowHooks
  timeout: IRpcTimeoutFeature
}>
```

## Capture portable values

Default `normalizePortable` copies and freezes records/arrays, converting visible Uint8Array bytes into an unpadded canonical base64url tag. Later source mutations do not alter the snapshot.

```ts doc-test=run
import assert from 'node:assert/strict'
import { normalizePortable } from '@migaia/rpc-contract/portable'

const source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }
const snapshot = normalizePortable(source)
source.profile.name = 'Grace'
source.bytes[0] = 99
assert.equal(
  JSON.stringify(snapshot),
  '{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}'
)
assert.equal(Object.isFrozen(snapshot), true)
console.log('portable snapshot preserved')
```

The domain contains null, booleans, strings, finite numbers, arrays, plain or null-prototype records, and valid bytes tags. Nonfinite numbers, cycles, undefined, functions, symbols, bigint, Date, Map, Set, and arbitrary class instances are unsupported. The default maximum depth is64.

Protocol records read known fields directly, ignore unknown fields, and retain the original object. They do not inspect prototypes, getters, or non-enumerable properties. Business payloads retain their existing portability rules; default wire traversal may execute each business-record getter once. Negotiated native binary can retain genuine ArrayBuffer/Uint8Array values. The physical carrier owns capability admission, digests, encoding, transfer, and cleanup.

## One protocol

The profile is `migaia.rpc/2`, protocol version2.0, and directory schemaVersion3. Handshake directly exchanges identity, generations, method modes/schemas, and actual codec/extension availability. Operational frames share id, route, and task; v1, the old runtime carrier selector, and the separate JSON-RPC profile are removed.

Kinds are `handshake`, `call`, `group`, `result`, `error`, `cancel`, `stream`, `outcome`, `control`, and `directory`. Notifications also have call IDs so cancellation can propagate after physical sending, without adding business acknowledgement or receipts. Groups contain ordered business steps rather than physical batches.

Extensions use outer carrier records `{ kind: 'extension', extension: '<name>@<version>', data, sidecars? }`. A plugin must be installed and negotiated before chunk/batch behavior executes. Contract checks shapes without enabling capabilities.

See the [protocol guide](./USEGUIDE.en.md) for fields, stage ordering, binary, and errors. JSON Schema supplies structural checks; cross-field relationships, aggregate budgets, native authority, and lifetimes remain the responsibility of the corresponding validator/execution owner.

## Errors

`/error-code` owns every RPC source/code; other packages no longer duplicate those tables. Diagnostic identity grants no authority. Copies and remotely restored errors do not gain local retry, retirement, or control rights.

The protocol carries a `{ root, nodes }` flat error graph. Nodes retain source, code, name, message, stack, cause/errors indices, and optional diagnostics. Restoration preserves supported native classes and sender stacks without replacing them with receiver stacks. Standalone tree utilities under `/errors` remain pure projection helpers, not another business protocol.

Applications start with [rpc-host](../rpc-host/README.en.md) and `createRpcHost`; carrier authors use `@migaia/rpc-host/sdk`. Old `/v1`, `/runtime`, `/framing`, `/binary`, and `/remote` entries and profiles are removed without compatibility aliases.
