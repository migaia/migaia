export type IWebRpcSendOptions<Transfer = unknown> = { readonly transfer?: readonly Transfer[] };
export type IWebRpcTransport<Message = unknown, Transfer = unknown> = {
  send(message: Message, options?: IWebRpcSendOptions<Transfer>): void | Promise<void>;
  subscribe(listener: (message: Message) => void): () => void;
  close?(): void | Promise<void>;
  onTransportError?(listener: (error: unknown) => void): () => void;
  onListenerError?(listener: (error: unknown) => void): () => void;
  readonly peerId?: string;
  readonly origin?: string;
};
export type RpcTransport<Message = unknown, Transfer = unknown> = IWebRpcTransport<
  Message,
  Transfer
>;
export type RpcSendOptions<Transfer = unknown> = IWebRpcSendOptions<Transfer>;
