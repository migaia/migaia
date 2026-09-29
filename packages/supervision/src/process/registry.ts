import { systemWallClock, type IWallClock } from '@migaia/utils/scheduler'
import type { IUnitRuntime } from '../index.js'
import type { IProcessHandle, IProcessRegistry } from './types.js'

/** Registers a launched unit before ready and retains its record until exit. */
export async function registerRecord(
  handle: IProcessHandle,
  unit: IUnitRuntime,
  id: string,
  registry: { readonly port: IProcessRegistry; readonly namespace: string } | undefined,
  wallClock: IWallClock = systemWallClock
): Promise<void> {
  if (!registry) return
  const recordId = `${id}/${handle.identity.fingerprint}`
  await registry.port.add({
    id: recordId,
    namespace: registry.namespace,
    identity: handle.identity,
    launchedAt: wallClock.timestamp()
  })
  unit.scope.own({ id: recordId }, { force: () => registry.port.remove(recordId) })
}
