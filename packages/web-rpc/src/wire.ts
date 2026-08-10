export type IWebRpcVariation = 'abort' | 'ping' | 'pong';
export type IWebRpcChunkFrame = {
  readonly kind: 'chunk';
  readonly messageId: string;
  readonly index: number;
  readonly total: number;
  readonly data: string;
  readonly senderId: string;
  readonly targetId: string;
};
export type IWebRpcChunkAck = {
  readonly kind: 'chunk-ack';
  readonly messageId: string;
  readonly senderId: string;
  readonly targetId: string;
};
export type IWebRpcRequest = {
  readonly kind: 'request';
  readonly version: string;
  readonly taskId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly method: string;
  readonly data: unknown;
  readonly dispatchOnly?: boolean;
  readonly sentAt: number;
};
export type IWebRpcResponse = {
  readonly kind: 'response';
  readonly version: string;
  readonly taskId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly method: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly message?: string;
  readonly code?: string;
  readonly sentAt: number;
};
export type IWebRpcEnvelope =
  | IWebRpcRequest
  | IWebRpcResponse
  | {
      readonly kind: 'variation';
      readonly variation: IWebRpcVariation;
      readonly taskId?: string;
      readonly senderId: string;
      readonly targetId: string;
    }
  | IWebRpcChunkFrame
  | IWebRpcChunkAck;
export const isWebRpcEnvelope = (value: unknown): value is IWebRpcEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'request')
    return (
      typeof record.version === 'string' &&
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      typeof record.method === 'string' &&
      typeof record.sentAt === 'number' &&
      'data' in record
    );
  if (record.kind === 'response')
    return (
      typeof record.version === 'string' &&
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      typeof record.method === 'string' &&
      typeof record.ok === 'boolean' &&
      typeof record.sentAt === 'number'
    );
  if (record.kind === 'variation')
    return (
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      ['abort', 'ping', 'pong'].includes(record.variation as string)
    );
  if (record.kind === 'chunk')
    return (
      typeof record.messageId === 'string' &&
      typeof record.index === 'number' &&
      typeof record.total === 'number' &&
      typeof record.data === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string'
    );
  if (record.kind === 'chunk-ack')
    return (
      typeof record.messageId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string'
    );
  return false;
};
export const assertMethod = (method: string): string => {
  if (typeof method !== 'string' || method.length === 0)
    throw new TypeError('method must be a non-empty string');
  return method;
};
