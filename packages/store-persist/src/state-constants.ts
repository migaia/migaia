/** Persistence unit lifecycle states. */
export const PersistState = {
  idle: 'idle',
  active: 'active',
  loading: 'loading',
  writing: 'writing',
  ready: 'ready',
  success: 'success',
  error: 'error',
  disposed: 'disposed'
} as const;

/** Persistence codec representations. */
export const PersistCodecOutput = {
  text: 'text',
  structured: 'structured',
  binary: 'binary'
} as const;

export type IPersistState = (typeof PersistState)[keyof typeof PersistState];
export type IPersistCodecOutput = (typeof PersistCodecOutput)[keyof typeof PersistCodecOutput];
