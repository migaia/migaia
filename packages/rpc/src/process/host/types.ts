import type { IRemoteHostCatalog } from '../../remote/index.js'
import type { IRemoteServeHostOptions } from '../../remote/index.js'
import type { IProcessRegistrationListenOptions } from '../resilience/types.js'

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
