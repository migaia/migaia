/** Stable source admission text retains the original diagnosis while the owning domain changes. */
export const CoroutineErrorText = {
  /** Missing/conflicting sources and forged task connections are rejected before acquisition. */
  sourceInvalid: 'Runtime coroutine requires exactly one task or opaque connection'
} as const

/** Native namespace and EventTarget vocabulary are owned once by this actual coroutine carrier. */
export const CoroutineText = {
  namespace: 'coroutine',
  message: 'message',
  close: 'close',
  messageerror: 'messageerror'
} as const
