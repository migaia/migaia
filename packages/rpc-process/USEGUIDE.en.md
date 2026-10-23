# `@migaia/rpc-process` usage guide

Choose a concrete ownership or calling task below. The examples use real Node processes and local sockets, with public Host/supervisor owners rather than fabricated native resources.

## Find a scenario

| Scenario                                                              | API                       | Details                                                                                    |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| Run a function in a real child and close its owner                    | `createProcessPeer`       | [Complete example](#run-a-function-in-a-real-child-and-close-its-owner)                    |
| Use reverse calls and streaming on the same child connection          | `createProcessPeer`       | [Complete example](#use-reverse-calls-and-streaming-on-the-same-child-connection)          |
| Close one client while leaving a named local service available        | `createProcessPeer`       | [Complete example](#close-one-client-while-leaving-a-named-local-service-available)        |
| Let a Host own a spawned service and its release                      | `createProcessPlugin`     | [Complete example](#let-a-host-own-a-spawned-service-and-its-release)                      |
| Keep retry scopes stable across reconnections and separate principals | `createProcessResilience` | [Complete example](#keep-retry-scopes-stable-across-reconnections-and-separate-principals) |
| Reject new work after a real child reaches terminal state             | `createProcessResilience` | [Complete example](#reject-new-work-after-a-real-child-reaches-terminal-state)             |

## Running the examples

```bash
pnpm add @migaia/rpc-process @migaia/rpc-core @migaia/rpc-contract
pnpm add @migaia/plugin-host @migaia/supervision @migaia/utils
```

Save each complete example as its own real Node 24 TypeScript entry file. Self-spawn reruns that file, so keep the isProcessChild branch. Named endpoints here use Node/POSIX same-user permissions; explicit addresses and Windows require tokens. Host and governance examples import the second installation line directly. These examples do not verify Bun, Deno, Electron, Windows Jobs, foreign-language peers, or sandbox tools.

## Run a function in a real child and close its owner

CPU work must run outside the main process, but a function call alone does not show where it executes.

Handwritten spawning also needs framing, authentication and cleanup; rerunning one entry without a role check can recursively spawn more children.

Branch with isProcessChild(), provide methods in the child, and use spawn: true in the parent; close the returned Peer in finally.

```ts doc-test=run
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number; pid(): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: { double: (value: number) => value * 2, pid: () => process.pid }
  })
} else {
  const child = await createProcessPeer<IServiceApi>({ spawn: true })
  try {
    console.log(await child.request('double', 21))
    console.log((await child.request('pid')) !== process.pid)
  } finally {
    await child.close()
  }
}
```

Output:

```text
42
true
```

Output is `42` then `true`: the method doubles 21, and its native process id differs from the parent.

The parent owns this child and closes it explicitly; this Node entry must be a real file, not eval or a test runner, and Node does not guarantee terminating every descendant.

### Example parameters

spawn:true reruns this real file, after isProcessChild selects the role. The child omits a source only because the launcher supplied bootstrap. provide.double accepts a number and doubles it; pid returns native process.pid. TRemote supplies static typing only. defaultTimeoutMs is 30000 ms, request payload is 21, and finally closes the owning Peer. A different PID proves neither a permission sandbox nor complete descendant termination.

## Use reverse calls and streaming on the same child connection

A child may need a parent-owned service while producing a sequence of results for its caller.

Independent one-way pipes require separate routing and correlation, and treating a sequence as one response forces the producer to collect it first.

Provide a parent method, let the child request it through its Peer, and expose an async generator consumed with stream().

```ts doc-test=run
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IParentApi = { prefix(value: string): string }
type IChildApi = {
  label(value: string): Promise<string>
  count(limit: number): AsyncGenerator<number>
}
if (isProcessChild()) {
  const parent = createProcessPeer<IParentApi>({
    provide: {
      label: async (value: string): Promise<string> => (await parent).request('prefix', value),
      count: async function* (limit: number) {
        for (let value = 1; value <= limit; value++) yield value
      }
    }
  })
  await parent
} else {
  const child = await createProcessPeer<IChildApi>({
    spawn: true,
    provide: { prefix: (value: string) => 'main:' + value }
  })
  try {
    console.log(await child.request('label', 'job'))
    const values: number[] = []
    for await (const value of child.stream('count', 3)) values.push(value)
    console.log(values.join(','))
  } finally {
    await child.close()
  }
}
```

Output:

```text
main:job
1,2,3
```

Output is `main:job` then `1,2,3`, proving the child awaited a reverse request and the parent consumed its three stream items.

Both directions use the same authenticated connection; stream transmission starts on iteration, while notify completion would only mean sending completed.

### Example parameters

Both parties provide methods: parent prefix handles a string; child label awaits its actual Peer before making a reverse request; count yields 1..limit. spawn:true and default deadlines match the prior case. stream('count',3) begins on iteration, and values retains business results. The child closure retains the real factory Promise rather than a fabricated ready Peer. The parent still owns the spawned process.

## Close one client while leaving a named local service available

A CLI connection ends, but the local service must remain available to the next caller.

If the client treats a connection as ownership of the server process or listener, its cleanup can remove a service still used by others.

Use a unique named listener and connect separate clients; close each borrowed connection before closing the server owner.

```ts doc-test=run
import { randomUUID } from 'node:crypto'
import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number }
const name = 'reader-' + randomUUID()
const server = await createProcessPeer({
  listen: name,
  provide: { double: (value: number) => value * 2 }
})
try {
  const first = await createProcessPeer<IServiceApi>({ connect: name })
  try {
    console.log(await first.request('double', 20))
  } finally {
    await first.close()
  }
  const second = await createProcessPeer<IServiceApi>({ connect: name })
  try {
    console.log(await second.request('double', 21))
  } finally {
    await second.close()
  }
} finally {
  await server.close()
}
```

Output:

```text
40
42
```

Output is `40` then `42`; the second client connects and calls successfully after the first closes.

This Node/POSIX example uses same-user endpoint permissions, not authentication between applications of that user; Windows and explicit addresses require a token.

### Example parameters

A random UUID name avoids collisions with other runs. One OS user derives the named endpoint; Node/POSIX uses 0700 directory/0600 socket permissions without distinguishing applications of that user. listen.provide exposes double. Each connect closes separately, then the server closes. connectTimeoutMs defaults to 5000 and retries only named-local ENOENT/ECONNREFUSED; explicit addresses and Windows require a token.

## Let a Host own a spawned service and its release

An application installs several services and needs one owner to close their process connections during shutdown.

Keeping each child in a separate local variable makes it easy to omit one from cleanup or mix service lookup with native process ownership.

Create a named process plugin, install it with host.use(), call through host.process, and dispose the Host in finally.

```ts doc-test=run
import { defineHost } from '@migaia/plugin-host'
import { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number }
if (isProcessChild()) {
  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
    name: 'service',
    spawn: true
  })
  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(service)
    console.log(await host.process!.request('service', 'double', 21))
    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))
  } finally {
    const result = await host.dispose()
    console.log(result.cleanupComplete)
  }
}
```

Output:

```text
42
spawn
true
```

Output is `42`, `spawn`, then `true`: the call succeeds, the outlet identifies a spawned connection, and Host cleanup completes.

The Host owns this installed child; both execution budgets are explicitly false, meaning unlimited, rather than defaults, and no arbitrary application side effects are rolled back.

### Example parameters

service.name='service' names the Host connection. spawn:true uses real self-spawn, and omitted expose publishes no Host methods to the child. defineHost explicitly sets host.execution.mutationTimeoutMs/pipelineDrainTimeoutMs to false, meaning unlimited rather than defaults. host.use installs it; host.process.request selects service first, list exposes kind=spawn, and disposal returns structured cleanupComplete without rolling back arbitrary external side effects.

## Keep retry scopes stable across reconnections and separate principals

A reconnect changes connection labels, but retries for the same authenticated principal should still address one retained result scope.

Scoping only by connection loses that continuity, while sharing one unqualified scope can mix results belonging to different principals.

Derive sessionOptions from explicit identities and compare their store and scope; these inputs demonstrate configuration, not authentication.

```ts doc-test=run
import { createProcessResilience } from '@migaia/rpc-process'
import { systemScheduler } from '@migaia/utils/scheduler'

const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })
try {
  const first = resilience.sessionOptions({
    connectionId: 'connection-1',
    sessionId: 'session-1',
    principalId: 'account-A'
  })
  const reconnect = resilience.sessionOptions({
    connectionId: 'connection-2',
    sessionId: 'session-2',
    principalId: 'account-A'
  })
  const other = resilience.sessionOptions({
    connectionId: 'connection-3',
    sessionId: 'session-3',
    principalId: 'account-B'
  })
  const admission = { token: 'operation', senderId: 'caller' }
  console.log(first.idempotency.store === reconnect.idempotency.store)
  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))
  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))
  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)
} finally {
  await resilience.close()
}
```

Output:

```text
true
true
true
32 32
```

Output is `true`, `true`, `true`, then `32 32`: one owner shares a store, the same principal keeps its scope, and a different principal gets another scope.

The default concurrent limits are 32 globally and per peer for this session; the application must obtain principalId from successful authentication before applying these options.

### Example parameters

Resilience requires systemScheduler/report. Each identity supplies connectionId/sessionId/principalId. Changed connection labels retain account-A's scope while account-B differs. admission token:'operation'/senderId:'caller' is example idempotency-call context, not an authentication credential. Default maxConcurrentCallsPerConnection=32 yields both maxGlobal/maxPerPeer=32. Apply principalId only after real authentication.

## Reject new work after a real child reaches terminal state

A supervised child exits and the selected policy will not restart it, yet an application may still try to dispatch another request.

A cached ready flag can outlive the actual process; replacing the supervisor with a diagnostic object also loses the real lifecycle boundary.

Attach a real Node process supervisor, subscribe to its terminal notification through resilience, and run the returned guard before dispatch.

```ts doc-test=run
import { createProcessResilience } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'

const reports: unknown[] = []
const report = (error: unknown) => {
  reports.push(error)
}
const supervisor = createProcessSupervisor({
  id: 'worker',
  launcher: createNodeProcessLauncher(),
  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
  scheduler: systemScheduler,
  report,
  isolation: 'best-effort',
  restart: { mode: 'never' },
  spec: {
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }
  }
})
const resilience = createProcessResilience({ scheduler: systemScheduler, report })
let finish: () => void = () => undefined
const terminal = new Promise<void>((resolve) => {
  finish = resolve
})
const off = resilience.onTerminal(() => {
  finish()
})
const registration = resilience.attachRegistration(
  'worker',
  {
    ownership: 'spawn-owned',
    health: 'none',
    supervisor: {
      restart: () => supervisor.restart(),
      inspect: () => supervisor.inspect(),
      dispose: () => supervisor.dispose(),
      onTerminal: (listener) =>
        supervisor.subscribe((event) => {
          if (event.type === 'terminal') listener(event)
        })
    }
  },
  { kind: 'standalone-host', release: () => supervisor.dispose() }
)
try {
  const guard = resilience.callGuard('worker')
  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })
  await supervisor.start()
  await terminal
  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)
  try {
    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error
    console.log(failure.code)
  }
  off()
  const closing = resilience.close()
  console.log(closing === resilience.close())
  await closing
  console.log(resilience.inspect('worker') === undefined)
  console.log(supervisor.inspect().state)
} finally {
  off()
  await resilience.close()
  await supervisor.dispose()
}
```

Output:

```text
terminal none
PROCESS_TERMINAL_CALL
true
true
terminal
```

Output is `terminal none`, `PROCESS_TERMINAL_CALL`, `true`, `true`, then `terminal`: the guard rejects, close is shared, and governance removal leaves the supervisor state intact.

The child really exits with code 1 under restart mode never; the handler marks the terminal report handled, while caller cleanup still disposes the original supervisor.

### Example parameters

The real process supervisor uses a Node launcher, maxUnits:1 budget, systemScheduler/report, and best-effort isolation. restart.mode='never'. spec.command is the current Node and -e is a direct supervisor exit command, not a Peer self-spawn entry. env inherits PATH with set={}, and stdio is ignore/ignore/drain. The binding forwards actual supervisor methods with ownership='spawn-owned', health='none', and standalone-host.release delegates to actual disposal. off is repeatable. A fulfilled terminal handler marks handled; beforeDispatch receives method/mode/current generation. After governance close, finally still disposes the original supervisor.

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

| Bridge code, source=rpc.contract.jsonrpc | Trigger                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| JSONRPC_FRAME_INVALID                          | Invalid header/encoding/JSON or partial closure; terminal connection |
| JSONRPC_EXTENSION_MISSING                      | Hello omits required capabilities or extension methods               |
| JSONRPC_PROFILE_INVALID                        | Unsupported local profile, payload, or capabilities                  |
| JSONRPC_UNSUPPORTED_MODE                       | Stream in the local contract or remote catalog                       |
| JSONRPC_HANDSHAKE_TIMEOUT                      | Handshake deadline; inspect bootstrap/stdin/reply handling           |

Remote wire source/code is diagnostic data, not local cancellation/retry/authentication authority. Business Errors without semantic identity can restore their native type with unknown/UNKNOWN rather than invented Process codes. Non-idempotent retry still requires reconciliation or real provider-side meta.idempotencyKey deduplication.

### Errors and troubleshooting

RPC_PROCESS_ERROR_SOURCE is rpc.transport.process. Native synchronous spawn and Unix listener preparation/bind errors receive semantic identity on the original object, retaining native type, stack, and other OS fields while replacing errno code with the semantic code. Wrappers retain originals through cause. Do not control behavior by matching messages.

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
