/** Stable fixture methods let tests observe provider behavior through independent requests. */
export const PeerMethod = {
  echo: 'echo',
  received: 'peer.received',
  trace: 'peer.trace',
  error: 'peer.error',
  wait: 'peer.wait',
  aborts: 'peer.aborts'
} as const

/** Fixed fixture diagnostics never retain untrusted input or authentication material. */
export const PeerText = {
  cause: 'peer cause',
  error: 'peer error',
  mismatch: 'peer echo mismatch',
  authRejected: 'peer authentication rejected',
  earlyExit: 'public peer exited before ready',
  ready: 'READY pid=',
  result: 'RESULT ok\n',
  failurePrefix: 'PEER_ERROR ',
  bridgeUnsupported: 'UNSUPPORTED jsonrpc: producer bridge not integrated\n',
  listenerUnsupported: 'UNSUPPORTED listener: auth-fd required\n'
} as const
