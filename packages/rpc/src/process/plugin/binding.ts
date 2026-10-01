import { resolveAbortReason } from '../../core/internal/async-control.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget, type IUnitProfile } from '@migaia/supervision'
import {
  createProcessSupervisor,
  DrainedStream,
  type IProcessHandle,
  type IProcessSpec
} from '@migaia/supervision/process'
import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRemoteBinding, IRemoteChannel } from '../../remote/types.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import {
  ProcessConnectionProfile,
  ProcessPluginChannelKind,
  ProcessPluginWire
} from './constants.js'
import type {
  IConnectProcessPluginDeployment,
  IProcessConnectionHandle,
  IProcessPluginEstablish,
  IProcessPluginSession,
  ISpawnProcessPluginDeployment
} from './types.js'

/** Reports secondary diagnostics without replacing the error that triggered cleanup. */
export function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (reporterError) {
    hostRethrowReporter(reporterError, IpcReporterContext)
  }
}

/** Rejects one invalid process option before launcher, dialer, or host work begins. */
export function invalidOption(field: string): never {
  throw createProcessError(RpcProcessErrorCode.pluginInvalidOption, undefined, { field })
}

/** Ensures a bootstrap secret is exactly the token supplied to the authenticated adapter. */
function sameUtf8(value: Uint8Array, token: string): boolean {
  const expected = new TextEncoder().encode(token)
  if (value.length !== expected.length) return false
  for (let index = 0; index < value.length; index += 1)
    if (value[index] !== expected[index]) return false
  return true
}

/** Rejects deployment mismatches without embedding a token or payload in diagnostics. */
export function validateSpawnProcessPluginDeployment<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  specField = 'supervision.spec'
): void {
  if (!deployment || deployment.kind !== 'spawn' || !deployment.supervision)
    invalidOption('deployment.kind')
  if (deployment.channelKind === ProcessPluginChannelKind.messagePort) {
    if (deployment.wire !== undefined) invalidOption('deployment.wire')
    return
  }
  if (deployment.channelKind !== ProcessPluginChannelKind.byte)
    invalidOption('deployment.channelKind')
  if (deployment.wire !== ProcessPluginWire.native && deployment.wire !== ProcessPluginWire.jsonrpc)
    invalidOption('deployment.wire')
  if (typeof deployment.token !== 'string' || deployment.token.length === 0)
    invalidOption('deployment.token')
  const bootstrap = deployment.supervision.spec.bootstrap
  if (!bootstrap || !sameUtf8(bootstrap.payload, deployment.token))
    invalidOption(`${specField}.bootstrap`)
  if (deployment.wire === ProcessPluginWire.jsonrpc && bootstrap.via !== 'fd')
    invalidOption(`${specField}.bootstrap.via`)
  if (
    deployment.wire === ProcessPluginWire.native &&
    bootstrap.via !== 'stdin' &&
    bootstrap.via !== 'fd'
  )
    invalidOption(`${specField}.bootstrap.via`)
}

/** The active generation alone can subscribe to stderr blocks after its channel is ready. */
function createStderrSource(report: (error: unknown) => void) {
  /** A closed channel removes its subscription; pre-handshake blocks are not buffered. */
  let listener: ((chunk: Uint8Array) => void) | undefined
  return {
    emit(chunk: Uint8Array): void {
      try {
        listener?.(chunk)
      } catch (error) {
        reportSafely(report, error)
      }
    },
    subscribe(next: (chunk: Uint8Array) => void): () => void {
      if (listener) invalidOption('ipc.stderr')
      listener = next
      return () => {
        if (listener === next) listener = undefined
      }
    }
  }
}

/** A channel adapter receives one immutable session and the binding's scheduler identity. */
async function establishGeneration(
  raw: IProcessByteChannel | IProcessMessageChannel,
  establish: IProcessPluginEstablish,
  signal: IAbortSignal,
  scheduler: IScheduler,
  session: IProcessPluginSession,
  token: string | undefined,
  stderr: (listener: (chunk: Uint8Array) => void) => () => void,
  report: (error: unknown) => void,
  closeRaw: () => Promise<void>
): Promise<IRemoteChannel> {
  if (signal.aborted) {
    try {
      await closeRaw()
    } catch (error) {
      reportSafely(report, error)
    }
    throw resolveAbortReason(signal)
  }
  let channel: IRemoteChannel
  try {
    channel = await establish(raw, {
      signal,
      role: 'initiator',
      session,
      scheduler,
      ...(token === undefined ? {} : { token }),
      stderr
    })
  } catch (error) {
    try {
      await closeRaw()
    } catch (cleanupError) {
      reportSafely(report, cleanupError)
    }
    throw error
  }
  if (
    channel.scheduler !== scheduler ||
    channel.agreement.source !==
      (raw.kind === ProcessPluginChannelKind.byte ? 'negotiated' : 'static')
  ) {
    try {
      await channel.close()
    } catch (error) {
      reportSafely(report, error)
    }
    invalidOption('deployment.establish')
  }
  return channel
}

/** Maps an owned process supervisor into the one remote binding contract. */
export function createSpawnProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void
): IRemoteBinding<THandle, IProcessSpec> {
  validateSpawnProcessPluginDeployment(deployment)
  const scheduler = deployment.supervision.scheduler ?? systemScheduler
  const stderr = createStderrSource(report)
  const callerOutput = deployment.supervision.output?.onChunk
  const supervisor = createProcessSupervisor({
    ...deployment.supervision,
    scheduler,
    output: {
      ...deployment.supervision.output,
      onChunk(stream, chunk) {
        try {
          callerOutput?.(stream, chunk)
        } catch (error) {
          reportSafely(report, error)
        }
        if (stream === DrainedStream.stderr) stderr.emit(chunk)
      }
    }
  })
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    async openChannel(unit, signal) {
      const raw = await deployment.rawChannel(unit, signal)
      if (raw.kind !== deployment.channelKind) {
        await raw.close()
        invalidOption('deployment.channelKind')
      }
      const session: IProcessPluginSession = Object.freeze({
        connectionId: defaultRpcId(),
        sessionId: defaultRpcId(),
        processId: unit.identity.fingerprint
      })
      return establishGeneration(
        raw,
        deployment.establish,
        signal,
        scheduler,
        session,
        deployment.token,
        stderr.subscribe,
        report,
        () => Promise.resolve(raw.close())
      )
    }
  }
}

/** Converts an external socket into a local unit whose exit waits for physical close. */
function createConnectionHandle(raw: IProcessByteChannel): IProcessConnectionHandle {
  /** The physical close notification settles the local session budget lease. */
  let settleExit!: (value: Readonly<{ reason: unknown }>) => void
  const exited = new Promise<Readonly<{ reason: unknown }>>((resolve) => {
    settleExit = resolve
  })
  /** A close Promise is shared across supervisor stop, endpoint disposal, and EOF. */
  let closing: Promise<void> | undefined
  /** A closed dialer may notify synchronously during subscription. */
  let unsubscribe: () => void = () => undefined
  unsubscribe = raw.onClose((reason) => {
    unsubscribe()
    settleExit({ reason })
  })
  return {
    identity: Object.freeze({ fingerprint: defaultRpcId() }),
    exited,
    channel: raw,
    close: () =>
      (closing ??= Promise.resolve(raw.close()).then(() => {
        unsubscribe()
        settleExit({ reason: undefined })
      }))
  }
}

/** Maps a borrowed external process to an owned, single-session socket supervisor. */
export function createConnectProcessBinding(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IRemoteBinding<IProcessConnectionHandle, string> {
  if (
    !deployment ||
    deployment.kind !== 'connect' ||
    typeof deployment.address !== 'string' ||
    deployment.address.length === 0
  )
    invalidOption('deployment.address')
  if (typeof deployment.token !== 'string' || deployment.token.length === 0)
    invalidOption('deployment.token')
  const scheduler = deployment.supervision?.scheduler ?? systemScheduler
  const budget = createUnitBudget({ kind: ProcessConnectionProfile.kind, maxUnits: 1, scheduler })
  const profile: IUnitProfile<string, IProcessConnectionHandle, Readonly<{ reason: unknown }>> = {
    kind: ProcessConnectionProfile.kind,
    gracefulTermination: true,
    requirements: () => [],
    validateSpec(address) {
      if (typeof address !== 'string' || address.length === 0) invalidOption('deployment.address')
    },
    terminate(handle) {
      void handle.close().catch((error: unknown) => reportSafely(report, error))
    },
    classifyExit(status) {
      return status.reason === undefined
        ? { reason: 'exited' }
        : { reason: 'crashed', cause: status.reason }
    }
  }
  const supervisor = createSupervisor({
    id: defaultRpcId(),
    spec: deployment.address,
    budget,
    scheduler,
    report,
    ...deployment.supervision,
    profile,
    launcher: {
      capabilities: {},
      async launch(address, context) {
        const raw = await deployment.dial(address, context.signal)
        if (context.signal.aborted) {
          await raw.close()
          throw resolveAbortReason(context.signal)
        }
        return createConnectionHandle(raw)
      }
    }
  })
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    async openChannel(unit, signal) {
      const session: IProcessPluginSession = Object.freeze({
        connectionId: defaultRpcId(),
        sessionId: unit.identity.fingerprint
      })
      return establishGeneration(
        unit.channel,
        deployment.establish,
        signal,
        scheduler,
        session,
        deployment.token,
        () => () => undefined,
        report,
        unit.close
      )
    }
  }
}

/** One internal entry point keeps processHost on the same spawn and connect ownership paths. */
export function createProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void
): IRemoteBinding<THandle, IProcessSpec>
export function createProcessBinding(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IRemoteBinding<IProcessConnectionHandle, string>
export function createProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IRemoteBinding<THandle, IProcessSpec> | IRemoteBinding<IProcessConnectionHandle, string> {
  return deployment.kind === 'spawn'
    ? createSpawnProcessBinding(deployment, report)
    : createConnectProcessBinding(deployment, report)
}
