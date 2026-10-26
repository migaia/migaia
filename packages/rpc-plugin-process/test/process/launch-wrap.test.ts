import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import * as processSupervision from '@migaia/supervision/process'
import type {
  IProcessLauncher,
  IProcessLaunchContext,
  IProcessRecord,
  IProcessRegistry,
  IProcessSpec,
  IProcessSupervisorOptions
} from '@migaia/supervision/process'
import { processPlugin, type IProcessNamespaceExtensions } from '@migaia/rpc-plugin-process'
import type { IRpcNamespace } from '@migaia/rpc-host'
import { type IProcessLaunchCommand, type IProcessShortSpawn } from '@migaia/rpc-plugin-process'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines, type IRpcMemberEvent } from '@migaia/rpc-host/sdk'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../dist/process/adapters/node-child-process.js'

/** An absolute TypeScript entry works with Node's native type stripping and no fixture loader. */
const entry = fileURLToPath(new URL('./fixtures/launch-wrap-child.ts', import.meta.url))
/** The external macOS tool is optional; the skip reason is part of the sandbox case evidence. */
const sandboxAvailable = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')
/** The public Host install wrapper stays visible instead of asserting only a nested code. */
const hostFailure = { source: 'plugin.host', code: 'PLUGIN_INSTALL_FAILED' }

/** Error inspection keeps native values and cause identity intact while checking owner layers. */
type IObservedError = Error & {
  source?: string
  code?: string
  detail?: { field?: string; reason?: string }
}

/** Follow actual cause links without relying on a fixed count of managed owner wrappers. */
function causes(error: unknown): IObservedError[] {
  /** A repeated object ends the walk rather than hiding a cause cycle. */
  const seen = new Set<unknown>()
  /** Original instances remain available for strict identity assertions. */
  const result: IObservedError[] = []
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    result.push(error as IObservedError)
    error = (error as Error).cause
  }
  return result
}

/** Require one semantic owner layer without assuming its distance from the Host boundary. */
function layer(error: unknown, source: string, code: string): IObservedError {
  /** The exact matching instance is needed to inspect its original cause. */
  const found = causes(error).find((item) => item.source === source && item.code === code)
  expect(found, `${source}:${code}`).toBeDefined()
  return found!
}

/** Diagnostics record every native and package layer with redacted fixture message text. */
function diagnostic(error: unknown) {
  return causes(error).map((item) => ({
    name: item.name,
    source: item.source,
    code: item.code,
    reason: item.detail?.reason,
    field: item.detail?.field,
    message: item.message?.replaceAll(entry, '<fixture>')
  }))
}

/** Wrap the runtime-selected command while deliberately planting forbidden result fields. */
function externalEnv(command: IProcessLaunchCommand): IProcessLaunchCommand {
  /** Extra own data attempts to override protected fields while retaining the public command shape. */
  const result = {
    ...command,
    command: '/usr/bin/env',
    args: ['TRAY_WRAPPED=1', command.command, ...command.args],
    stdio: 'ignore',
    bootstrap: undefined,
    limits: null,
    permissions: ['planted']
  }
  return result
}

/** Create the existing public Host without imposing mutation deadlines on real child startup. */
function createHost() {
  /** Lazy pipeline authority reads this case's own native host only at installation. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['process']
  )
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The same native object drops unused contravariant pipeline methods from this static view. */
  const native: Pick<typeof host, 'use' | 'dispose'> = host
  /** Keep this exact native Host's generics and its installed public process namespace. */
  type ILaunchWrapHost = typeof native &
    Readonly<{ process: IRpcNamespace & IProcessNamespaceExtensions }>
  return native as ILaunchWrapHost
}

/** Every scenario uses the same short source and leaves supervision's restart policy explicit. */
function plugin(spawn: IProcessShortSpawn, report: (error: unknown) => void = () => undefined) {
  return processPlugin({
    name: 'service',
    spawn: { entry, supervision: { restart: { mode: 'never' } }, ...spawn },
    report
  })
}

/** Capture only rejected installation; successful installation is an assertion failure. */
async function installFailure(spawn: IProcessShortSpawn, report?: (error: unknown) => void) {
  /** The Host retains resource rollback even when source preparation or native launch fails. */
  const host = createHost()
  try {
    /** An explicit outcome avoids swallowing either unexpected success or fixture assertions. */
    const outcome = await host.use(plugin(spawn, report)).then(
      () => ({ installed: true as const }),
      (error: unknown) => ({ installed: false as const, error })
    )
    expect(outcome.installed).toBe(false)
    if (outcome.installed) return undefined
    expect(outcome.error).toMatchObject(hostFailure)
    return outcome.error
  } finally {
    await host.dispose()
  }
}

/** A class launcher deliberately keeps every operation non-enumerable on its prototype. */
class RecordingLauncher implements IProcessLauncher<INodeProcessHandle> {
  /** This native owner retains actual process bootstrap, channel and cleanup semantics. */
  readonly #native = createNodeProcessLauncher()
  /** Native capability identity must pass through the wrapper unchanged. */
  readonly capabilities = this.#native.capabilities
  /** The observed receiver distinguishes delegation from an unbound method copy. */
  readonly receivers: RecordingLauncher[] = []
  /** Original launch fields let the test compare the protected values after callback projection. */
  readonly specifications: IProcessSpec[] = []

  /** Launch through the original Node owner, recording this exact class instance. */
  async launch(spec: IProcessSpec, context: IProcessLaunchContext): Promise<INodeProcessHandle> {
    this.receivers.push(this)
    this.specifications.push(spec)
    return this.#native.launch(spec, context)
  }

  /** The synthetic registry record is safe to reclaim; no unrelated native PID is inspected. */
  async probe(_record: IProcessRecord) {
    this.receivers.push(this)
    return processSupervision.OrphanProbeResult.alive
  }

  /** Record receiver only; the synthetic recovery record owns no real child. */
  async terminateRecord(_record: IProcessRecord): Promise<void> {
    this.receivers.push(this)
  }
}

describe('launch-wrap revision 5', () => {
  it('wraps start, restart and replacement without replacing channel or bootstrap', async () => {
    /** The Host owns all three real child generations. */
    const host = createHost()
    /** A per-launch count distinguishes runtime wrapping from assembly-only wrapping. */
    let calls = 0
    /** Extra callback-result accessors must remain unread when protected fields are projected. */
    let extraReads = 0
    try {
      await host.use(
        plugin({
          wrap: (command) => {
            expect(Object.keys(command)).toEqual(['command', 'args', 'cwd', 'env'])
            calls += 1
            return Object.defineProperty(externalEnv(command), 'stdio', {
              enumerable: true,
              get: () => {
                extraReads += 1
                return 'ignore'
              }
            })
          }
        })
      )
      expect(await host.process!.send('service', 'wrapped')).toBe('1')
      expect(await host.process!.members.restart('service')).toMatchObject({ state: 'ready' })
      expect(await host.process!.send('service', 'wrapped')).toBe('1')
      expect(await host.process!.members.replace('service')).toMatchObject({ kind: 'replaced' })
      expect(await host.process!.send('service', 'wrapped')).toBe('1')
      expect(calls).toBe(3)
      expect(extraReads).toBe(0)
    } finally {
      await host.dispose()
    }
  })

  it('leaves the wrapper variable absent without wrap', async () => {
    /** Child environment inherits PATH only, independently of the test runner's ambient env. */
    const host = createHost()
    try {
      await host.use(plugin({}))
      expect(await host.process!.send('service', 'wrapped')).toBeNull()
    } finally {
      await host.dispose()
    }
  })

  it('preserves class launcher receivers, capabilities and prototype recovery operations', async () => {
    /** Public supervision factory is the existing seam exposing the launcher's prepared operations. */
    const original = processSupervision.createProcessSupervisor
    /** Only the already-public supervisor call is observed; no production test seam is added. */
    let captured: IProcessLauncher<INodeProcessHandle> | undefined
    /** Delegate the factory unchanged while retaining its actual selected launcher. */
    const observe = vi
      .spyOn(processSupervision, 'createProcessSupervisor')
      .mockImplementation((options) => {
        captured = options.launcher as IProcessLauncher<INodeProcessHandle>
        return original(options)
      })
    /** Non-enumerable methods read ECMAScript private state, so a lost receiver fails concretely. */
    const launcher = new RecordingLauncher()
    /** No synthetic registry operation addresses an actual native process. */
    const record: IProcessRecord = {
      id: 'fixture',
      namespace: 'fixture',
      identity: { fingerprint: 'fixture' },
      launchedAt: 0
    }
    /** Existing orphan recovery invokes the prepared launcher's optional operations. */
    const registry: IProcessRegistry = {
      add: async () => undefined,
      remove: async () => undefined,
      list: async () => [record]
    }
    /** Host installation drives the same source preparation as ordinary production callers. */
    const host = createHost()
    try {
      await host.use(
        plugin({
          wrap: externalEnv,
          supervision: {
            launcher,
            restart: { mode: 'never' },
            registry: { port: registry, namespace: 'fixture' }
          }
        })
      )
      expect(await host.process!.send('service', 'wrapped')).toBe('1')
      expect(captured!.capabilities).toBe(launcher.capabilities)
      expect(Object.hasOwn(captured!, 'probe')).toBe(true)
      expect(Object.hasOwn(captured!, 'terminateRecord')).toBe(true)
      expect(
        await processSupervision.reclaimOrphanProcesses({
          registry,
          namespace: 'fixture',
          launcher: captured!,
          report: () => undefined
        })
      ).toMatchObject({ terminated: ['fixture'], removed: ['fixture'], failures: [] })
      expect(launcher.receivers).toEqual([launcher, launcher, launcher])
      expect(launcher.specifications[0]).toMatchObject({
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: expect.any(Uint8Array) }
      })
      expect(launcher.specifications[0].limits).toBeUndefined()
      expect(launcher.specifications[0].permissions).toBeUndefined()
    } finally {
      await host.dispose()
      observe.mockRestore()
    }
  })

  it('does not fabricate optional launcher operations', async () => {
    /** Capture the prepared public supervisor input without changing construction semantics. */
    const original = processSupervision.createProcessSupervisor
    /** A default Node launcher has neither recovery operation. */
    let captured: IProcessSupervisorOptions<INodeProcessHandle>['launcher'] | undefined
    /** The public factory supplies the existing observation seam for absent optional fields. */
    const observe = vi
      .spyOn(processSupervision, 'createProcessSupervisor')
      .mockImplementation((options) => {
        captured = options.launcher as IProcessLauncher<INodeProcessHandle>
        return original(options)
      })
    /** Host cleanup owns this real child. */
    const host = createHost()
    try {
      await host.use(plugin({ wrap: externalEnv }))
      expect(Object.hasOwn(captured!, 'probe')).toBe(false)
      expect(Object.hasOwn(captured!, 'terminateRecord')).toBe(false)
    } finally {
      await host.dispose()
      observe.mockRestore()
    }
  })

  it('rejects non-function wrap before launching', async () => {
    /** Launch counting proves preparation rejects before creating a native process. */
    const launcher = new RecordingLauncher()
    /** Invalid user input is deliberately outside the static option type. */
    const error = await installFailure({
      wrap: 1 as unknown as IProcessShortSpawn['wrap'],
      supervision: { launcher }
    })
    /** Preparation errors sit directly beneath the Host install boundary. */
    const invalid = (error as Error).cause as IObservedError
    expect(invalid).toBeInstanceOf(TypeError)
    expect(invalid).toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_PLUGIN_INVALID_OPTION',
      detail: { field: 'wrap' },
      stack: expect.stringMatching(/\S/)
    })
    expect(invalid.cause).toBeUndefined()
    expect(launcher.receivers).toEqual([])
  })

  it.each(['command', 'args', 'env'] as const)(
    'rejects inherited required command field %s',
    async (field) => {
      /** A required field on the prototype must not become native launch authority. */
      const error = await installFailure({
        wrap: (command) => {
          /** Remaining own properties retain valid values for every unrelated field. */
          const { [field]: inherited, ...own } = command
          return Object.create({ [field]: inherited }, Object.getOwnPropertyDescriptors(own))
        }
      })
      /** Own-data validation fails at the named field without executing a launch. */
      const invalid = layer(error, 'supervision', 'LAUNCH_FAILED').cause as IObservedError
      expect(invalid).toBeInstanceOf(TypeError)
      expect(invalid).toMatchObject({
        source: 'rpc.transport.process',
        code: 'PROCESS_PLUGIN_INVALID_OPTION',
        detail: { field: `wrap.${field}` }
      })
      expect(invalid.cause).toBeUndefined()
    }
  )

  it.each(['command', 'args', 'cwd', 'env'] as const)(
    'rejects command field %s accessors without executing the getter',
    async (field) => {
      /** A property getter must never run while native launch authority is projected. */
      let reads = 0
      /** The getter returns a valid value, so rejection proves descriptor-based validation. */
      const error = await installFailure({
        wrap: (command) =>
          Object.defineProperty({ ...command }, field, {
            enumerable: true,
            get: () => {
              reads += 1
              return command[field]
            }
          })
      })
      /** Returning an accessor is invalid output and has no invented thrown cause. */
      const invalid = layer(error, 'supervision', 'LAUNCH_FAILED').cause as IObservedError
      expect(invalid).toBeInstanceOf(TypeError)
      expect(invalid).toMatchObject({
        source: 'rpc.transport.process',
        code: 'PROCESS_PLUGIN_INVALID_OPTION',
        detail: { field: `wrap.${field}` }
      })
      expect(invalid.cause).toBeUndefined()
      expect(reads).toBe(0)
    }
  )

  it.each([
    ['command', (command: IProcessLaunchCommand) => ({ ...command, command: '' })],
    ['args', (command: IProcessLaunchCommand) => ({ ...command, args: [1] })],
    ['cwd', (command: IProcessLaunchCommand) => ({ ...command, cwd: 1 })],
    [
      'env',
      (command: IProcessLaunchCommand) => ({
        ...command,
        env: { inherit: ['PATH'], set: { BAD: 1 } }
      })
    ]
  ] as const)(
    'reports invalid wrap.%s under Host and launch failure layers',
    async (field, wrap) => {
      /** Invalid callback results intentionally bypass the static return type. */
      const error = await installFailure({ wrap: wrap as unknown as IProcessShortSpawn['wrap'] })
      layer(error, 'rpc.remote', 'REMOTE_START_FAILED')
      /** Launcher failure retains the validation instance as its direct native cause. */
      const failed = layer(error, 'supervision', 'LAUNCH_FAILED')
      /** The invalid result was returned, so its TypeError has no invented cause. */
      const invalid = failed.cause as IObservedError
      expect(invalid).toBeInstanceOf(TypeError)
      expect(invalid).toMatchObject({
        source: 'rpc.transport.process',
        code: 'PROCESS_PLUGIN_INVALID_OPTION',
        detail: { field: `wrap.${field}` },
        stack: expect.stringMatching(/\S/)
      })
      expect(invalid.cause).toBeUndefined()
    }
  )

  it('retains thrown identity and reports SUPERVISION_EXHAUSTED when restart is never', async () => {
    /** The plain thrown object must remain the identical reachable native cause. */
    const original = { fixture: 'wrap-thrown' }
    /** The ordinary supervision reporter observes terminal restart-policy exhaustion. */
    const reports: unknown[] = []
    /** First-launch failure remains below the Host's install wrapper. */
    const error = await installFailure({
      wrap: () => {
        throw original
      },
      supervision: {
        restart: { mode: 'never' },
        report: (report) => {
          reports.push(report)
        }
      }
    })
    layer(error, 'rpc.remote', 'REMOTE_START_FAILED')
    /** Only the native tagged TypeError adds a layer before the identical original thrown object. */
    const invalid = layer(error, 'supervision', 'LAUNCH_FAILED').cause as IObservedError
    expect(invalid).toBeInstanceOf(TypeError)
    expect(invalid).toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_PLUGIN_INVALID_OPTION',
      detail: { field: 'wrap' },
      stack: expect.stringMatching(/\S/)
    })
    expect(invalid.cause).toBe(original)
    /** Exhaustion reports carry the same launch failure chain. */
    const exhausted = reports.find((report) => causes(report)[0]?.code === 'SUPERVISION_EXHAUSTED')
    expect(exhausted).toMatchObject({
      source: 'supervision',
      code: 'SUPERVISION_EXHAUSTED'
    })
    expect(layer(exhausted, 'supervision', 'LAUNCH_FAILED').cause).toBe(invalid)
  })

  it('preserves missing-command ENOENT below channel and launch failure layers', async () => {
    /** An absolute nonexistent command prevents PATH or shell behavior from changing this case. */
    const error = await installFailure({
      wrap: (command) => ({ ...command, command: '/migaia-launch-wrap-command-does-not-exist' })
    })
    /** Native spawn failure has exactly the documented owner sequence beneath managed admission. */
    const failed = layer(error, 'supervision', 'LAUNCH_FAILED')
    expect(failed.cause).toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_CHANNEL_CONNECT_FAILED',
      cause: { code: 'ENOENT' }
    })
  })

  it('classifies a bootstrap-completed exit-3 child as crashed', async () => {
    /** The Host owns the real launched handle until the child exits after its first reply. */
    const host = createHost()
    try {
      await host.use(
        plugin({
          wrap: (command) => ({
            ...externalEnv(command),
            args: ['TRAY_WRAPPED=1', command.command, ...command.args, 'crash-after-reply']
          })
        })
      )
      /** Subscribe after readiness but before the business call triggers the child's crash. */
      const exits: IRpcMemberEvent[] = []
      host.process!.members.on('exit', (event) => {
        exits.push(event)
      })
      expect(await host.process!.send('service', 'wrapped')).toBe('1')
      await vi.waitFor(
        () =>
          expect(exits).toContainEqual(
            expect.objectContaining({
              reason: 'crashed',
              code: 3,
              error: { source: 'supervision', code: 'EXIT_UNEXPECTED' }
            })
          ),
        { timeout: 2000 }
      )
    } finally {
      await host.dispose()
    }
  })

  it('records the immediately exiting wrapper phase without fixing a timing-dependent code', async () => {
    /** BC1 gives this source its own real Host, without a duplicate default namespace. */
    const host = createHost()
    /** All original error layers remain available for the observed phase record. */
    const reports: unknown[] = []
    try {
      /** Capture installation outcome independently from background exit publication. */
      const outcome = await host
        .use(
          processPlugin({
            name: 'immediate',
            spawn: {
              entry,
              wrap: (command) => ({ ...command, command: '/usr/bin/false', args: [] }),
              supervision: { restart: { mode: 'never' } }
            },
            report: (error) => {
              reports.push(error)
            }
          })
        )
        .then(
          () => ({ installed: true as const }),
          (error: unknown) => ({ installed: false as const, error })
        )
      console.info(
        '[immediate wrapper observed]',
        JSON.stringify({
          installed: outcome.installed,
          chain: outcome.installed ? [] : diagnostic(outcome.error),
          namespacePublished: Reflect.get(host, 'process') !== undefined,
          reports: reports.map(diagnostic)
        })
      )
      /** A command that sends no protocol reply cannot complete the real Session handshake. */
      expect(outcome.installed).toBe(false)
      if (outcome.installed) return
      expect(outcome.error).toMatchObject(hostFailure)
      /**
       * BC11 keeps the actual bootstrap phase and native cause without requiring a duplicate
       * wrapper.
       */
      const failed = causes(outcome.error).find(
        (error) => error.source === 'supervision' && error.code === 'LAUNCH_FAILED'
      )
      if (failed) {
        expect(failed.cause).toMatchObject({
          source: 'rpc.transport.process',
          code: 'PROCESS_CHANNEL_CONNECT_FAILED',
          cause: expect.any(Error)
        })
        console.info(
          '[immediate wrapper]',
          JSON.stringify({
            phase: 'LAUNCH_FAILED',
            chain: diagnostic(outcome.error),
            reports: reports.map(diagnostic)
          })
        )
      } else {
        /** A returned handle can lose its channel before Host installation commits. */
        const start = layer(outcome.error, 'rpc.remote', 'REMOTE_START_FAILED')
        expect(start.cause).toMatchObject({
          source: 'rpc.transport.process',
          code: 'PROCESS_CHANNEL_CLOSED'
        })
        console.info(
          '[immediate wrapper]',
          JSON.stringify({
            phase: 'PROCESS_CHANNEL_CLOSED',
            chain: diagnostic(outcome.error),
            reports: reports.map(diagnostic)
          })
        )
      }
      /** BC1 replaces the old shared outlet event surface with uncommitted namespace absence. */
      expect(Reflect.get(host, 'process')).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })

  it('records a failed second launch without emitting a native exit', async () => {
    /** First launch establishes the Host outlet; second launch fails inside the same supervisor. */
    const host = createHost()
    /** Invocation count selects the actual restart rather than initial preparation. */
    let calls = 0
    try {
      await host.use(
        plugin({
          wrap: (command) => {
            calls += 1
            if (calls === 2) throw { fixture: 'restart-wrap-thrown' }
            return externalEnv(command)
          }
        })
      )
      /** Public detail identifies the old handle's supervisor generation before retirement. */
      const started = await host.process!.members.get('service')
      /** Only this already launched generation may contribute a native stopped event. */
      const oldGeneration = 'generation' in started.unit ? started.unit.generation : undefined
      expect(oldGeneration).toBeTypeOf('number')
      /** Ignore retirement of the old handle and observe the restart's failed launch. */
      const exits: IRpcMemberEvent[] = []
      host.process!.members.on('exit', (event) => {
        exits.push(event)
      })
      /** The returned state and original report chain explain a failed restart's observed phase. */
      const outcome = await host.process!.members.restart('service')
      expect(outcome.state).not.toBe('ready')
      expect(calls).toBe(2)
      /** Lookup rejection is recorded separately so it cannot swallow a detail assertion failure. */
      const detail = await host.process!.members.get('service').then(
        (value) => ({ found: true as const, value }),
        (error: unknown) => ({ found: false as const, error })
      )
      if (detail.found) {
        expect(detail.value.lastExit).toMatchObject({
          reason: 'launch-failed',
          error: { source: 'supervision', code: 'LAUNCH_FAILED' }
        })
      } else {
        expect(detail.error).toBeInstanceOf(Error)
      }
      /** Only retirement of the old handle has a native exit; the failed attempt has no handle. */
      expect(
        exits.filter(
          (event) =>
            event.type === 'exit' &&
            (event.reason !== 'stopped' || event.generation !== oldGeneration)
        )
      ).toEqual([])
      console.info(
        '[restart wrapper observed]',
        JSON.stringify({
          outcome,
          calls,
          exits,
          ...(detail.found
            ? { lastExit: detail.value.lastExit }
            : { getRejection: diagnostic(detail.error) })
        })
      )
    } finally {
      await host.dispose()
    }
  })

  it.skipIf(!sandboxAvailable)(
    `external sandbox denies a child write while calls succeed${sandboxAvailable ? '' : ' (skipped: /usr/bin/sandbox-exec unavailable on this platform)'}`,
    async () => {
      /** This test owns its temporary target and deletes only its own fixture directory. */
      const directory = await mkdtemp(join(tmpdir(), 'migaia-launch-wrap-'))
      /** Resolve /var aliases so sandbox's native path matcher names the actual directory. */
      const denied = await realpath(directory)
      /** Sandbox profile stays caller data; rpc-process does not recognize the external tool. */
      const profile = `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(denied)}))`
      /** The Host owns the sandboxed child, with unchanged stdin/stdout bootstrap and channel. */
      const host = createHost()
      try {
        await host.use(
          plugin({
            wrap: (command) => ({
              ...command,
              command: '/usr/bin/sandbox-exec',
              args: ['-p', profile, command.command, ...command.args]
            })
          })
        )
        expect(await host.process!.send('service', 'wrapped')).toBeNull()
        expect(await host.process!.send('service', 'write', join(denied, 'denied.txt'))).toEqual({
          wrote: false,
          code: 'EPERM'
        })
      } finally {
        await host.dispose()
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
})
