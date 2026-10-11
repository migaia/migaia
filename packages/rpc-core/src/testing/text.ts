/** Pair identities distinguish each canonical endpoint without implying native execution ownership. */
export const PeerPairName = { a: 'peer-a', b: 'peer-b' } as const

/** Missing sides fail before any memory transport or canonical endpoint is acquired. */
export const PeerPairErrorText = {
  sidesInvalid: 'Testing pair requires two provide sides'
} as const
