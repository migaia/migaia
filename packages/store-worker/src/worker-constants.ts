/** Ownership policy for values crossing the worker boundary. */
export const WorkerOwnership = {
  transfer: 'transfer',
  clone: 'clone'
} as const;

/** Worker serialization diagnostic source kind. */
export const WorkerDiagnosticType = { worker: 'worker' } as const;

/** Byte-transfer policy for worker serializer inputs. */
export const WorkerByteOwnership = {
  copy: 'copy',
  transfer: 'transfer'
} as const;

/** Serialization phases executed inside the worker. */
export const WorkerSerializePhase = {
  encode: 'encode',
  decode: 'decode'
} as const;

/** Stable endpoint identifiers used by the serializer worker RPC pair. */
export const WorkerRpcIdentity = {
  main: 'main',
  worker: 'worker',
  call: 'call'
} as const;

export type IWorkerOwnership = (typeof WorkerOwnership)[keyof typeof WorkerOwnership];
export type IWorkerDiagnosticType =
  (typeof WorkerDiagnosticType)[keyof typeof WorkerDiagnosticType];
export type IWorkerByteOwnership = (typeof WorkerByteOwnership)[keyof typeof WorkerByteOwnership];
export type IWorkerSerializePhase =
  (typeof WorkerSerializePhase)[keyof typeof WorkerSerializePhase];
