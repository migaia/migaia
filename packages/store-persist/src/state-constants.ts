/** Public persistence hydration, write and terminal status vocabulary. */
export const PersistState = {
  idle: 'idle',
  loading: 'loading',
  writing: 'writing',
  ready: 'ready',
  success: 'success',
  error: 'error',
  disposed: 'disposed'
} as const

/** Persistence codec representations. */
export const PersistCodecOutput = {
  text: 'text',
  structured: 'structured',
  binary: 'binary'
} as const

export type IPersistState = (typeof PersistState)[keyof typeof PersistState]
