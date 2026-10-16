import type { INativeAbortSignal } from '@migaia/utils/promise'
import { createCoroutinePlugin, type ICoroutineTaskContext } from '../../dist/remote/index.js'

/** Public signal is the host AbortSignal that supervision's native controller produces. */
declare const signal: INativeAbortSignal
/** Task context accepts the host signal exactly, so it reaches host APIs without a cast. */
const contextSignal: ICoroutineTaskContext['signal'] = signal
void contextSignal
/** Explicit remote typing must leave the provide option usable. */
type IRemote = { read(payload: string): string }
createCoroutinePlugin<IRemote>({
  name: 'typed',
  task: async () => undefined,
  provide: { svc: { read: (payload: string) => payload } }
})
/** A physical port cannot forge the opaque coroutine connection. */
declare const port: MessagePort
// @ts-expect-error connect must be the opaque task connection, not a MessagePort
createCoroutinePlugin({ name: 'raw-port', connect: port })
/** A genuine opaque token still cannot accompany a parent task. */
declare const connect: ICoroutineTaskContext['connect']
// @ts-expect-error parent and child modes are mutually exclusive
createCoroutinePlugin({ name: 'both', task: async () => undefined, connect })
