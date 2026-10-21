# `@migaia/rpc-process`

Call functions in a child process or local service with typed requests and streams, while an explicit owner manages connections, supervision, and cleanup.

## You may have run into this

- A result returns without proving computation left the main process because launch and call ownership are unclear.
- Reverse calls use another pipe because bidirectional routing and response correlation are rebuilt separately.
- One CLI client shuts down a shared service because borrowing a connection is confused with process ownership.
- Reconnects lose retained outcomes or mix principals because deduplication scopes follow temporary connection labels.
- A stale ready flag still dispatches work after the actual supervisor enters terminal state.

## Why choose it

- **Execute a business function in a real operating-system child.** Spawn and Core calls share the supervised connection, while the returned PID demonstrates the process boundary, demonstrated in [Run a function in a real child and close its owner](./USEGUIDE.en.md#run-a-function-in-a-real-child-and-close-its-owner).
- **Use reverse requests and iterative results over one connection.** Both parties provide methods through the same authentication and catalog, enabling parent-service calls and child generators, demonstrated in [Use reverse calls and streaming on the same child connection](./USEGUIDE.en.md#use-reverse-calls-and-streaming-on-the-same-child-connection).
- **Keep connection cleanup separate from service ownership.** connect releases only its local connection while the named listener remains available to another caller, demonstrated in [Close one client while leaving a named local service available](./USEGUIDE.en.md#close-one-client-while-leaving-a-named-local-service-available).
- **Keep principal-label scopes stable across reconnections.** sessionOptions derives owner-local scopes from application-supplied principalId, sharing store/scope for one principal while separating another, demonstrated in [Keep retry scopes stable across reconnections and separate principals](./USEGUIDE.en.md#keep-retry-scopes-stable-across-reconnections-and-separate-principals).
- **Reject new work before dispatch after real terminal state.** callGuard uses the registered supervisor's terminal state, and removing governance does not dispose an externally owned supervisor, demonstrated in [Reject new work after a real child reaches terminal state](./USEGUIDE.en.md#reject-new-work-after-a-real-child-reaches-terminal-state).

## Start here

```ts doc-test=run
import { randomUUID } from 'node:crypto'
import { createProcessPeer } from '@migaia/rpc-process'

const name = 'reader-' + randomUUID()
const provide = { double: (value: number) => value * 2 }
const server = await createProcessPeer({ listen: name, provide })
const client = await createProcessPeer<{ double(value: number): number }>({ connect: name })
try {
  console.log(await client.request('double', 21))
} finally {
  await client.close()
  await server.close()
}
```

Output:

```text
42
```

This short example uses a Node/POSIX same-user local endpoint; see [child launch and cleanup](./USEGUIDE.en.md#run-a-function-in-a-real-child-and-close-its-owner) for a real child, or [Host ownership](./USEGUIDE.en.md#let-a-host-own-a-spawned-service-and-its-release) for several installed services.

## Pitfalls when writing it yourself

This manually assembled local request channel is displayed only. Native byte chunks do not provide framing, authentication, or cleanup ownership by themselves.

```ts doc-test=check
import { createServer } from 'node:net'

const server = createServer((socket) => {
  socket.on('data', (chunk) => {
    const value = JSON.parse(chunk.toString()) // Pitfall: one data chunk is not necessarily one JSON message.
    socket.write(JSON.stringify(value * 2)) // Pitfall: no source authentication or request/result correlation.
  })
})
server.listen(0, '127.0.0.1') // Pitfall: sockets and the listener need separate cleanup ownership.
void server
```

The quick start uses Peer's real handshake and message correlation, closes each client's own connection, and closes the listener separately instead of treating one byte chunk as a complete request.

## A three-minute mental model

First decide who launches, connects, or accepts. A Peer is Core's logical call interface. A spawn owner owns its child; connect owns only its connection; listen owns acceptance; resilience connects real state to governance policy.

| Task / term                            | Tool                           | Meaning                                              |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| An isolated task / spawn               | createProcessPeer({spawn})     | Launch and own a supervised child                    |
| An existing service / connect          | createProcessPeer({connect})   | Borrow the service and close only this connection    |
| Accept callers / listen                | createProcessPeer({listen})    | Accept independent sessions on a local endpoint      |
| Shared cleanup / Plugin                | createProcessPlugin → host.use | Let Host own installed process connections           |
| Admission and diagnostics / resilience | sessionOptions / callGuard     | Scope authenticated retries and refuse terminal work |

## Typical scenarios

| Scenario                                                              | How to combine                                                  | Details                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Run a function in a real child and close its owner                    | `isProcessChild → spawn:true → request → close`                 | [Complete example](./USEGUIDE.en.md#run-a-function-in-a-real-child-and-close-its-owner)                    |
| Use reverse calls and streaming on the same child connection          | `provide(parent) ↔ request(child) → stream`                     | [Complete example](./USEGUIDE.en.md#use-reverse-calls-and-streaming-on-the-same-child-connection)          |
| Close one client while leaving a named local service available        | `listen(name) → connect × 2 → close client → close server`      | [Complete example](./USEGUIDE.en.md#close-one-client-while-leaving-a-named-local-service-available)        |
| Let a Host own a spawned service and its release                      | `createProcessPlugin → host.use → host.process → dispose`       | [Complete example](./USEGUIDE.en.md#let-a-host-own-a-spawned-service-and-its-release)                      |
| Keep retry scopes stable across reconnections and separate principals | `sessionOptions(identity) → idempotency.store / scope`          | [Complete example](./USEGUIDE.en.md#keep-retry-scopes-stable-across-reconnections-and-separate-principals) |
| Reject new work after a real child reaches terminal state             | `real supervisor → attachRegistration → callGuard → onTerminal` | [Complete example](./USEGUIDE.en.md#reject-new-work-after-a-real-child-reaches-terminal-state)             |

## Installation

```bash
pnpm add @migaia/rpc-process @migaia/rpc-core @migaia/rpc-contract
```

The full Host/governance examples also import their owners directly:

```bash
pnpm add @migaia/plugin-host @migaia/supervision @migaia/utils
```

## Essential APIs

| API                                | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `createProcessPeer(options)`       | Obtain an independent process call interface                  |
| `isProcessChild()`                 | Separate parent/child roles in a self-spawned entry           |
| `peer.request / notify / stream`   | Choose a scalar result, sending only, or iterative results    |
| `peer.close()`                     | Release the connection and stop an owned child                |
| `createProcessPlugin(options)`     | Give a process connection to PluginHost                       |
| `createProcessResilience(options)` | Combine session limits, retry scopes, and terminal governance |

## Contract details

### Ownership, installation, and platform entries

This package owns process launch, stdio/socket resources, bootstrap discovery, authentication, and supervisor bindings. Core owns Runtime Peer calls, catalogs, deadlines, cancellation, idempotency, and error reconstruction. supervision owns execution units, budgets, and restarting; PluginHost owns installation, dependencies, and replacement. Do not create competing shutdown owners for one child.

Install rpc-process, rpc-core, and rpc-contract directly. The latter two are peer dependencies, without a runtime requirement that all versions be numerically equal. Runtime dependencies are plugin-host, supervision, and utils. Publishing retains dist/schema and nine entries. The manifest supports Node>=18; these TypeScript examples were executed with Node 24, not as evidence for Bun, Deno, Electron, or Windows.

| Entry                                        | Purpose and limits                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Root                                         | createProcessPeer/Plugin/Transport, createNativeProcessOffer, createProcessResilience, errors/constants, channel and extension types |
| adapters/node-child-process                  | createNodeProcessLauncher, openProcessStdioChannel, child/process stdio construction                                                 |
| adapters/node-socket                         | dialProcessByteChannel, listenProcessByteChannel, createAdapterSocketByteIO                                                          |
| adapters/bun-spawn / adapters/bun-socket     | Bun launch, stdio, and local sockets                                                                                                 |
| adapters/deno-command / adapters/deno-socket | Deno.Command, stdio, and local sockets with host permissions                                                                         |
| adapters/electron-utility-process            | createElectronUtilityProcessLauncher over whole messages; optional electron ^44.0.0                                                  |
| adapters/windows-job                         | Optional koffi ^3.1.6; currently a placeholder with unsupported capabilities and launch rejecting PROCESS_CHANNEL_CONNECT_FAILED     |

Import the actual host entry rather than loading unrelated platform dependencies. Local process work and daemons are supported; cross-machine sockets are not. Use rpc-threads for Workers and rpc-browser for browser windows. Foreign-language services use the JSON-RPC byte profile rather than native streaming or transfer.

### Peer sources, short launch, and bootstrap

Choose exactly one spawn/connect/listen source. Only a child launched by this library may omit all three and discover its parent through the existing marker and stdin bootstrap. Direct node service.js does not satisfy that condition; independently started services should listen explicitly. provide defaults to no application methods and accepts own enumerable data properties and nested method groups. Names become dotted paths such as math.double. Accessors, cycles, duplicates, and invalid names fail before connection. Scalar functions use request/notify; iterable/async-iterable methods use stream. Core's portable-value domain still applies.

| Source  | Actual ownership                                   | close effect                                                       |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| spawn   | Supervisor-owned child and connection              | Close the connection and stop the owned child                      |
| connect | Only the local connection; remote process borrowed | Release this connection without ending the service                 |
| listen  | Listener and accepted sessions                     | Stop acceptance and close sessions without owning client processes |

Both parties may provide methods and make reverse calls. A child Peer keeps its event loop alive until parent connection closure. The ordinary parent-loss path handles child exit, but forcibly killing the parent cannot guarantee that parent cleanup ran or that every descendant terminates.

Short spawn accepts true, an entry string/URL, or a configuration object. true reruns the entire main module; branch on isProcessChild first to avoid recursive spawning. That function reads existing discovery state, remains true after discovery consumes the marker, and grants no authentication. Self-spawn excludes REPL/eval/test runners, Electron, and single executables lacking a usable main entry; use an exact entry or command/args instead.

| Short spawn field     | Default and effect                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| entry / base          | Relative strings resolve from the main-entry directory; base overrides that reference, while an explicit URL names the exact file                 |
| command / args        | Current runtime by default; explicit commands default to []; spawn:true inherits argv.slice(2), other entries default to no application arguments |
| cwd                   | undefined, passed to the actual launcher                                                                                                          |
| env.inherit / env.set | ['PATH'] / {}, without ambient full-environment inheritance                                                                                       |
| stdio                 | {stdin:'channel',stdout:'channel',stderr:'drain'}                                                                                                 |
| wire                  | native; jsonrpc requires a local contract or custom establish                                                                                     |
| token                 | Random 32-byte base64url credential passed through stdin bootstrap, never intended for logs                                                       |
| supervision           | One maxUnits:1 process budget, best-effort isolation, and the selected native launcher unless overridden                                          |
| limits / permissions  | undefined, subject to the launcher's actual capabilities rather than an automatic OS sandbox                                                      |
| offer / establish     | Optional narrower proposal or real-channel assembly; otherwise the standard native/jsonrpc path                                                   |
| wrap                  | undefined; rewrites only command/args/cwd/env on each launch                                                                                      |
| onNotice              | undefined; handles expected termination-capability notices without suppressing unrelated failures                                                 |

Node/Bun retain runtime flags and --import loaders while removing eval/print/test control arguments. Node type stripping does not rewrite .js imports to .ts; use built JavaScript or a real loader for that source layout. Bun resolves supported TypeScript imports. Deno's default run grants only PATH/bootstrap environment access; extra permissions require explicit command/args. A test runner's entry is not a self-spawnable business module.

PROCESS_RUNTIME_API_ENV is MIGAIA_RPC_RUNTIME_API_BOOTSTRAP with discovery version '1'; it is nonsecret discovery data. Actual bootstrap starts with a four-byte big-endian length and content. Its separate metadata envelope does not change the RPC handshake grammar. Runtime bootstrap defaults to 10000 ms, followed by the ordinary handshake deadline.

Node launches without a shell or implicit environment inheritance, drains stderr before writing bootstrap, and never also consumes channel stdout as ordinary output. It advertises enforced fault isolation/stdin bootstrap but not enforced termination, memory, CPU, permission, or fd-bootstrap capability. POSIX can attempt process-group termination and Windows can attempt direct-child termination; neither is a promise that every descendant ends. Required isolation cannot be substituted for Node best-effort behavior.

Short-source spawn.supervision.startupTimeoutMs defaults to 10000. Its restart object has flat fields mode:'on-failure', maxRestarts:5, windowMs:60000, initialDelayMs:250, factor:2, maxDelayMs:30000. stop.drainTimeoutMs/stop.reapTimeoutMs both default to 5000. restart.mode is never/on-failure/always: no restart, restart on failure, or restart after every exit. Process managed bindings also reuse Core's 5000-ms call drain, narrowed by remaining stop budget rather than waiting indefinitely for uncooperative calls.

With report omitted, short sources coalesce the expected unsupported-termination notice once per native process. Explicit report receives it per launch, whether the default function is supplied directly or wrapped. onNotice replaces that particular reporter delivery. Other errors remain reported, and full sources retain explicit reporting policy.

### External sandbox wrappers and full sources

wrap(command) runs on initial launch, restart, and replacement, including a custom launcher. It receives and may return only command, args, cwd, and env. Applications may choose sandbox-exec/profiles on macOS or bwrap/read-only mounts/network isolation on Linux. This package installs no sandbox tools or policies, and those platform descriptions are not execution evidence.

A wrapper must preserve stdin/stdout: stdin first carries bootstrap and then RPC, stdout contains only protocol frames, and logs use stderr. Preserve env.inherit/env.set. The launcher adds MIGAIA_RPC_RUNTIME_API_BOOTSTRAP after wrapping; container wrappers must forward it and the original environment. Preserve the real exit code rather than converting failure into success. Returned stdio/bootstrap/limits/permissions fields do not acquire authority over those resources.

A nonfunction wrap fails during source preparation. A throw or invalid return fails launch with PROCESS_PLUGIN_INVALID_OPTION TypeError reachable through supervision LAUNCH_FAILED, retaining a thrown callback value on cause. Host installation can add outer PLUGIN_INSTALL_FAILED; classify identities rather than message text.

A full spawn combines kind:'spawn', channelKind:'byte'|'message', supervision, rawChannel(handle,signal), establish(raw,prepared), token, and optional offer. Full byte spawn must explicitly select wire:'native'|'jsonrpc'; message spawn must omit wire. Only short forms add the native default. supervision.spec owns command/args/env/stdio/bootstrap/limits, and stdin bootstrap bytes must match authentication token. A budget bounds simultaneous units, not OS memory. isolation is best-effort/required, and spec.limits.callWallTimeMs caps individual call deadlines.

rawChannel returns this launch's real handle resources. establish uses prepared offer/scheduler/signal/session/token/stderr to authenticate the real channel, not a claimed authenticated DTO. Advanced callback sources async(context)=>sourceResult bypass this package's supervision and do not grant stop/restart/replace capability.

### Calls, deadlines, and unknown outcomes

TRemote supplies business typing only. With no generic surface there are no callable method types; IRuntimeDynamicSurface permits dynamic strings at compile time while the accepted remote catalog still rejects unknown methods.

| Peer method                       | Behavior                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| request(method,payload?,options?) | Await a scalar result and preserve operation failure                                                           |
| notify(method,payload?,options?)  | Await local sending, not remote business completion                                                            |
| stream(method,payload?,options?)  | Start on first next; early break/return signals producer cleanup                                               |
| group(steps,options?)             | Sequential requests; later steps become not-executed after failure without rolling back completed work         |
| outcome(idempotencyKey)           | Query pending/done/unknown; done contains the retained result, unknown does not prove nonexecution             |
| describe(options?)                | Query local identity, admitted connections, and catalog without another network call                           |
| on / Symbol.asyncDispose          | Core events/cleanup; a connecting factory establishes initial readiness, while listen only installs acceptance |
| close()                           | Seal new work, drain according to the original owner, and share one cleanup Promise                            |

defaultTimeoutMs is 30000 ms and must be a positive finite number; only request/stream inherit it. A call's timeoutMs may be a nonnegative number or false: 0 expires immediately and false disables the default deadline, while a process callWallTimeMs cap may still apply. signal cancellation is cooperative and does not prove business nonexecution. idempotencyKey reuses outcomes only when the provider declared and retained them. orderKey serializes a key at the provider. cancel:'before-start' cancels unstarted work but waits for the real outcome once it has started.

Process calls reject the transfer property even when []. Ordinary ArrayBuffer/Uint8Array payloads are copied. Timeout, cancellation, disconnection, and unknown outcome do not prove that execution never happened. Reconcile non-idempotent writes through outcome or business state before retrying. Distinguish admission failures such as OVERLOADED/PROCESS_CONNECTION_LIMIT and successful before-start cancellation from sent calls whose outcome is unknown.

### Names, local sockets, and authentication

Short connect/listen strings may be plain service names or explicit addresses. Names contain no slash/protocol and derive one endpoint from OS user and name. POSIX uses a private 0700 user directory and 0600 socket, rejecting wrong owners/permissions, symlinks, and other services' paths. Node-compatible APIs expose no peer-credential reader here; OS permissions isolate users, not applications within one user. Supply a token to distinguish those applications.

Loopback TCP, explicit Unix paths, and Windows named pipes without an adapter ACL require tokens. The same-user hello marker is public protocol data, not a secret. Supported addresses are tcp://127.0.0.1:port, tcp://[::1]:port, absolute Unix paths, and Windows named pipes, never remote-machine addresses. Port 0 lets the OS choose a port returned through listener.address.

connectTimeoutMs defaults to 5000 ms and accepts a finite nonnegative number. Only named-local rendezvous retries ENOENT/ECONNREFUSED at up-to-25-ms intervals; explicit-address dialing does not. signal cancels a pending retry with its original reason. A second same-name listener still fails PROCESS_CHANNEL_LISTEN_FAILED. Existing owner records reclaim only abandoned same-service paths.

Full connect contains kind:'connect', address/token, dial(address,signal), establish, optional offer, and native wire by default. Optional local-session supervision can set restart/startupTimeoutMs/health/stop/terminalPolicy/scheduler; it rebuilds the connection without owning or restarting the external process. Full listen contains kind:'listener', listen/address/offer/verify/createConnectionContext and optional scheduler. Each accepted session has its own labels and channel. verify returns the principal rather than trusting self-reported client identity. Invalid credentials can produce outer REMOTE_START_FAILED on the client and original PROCESS_CHANNEL_AUTH_REJECTED in the server reporter; do not blindly repeat them.

A socket listener owns listening and unhanded candidates, not sessions already transferred. close shares one Promise. Unix owner records do not guarantee native path deletion safety after external replacement: Node/libuv may unlink a successor inode installed at the old path when the original listener closes. The current path reports PROCESS_CHANNEL_LISTEN_FAILED/cause once, without repeating on later closes. Do not replace an active listener's path with another owner. The existing Darwin path budget is 104 bytes without a shorter hidden staging address.

### PluginHost outlet, replacement, and descriptors

The runtime createProcessPlugin form adds name/expose to Peer sources/provide, producing a plugin for Host.use. Host owns that installed process connection; another owner should not independently terminate it. expose defaults to no Host methods. Explicit Feature method paths are whitelisted individually: exposing math.add does not expose math.sub.

host.process request/notify/stream/group/outcome take a connection name or {name,instanceId} when exact instance selection is required. list/get expose identity, generation, health, and exit information, returning unavailable rather than invented zeros. on returns an idempotent disposer; watch is bounded async iteration. broadcast aggregates individual results without all-success guarantees. stop/kill/restart/replace require spawn ownership; connect/listen reject with CAPABILITY_CONFLICT.

Replacement uses existing supervision/Host strategies without moving calls already executing. IProcessPlugin.replace defaults options to {} and strategy to stop-then-start, accepting optional spec and stop-then-start/start-then-switch strategies; results carry the underlying supervisor outcome or successor plugin. Original owners retain preparation, switching, and retirement. Both Host execution budgets must be explicit under PluginHost's contract; false means unlimited rather than a default.

Root also exports parseProcessPluginDescriptor and ProcessPluginWire. A descriptor is persistent configuration data without live channels, bootstrap credentials, or authenticated state. Executable ports come from actual factories. Low-level IProcessPluginOptions deployment/host/endpointFactory/registrationOwner and convenient runtime-source options are distinct public shapes.

### Session governance and terminal liquidation

createProcessResilience requires scheduler/report and does not create another process supervisor. Its default idempotency store uses an owner-specific namespace. Different connections/sessions of one principal share a deduplication scope; separate owners remain isolated. identity requires a nonempty principalId, with connectionId/sessionId labels and optional processId.

| Resilience option                                | Exact default           |
| ------------------------------------------------ | ----------------------- |
| maxConnections / maxConcurrentCallsPerConnection | 64 / 32                 |
| maxCallsPerMinute / maxPayloadBytes              | 600 / 16*1024*1024      |
| maxConsecutiveTimeouts / idleTimeoutMs           | 3 / 60000               |
| drainMs                                          | 5000                    |
| reportAtMs                                       | [0,60000,300000,900000] |
| unhandledLimit / liquidation.cascade             | 3 / false               |

Capacity, timeout, and drain options are positive safe integers; 0 does not disable them. Report times are relative to terminal entry, with the original supervisor retaining its zero-minute report. Liquidation follows the unhandled threshold rather than treating the first diagnostic as removal.

sessionOptions(identity) supplies Endpoint idempotency/limits. listenRegistrations accepts wire:'native', a real listen/address/offer, verifyToken, createConnectionContext, onCandidate, and optional serviceId/scheduler/handshakeTimeoutMs/signal. onCandidate returns adopt/reject. The listener owns pending candidates, while an adopted lease passes to its adopter. lease.channel/identity/close form one session. Principals come from authentication; declaring fields cannot skip a handshake.

attachRegistration(name,binding,owner) connects a real supervisor. binding.ownership is spawn-owned/connection-borrowed and health is ping/custom/none. The owner is either proxy-plugin name/Host.unUse or standalone-host release. callGuard rejects terminal/liquidated work before provider execution. inspect returns state/health/unhandled/liquidated/reason or undefined for unknown names. Any fulfilled onTerminal handler counts as handled, resets unhandled accounting, and stops later diagnostics; only all-rejected outcomes remain unhandled, with rejection causes reported.

Explicit shared-instance health failure closes shared sessions before creating/replacing the target; failure keeps it fenced and reports the original reason. Per-connection mode closes only the affected session rather than replacing the shared process. Connection/rate/payload admission fails PROCESS_CONNECTION_LIMIT before business execution. Consecutive timeouts and idle expiry close that connection without proving whole-instance failure.

Liquidation uses only the Host's committed affected plan, never a dry run as proof of mutation. Post-removal cleanup errors still count as committed and retain terminal/cleanup causes. Precommit rejection or standalone release failure creates no liquidated tombstone and does not retry the Host mutation automatically. Default suspend starts diagnostics for actually affected dependants; cascade releases actual dependants without starting diagnostics for already-released ones. Only the newest 100 committed tombstones remain. An old registration.close cannot remove a replacement generation.

registration.close stops its diagnostics/subscription without disposing an external supervisor. resilience.close releases listeners/registrations it owns, shares one allSettled cleanup Promise, and rejects cleanup failure as PROCESS_CHANNEL_CLOSED AggregateError. Not every read method becomes a closed-state exception; sessionOptions/inspect retain their original behavior. The actual supervisor/Host owner still disposes those resources.

### Channels, negotiation, diagnostics, and platform capability

IProcessByteChannel is an ordered kind:'byte' write/onData/onClose/close port whose write Promise retains backpressure. IProcessMessageChannel supplies kind:'message' send/onMessage/onClose/close. Byte createProcessTransport requires initiator+offer or responder+offer+auth; responder auth is required/verify or explicit none. Common options include peerId/report/ipc and optional signal/scheduler/handshakeTimeoutMs. ipc requires connectionId/sessionId/log and optionally processId, stderr, maxPendingData/maxPendingControl.

createNativeProcessOffer requires peer and optionally auth/stream/capabilities. Its direct baseline is ping/close/batch, adding stream only for stream:true. Omitted capabilities lets Runtime complete defaults from actually installed Core capabilities. Explicit lists, including [], are not widened automatically; stream:false prevents automatic stream expansion. Offer/version/codec/peer data is frozen, and Contract owns the json codec and current RpcProtocol version.

Message staticAgreement.local/peer must both use codec:'identity' with identical ordered capability lists. This validates input declarations rather than minting negotiated trust. Existing base abort/ping/close/deadline/idempotency/trace/stream/batch capabilities are directly usable; Runtime/binary extensions still require Core ACK. Missing ACK or timeout leaves actual base capabilities, visible through agreement.capabilities.

Default inbound providerLimits are maxPerPeer=64/maxGlobal=256, with rejection reasons available through onRejected. Exceeding limits produces Core OVERLOADED before execution. These differ from resilience's 32-per-session concurrency defaults. PROCESS_HANDSHAKE_MAX_FRAME_BYTES=65536 bounds the initial handshake frame; native business frames are limited to 16 MiB. Handshake and message-extension ACK deadlines default to 10000 ms. Core pending-send data/control limits default to 256/8. Manual receiveAdapterBootstrap/openProcessStdioChannel has no timer when bootstrapTimeout is omitted; automatic child discovery explicitly supplies 10000 ms. Use stream or application chunking for large values.

stderr drains from launch. Each session produces at most 32 ipc.stderr records per 1000 ms, merging excess chunks into a redacted droppedChunks summary. stdout is never a log channel. Native ping defaults to 5000-ms intervals, 2000-ms checks, and three failures before unhealthy; explicit custom health wins. JSON-RPC disables native ping by default. PROCESS_HEALTH_PING_FAILED feeds the original supervision policy rather than a new restart loop.

Node/Bun/Deno stdio/socket paths reuse Core byte framing. transport.observe is available; the old not-implemented description is obsolete. Byte observation emits once synchronously with complete frame.byteLength and borrowed detail containing frameBytes/drainMs. Inbound drainMs is 0; outbound starts at -1 and physical onWrite completion updates that same detail without a second asynchronous carrier event. Capture supplies the original frame reference; copy numeric metadata when retaining it. Whole-message content retains the original value, detail is undefined, and native-byte size is known while opaque size remains -1 without serialization. Observer failures report through Core TRANSPORT. Logical send duration is not drainMs, and Node results prove neither native Electron behavior nor a speed claim.

Web Streams byte close publishes its shared Promise before callbacks, then attempts all observers, reader.cancel, writer.abort, and physical cleanup despite failures. Cleanup rejects PROCESS_CHANNEL_CLOSED AggregateError with first cause and all errors. Writer acquisition failure releases an acquired reader lock and retains native TypeError with PROCESS_CHANNEL_CONNECT_FAILED. Node/Deno/Web byte constructors require actual resources, not authenticated-state claims.

Adapter authors can use createAdapterSocketByteIO, createAdapterChildStdio, createAdapterProcessStdio, createAdapterWebByteIO, and createAdapterProcessLaunch/Peer/Plugin. Prefer Core defineByteAdapter/defineMessageAdapter, using the original advanced SDK for complex assembly rather than duplicating framing, handshake, correlation, or lifetime state.

### Foreign-language JSON-RPC contract

For ordinary foreign children use spawn:{command,args,wire:'jsonrpc',contract}, retaining normal spawn supervision. createProcessJsonRpcChannel supports an application-owned ordered byte connection. Former bridge factories converge on this entry and IProcessJsonRpcChannelOptions; bridge error constants come from rpc-contract/framing/jsonrpc. Process retains byte-close/stderr/diagnostic ownership while Core owns protocol negotiation, correlation, and cleanup.

Advanced options explicitly provide byte/peerId/target/offer/token/scheduler/wallClock/ipc/report, with optional signal/handshakeTimeoutMs. JSON-RPC handshake defaults to 10000 ms without native length-prefix framing or default ping. target is {kind:'plugin',contract} or {kind:'host',catalog}. Local contract prechecks unsupported streams; the actual callable catalog comes from remote migaia.describe, never caller-declared authority. The bridge fills codecs/auth. Optional capabilities are deadline@1, trace@1, idempotency@1 plus automatically required jsonrpc-bridge@1/runtime-api@1/batch@1/abort@1/wire-error@1.

| Protocol operation | Wire requirements                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap          | Child reads four-byte big-endian length and UTF-8 token before messages; socket credentials are shared by the application                                                                          |
| Framing            | Content-Length counts UTF-8 bytes, followed by CRLF CRLF and JSON; header≤1024 bytes, frame≤16 MiB                                                                                                 |
| migaia.hello       | JSON-RPC 2.0 with id; params.hello is a JSON-stringified handshake hello containing migaia.rpc, versions, json codec, capabilities, peer, auth                                                     |
| Hello result       | reply is a JSON accept/reject string and methods lists migaia.hello/migaia.describe/migaia.invoke/migaia.cancel; accept selects shared version, currently 1.1, json codec, and shared capabilities |
| migaia.describe    | params.args=[]; result schemaVersion:2, self{name,instanceId}, methods; instanceId matches handshake peer.id                                                                                       |
| Method row         | name, supportedModes containing only request/notify, modeSource:'declared', optional idempotent; stream is rejected                                                                                |
| migaia.invoke      | params.method and positional args array; omitted payload becomes []; id requests a result, absence means notify without a reply                                                                    |
| Invoke meta        | Optional timeoutMs/idempotencyKey/trace, including only actually supplied values                                                                                                                   |
| migaia.cancel      | Notification with params.id and optional reason, no acknowledgement or rollback; late results are discarded                                                                                        |
| Batch              | Arrays after handshake, processed in order; replies include only id-bearing requests, with independent member failures and no reply for all-notify batches                                         |

Reject non-hello traffic before authentication. Invalid credentials produce reject plus wire error. stdout contains protocol only; logs use stderr. Any language can implement the peer. The former minimal Python pattern reads exact bootstrap bytes, loops over Content-Length messages, verifies hello, describes methods, dispatches invoke, and handles cancel notifications; it does not automatically implement business idempotency or cancellation. Reverse migaia.invoke is supported by the protocol but must be verified in the application's language implementation.

Payloads must be arrays, otherwise JSONRPC_PROFILE_INVALID. Represent integers outside ±(2^53-1) as strings. JSON encoding supports neither native streams nor transfer. Invalid framing/UTF-8/JSON or partial-frame closure terminates with JSONRPC_FRAME_INVALID. Unknown/late ids are reported and discarded without disrupting other calls.

Business failures use JSON-RPC error.code/message/data.migaiaWireError, with source/code/name/message/stack and optional cause/errors. Never replace the recorded stack at the receiver. Integer JSON-RPC codes include -32700 parse, -32600 request, -32601 method, -32602 parameters, -32603 internal, and -32000 business. Semantic diagnostics still use wire source/code. Reuse Contract toJsonRpcError/fromJsonRpcError and encodeJsonRpcFrame/createJsonRpcFrameDecoder rather than another protocol implementation.

| Bridge code, source=@migaia/rpc/bridge/jsonrpc | Trigger                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| JSONRPC_FRAME_INVALID                          | Invalid header/encoding/JSON or partial closure; terminal connection |
| JSONRPC_EXTENSION_MISSING                      | Hello omits required capabilities or extension methods               |
| JSONRPC_PROFILE_INVALID                        | Unsupported local profile, payload, or capabilities                  |
| JSONRPC_UNSUPPORTED_MODE                       | Stream in the local contract or remote catalog                       |
| JSONRPC_HANDSHAKE_TIMEOUT                      | Handshake deadline; inspect bootstrap/stdin/reply handling           |

Remote wire source/code is diagnostic data, not local cancellation/retry/authentication authority. Business Errors without semantic identity can restore their native type with unknown/UNKNOWN rather than invented Process codes. Non-idempotent retry still requires reconciliation or real provider-side meta.idempotencyKey deduplication.

### Errors and troubleshooting

RPC_PROCESS_ERROR_SOURCE is @migaia/rpc/process. Native synchronous spawn and Unix listener preparation/bind errors receive semantic identity on the original object, retaining native type, stack, and other OS fields while replacing errno code with the semantic code. Wrappers retain originals through cause. Do not control behavior by matching messages.

| Process code                                                   | Scenario                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| PROCESS_HANDSHAKE_TIMEOUT / PROCESS_CHANNEL_AUTH_REJECTED      | Incomplete handshake or rejected credentials                                         |
| PROCESS_CHANNEL_CLOSED                                         | Closed-channel work or resource/close-observer cleanup failure; inspect cause/errors |
| PROCESS_CHANNEL_CONNECT_FAILED / PROCESS_CHANNEL_LISTEN_FAILED | Dial/launch or listener preparation/bind failure                                     |
| PROCESS_PLUGIN_INVALID_OPTION / PROCESS_HOST_INVALID_OPTION    | Invalid source/plugin or Host configuration                                          |
| PROCESS_HOST_CLOSED                                            | Facade release has begun; create another owner                                       |
| PROCESS_RESILIENCE_INVALID_OPTION / PROCESS_CONNECTION_LIMIT   | Invalid governance or connection/rate/payload admission refusal                      |
| PROCESS_INSTANCE_UNHEALTHY / PROCESS_HEALTH_PING_FAILED        | Explicit shared-instance health isolation or failed native ping                      |
| PROCESS_TERMINAL_CALL / PROCESS_LIQUIDATED                     | Terminal work refusal or liquidation forbidding restart                              |
| PROCESS_USAGE_SAMPLE_FAILED                                    | Native CPU/memory sample failure; show unavailable without altering process lifetime |

Core call errors include DEADLINE_EXCEEDED/TimeoutError, CANCELLED/AbortError, OVERLOADED, PROVIDER_NOT_FOUND, and TRANSPORT. Remote/PluginHost/Supervision wrappers keep their own sources. Native business errors such as RangeError retain type/message/stack/cause through wire rather than becoming Process host errors.

For automatic-source failure, confirm the library launcher actually started the child. For handshake timeout, confirm bootstrap consumption, stdin reading, and protocol-only stdout. Check loopback/permissions/token for sockets. notify confirms sending only. Send large files in chunks/streams or pass an agreed path for the remote application to read. Validate descendant termination and permissions against the actual host.

These existing scripts are listed without claiming this documentation editor ran them. The package retains coverage in its test script; benchmark or multi-host support descriptions are not execution evidence.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```
