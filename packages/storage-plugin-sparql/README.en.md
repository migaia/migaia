# @migaia/storage-plugin-sparql

Write RDF to a remote SPARQL endpoint or local Oxigraph store and use query chains to read, filter and change quads: data made of a subject, predicate, object and graph. Install the plugin with an HTTP or Oxigraph adapter, construct queries from RDF values, and use `expect` to require specific quads to remain present at commit. A network write with an unknown outcome is not retried automatically.

## Sound familiar?

- A quote breaks a query because a value was inserted as SPARQL syntax.
- Two requests rename the same subject after reading an old value, assuming a predicate can have only one value.
- A timed-out HTTP write is retried even though it already committed.
- Blank nodes from separate RDF documents become confused because their identities were treated as global.

## Why choose it?

- Terms and template bindings separate RDF data from query syntax. See [HTTP reads and writes](./USEGUIDE.en.md#http-reads-and-writes).
- `expect` states which quads must still exist for a conditional commit. See [Detect competing updates](./USEGUIDE.en.md#detect-competing-updates).
- Graph documents use a real RDF parser/writer, with separate blank-node identities for separate imports. See [Graph documents and ontology](./USEGUIDE.en.md#graph-documents-and-ontology).
- Unknown writes are not replayed automatically. Explicit rejection, read failure and unknown commit have distinct errors. See [Failures and disposal](./USEGUIDE.en.md#failures-and-disposal).

## Start here

Use a real Oxigraph Store to write a name quad and read back its count by subject.

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'

await using host = await createStorageHost({
  plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })]
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('urn:example:alice'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Alice'),
  graph: term.defaultGraph
}
await store.use(rdf).add([quad])
console.log(await store.use(rdf).match({ subject: quad.subject }).count())
```

Expected output:

```text
1
```

For filtered deletion, read [Query and change quads](./USEGUIDE.en.md#query-and-change-quads). For a remote service, read [HTTP reads and writes](./USEGUIDE.en.md#http-reads-and-writes).

## What hand-written code gets wrong

String concatenation and a direct HTTP request leave escaping and commit confirmation to the application. This is shown without execution.

```ts doc-test=check
export async function replaceName(endpoint: string, subject: string, name: string) {
  // Pitfall: an embedded quote changes the generated syntax.
  const text = `INSERT DATA { <${subject}> <urn:example:name> "${name}" }`
  // Pitfall: this neither checks HTTP status nor confirms an unknown write.
  await fetch(endpoint, { method: 'POST', body: text })
}
```

Template values bind RDF terms. Transactions use conditional updates and confirmation to distinguish real conflicts from unknown outcomes.

## The model in three minutes

| Tool                           | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| endpoint                       | A real database's query/update connection, adapted from HTTP or Oxigraph. |
| `store.use(rdf)`               | Work with directly comparable quads.                                      |
| `store.use(sparql)`            | Native SELECT, ASK, CONSTRUCT and UPDATE with term binding.               |
| `transaction` / `tx()`         | Accumulate changes and check preconditions in a conditional commit.       |
| Graph Store / ontology Feature | Import, export or replace one graph's RDF document.                       |

Raw SPARQL templates express native query statements. A quad has a subject, predicate, object and graph. A ground quad has no blank node or variable. Organization views map logical graphs to separate physical named graphs.

## Typical scenarios

| Scenario                                 | Building blocks                  | Details                                                                       |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| Filter names before deletion             | `rdf.match` + `where` + `delete` | [Query and change quads](./USEGUIDE.en.md#query-and-change-quads)             |
| Confirm an old value before replacing it | `expect` + `tx`                  | [Detect competing updates](./USEGUIDE.en.md#detect-competing-updates)         |
| Connect to a remote dataset              | `httpEndpoint` + `sparql`        | [HTTP reads and writes](./USEGUIDE.en.md#http-reads-and-writes)               |
| Manage schema documents                  | graphStore / ontology            | [Graph documents and ontology](./USEGUIDE.en.md#graph-documents-and-ontology) |

## Install

The package is currently `private: true` for this repository's workspace; do not assume a registry release. From an application in the same workspace, install the neighboring packages and real peers:

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-sparql
pnpm add n3@^1.26.0 oxigraph@^0.4.11
```

Use Node.js 24 or later. The root does not load Oxigraph's native runtime. `/oxigraph` explicitly selects a real Store; `/http` uses runtime fetch. RDF parsing uses n3 and real RDF/JS declarations.

## Essential API

| API                                                 | Purpose                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `sparqlBackendPlugin({ endpoint, id? }, features?)` | Install an endpoint; id defaults to sparql. |
| `oxigraphEndpoint(store)` / `httpEndpoint(options)` | Adapt local or remote endpoints.            |
| `store.use(rdf)`                                    | `add`, `delete` and `match`.                |
| `store.use(sparql)`                                 | Native query/update templates.              |
| `store.transaction(run)` / `store.tx()`             | Optimistic transactions.                    |
| `graphStoreFeature()` / `ontologyFeature()`         | Graph-document operations.                  |

## Contract details

The backend supplies RDF, SPARQL and native optimistic transactions, with no KV, records, vector, SQL or key locks. Standard RDF accepts named subjects/predicates, named or literal objects, and default/named graphs. Raw SELECT/CONSTRUCT and documents also support blank nodes. RDF-star, document variables and blank standard quads reject. Reasoning belongs to the database.

The endpoint and Store remain with the caller; the host never closes them. Oxigraph 0.4.11's public Store type has no close/dispose method. Release any external connection pool through that client's real API. Host shutdown rejects new calls, cancels active reads and waits for dispatched commits.

Without expect, changes have canonical quad-set semantics: different objects may coexist for one predicate. HTTP deployment must guarantee atomic execution of a conditional Modify and read-after-write visibility on the same dataset; the protocol alone cannot establish those properties. See the [usage guide](./USEGUIDE.en.md) for failures, unknown commits and document limits.
