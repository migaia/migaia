import { processPlugin } from '@migaia/rpc-plugin-process'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'

/** The sole public process factory returns the registered transport definition. */
type ITransportDefinition<T extends IRpcTransportPlugin> = T
export type ICanonicalProcessPlugin = ITransportDefinition<ReturnType<typeof processPlugin>>

// @ts-expect-error Endpoint construction remains owned by the host.
processPlugin({ spawn: true, endpointFactory: () => undefined })

// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createAdapterChannel } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessTransport } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessChannelClosedError } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { openProcessObjectChannel } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessPeer } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createNativeProcessOffer } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessResilience } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessPlugin } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { parseProcessPluginDescriptor } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { ProcessPluginWire } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { receiveAdapterBootstrap } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createAdapterWebByteIO } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createAdapterProcessLaunch } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createAdapterProcessPeer } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createAdapterProcessPlugin } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_HANDSHAKE_MAX_FRAME_BYTES } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_ENV } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_ENV_VERSION } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_BOOTSTRAP_KIND } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_BOOTSTRAP_VERSION } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_FINGERPRINT_PREFIX } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { createProcessJsonRpcChannel } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { IProcessHostRegistrationApproval } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { IProcessHostRegistrations } from '@migaia/rpc-plugin-process'
// @ts-expect-error The public root keeps native assembly and legacy runtime factories private.
import type { IRuntimeProcessPeerOptions } from '@migaia/rpc-plugin-process'

/** Every negative import is consumed so unused bindings cannot hide a missing public-boundary error. */
export type IRetiredProcessExports =
  | typeof createAdapterChannel
  | typeof createProcessTransport
  | typeof createProcessChannelClosedError
  | typeof openProcessObjectChannel
  | typeof createProcessPeer
  | typeof createNativeProcessOffer
  | typeof createProcessResilience
  | typeof createProcessPlugin
  | typeof parseProcessPluginDescriptor
  | typeof ProcessPluginWire
  | typeof receiveAdapterBootstrap
  | typeof createAdapterWebByteIO
  | typeof createAdapterProcessLaunch
  | typeof createAdapterProcessPeer
  | typeof createAdapterProcessPlugin
  | typeof PROCESS_HANDSHAKE_MAX_FRAME_BYTES
  | typeof PROCESS_RUNTIME_API_ENV
  | typeof PROCESS_RUNTIME_API_ENV_VERSION
  | typeof PROCESS_RUNTIME_API_BOOTSTRAP_KIND
  | typeof PROCESS_RUNTIME_API_BOOTSTRAP_VERSION
  | typeof PROCESS_RUNTIME_API_FINGERPRINT_PREFIX
  | typeof PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
  | typeof createProcessJsonRpcChannel
  | IProcessHostRegistrationApproval
  | IProcessHostRegistrations
  | IRuntimeProcessPeerOptions
