import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import {
  coroutinePlugin,
  type ICoroutineTaskContext,
  type ICoroutineConnect,
  type ICoroutineUserTask,
  type ICoroutineSupervisorPolicy,
  type ICoroutineReplaceSpec,
  type ICoroutinePluginOptions
} from '@migaia/rpc-plugin-coroutines'
import type * as Host from '@migaia/rpc-host'
import type * as Sdk from '@migaia/rpc-host/sdk'

/** Public signal is the host AbortSignal that supervision's native controller produces. */
declare const signal: INativeAbortSignal
/** Task context accepts the host signal exactly, so it reaches host APIs without a cast. */
const contextSignal: ICoroutineTaskContext['signal'] = signal
void contextSignal
/** Explicit remote typing must leave the provide option usable. */
type IRemote = { read(payload: string): string }
createRpcHost<IRemote>({
  plugins: [coroutinePlugin({ name: 'typed', spawn: async () => undefined })],
  provide: { svc: { read: (payload: string) => payload } }
})
/** A physical port cannot forge the opaque coroutine connection. */
declare const port: MessagePort
// @ts-expect-error connect must be the opaque task connection, not a MessagePort
coroutinePlugin({ name: 'raw-port', connectToParent: port })
/** A genuine opaque token still cannot accompany a parent task. */
declare const connect: ICoroutineTaskContext['connect']
// @ts-expect-error parent and child modes are mutually exclusive
coroutinePlugin({ name: 'both', spawn: async () => undefined, connectToParent: connect })

/** All transport-owned author types are available from their one public package owner. */
declare const task: ICoroutineUserTask
declare const policy: ICoroutineSupervisorPolicy
const parentOptions: ICoroutinePluginOptions = { spawn: task, supervisor: policy }
const childHandle: ICoroutineConnect = connect
const replacement: ICoroutineReplaceSpec = { task }
void [parentOptions, childHandle, replacement]

/** Host cannot reverse-depend on or re-export transport-owned coroutine declarations. */
// @ts-expect-error coroutine handle belongs only to its transport package
type IHostConnect = Host.ICoroutineConnect
// @ts-expect-error coroutine task belongs only to its transport package
type IHostTask = Host.ICoroutineUserTask
// @ts-expect-error coroutine context belongs only to its transport package
type IHostContext = Host.ICoroutineTaskContext
// @ts-expect-error coroutine policy belongs only to its transport package
type IHostPolicy = Host.ICoroutineSupervisorPolicy
// @ts-expect-error coroutine replacement belongs only to its transport package
type IHostReplace = Host.ICoroutineReplaceSpec
// @ts-expect-error the SDK cannot reverse-export the coroutine handle
type ISdkConnect = Sdk.ICoroutineConnect
// @ts-expect-error the SDK cannot reverse-export the coroutine task
type ISdkTask = Sdk.ICoroutineUserTask
// @ts-expect-error the SDK cannot reverse-export the coroutine context
type ISdkContext = Sdk.ICoroutineTaskContext
// @ts-expect-error the SDK cannot reverse-export the coroutine policy
type ISdkPolicy = Sdk.ICoroutineSupervisorPolicy
// @ts-expect-error the SDK cannot reverse-export the coroutine replacement
type ISdkReplace = Sdk.ICoroutineReplaceSpec

/** Consume only compile-time negative assertions; no retired value or runtime wrapper is emitted. */
declare const absentTypes: [
  IHostConnect,
  IHostTask,
  IHostContext,
  IHostPolicy,
  IHostReplace,
  ISdkConnect,
  ISdkTask,
  ISdkContext,
  ISdkPolicy,
  ISdkReplace
]
void absentTypes
