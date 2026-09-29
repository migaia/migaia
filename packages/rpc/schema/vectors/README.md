# RPC contract vectors

`canonical.json` is the package-owned semantic fixture. Run `node generate.mjs` to regenerate the
portable-value vector, or `node generate.mjs --check` in a gate. Vectors must be updated together
with a descriptor version change or an explicit type-only/non-wire proof.

`error-chain.json` version 2 is the language-neutral `wire-error` fixture. `valid` values normalize
unchanged; `invalid` values report the listed first violation and JSON Pointer. `unknownFields`
checks both reject and ignore modes, including the normalized `ignoreExpected` snapshot and
ordered unknown-field callbacks. `truncation` maps logical thrown values to canonical payloads;
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
