import type { IReadyOutcome, ReplaceStrategy } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRemoteHostCatalog } from '../../remote/contract.js'
import type { IRemoteHostHandle } from '../../remote/host.js'
import type { IRemoteEndpointFactory, IRemoteRetryPort } from '../../remote/types.js'
import type { IRemoteServeHostOptions } from '../../remote/serve-host.js'
import type {
  IConnectProcessPluginDeployment,
  ISpawnProcessPluginDeployment,
  IProcessServeChildIngress,
  IProcessServeListenerIngress,
  IProcessServeEndpointFactory
} from '../plugin/types.js'
import type {
  IProcessRegistrationListenOptions,
  IProcessResilience,
  IProcessResilienceSnapshot
} from '../resilience/types.js'

/** Platform adapters own signal subscription; the Host root does not import platform APIs. */
export type IProcessHostShutdownSignal = Readonly<{
  subscribe(listener: (signal: 'SIGINT' | 'SIGTERM') => void): () => void
}>

/** Replacement selects a new owned process while retaining the same public facade. */
export type IProcessHostReplaceOptions = Readonly<{
  spec?: IProcessSpec
  strategy?: ReplaceStrategy
}>

/** Remote operations are delegated to the current fully described candidate. */
export type IProcessHost = IRemoteHostHandle &
  Readonly<{
    replace(options?: IProcessHostReplaceOptions): Promise<IProcessHost>
    restart(): Promise<IReadyOutcome<unknown>>
    inspectRegistration(): IProcessResilienceSnapshot | undefined
  }>

/** One facade owns candidates and optionally its default governor, never a borrowed peer PID. */
export type IProcessHostOptions<THandle extends IProcessHandle = IProcessHandle> = Readonly<{
  catalog: IRemoteHostCatalog
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment
  endpointFactory: IRemoteEndpointFactory
  report(error: unknown): void
  scheduler?: IScheduler
  resilience?: IProcessResilience
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
  replaceStrategy?: ReplaceStrategy
  shutdownSignal?: IProcessHostShutdownSignal
}>

/** A verifier principal selects a local approved Host and contract, not a peer claim. */
export type IProcessHostRegistrationApproval = Readonly<{
  targetHost: IRemoteServeHostOptions['host']
  name: string
  contract: IRemoteHostCatalog[string]
}>

/** Reverse registration consumes an already authenticated native channel exactly once. */
export type IProcessHostRegistrations = Omit<
  IProcessRegistrationListenOptions,
  'wire' | 'onCandidate'
> &
  Readonly<{
    resolveRegistration(principalId: string): IProcessHostRegistrationApproval | undefined
  }>

/** The service owns its sessions while the target PluginHost and supplied governor remain borrowed. */
export type IProcessServeHostOptions = Readonly<{
  host: IRemoteServeHostOptions['host']
  catalog: IRemoteHostCatalog
  resolvePlugin: IRemoteServeHostOptions['resolvePlugin']
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress
  endpointFactory: IProcessServeEndpointFactory
  scheduler: IScheduler
  report(error: unknown): void
  resilience?: IProcessResilience
  registrations?: IProcessHostRegistrations
}>

/** Explicit close releases only this service's sessions and adopted registrations. */
export type IProcessServeHostHandle = Readonly<{ close(): Promise<void> }>
