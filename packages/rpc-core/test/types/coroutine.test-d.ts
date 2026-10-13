import type { IAbortSignal } from '@migaia/lifecycle'
import { createCoroutinePlugin, type ICoroutineTaskContext } from '../../dist/remote/index.js'

/** Public signal follows supervision's cooperative signal contract without a cast. */
declare const signal: IAbortSignal
/** Task context accepts the original lifecycle signal exactly. */
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
