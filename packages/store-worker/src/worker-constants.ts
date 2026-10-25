/** Worker serialization diagnostic source kind. */
export const WorkerDiagnosticType = {
  /** Default parser name and serializer diagnostic type when no format label is supplied. */
  worker: 'worker'
} as const

/** Serialization phases executed inside the worker. */
export const WorkerSerializePhase = {
  encode: 'encode',
  decode: 'decode'
} as const

/** Internal dispatch route for bounded serializer stream frames and acknowledgements. */
export const WorkerSerializeFrameMethod = 'serialize.frame'

/** Serializer stream frame kinds; the request operation remains owned by store-worker. */
export const WorkerSerializeFrameKind = {
  open: 'open',
  chunk: 'chunk',
  end: 'end',
  cancel: 'cancel',
  ack: 'ack'
} as const

/** Stable endpoint identifiers used by the serializer worker RPC pair. */
export const WorkerRpcIdentity = {
  main: 'main',
  worker: 'worker',
  call: 'call',
  /** Internal cancellation envelope route; never exposed as an application method. */
  cancel: '__worker_cancel'
} as const

/** Public fallback diagnostic values declared by WorkerDiagnosticType. */
export type IWorkerDiagnosticType = (typeof WorkerDiagnosticType)[keyof typeof WorkerDiagnosticType]
export type IWorkerSerializePhase = (typeof WorkerSerializePhase)[keyof typeof WorkerSerializePhase]
