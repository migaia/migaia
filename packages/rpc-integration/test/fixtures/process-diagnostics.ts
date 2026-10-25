import { defineTransportPlugin, createAdapterDeployment } from '@migaia/rpc-host/plugin'
import { vi } from 'vitest'
import { readEndpointOwner } from '../../../rpc-host/dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../../rpc-host/dist/core/endpoint-kernel.js'
import { ProviderAdmissionRegistry } from '../../../rpc-host/dist/core/internal/provider-admission.js'
import type { ProviderExecutor } from '../../../rpc-host/dist/core/internal/provider-executor.js'
import type {
  ProviderRegistry,
  IProviderSessionPolicy
} from '../../../rpc-host/dist/core/internal/provider.js'
import type { ResourceScope } from '../../../rpc-host/dist/core/internal/resource-scope.js'
import {
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readAdapterDeployment } from '../../../rpc-host/dist/runtime-adapter/deployment.js'
import { readRpcPluginMetadata } from '../../../rpc-host/dist/plugin/metadata.js'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import type { IRpcTransport } from '../../../rpc-host/dist/core/transport.js'
import type { IProcessCommonOptions } from '../../../rpc-plugin-process/dist/process/types.js'
import { RpcPlatform } from '@migaia/rpc-host/plugin'
import {
  createRuntimeMessageConnection,
  type IRuntimeByteDiagnostics
} from '@migaia/rpc-host/plugin'
import type { IRuntimeMessageIO } from '../../../rpc-host/dist/runtime-adapter/byte/types.js'
import {
  bindRuntimeByteWire,
  bindRuntimeMessageTransport
} from '../../../rpc-host/dist/runtime-adapter/byte/carrier.js'
import { attachIpcConnection as attachGenericIpcConnection } from '../../../rpc-host/dist/runtime-adapter/byte/ipc-connection.js'
import {
  createRuntimeBytePipeline,
  runtimeMessagePipeline
} from '../../../rpc-host/dist/runtime-adapter/byte/pipeline.js'
import { RPC_PROCESS_ERROR_SOURCE as ERROR_SOURCE, RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProcessErrorText } from '../../../rpc-plugin-process/dist/process/error-text.js'
import { attachIpcStderr } from '../../../rpc-plugin-process/dist/process/stderr.js'

/** Historical redaction fixture checks that native stderr payloads stay out of reported records. */
export const CHILD_STDERR_REDACTED = '[child stderr redacted]'

/** Canonical Process diagnostics configure the same relocated generic carrier under observation. */
export const processByteDiagnostics: IRuntimeByteDiagnostics = {
  closed: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed,
    message: RpcProcessErrorText.channelClosed
  },
  timeout: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.handshakeTimeout,
    message: RpcProcessErrorText.handshakeTimeout
  },
  authenticationRejected: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.authRejected,
    message: RpcProcessErrorText.authRejected
  },
  duplicateBinding: RpcProcessErrorText.duplicateBinding,
  optionsInvalid: RpcProcessErrorText.optionsInvalid,
  jsonCodecRequired: RpcProcessErrorText.jsonCodecRequired,
  negotiatedCodecUnsupported: RpcProcessErrorText.negotiatedCodecUnsupported,
  handshakeTimeoutInvalid: RpcProcessErrorText.handshakeTimeoutInvalid
}

/** The canonical Core factory retains the original Process codec identity and diagnostic text. */
export const byteProcessPipeline = createRuntimeBytePipeline(RpcProcessErrorText.expectedString)
/** Existing encoder assertions keep their binding while observing the relocated canonical codec. */
export const remoteProcessJsonCodec = byteProcessPipeline.codec
/** Existing static message assertions observe the same canonical identity/message component pair. */
export const messageProcessPipeline = runtimeMessagePipeline

/** Each actual executor is observed once even when multiple native sessions share its kernel. */
const admissionObservations = new WeakMap<ProviderExecutor<string>, ProcessAdmissionObservation>()

/** Capture only registry returns from real execution; observation never prepares or commits policy. */
class ProcessAdmissionObservation {
  /** Policy identity selects the exact registry already chosen by its actual provider execution. */
  readonly #byPolicy = new WeakMap<IProviderSessionPolicy, ProviderAdmissionRegistry>()
  /** The canonical kernel lifetime restores its original executor callback exactly once. */
  readonly close: () => void

  /** Retain the original receiver, call count and return value through a call-through spy. */
  constructor(executor: ProviderExecutor<string>) {
    /** This exact callback is the only code allowed to resolve the held native admission scope. */
    const original = executor.options.sessionAdmission!
    /** One existing execution call is forwarded once, before its returned registry is recorded. */
    const spy = vi.spyOn(executor.options, 'sessionAdmission').mockImplementation((policy) => {
      /** Preserve its real receiver without invoking policy preparation an additional time. */
      const selected = Reflect.apply(original, executor.options, [policy])
      if (selected instanceof ProviderAdmissionRegistry) this.#byPolicy.set(policy, selected)
      return selected
    })
    this.close = () => spy.mockRestore()
  }

  /** Read an already observed execution choice; absent observations remain visibly absent. */
  read(policy: IProviderSessionPolicy): ProviderAdmissionRegistry | undefined {
    return this.#byPolicy.get(policy)
  }
}

/** Observe one genuine shared kernel without constructing an endpoint, scope or provider policy. */
function observeProcessSessionAdmission(peer: IRuntimePeer): void {
  /** The accepted member retains its original canonical endpoint projection ancestry. */
  const endpoint = readRuntimePeerConnection(peer).endpoint
  /** This is the executor that actually dispatches the native session's business frames. */
  const executor = readEndpointOwner<ProviderExecutor<string>>(endpoint, 'provider-executor')!
  if (admissionObservations.has(executor)) return
  /** The original kernel retires this test observation with its real resources. */
  const observation = new ProcessAdmissionObservation(executor)
  admissionObservations.set(executor, observation)
  readEndpointOwner<ResourceScope>(endpoint, EndpointOwnerKey.resourceScope)!.addSync(
    'fixture native admission observation',
    observation.close
  )
}

/** Read only the registry previously returned by actual execution for this current native policy. */
export function readObservedProcessSessionAdmission(
  peer: IRuntimePeer
): ProviderAdmissionRegistry | undefined {
  /** Canonical connection identity selects the real Host session, rather than a fixture selector. */
  const connection = readRuntimePeerConnection(peer)
  /** Policy lookup reads the Host's existing session Map and performs no preparation or commit. */
  const policy = readEndpointOwner<ProviderRegistry>(
    connection.endpoint,
    EndpointOwnerKey.providerRegistry
  )!.sessionPolicy?.(connection.peerId)
  /** Multiple accepted sessions may share the same original executor and admission registry. */
  const executor = readEndpointOwner<ProviderExecutor<string>>(
    connection.endpoint,
    'provider-executor'
  )!
  return policy ? admissionObservations.get(executor)?.read(policy) : undefined
}

/** Construct a genuine Core fixed-profile channel over the fixture's actual held message I/O. */
export function createProcessFixtureChannel(
  io: IRuntimeMessageIO,
  options: Readonly<{ peerId: string; scheduler: IScheduler; capabilities?: readonly string[] }>
) {
  return createRuntimeMessageConnection(
    io,
    {
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString,
      peerId: options.peerId,
      scheduler: options.scheduler,
      offer: options.capabilities ?? [],
      report: () => undefined,
      ipc: { connectionId: options.peerId, sessionId: options.peerId, log: () => undefined }
    },
    processByteDiagnostics
  )
}

/**
 * Observe only actual SDK accept receipts; no endpoint, Peer, directory or service is constructed.
 * The fixture keeps each genuine member for the original provider-admission identity assertions.
 */
export function observeProcessListenerSessions(
  plugin: import('@migaia/rpc-host/plugin').IRpcTransportPlugin,
  sessions: import('../../../rpc-host/dist/remote/runtime-api/peer.js').IRuntimePeer[]
) {
  /** The caller supplies only the current native process definition, already admitted by the SDK. */
  const metadata = readRpcPluginMetadata(plugin)! as Extract<
    NonNullable<ReturnType<typeof readRpcPluginMetadata>>,
    { kind: 'transport' }
  >
  /** This is the original canonical listener recipe, including governor/drain/handshake ownership. */
  const recipe = readAdapterDeployment(metadata.definition.deployment)!
  /** Explicit immutable inputs retain only the genuine recipe and caller-owned receipt observations. */
  const observation = { recipe, sessions }
  return defineTransportPlugin({
    ...metadata.definition,
    deployment: createAdapterDeployment({
      ...recipe,
      listen: (context, accept) =>
        observation.recipe.listen!(context, (channel, preparation) => {
          /** Return this exact native accept Promise; observation never replaces its settlement. */
          const accepted = accept(channel, preparation)
          /**
           * Original listener consumes failure; this reaction records successful native identity
           * only.
           */
          void accepted.then(
            (session) => {
              /** Host retains genuine Peer connection metadata on this exact accepted member. */
              const peer = session.peer as unknown as IRuntimePeer
              observeProcessSessionAdmission(peer)
              observation.sessions.push(peer)
            },
            () => undefined
          )
          return accepted
        })
    })
  })
}

/** Supply only the moved diagnostic/presentation arguments to the same private byte mechanism. */
export function bindProcessByteWire(
  channel: Parameters<typeof bindRuntimeByteWire>[0],
  options: Omit<Parameters<typeof bindRuntimeByteWire>[1], 'platform' | 'expectedStringText'>
) {
  return bindRuntimeByteWire(
    channel,
    {
      ...options,
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString
    },
    processByteDiagnostics
  )
}

/** Supply only the moved diagnostic/presentation arguments to the same whole-message mechanism. */
export function bindProcessMessageTransport(
  channel: Parameters<typeof bindRuntimeMessageTransport>[0],
  options: Omit<
    Parameters<typeof bindRuntimeMessageTransport>[1],
    'platform' | 'expectedStringText'
  >
) {
  return bindRuntimeMessageTransport(
    channel,
    {
      ...options,
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString
    },
    processByteDiagnostics
  )
}

/** Compose the two relocated canonical owners while keeping all existing stderr assertions intact. */
export function attachIpcConnection(
  transport: IRpcTransport,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
) {
  /** Core owns the original gate/log installation; Process owns the original stderr subscription. */
  const attached = attachGenericIpcConnection(transport, ipc, report, scheduler)
  try {
    /** The existing Process subscriber is an actual cleanup resource of the same Core connection. */
    const unsubscribe = attachIpcStderr(attached.log, ipc, report, scheduler)
    attached.ownClose({ close: unsubscribe })
    return attached
  } catch (primary) {
    void attached.close().catch(report)
    throw primary
  }
}
