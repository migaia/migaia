import { PeerRegistry } from './peers';
import { ProviderRegistry } from './provider';
import { HookRegistry } from './hooks';
import { ChunkAssembler } from './chunk';
import { WebRpcError, WebRpcErrorCode } from '../errors';

/** Centralized keys used for middleware-to-runtime capability composition. */
export const WebRpcCapabilityKey = {
  connect: 'connect',
  connectCapability: 'connectCapability',
  contract: 'contract',
  contractCapability: 'contractCapability',
  uuid: 'uuid',
  protocol: 'protocol',
  protocolCapability: 'protocolCapability',
  authentication: 'authentication',
  authenticationCapability: 'authenticationCapability',
  timeout: 'timeout',
  timeoutCapability: 'timeoutCapability',
  hooks: 'hooks',
  chunk: 'chunk',
  chunkCapability: 'chunkCapability',
  abort: 'abort',
  abortCapability: 'abortCapability',
  ping: 'ping',
  pingCapability: 'pingCapability'
} as const;
/** Stores middleware capabilities with typed access and no dependency on middleware names. */
export class WebRpcCapabilityRegistry {
  readonly #values = new Map<string, unknown>();
  #frozen = false;

  /** Publishes one capability for later runtime composition. */
  set<T>(key: string, value: T): void {
    if (this.#frozen)
      throw new WebRpcError(WebRpcErrorCode.capabilityConflict, 'Capabilities are frozen');
    if (this.#values.has(key) && this.#values.get(key) !== value)
      throw new WebRpcError(
        WebRpcErrorCode.capabilityConflict,
        `Capability already published: ${key}`
      );
    this.#values.set(key, value);
  }

  /** Freezes publication after factory assembly. */
  freeze(): void {
    const seen = new WeakMap<object, unknown>();
    for (const [key, value] of this.#values)
      this.#values.set(key, freezeCapability(cloneCapability(value, seen)));
    this.#frozen = true;
  }

  /** Reads one capability without exposing the backing registry. */
  get<T>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  /** Clears middleware capabilities during failed construction or disposal. */
  clear(): void {
    this.#values.clear();
    this.#frozen = false;
  }
}

function freezeCapability<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) freezeCapability(descriptor.value);
    }
  } else if (isPlainObject(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) freezeCapability(descriptor.value);
    }
  } else {
    return value;
  }
  return Object.freeze(value);
}

function cloneCapability<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== 'object') return value;
  const object = value as object;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  const existing = seen.get(object);
  if (existing) return existing as T;
  const clone: object = Array.isArray(value) ? [] : Object.create(null);
  seen.set(object, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ('value' in descriptor) {
      descriptor.value = cloneCapability(descriptor.value, seen);
      Object.defineProperty(clone, key, descriptor);
    } else {
      Object.defineProperty(clone, key, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: true,
        value: cloneCapability(Reflect.get(value, key), seen)
      });
    }
  }
  return clone as T;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class WebRpcRuntime<TTargetId extends string> {
  readonly capabilities: WebRpcCapabilityRegistry;
  readonly peers = new PeerRegistry<TTargetId>();
  readonly provider = new ProviderRegistry();
  readonly hooks = new HookRegistry();
  readonly chunks: ChunkAssembler;

  constructor(capabilities = new WebRpcCapabilityRegistry()) {
    this.capabilities = capabilities;
    this.chunks = new ChunkAssembler();
  }
}
