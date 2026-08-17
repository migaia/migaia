import { createRuntimeTimer } from './async-control.js';
import { tagWebRpcError, WebRpcErrorCode } from '../errors.js';

/** Measures encoded text in UTF-8 bytes. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Splits text without cutting a Unicode code point or exceeding a byte budget. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
    throw tagWebRpcError(
      new RangeError('maxBytes must be at least 4 bytes'),
      WebRpcErrorCode.invalidConfig
    );
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (part && bytes + characterBytes > maxBytes) {
      parts.push(part);
      part = '';
      bytes = 0;
    }
    part += character;
    bytes += characterBytes;
  }
  if (part) parts.push(part);
  return parts;
}

const chunkTupleKey = (peerKey: string, messageId: string): string =>
  JSON.stringify([peerKey, messageId]);

/** Owns inbound chunk assembly, duplicate protection, limits, and expiry cleanup. */
export class ChunkAssembler {
  readonly #chunks = new Map<
    string,
    {
      peerKey: string;
      total: number;
      parts: Map<number, string>;
      bytes: number;
      timer: { readonly clear: () => void };
    }
  >();

  #chunkSize: number | undefined;
  #maxMessageBytes: number | undefined;
  #maxConcurrentMessages = 128;
  #maxConcurrentMessagesPerPeer = 32;
  #maxBufferedBytes = 16 * 1024 * 1024;
  #maxChunksPerMessage = 4096;
  #maxChunkBytes = 4 * 1024 * 1024;
  #assemblyTimeoutMs = 30_000;
  #observe:
    | ((event: 'chunk.rejected' | 'chunk.expired', messageId?: string, peerKey?: string) => void)
    | undefined;
  #bufferedBytes = 0;
  readonly #peerCounts = new Map<string, number>();

  /** Returns the number of partial messages retained for lifecycle inspection. */
  get size(): number {
    return this.#chunks.size;
  }

  constructor(
    config: {
      readonly chunkSize?: number;
      readonly maxMessageBytes?: number;
      readonly maxConcurrentMessages?: number;
      readonly maxConcurrentMessagesPerPeer?: number;
      readonly maxBufferedBytes?: number;
      readonly maxChunksPerMessage?: number;
      readonly maxChunkBytes?: number;
      readonly assemblyTimeoutMs?: number;
    } = {}
  ) {
    this.configure(config);
  }

  /** Updates limits after middleware capabilities are normalized. */
  configure(
    config: {
      readonly chunkSize?: number;
      readonly maxMessageBytes?: number;
      readonly maxConcurrentMessages?: number;
      readonly maxConcurrentMessagesPerPeer?: number;
      readonly maxBufferedBytes?: number;
      readonly maxChunksPerMessage?: number;
      readonly maxChunkBytes?: number;
      readonly assemblyTimeoutMs?: number;
    } = {}
  ): void {
    this.#chunkSize = config.chunkSize;
    this.#maxMessageBytes = config.maxMessageBytes;
    if (config.maxConcurrentMessages !== undefined)
      this.#maxConcurrentMessages = config.maxConcurrentMessages;
    if (config.maxConcurrentMessagesPerPeer !== undefined)
      this.#maxConcurrentMessagesPerPeer = config.maxConcurrentMessagesPerPeer;
    if (config.maxBufferedBytes !== undefined) this.#maxBufferedBytes = config.maxBufferedBytes;
    if (config.maxChunksPerMessage !== undefined)
      this.#maxChunksPerMessage = config.maxChunksPerMessage;
    if (config.maxChunkBytes !== undefined) this.#maxChunkBytes = config.maxChunkBytes;
    if (config.assemblyTimeoutMs !== undefined) this.#assemblyTimeoutMs = config.assemblyTimeoutMs;
  }

  /** Installs a non-throwing observer for rejected and expired assemblies. */
  observe(
    observer: (
      event: 'chunk.rejected' | 'chunk.expired',
      messageId?: string,
      peerKey?: string
    ) => void
  ): void {
    this.#observe = observer;
  }

  /** Reports whether a peer still owns an incomplete message assembly. */
  hasAssembly(messageId: string, peerKey = 'unknown'): boolean {
    return this.#chunks.has(chunkTupleKey(peerKey, messageId));
  }

  /** Accepts one frame and returns a complete payload only when all parts arrive. */
  accept(
    frame: {
      messageId: string;
      index: number;
      total: number;
      data: string;
    },
    peerKey = 'unknown'
  ): string | undefined {
    if (
      !Number.isSafeInteger(frame.index) ||
      !Number.isSafeInteger(frame.total) ||
      frame.index < 0 ||
      frame.total <= 0 ||
      typeof frame.data !== 'string'
    ) {
      this.#observe?.('chunk.rejected');
      return undefined;
    }
    const key = chunkTupleKey(peerKey, frame.messageId);
    const existing = this.#chunks.get(key);
    const bytes = utf8ByteLength(frame.data);
    if (
      frame.total > this.#maxChunksPerMessage ||
      bytes > this.#maxChunkBytes ||
      (this.#chunkSize !== undefined && bytes > this.#chunkSize)
    ) {
      if (existing) this.#remove(key);
      this.#observe?.('chunk.rejected');
      return undefined;
    }
    const current = existing ?? {
      peerKey,
      total: frame.total,
      parts: new Map<number, string>(),
      bytes: 0,
      timer: createRuntimeTimer(() => {
        this.#observe?.('chunk.expired', frame.messageId, peerKey);
        this.#remove(key);
      }, this.#assemblyTimeoutMs)
    };
    if (!existing) {
      const peerCount = this.#peerCounts.get(peerKey) ?? 0;
      if (
        this.#chunks.size >= this.#maxConcurrentMessages ||
        peerCount >= this.#maxConcurrentMessagesPerPeer
      ) {
        current.timer.clear();
        this.#observe?.('chunk.rejected');
        return undefined;
      }
      this.#peerCounts.set(peerKey, peerCount + 1);
    }
    if (
      current.total !== frame.total ||
      frame.index < 0 ||
      frame.index >= frame.total ||
      current.parts.has(frame.index) ||
      current.bytes + bytes > (this.#maxMessageBytes ?? Number.MAX_SAFE_INTEGER) ||
      this.#bufferedBytes + bytes > this.#maxBufferedBytes
    ) {
      if (!existing) {
        current.timer.clear();
        const peerCount = this.#peerCounts.get(peerKey) ?? 1;
        if (peerCount <= 1) this.#peerCounts.delete(peerKey);
        else this.#peerCounts.set(peerKey, peerCount - 1);
      }
      if (existing) this.#remove(key);
      this.#observe?.('chunk.rejected');
      return undefined;
    }
    current.parts.set(frame.index, frame.data);
    current.bytes += bytes;
    this.#bufferedBytes += bytes;
    this.#chunks.set(key, current);
    if (current.parts.size !== current.total) return undefined;
    this.#remove(key);
    return Array.from({ length: current.total }, (_, index) => current.parts.get(index) ?? '').join(
      ''
    );
  }

  #remove(key: string): void {
    const current = this.#chunks.get(key);
    if (!current) return;
    current.timer.clear();
    this.#chunks.delete(key);
    this.#bufferedBytes -= current.bytes;
    const peerCount = this.#peerCounts.get(current.peerKey) ?? 1;
    if (peerCount <= 1) this.#peerCounts.delete(current.peerKey);
    else this.#peerCounts.set(current.peerKey, peerCount - 1);
  }

  /** Clears all partial payloads and their expiry timers. */
  clear(): void {
    for (const key of Array.from(this.#chunks.keys())) this.#remove(key);
  }
}
