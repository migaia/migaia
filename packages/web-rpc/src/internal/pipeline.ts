import {
  WebRpcAuthenticationError,
  WebRpcErrorCode,
  WebRpcSerializationError,
  WebRpcTransportError
} from '../errors';
import type {
  IWebRpcAuthenticationCapability,
  IWebRpcAuthenticationContext,
  IWebRpcChunkCapability,
  IWebRpcPlatform,
  IWebRpcProtocolCapability,
  ISendOptions
} from '../typing';
import type { IWebRpcTransport } from '../transport';
import { isUint8Array } from './safe-value';
import { utf8ByteLength } from './chunk';

/** Owns outbound protocol encoding, chunk framing, and transport error classification. */
export class WebRpcOutboundPipeline<TTargetId extends string> {
  readonly transport: IWebRpcTransport;
  readonly id: string;
  readonly protocol: IWebRpcProtocolCapability;
  readonly chunk: IWebRpcChunkCapability;
  readonly authentication: IWebRpcAuthenticationCapability | undefined;
  readonly onVariationFailure: (code: string, error: unknown) => void;
  /** Releases a chunk message id after every frame has settled. */
  readonly #releaseMessageId: (id: string) => void;
  /** Captures the validated transport send callable to prevent descriptor TOCTOU. */
  readonly #transportSend: IWebRpcTransport['send'];
  /** Captures the validated transport payload discriminant for every outbound frame. */
  readonly #transportEncodedType: IWebRpcTransport['encodedType'];

  constructor(
    transport: IWebRpcTransport,
    id: string,
    protocol: IWebRpcProtocolCapability,
    chunk: IWebRpcChunkCapability,
    onVariationFailure: (code: string, error: unknown) => void,
    authentication?: IWebRpcAuthenticationCapability,
    platform: IWebRpcPlatform = transport.platform,
    releaseMessageId: (id: string) => void = () => undefined
  ) {
    this.transport = transport;
    this.id = id;
    this.protocol = protocol;
    this.chunk = chunk;
    this.authentication = authentication;
    this.onVariationFailure = onVariationFailure;
    this.#releaseMessageId = releaseMessageId;
    this.#transportSend = transport.send;
    this.#transportEncodedType = transport.encodedType;
    this.#authenticationContext = Object.freeze({
      direction: 'outbound',
      endpointId: id,
      platform
    });
  }

  /** Stable context passed to every outbound authentication transform. */
  readonly #authenticationContext: IWebRpcAuthenticationContext;

  /** Encodes and sends a contract message, optionally framing it into chunks. */
  send(
    message: unknown,
    createMessageId: (targetId: TTargetId) => string,
    options?: ISendOptions
  ): void | Promise<void> {
    let encoded: unknown;
    try {
      encoded = this.protocol.encode(message);
      this.assertProtocolEncodedType(encoded);
    } catch (cause) {
      throw new WebRpcSerializationError('Protocol encode failed', cause);
    }
    try {
      const chunkSize = this.chunk.chunkSize ?? 0;
      const byteLength = (value: string): number => {
        const canonical = utf8ByteLength(value);
        const measured = this.chunk.byteLength(value);
        if (!Number.isSafeInteger(measured) || measured < canonical || measured < 0)
          throw new WebRpcSerializationError('Custom byteLength returned an unsafe measurement');
        return measured;
      };
      if (this.chunk.maxMessageBytes) {
        const size =
          typeof encoded === 'string'
            ? byteLength(encoded)
            : isUint8Array(encoded)
              ? encoded.byteLength
              : undefined;
        if (size === undefined || size > this.chunk.maxMessageBytes)
          throw new WebRpcSerializationError('Encoded message exceeds configured maximum');
      }
      if (chunkSize > 0 && typeof encoded === 'string' && byteLength(encoded) > chunkSize) {
        if (options?.transfer && options.transfer.length > 0)
          throw new WebRpcSerializationError('Transfer lists are unsupported for chunked messages');
        const targetId = (message as { targetId: TTargetId }).targetId;
        const receiverId = (message as { receiverId?: string }).receiverId;
        const parts = this.chunk.split(encoded, chunkSize);
        if (
          parts.length === 0 ||
          parts.join('') !== encoded ||
          parts.some(
            (part) =>
              typeof part !== 'string' ||
              part.length === 0 ||
              byteLength(part) > chunkSize ||
              byteLength(part) > (this.chunk.maxChunkBytes ?? 4 * 1024 * 1024)
          ) ||
          parts.length > (this.chunk.maxChunksPerMessage ?? 4096) ||
          !Number.isSafeInteger(parts.length)
        )
          throw new WebRpcSerializationError('Chunk splitter returned invalid frames');
        const messageId = createMessageId(targetId);
        return Promise.all(
          parts.map((data, index) =>
            this.#sendTransport(
              this.encodeFrame({
                kind: 'chunk',
                messageId,
                index,
                total: parts.length,
                data,
                senderId: this.id,
                targetId,
                ...(receiverId === undefined ? {} : { receiverId })
              }),
              options?.transfer
            )
          )
        )
          .then(() => undefined)
          .finally(() => this.#releaseMessageId(messageId));
      }
      return this.#sendTransport(encoded, options?.transfer);
    } catch (cause) {
      if (cause instanceof WebRpcSerializationError) throw cause;
      throw new WebRpcTransportError('Transport send failed', cause);
    }
  }

  /** Encodes and sends a variation without chunking it. */
  sendVariation(message: unknown, rejectOnFailure = false): Promise<void> {
    let encoded: unknown;
    try {
      encoded = this.protocol.encode(message);
      this.assertProtocolEncodedType(encoded);
    } catch (error) {
      this.onVariationFailure(WebRpcErrorCode.internal, error);
      return rejectOnFailure ? Promise.reject(error) : Promise.resolve();
    }
    return this.#sendTransport(encoded).catch((error) => {
      const code =
        error instanceof WebRpcAuthenticationError
          ? WebRpcErrorCode.authenticationFailed
          : WebRpcErrorCode.transport;
      this.onVariationFailure(code, error);
      if (rejectOnFailure) throw error;
    });
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(value: unknown): void {
    const encodedType = this.protocol.encodedType;
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new WebRpcSerializationError(`Protocol encoded output must be ${encodedType}`);
  }

  /** Validates protected output against transport payload requirements. */
  private assertTransportEncodedType(value: unknown): void {
    const encodedType = this.#transportEncodedType;
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new WebRpcAuthenticationError(`Protected frame output must be ${encodedType}`);
  }

  /** Encodes and validates one internally generated chunk frame. */
  private encodeFrame(value: unknown): unknown {
    const encoded = this.protocol.encode(value);
    this.assertProtocolEncodedType(encoded);
    return encoded;
  }

  /** Normalizes synchronous and asynchronous transport failures without changing send ordering. */
  #sendTransport(value: unknown, transfer?: readonly unknown[]): Promise<void> {
    if (this.authentication && transfer && transfer.length > 0)
      return Promise.reject(
        new WebRpcAuthenticationError('Transfer lists are unsupported with authentication')
      );
    return Promise.resolve()
      .then(() =>
        this.authentication
          ? this.authentication.protect(value, this.#authenticationContext)
          : value
      )
      .then((protectedValue) => {
        this.assertTransportEncodedType(protectedValue);
        return this.#transportSend(protectedValue, { transfer });
      })
      .then(() => undefined)
      .catch((cause) => {
        if (cause instanceof WebRpcAuthenticationError) throw cause;
        throw new WebRpcTransportError('Transport send failed', cause);
      });
  }
}
