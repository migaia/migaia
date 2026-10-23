import type { ILockKey } from '@migaia/storage-contract'

/** Revision facts share the existing logical channel domain and backend-captured key identity. */
export type IBackendRevisionPort = Readonly<{
  read(channel: ILockKey['channel'], encodedKey: string): number
  write(channel: ILockKey['channel'], encodedKey: string): void
  epoch(channel: ILockKey['channel']): number
  clear(channel: ILockKey['channel']): void
}>
/** Each touched channel owns only its current tombstones and clear generation. */
type IRevisionChannel = { readonly entries: Map<string, number>; epoch: number }

/** Create the original memory revision algorithm for one physical backend data universe. */
export function createBackendRevisionPort(): IBackendRevisionPort {
  /** The physical backend alone retains this map; no registration or resource registry is created. */
  const channels = new Map<ILockKey['channel'], IRevisionChannel>()
  /** Allocate only channels that actually change; reads of absent identities remain zero. */
  const writable = (channel: ILockKey['channel']): IRevisionChannel => {
    /** A prior write or clear retains the same channel identity. */
    let state = channels.get(channel)
    if (!state) {
      state = { entries: new Map(), epoch: 0 }
      channels.set(channel, state)
    }
    return state
  }
  return Object.freeze({
    read: (channel: ILockKey['channel'], encodedKey: string): number =>
      channels.get(channel)?.entries.get(encodedKey) ?? 0,
    write: (channel: ILockKey['channel'], encodedKey: string): void => {
      /** Only a successful native mutation advances its captured identity. */
      const state = writable(channel)
      state.entries.set(encodedKey, (state.entries.get(encodedKey) ?? 0) + 1)
    },
    epoch: (channel: ILockKey['channel']): number => channels.get(channel)?.epoch ?? 0,
    clear: (channel: ILockKey['channel']): void => {
      /** Clear drops tombstones while a new epoch invalidates every older channel snapshot. */
      const state = writable(channel)
      state.entries.clear()
      state.epoch++
    }
  })
}
