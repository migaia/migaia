export type IWebRpcSendOptions<Transfer = unknown> = { readonly transfer?: readonly Transfer[] };
import type { IWebRpcPlatform } from './typing';
export type IWebRpcInboundMessage<T = unknown> = {
  readonly data: T;
  readonly peerId?: string;
  readonly origin?: string;
  readonly source?: unknown;
};
export type IWebRpcTransportTopology = 'exclusive' | 'multiplexed' | 'broadcast';
export type IWebRpcTransport<Message = unknown, Transfer = unknown> = {
  send(message: Message, options?: IWebRpcSendOptions<Transfer>): void | Promise<void>;
  subscribe(listener: (message: IWebRpcInboundMessage<Message>) => void): () => void;
  close?(): void | Promise<void>;
  onTransportError?(listener: (error: unknown) => void): () => void;
  onListenerError?(listener: (error: unknown) => void): () => void;
  readonly peerId?: string;
  readonly origin?: string;
  readonly platform: IWebRpcPlatform;
  /** Describes whether adapter messages share one peer, many peers, or a broadcast group. */
  readonly topology?: IWebRpcTransportTopology;
  readonly encodedType?: 'any' | 'string' | 'uint8array';
  readonly ownership?: 'owned' | 'borrowed';
  /** Adapter-owned source proof for multiplexed transports. */
  readonly sourceProof?: (source: unknown, origin?: string) => boolean;
  /** True only when the adapter can prove that no further messages can be delivered. */
  readonly closed?: boolean;
};
