# RPC contract vectors

`canonical.json` is the package-owned semantic fixture. Run `node generate.mjs` to regenerate the
portable-value vector, or `node generate.mjs --check` in a gate. Vectors must be updated together
with a descriptor version change or an explicit type-only/non-wire proof.

`error-chain.json` version 2 is the language-neutral `wire-error` fixture. `valid` values normalize
unchanged; `invalid` values report the listed first violation and JSON Pointer. `unknownFields` now checks BC9 acceptance; the legacy `ignoreExpected` snapshot retains the
known error fields. Unknown metadata is ignored without a callback. `truncation` maps logical thrown values to canonical payloads;
`{ "absent": true }` represents JavaScript `undefined` and may be skipped by languages without an
absent value. `{ "logicalError": { ... } }` describes an Error-like graph without relying on a JS
prototype; `{ "ref": "root" }` in `cause` makes a cycle. `jsonrpc` maps foreign JSON-RPC errors.

`generate` avoids embedding megabyte strings or thousand-node trees in JSON. `chain` makes `size`
nodes joined by `cause`; `errorsChain` joins them through one-element `errors` arrays; `wide` makes
one root and `size - 1` sibling errors; `message` makes one node whose message is `size` ASCII
`x` characters; `dataDepth` makes one root whose `data` leaf is wrapped in `size - 1` arrays;
`totalBytes` makes one root and 16 siblings, with the first 15 messages each 65 536 `x` bytes and
the last message sized to make the total text-unit count equal `size` (the root and each child
contribute eight fixed bytes). Generated nodes use `s/C/Error`, empty message and `x` stack unless
the shape supplies a message. These rules are independent of JavaScript prototypes and constructors.

The `truncation` generators `longStack`, `oversizedData`, and `greedySiblings` describe large
logical errors without literal megabyte strings. `size` is the input string length or sibling
count; `textBytes` is the ASCII length of each sibling's message and stack; `expectedBytes` and
`expectedChildren` specify the retained output. The `jsonrpc` generator `foreignLongMessage`
uses `size` for the incoming message and `expectedStackBytes` for the truncated synthesized
stack. These generated cases assert their expected wire snapshots, including `truncated`.

All sizes use UTF-8 bytes of Unicode scalar values. Count each node's five string fields, strings
and record keys within `data`, and bytes values' `base64url` text. Do not count node field names,
JSON syntax, or bytes marker keys. The sender replaces lone surrogates and marks `truncated`; the
receiver rejects them. Child admission counts only the child's five fields before `data` and
descendants. `cause` precedes `errors`, and cleanup errors append to `errors` in source order.

`envelope.json` records current envelope kinds, invalid values with the first `violation` and `pointer`,
unknown metadata acceptance and the original known-field validation order. An invalid case
marked `evolvable` may become valid in a later negotiated minor version. `control.json` records
the four initial variation subtypes, their payloads, and expected actions; its unknown subtype is
also evolvable. `handshake.json` records offer pairs, negotiated values, invalid first messages,
and accept values outside an offer. These vectors contain JSON values and protocol text only; they
do not depend on JavaScript error prototypes.

The unpublished frozen 1.0/1.1 snapshots are replaced by with `protocol-baseline.json` and the
current vector files named by it. `SHA256SUMS` covers that baseline, its independent selftest
groups, and the v2 directory and batch contracts. There is one canonical copy of each group.
Network peers require protocol 1.1, `runtime-api@1`, `batch@1` and v2 describe; missing baseline
capabilities are rejected during handshake. Native batches use the existing `batch` envelope;
bridge batches use JSON-RPC 2.0 arrays. Neither path falls back to v1 describe or single-frame-only
operation. Generic highest-common-version negotiation vectors still test the pure contract
functions; they do not authorize an older network baseline.

The obsolete frozen-file identity assertions are replaced by checks of this manifest. First
violations, JSON pointers, wire-error graphs, warning order, framing bytes and stream credit
assertions remain. V1 remote-contract and Host-control vectors remain local advanced facade
configuration until those APIs are removed; foreign network selftests do not interpret them as
describe responses.

## Core profile family

`core-profile.json` is the sole live `migaia.rpc/2` semantic family. Its `valid` and `invalid`
sections retain the existing protocol, correlation, portable-value and schema cases. Under R17/BC9,
unknown metadata is accepted; the former frame/option unknown-field rejection cases now belong to
`valid`. `unknownIgnored` pairs a baseline with a frame containing exactly two unknown fields on
one protocol record. Each language admits the original object and compares all remaining known
content after removing only those two test fields. The extra fields are never business payloads,
so their acceptance does not relax portable bytes markers or JSON Schema keywords.

The current conformance runner requires every core-profile ID from Go, Python, Rust and the public
TypeScript `normalizeRpcFrame` entry. Foreign peers continue their complete existing selftests,
including independent native business, schema, portable value, error-budget and framing assertions;
any non-retired failure still fails. Older vector files and the six v1 TypeScript runner files stay
as historical migration inputs. Moving the current runner does not claim their business assertions
were received or passed.

`packages/rpc-contract/schema/protocol.schema.json` documents the JSON grammar. Pure validators
remain authoritative for node-index bounds, text/depth budgets, handshake identity, group fail-stop
ordering, method uniqueness and runtime state. Only the metadata admission rules changed in BC9.

R19/BC10 adds route-boundary vectors: `forwardRoute` and retained error-node provenance both
accept the origin plus sixteen forwarding hosts (seventeen nodes), and reject eighteen nodes.
Native peers use the same protocol maximum; this does not implement a foreign Host forwarding
policy or change other portable, error-text, graph-node or schema budgets.
