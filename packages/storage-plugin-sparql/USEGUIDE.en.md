# SPARQL native endpoints

`@migaia/storage-plugin-sparql/http` creates a caller-owned SPARQL 1.1 Protocol endpoint. Pass queryUrl and updateUrl, optionally graphStoreUrl and Basic or Bearer credentials. The factory performs no I/O. Generic HTTP supplies no atomicUpdate promise. Authentication is used only in native request headers.

`@migaia/storage-plugin-sparql/oxigraph` adapts a caller-owned oxigraph.Store. The adapter never closes it. Its atomicUpdate executes exactly one native Store.update. Graph replacement parses with n3 and performs one complete native Update; merge uses native transactional load. Oxigraph 0.4.11 is the supported peer, with n3 1.26.0 and real RDF/JS declarations.

SELECT/ASK use the SPARQL JSON format. CONSTRUCT and RDF documents use the actual n3 parser/writer, preserving RDF 1.1 literals and response-local blank nodes. Turtle and N-Triples are the supported graph formats. Every document parse uses a fresh blank prefix. RDF-star and variables are outside the supported document domain.

HTTP HEAD404 means a missing graph; GET404 rejects. Other 4xx failures carry SPARQL_REQUEST_FAILED, read 5xx/transport failures carry SPARQL_UNAVAILABLE. A sent modification whose result is uncertain carries SPARQL_COMMIT_UNKNOWN and is never replayed. Errors retain original status/body/cause without copying authentication configuration. Parsing failures carry SPARQL_RESPONSE_INVALID. Local invalid inputs use the shared INVALID_ARGUMENT family.
