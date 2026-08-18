import {
  SerializeCodecError,
  assertSerializeType,
  encodeSerializeTextChunk,
  validateSerializeChunk,
  isChunkShape,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeRegistryOptions,
  type ISerializeCleanupError,
  type ISerializeTimeoutDiagnostic,
  type ITextDecoder,
  type ITextEncoder
} from './types.js';
import {
  createAbortController,
  createLifecycleScope,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScope
} from '@migaia/lifecycle';
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.js';
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.js';
import { composeSerializeSignal, snapshotSerializeSignal } from './signal.js';

const NEVER_ABORTED: ISerializeAbortSignal = {
  aborted: false,
  reason: undefined,
  addEventListener() {},
  removeEventListener() {}
};

/** A captured method invocation that retains the original protocol receiver. */
type IInvokable<TResult> = (...args: never[]) => TResult;

/** Invoke an admission-snapshotted method without reading its property again. */
const invokeWithReceiver = <TResult>(
  method: IInvokable<TResult>,
  receiver: object,
  args: readonly unknown[]
): TResult => Reflect.apply(method, receiver, args);

/** The one-time iterable protocol snapshot used by `collectChunks`. */
type IIterableProbe =
  | {
      readonly kind: 'async';
      readonly factory: IInvokable<AsyncIterator<ISerializeChunk>>;
    }
  | {
      readonly kind: 'sync';
      readonly factory: IInvokable<Iterator<ISerializeChunk>>;
    };

/**
 * Probe object-like iterable outputs by direct protocol reads, preserving async precedence and
 * receiver.
 */
const probeIterable = (value: unknown): IIterableProbe | undefined => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return undefined;
  const candidate = value as Record<PropertyKey, unknown>;
  const asyncFactory = candidate[Symbol.asyncIterator];
  if (asyncFactory !== undefined) {
    const factory = asyncFactory;
    if (typeof factory !== 'function')
      throw new TypeError('serialize async iterator must be a function');
    return {
      kind: 'async',
      factory: factory as IInvokable<AsyncIterator<ISerializeChunk>>
    };
  }
  const syncFactory = candidate[Symbol.iterator];
  if (syncFactory !== undefined) {
    const factory = syncFactory;
    if (typeof factory !== 'function') throw new TypeError('serialize iterator must be a function');
    return {
      kind: 'sync',
      factory: factory as IInvokable<Iterator<ISerializeChunk>>
    };
  }
  return undefined;
};

/**
 * Extract a diagnostic reason without allowing hostile error accessors/coercion to replace the
 * primary failure. Normal Error messages and primitive coercions retain their existing text;
 * failures during either read use one deterministic package-owned fallback.
 */
const reasonOf = (error: unknown): string => {
  try {
    if (error instanceof Error) {
      try {
        const message = error.message;
        return typeof message === 'string' ? message : String(message);
      } catch {
        return SerializeErrorText.reasonUnavailable;
      }
    }
    try {
      return String(error);
    } catch {
      return SerializeErrorText.reasonUnavailable;
    }
  } catch {
    return SerializeErrorText.reasonUnavailable;
  }
};

/** 结构化探测宿主 `TextEncoder`（Encoding API），不 import DOM/Node。 */
const hostTextEncoder = (): ITextEncoder | undefined => {
  const Ctor = (globalThis as { TextEncoder?: new () => ITextEncoder }).TextEncoder;
  return Ctor ? new Ctor() : undefined;
};

/** 结构化探测宿主 `TextDecoder`（Encoding API），不 import DOM/Node。 */
const hostTextDecoder = (): ITextDecoder | undefined => {
  const Ctor = (globalThis as { TextDecoder?: new () => ITextDecoder }).TextDecoder;
  return Ctor ? new Ctor() : undefined;
};

/**
 * 手动消费 AsyncIterable，使 `take` 抛错（abort）时能显式调用 `iterator.return()` 并把其错误作为 secondary 路由到
 * `report`（不覆盖 primary）。
 */
async function drainAsyncIterable(
  output: AsyncIterable<ISerializeChunk>,
  factory: IInvokable<AsyncIterator<ISerializeChunk>>,
  take: (chunk: unknown) => void,
  report: (error: unknown) => void
): Promise<void> {
  let iterator: AsyncIterator<ISerializeChunk> | undefined;
  try {
    iterator = invokeWithReceiver(factory, output, []);
    if (iterator === null || typeof iterator !== 'object')
      throw new TypeError('serialize async iterator must return an object');
    const next = iterator.next;
    if (typeof next !== 'function')
      throw new TypeError('serialize async iterator.next must be a function');
    while (true) {
      const result = await invokeWithReceiver(
        next as unknown as IInvokable<Promise<IteratorResult<ISerializeChunk>>>,
        iterator,
        []
      );
      if (result.done) break;
      take(result.value);
    }
  } catch (error) {
    if (iterator !== undefined) {
      try {
        const close = iterator.return;
        if (typeof close === 'function') await invokeWithReceiver(close, iterator, []);
      } catch (closeError) {
        try {
          report(closeError);
        } catch {
          // A diagnostic reporter must not replace the iterator's primary failure.
        }
      }
    }
    throw error;
  }
}

/** Consume a captured synchronous iterator and close it when chunk processing fails. */
function drainSyncIterable(
  output: Iterable<ISerializeChunk>,
  factory: IInvokable<Iterator<ISerializeChunk>>,
  take: (chunk: unknown) => void,
  report: (error: unknown) => void
): void {
  let iterator: Iterator<ISerializeChunk> | undefined;
  try {
    iterator = invokeWithReceiver(factory, output, []);
    if (iterator === null || typeof iterator !== 'object')
      throw new TypeError('serialize iterator must return an object');
    const next = iterator.next;
    if (typeof next !== 'function')
      throw new TypeError('serialize iterator.next must be a function');
    while (true) {
      const result = invokeWithReceiver(
        next as unknown as IInvokable<IteratorResult<ISerializeChunk>>,
        iterator,
        []
      );
      if (result.done) break;
      take(result.value);
    }
  } catch (error) {
    if (iterator !== undefined) {
      try {
        const close = iterator.return;
        if (typeof close === 'function') invokeWithReceiver(close, iterator, []);
      } catch (closeError) {
        try {
          report(closeError);
        } catch {
          // A diagnostic reporter must not replace the iterator's primary failure.
        }
      }
    }
    throw error;
  }
}

/**
 * 把 parser 吐出的分段收敛成一段。
 *
 * 拼装规则：全 text 直接拼字符串；出现 bytes 就地转字节；出现 value 独占一次输出。
 */
async function collectChunks(
  output: ISerializeOutput,
  details: {
    type: string;
    phase: ISerializePhase;
    context: string;
    signal: ISerializeAbortSignal;
  },
  encoder: ITextEncoder,
  report: (error: unknown) => void
): Promise<ISerializeChunk> {
  const collected: ISerializeChunk[] = [];
  let sawBytes = false;
  let sawValue = false;
  let chunkIndex = 0;
  let bytesConsumed = 0;
  const chunkProgress: number[] = [];

  const take = (candidate: unknown): void => {
    if (details.signal.aborted) {
      throw new SerializeCodecError('serialize aborted', {
        type: details.type,
        phase: details.phase,
        context: details.context,
        chunkIndex,
        bytesConsumed,
        code: SerializeErrorCode.aborted,
        // R-1/T-15：abort 带 reason 时必须经 cause 保持 `=== reason` 可达；缺失则不制造原因。
        cause: details.signal.reason
      });
    }
    const at = { ...details, chunkIndex, bytesConsumed };
    const chunk = validateSerializeChunk(candidate, at);
    chunkProgress.push(bytesConsumed);
    if (chunk[0] === SerializeChunkKind.value) sawValue = true;
    if (chunk[0] === SerializeChunkKind.bytes) sawBytes = true;
    if (sawValue && chunkIndex > 0) {
      throw new SerializeCodecError('a value chunk cannot be combined with other chunks', {
        ...at,
        code: SerializeErrorCode.invalidChunk
      });
    }
    collected.push(chunk);
    bytesConsumed += chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0;
    chunkIndex++;
  };

  /** Convert any iterator/protocol failure into the codec boundary error. */
  const streamFailure = (error: unknown): SerializeCodecError =>
    new SerializeCodecError(`serialize stream failed at chunk ${chunkIndex}: ${reasonOf(error)}`, {
      ...details,
      chunkIndex,
      bytesConsumed,
      code: SerializeErrorCode.encodeFailed,
      cause: error
    });

  try {
    if (isChunkShape(output)) {
      take(output);
    } else {
      let iterable: IIterableProbe | undefined;
      try {
        iterable = probeIterable(output);
      } catch (error) {
        throw streamFailure(error);
      }

      if (iterable !== undefined) {
        try {
          if (iterable.kind === 'async') {
            await drainAsyncIterable(
              output as AsyncIterable<ISerializeChunk>,
              iterable.factory,
              take,
              report
            );
          } else {
            drainSyncIterable(output as Iterable<ISerializeChunk>, iterable.factory, take, report);
          }
        } catch (error) {
          if (error instanceof SerializeCodecError) throw error;
          throw streamFailure(error);
        }
      } else {
        let single: unknown;
        try {
          single = await output;
        } catch (error) {
          throw new SerializeCodecError(`serialize step failed: ${reasonOf(error)}`, {
            ...details,
            chunkIndex,
            bytesConsumed,
            code: SerializeErrorCode.encodeFailed,
            cause: error
          });
        }
        take(single);
      }
    }
  } catch (error) {
    if (error instanceof SerializeCodecError) throw error;
    throw streamFailure(error);
  }

  if (chunkIndex === 0) {
    throw new SerializeCodecError('serialize produced no chunks', {
      ...details,
      chunkIndex: 0,
      bytesConsumed: 0,
      code: SerializeErrorCode.encodeFailed
    });
  }
  if (sawValue) return collected[0];
  if (!sawBytes) {
    let text = '';
    for (const chunk of collected) text += chunk[1] as string;
    return ['text', text];
  }
  const parts = collected.map((chunk, index) =>
    chunk[0] === SerializeChunkKind.bytes
      ? chunk[1]
      : encodeSerializeTextChunk(encoder, chunk[1] as string, {
          ...details,
          chunkIndex: index,
          bytesConsumed: chunkProgress[index] ?? 0
        })
  );
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return ['bytes', merged];
}

/** 把任意分段规约成字符串（文本载体）。`decoder` 必填（Encoding 注入）。 */
export function chunkToText(chunk: ISerializeChunk, decoder: ITextDecoder): string {
  if (chunk[0] === SerializeChunkKind.text) return chunk[1];
  if (chunk[0] === SerializeChunkKind.bytes) return decoder.decode(chunk[1]);
  throw createSerializeTypeError(SerializeErrorCode.invalidChunk, 'a value chunk has no text form');
}

/** 把任意分段规约成字节（transfer / IndexedDB / wasm）。`encoder` 必填（Encoding 注入）。 */
export function chunkToBytes(chunk: ISerializeChunk, encoder: ITextEncoder): Uint8Array {
  if (chunk[0] === SerializeChunkKind.bytes) return chunk[1].slice();
  if (chunk[0] === SerializeChunkKind.text) return encoder.encode(chunk[1]);
  throw createSerializeTypeError(SerializeErrorCode.invalidChunk, 'a value chunk has no byte form');
}

export type {
  ISerializeAbortSignal,
  ISerializeChunk,
  ISerializeCleanupError,
  ISerializeContext,
  ISerializeParser,
  ISerializePhase,
  ISerializePlugin,
  ISerializeRegistry,
  ISerializeRegistryOptions,
  ISerializeScheduler,
  ISerializeTimeoutDiagnostic,
  ITextDecoder,
  ITextEncoder
} from './types.js';

/**
 * 双 Promise 模型（runtime-neutrality.sdd.md R-3）：把 parserTask 与「composed signal 已 abort」赛跑，使调用方在
 * parser 阻塞（encode/decode 永不 settle、AsyncIterable 不再 yield）时仍能因 abort 及时 settle，而不是永久挂起。
 *
 * ParserTask 仍独立运行（detached），其迟到结果/拒绝被观测但不改变已结算的 public promise；abort 的 reason 经 `cause` 保持 `===
 * reason` 可达（R-1/T-15）。`{ once: true }` + settle 后 `removeEventListener` 保证监听器不泄漏。
 */
function raceAbort<T>(
  task: Promise<T>,
  signal: ISerializeAbortSignal,
  details: { readonly type: string; readonly phase: ISerializePhase; readonly context: string }
): Promise<T> {
  const abortError = (): unknown => {
    const reason = signal.reason;
    if (
      isSerializeTaggedError(reason) &&
      (reason as { readonly code?: unknown }).code === SerializeErrorCode.invalidOption
    ) {
      return reason;
    }
    return new SerializeCodecError('serialize aborted', {
      type: details.type,
      phase: details.phase,
      context: details.context,
      chunkIndex: 0,
      bytesConsumed: 0,
      code: SerializeErrorCode.aborted,
      cause: reason
    });
  };
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortError());
    };
    try {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) return onAbort();
      task.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(
        isSerializeTaggedError(error)
          ? error
          : createSerializeTypeError(
              SerializeErrorCode.invalidOption,
              SerializeErrorText.signalAccessorFailed,
              { cause: error }
            )
      );
    }
  });
}

/** Immutable registry admission snapshot for one parser and its method receivers. */
type IParserMethodsSnapshot = {
  readonly encode: ISerializeParser['encode'];
  readonly decode: ISerializeParser['decode'];
  readonly dispose: ISerializeParser['dispose'];
};

/** Immutable registry admission snapshot for one plugin type and parser identity. */
type IParserSnapshot = {
  readonly type: string;
  readonly parser: ISerializeParser;
} & IParserMethodsSnapshot;

/** Immutable per-operation option snapshot captured before parser work or lease tracking. */
type ISerializeOperationOptionsSnapshot = {
  readonly type: string;
  readonly signal?: ISerializeAbortSignal;
  readonly context: string;
};

/** Keep already-tagged serialize validation errors intact while tagging hostile getters. */
const isSerializeTaggedError = (error: unknown): error is Error & { readonly source: string } => {
  try {
    return (
      error instanceof Error && (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE
    );
  } catch {
    return false;
  }
};

/** Immutable cleanup callback snapshot used after registry construction. */
type ICleanupSnapshot =
  | { readonly policy: typeof SerializeCleanupPolicy.throw }
  | {
      readonly policy: typeof SerializeCleanupPolicy.report;
      readonly report: (diagnostic: ISerializeCleanupError) => void;
    };

/** Immutable capability set captured before the registry can publish any lifecycle state. */
type IRegistryOptionsSnapshot = {
  readonly scheduler: NonNullable<ReturnType<typeof snapshotScheduler>>;
  readonly encoder: ITextEncoder;
  readonly decoder: ITextDecoder;
  readonly report: (error: unknown) => void;
  readonly onDrainTimeout: (diagnostic: ISerializeTimeoutDiagnostic) => void;
  readonly cleanup: ICleanupSnapshot;
};

/** A no-op reporter that keeps detached parser failures observed without host dependencies. */
const defaultReport = (_error: unknown): void => {};

/** A no-op timeout observer used when callers do not request deadline diagnostics. */
const defaultOnDrainTimeout = (_diagnostic: ISerializeTimeoutDiagnostic): void => {};

/**
 * Keeps cleanup failures reachable while retaining the first deadline failure as the rejected
 * value. Extensible errors receive an `errors` snapshot; frozen values use an AggregateError whose
 * first entry is the unchanged primary.
 */
const appendCleanupErrors = (primary: unknown, cleanupErrors: readonly unknown[]): unknown => {
  if (cleanupErrors.length === 0) return primary;
  if (primary !== null && (typeof primary === 'object' || typeof primary === 'function')) {
    try {
      const existing = (primary as { readonly errors?: unknown }).errors;
      const errors = Array.isArray(existing) ? [...existing, ...cleanupErrors] : [...cleanupErrors];
      Object.defineProperty(primary, 'errors', {
        value: Object.freeze(errors),
        enumerable: true,
        configurable: true
      });
      return primary;
    } catch {
      // Frozen or hostile primary: preserve both values in a standard aggregate.
    }
  }
  return new AggregateError([primary, ...cleanupErrors], reasonOf(primary));
};

/** Read operation options once, validate their structural contract, and preserve defaults. */
const snapshotOperationOptions = (
  options: unknown,
  primaryType: string
): ISerializeOperationOptionsSnapshot => {
  try {
    if (options !== undefined && (options === null || typeof options !== 'object')) {
      throw new TypeError(SerializeErrorText.operationOptionInvalid);
    }
    const candidate = options as
      | { readonly type?: unknown; readonly signal?: unknown; readonly context?: unknown }
      | undefined;
    const typeOption = candidate?.type;
    const signalOption = candidate?.signal;
    const contextOption = candidate?.context;
    if (typeOption !== undefined && typeof typeOption !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid);
    }
    if (contextOption !== undefined && typeof contextOption !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid);
    }
    return {
      type: typeOption ?? primaryType,
      signal: signalOption === undefined ? undefined : snapshotSerializeSignal(signalOption),
      context: contextOption ?? 'anonymous'
    };
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error;
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.operationOptionInvalid,
      { cause: error }
    );
  }
};

/** Capture one callback value and retain the object that owned its option property. */
const captureOptionCallback = <TArgs extends readonly unknown[], TResult>(
  value: unknown,
  receiver: object,
  invalidMessage: string
): ((...args: TArgs) => TResult) => {
  if (typeof value !== 'function')
    throw createSerializeTypeError(SerializeErrorCode.invalidOption, invalidMessage);
  const method = value as IInvokable<TResult>;
  return (...args: TArgs): TResult => invokeWithReceiver(method, receiver, args);
};

/** Capture an encoder method once and preserve the encoder object's receiver. */
const captureEncoder = (value: unknown): ITextEncoder => {
  const encoder = value === undefined ? hostTextEncoder() : value;
  if (encoder === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      'TextEncoder/TextDecoder is unavailable'
    );
  }
  if (encoder === null || (typeof encoder !== 'object' && typeof encoder !== 'function'))
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.encoderInvalid
    );
  const method = (encoder as { encode?: unknown }).encode;
  if (typeof method !== 'function')
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.encoderInvalid
    );
  const receiver = encoder as object;
  return {
    encode: (input: string) =>
      invokeWithReceiver(method as IInvokable<Uint8Array>, receiver, [input])
  };
};

/** Capture a decoder method once and preserve the decoder object's receiver. */
const captureDecoder = (value: unknown): ITextDecoder => {
  const decoder = value === undefined ? hostTextDecoder() : value;
  if (decoder === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      'TextEncoder/TextDecoder is unavailable'
    );
  }
  if (decoder === null || (typeof decoder !== 'object' && typeof decoder !== 'function'))
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.decoderInvalid
    );
  const method = (decoder as { decode?: unknown }).decode;
  if (typeof method !== 'function')
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.decoderInvalid
    );
  const receiver = decoder as object;
  return {
    decode: (input: Uint8Array) =>
      invokeWithReceiver(method as IInvokable<string>, receiver, [input])
  };
};

/** Snapshot all registry options before parser ownership or dispose single-flight state exists. */
const snapshotRegistryOptions = (
  options: ISerializeRegistryOptions | undefined
): IRegistryOptionsSnapshot => {
  try {
    if (
      options !== undefined &&
      (options === null || (typeof options !== 'object' && typeof options !== 'function'))
    )
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.registryOptionReadFailed
      );
    const receiver = options as object | undefined;
    const schedulerOption = options?.scheduler;
    const encoderOption = options?.encoder;
    const decoderOption = options?.decoder;
    const reportOption = options?.report;
    const onDrainTimeoutOption = options?.onDrainTimeout;
    const cleanupOption = options?.cleanup;

    const scheduler = snapshotScheduler(
      schedulerOption === undefined ? systemScheduler : schedulerOption
    );
    if (scheduler === undefined)
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerInvalid
      );

    const encoder = captureEncoder(encoderOption);
    const decoder = captureDecoder(decoderOption);
    const report =
      reportOption === undefined
        ? defaultReport
        : captureOptionCallback<[unknown], void>(
            reportOption,
            receiver as object,
            SerializeErrorText.reportInvalid
          );
    const onDrainTimeout =
      onDrainTimeoutOption === undefined
        ? defaultOnDrainTimeout
        : captureOptionCallback<[ISerializeTimeoutDiagnostic], void>(
            onDrainTimeoutOption,
            receiver as object,
            SerializeErrorText.onDrainTimeoutInvalid
          );

    let cleanup: ICleanupSnapshot;
    if (cleanupOption === undefined) {
      cleanup = { policy: SerializeCleanupPolicy.throw };
    } else {
      if (
        cleanupOption === null ||
        (typeof cleanupOption !== 'object' && typeof cleanupOption !== 'function')
      )
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.cleanupInvalid
        );
      const policy = (cleanupOption as { policy?: unknown }).policy;
      if (policy === SerializeCleanupPolicy.throw) {
        cleanup = { policy: SerializeCleanupPolicy.throw };
      } else if (policy === SerializeCleanupPolicy.report) {
        const cleanupReport = (cleanupOption as { report?: unknown }).report;
        cleanup = {
          policy: SerializeCleanupPolicy.report,
          report: captureOptionCallback<[ISerializeCleanupError], void>(
            cleanupReport,
            cleanupOption as object,
            SerializeErrorText.cleanupReportInvalid
          )
        };
      } else {
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.cleanupInvalid
        );
      }
    }

    return {
      scheduler,
      encoder,
      decoder,
      report,
      onDrainTimeout,
      cleanup
    };
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error;
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.registryOptionReadFailed,
      { cause: error }
    );
  }
};

/** Snapshot plugin-list protocol state before reading any plugin or parser property. */
const snapshotPluginList = (plugins: unknown): readonly ISerializePlugin[] => {
  try {
    if (plugins === null || (typeof plugins !== 'object' && typeof plugins !== 'function')) {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    const receiver = plugins as object & {
      readonly length?: unknown;
      readonly entries?: unknown;
    };
    const length = receiver.length;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    if (length === 0) return [];
    const entries = receiver.entries;
    if (typeof entries !== 'function') {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    const iterator = invokeWithReceiver(entries as IInvokable<unknown>, receiver, []);
    if (iterator === null || (typeof iterator !== 'object' && typeof iterator !== 'function')) {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    const next = (iterator as { readonly next?: unknown }).next;
    if (typeof next !== 'function') {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    const snapshot: ISerializePlugin[] = [];
    for (let index = 0; index < length; index += 1) {
      const result = invokeWithReceiver(
        next as IInvokable<{ readonly done?: unknown; readonly value?: unknown }>,
        iterator,
        []
      );
      if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
        throw new TypeError(SerializeErrorText.pluginListInvalid);
      }
      if ((result as { readonly done?: unknown }).done) {
        throw new TypeError(SerializeErrorText.pluginListInvalid);
      }
      const entry = (result as { readonly value?: unknown }).value;
      if (!Array.isArray(entry) || entry.length !== 2 || entry[0] !== index) {
        throw new TypeError(SerializeErrorText.pluginListInvalid);
      }
      snapshot.push(entry[1] as ISerializePlugin);
    }
    const finalResult = invokeWithReceiver(
      next as IInvokable<{ readonly done?: unknown }>,
      iterator,
      []
    );
    if (
      finalResult === null ||
      (typeof finalResult !== 'object' && typeof finalResult !== 'function') ||
      !(finalResult as { readonly done?: unknown }).done
    ) {
      throw new TypeError(SerializeErrorText.pluginListInvalid);
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error;
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.pluginListInvalid,
      { cause: error }
    );
  }
};

/** Read one plugin/parser graph once before it becomes visible to a registry. */
const snapshotPlugin = (
  plugin: ISerializePlugin,
  index: number,
  parserMethods: WeakMap<ISerializeParser, IParserMethodsSnapshot>
): IParserSnapshot => {
  try {
    const type = plugin.type;
    if (typeof type !== 'string')
      throw new TypeError('serialize plugin at index ' + index + ' must provide a string type');
    assertSerializeType(type);

    const parserValue = plugin.parser;
    if (parserValue === null || typeof parserValue !== 'object')
      throw new TypeError('serialize plugin "' + type + '" must provide a parser object');
    const parser = parserValue as ISerializeParser;
    const cachedMethods = parserMethods.get(parser);
    if (cachedMethods !== undefined) return { type, parser, ...cachedMethods };
    const encode = parser.encode;
    const decode = parser.decode;
    const dispose = parser.dispose;
    if (typeof encode !== 'function' || typeof decode !== 'function')
      throw new TypeError('serialize parser "' + type + '" must provide encode/decode functions');
    if (dispose !== undefined && typeof dispose !== 'function')
      throw new TypeError('serialize parser "' + type + '" dispose must be a function');
    const methods = { encode, decode, dispose } satisfies IParserMethodsSnapshot;
    parserMethods.set(parser, methods);
    return { type, parser, ...methods };
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error;
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      'invalid serialize plugin at index ' + index,
      { cause: error }
    );
  }
};

export function createSerializeRegistry(
  plugins: readonly ISerializePlugin[],
  options?: ISerializeRegistryOptions
): ISerializeRegistry {
  // 1. Snapshot and validate plugin-list protocol before any parser is inspected or owned.
  const pluginList = snapshotPluginList(plugins);
  if (pluginList.length === 0) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      'serialize registry needs at least one plugin'
    );
  }

  // 2. Snapshot every option before parser ownership or dispose single-flight state exists.
  const optionSnapshot = snapshotRegistryOptions(options);
  const { scheduler, encoder, report, onDrainTimeout, cleanup } = optionSnapshot;

  // 4. 建 closing controller + async scope + parser 注册。
  //    先一次性校验全部 plugin 的 type 合法性与重复性，再统一 own 到 scope：
  //    校验失败发生在任何 parser 被 own 之前，因此同步构造无需回滚（也无从回滚异步 parser dispose）。
  const closing = createAbortController();
  const scope: ILifecycleScope = createLifecycleScope();
  let primaryType = '';
  const parserMethods = new WeakMap<ISerializeParser, IParserMethodsSnapshot>();
  const byType = new Map<string, IParserSnapshot>();
  for (let index = 0; index < pluginList.length; index += 1) {
    const plugin = pluginList[index];
    const snapshot = snapshotPlugin(plugin, index, parserMethods);
    if (byType.has(snapshot.type)) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        `duplicate serialize plugin type: ${snapshot.type}`
      );
    }
    if (index === 0) primaryType = snapshot.type;
    byType.set(snapshot.type, snapshot);
  }
  const ownedParsers = new Set<ISerializeParser>();
  for (const snapshot of byType.values()) {
    if (ownedParsers.has(snapshot.parser)) continue;
    ownedParsers.add(snapshot.parser);
    const capturedDispose = snapshot.dispose as IInvokable<void | Promise<void>> | undefined;
    scope.own(snapshot.parser, {
      force:
        capturedDispose === undefined
          ? () => undefined
          : () => invokeWithReceiver(capturedDispose, snapshot.parser, [])
    });
  }
  // 5. pending tracker + close/dispose 状态
  let closed = false;
  let disposed = false;
  let cleanedUp = false;
  let pendingCount = 0;
  const drainResolvers: Array<() => void> = [];
  let disposePromise: Promise<void> | undefined;
  const track = <T>(task: Promise<T>): Promise<T> => {
    pendingCount++;
    const settle = (): void => {
      pendingCount--;
      if (pendingCount === 0) {
        const resolvers = drainResolvers.splice(0);
        for (const resolve of resolvers) resolve();
      }
    };
    task.then(settle, (error) => {
      settle();
      // Detached 迟到 rejection（cleanup 之后才 settle）走 report 通道观测；不重新接入 registry
      // 生命周期、不改变 terminal、不吞 rejection。report 自身抛错 containment（不影响 observation）。
      if (cleanedUp) {
        try {
          report(error);
        } catch {
          // report 抛错 containment：不影响 parser task 的 rejection observation
        }
      }
    });
    return task;
  };

  const drain = (): Promise<void> => {
    if (pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => drainResolvers.push(resolve));
  };

  const resolve = (type: string, phase: ISerializePhase): IParserSnapshot => {
    if (closed || disposed) {
      throw createSerializeError(
        SerializeErrorCode.registryDisposed,
        'serialize registry is disposed'
      );
    }
    const parser = byType.get(type);
    if (!parser) {
      throw new SerializeCodecError(`no serialize plugin registered for type: ${type}`, {
        type,
        phase,
        context: 'registry',
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.codecNotFound
      });
    }
    return parser;
  };

  // composed signal：caller + closing，first-observed-wins；closing 已 aborted 才 closing reason 优先。
  // 返回 `dispose` 供 operation settle 后移除两个 listener（R-3「settle 后移除两个 listener」，防长期 caller signal 上的监听器泄漏）。
  const composeSignal = (
    caller?: ISerializeAbortSignal
  ): { readonly signal: ISerializeAbortSignal; readonly dispose: () => void } =>
    composeSerializeSignal(caller, closing.signal, report);

  const doClose = (): void => {
    if (closed || disposed) return;
    closed = true;
    closing.abort();
  };

  return {
    primaryType,
    types: [...byType.keys()],
    has: (type) => byType.has(type),

    encode(value, options) {
      const task = (async (): Promise<ISerializeChunk> => {
        const operation = snapshotOperationOptions(options, primaryType);
        const type = operation.type;
        const parser = resolve(type, 'encode');
        const context: ISerializeContext = {
          signal: operation.signal ?? NEVER_ABORTED,
          context: operation.context
        };
        const composed = composeSignal(operation.signal);
        const signal = composed.signal;

        const parserTask = (async (): Promise<ISerializeChunk> => {
          try {
            let output: ISerializeOutput;
            try {
              output = invokeWithReceiver(
                parser.encode as IInvokable<ISerializeOutput>,
                parser.parser,
                [value, { signal, context: context.context }]
              );
            } catch (error) {
              throw new SerializeCodecError(`serialize step failed: ${reasonOf(error)}`, {
                type,
                phase: SerializePhase.encode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: 0,
                code: SerializeErrorCode.encodeFailed,
                cause: error
              });
            }
            const chunk = await collectChunks(
              output,
              { type, phase: SerializePhase.encode, context: context.context, signal },
              encoder,
              report
            );
            if (signal.aborted) {
              throw new SerializeCodecError('serialize aborted', {
                type,
                phase: SerializePhase.encode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
                code: SerializeErrorCode.aborted,
                cause: signal.reason
              });
            }
            return chunk;
          } finally {
            composed.dispose();
          }
        })();

        // 租约唯一释放点 + detached 迟到 rejection 出口（R-3 HIGH-1）：track 完整 collect/encode task，
        // 其迟到 rejection 在 cleanedUp 后经 report 观测、不改变 terminal。
        track(parserTask);
        // 双 Promise（R-3）：public promise = race(parserTask, composed abort)，abort 时及时 settle。
        return await raceAbort(parserTask, signal, {
          type,
          phase: SerializePhase.encode,
          context: context.context
        });
      })();
      return task;
    },

    decode(chunk, options) {
      const task = (async (): Promise<unknown> => {
        const operation = snapshotOperationOptions(options, primaryType);
        const type = operation.type;
        const parser = resolve(type, 'decode');
        const context: ISerializeContext = {
          signal: operation.signal ?? NEVER_ABORTED,
          context: operation.context
        };
        const composed = composeSignal(operation.signal);
        const signal = composed.signal;

        const parserTask = (async (): Promise<unknown> => {
          try {
            const validatedChunk = validateSerializeChunk(chunk, {
              type,
              phase: SerializePhase.decode,
              context: context.context,
              chunkIndex: 0,
              bytesConsumed: 0
            });
            let value: unknown;
            try {
              value = await invokeWithReceiver(
                parser.decode as IInvokable<unknown | Promise<unknown>>,
                parser.parser,
                [validatedChunk, { signal, context: context.context }]
              );
            } catch (error) {
              throw new SerializeCodecError(`deserialize failed: ${reasonOf(error)}`, {
                type,
                phase: SerializePhase.decode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed:
                  validatedChunk[0] === SerializeChunkKind.bytes ? validatedChunk[1].byteLength : 0,
                code: SerializeErrorCode.decodeFailed,
                cause: error
              });
            }
            if (signal.aborted) {
              throw new SerializeCodecError('deserialize aborted', {
                type,
                phase: SerializePhase.decode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
                code: SerializeErrorCode.aborted,
                cause: signal.reason
              });
            }
            return value;
          } finally {
            composed.dispose();
          }
        })();

        track(parserTask);
        return await raceAbort(parserTask, signal, {
          type,
          phase: SerializePhase.decode,
          context: context.context
        });
      })();
      return task;
    },

    close() {
      doClose();
    },

    dispose(opts) {
      if (disposePromise) return disposePromise;
      // Validate and capture the first deadline before publishing the single-flight promise.
      let deadlineAt: number | undefined;
      try {
        deadlineAt = opts?.deadlineAt;
      } catch (cause) {
        return Promise.reject(
          createSerializeTypeError(
            SerializeErrorCode.invalidOption,
            'serialize dispose deadlineAt could not be read',
            { cause }
          )
        );
      }
      if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) {
        return Promise.reject(
          createSerializeTypeError(
            SerializeErrorCode.invalidOption,
            'serialize dispose deadlineAt must be a finite number'
          )
        );
      }
      // Publish the single-flight promise before invoking scheduler or parser-owned callbacks;
      // hostile scheduler reentrancy must observe the same terminal Promise.
      let resolveDispose!: () => void;
      let rejectDispose!: (error: unknown) => void;
      disposePromise = new Promise<void>((resolve, reject) => {
        resolveDispose = resolve;
        rejectDispose = reject;
      });
      void (async (): Promise<void> => {
        doClose();
        disposed = true;
        let primaryError: unknown;
        let hasPrimaryError = false;
        const recordPrimary = (error: unknown): void => {
          if (!hasPrimaryError) {
            primaryError = error;
            hasPrimaryError = true;
          }
        };
        const reportTimeout = (): void => {
          try {
            onDrainTimeout({
              kind: SerializeCleanupKind.drainTimeout,
              source: SERIALIZE_SOURCE,
              deadlineAt,
              pendingCount
            });
          } catch {
            // onDrainTimeout 抛错不阻断 cleanup（containment）
          }
        };

        let timer: { cancel(): void } | undefined;
        try {
          if (deadlineAt === undefined) {
            await drain();
          } else {
            // 负值视为「已过」，由下方 remaining <= 0 分支处理，不在此抛错。
            const remaining = deadlineAt - scheduler.now();
            if (remaining <= 0) {
              reportTimeout();
            } else {
              let resolveDeadline!: () => void;
              const deadlineReached = new Promise<void>((resolve) => {
                resolveDeadline = resolve;
              });
              try {
                timer = scheduler.schedule(resolveDeadline, remaining);
              } catch (error) {
                recordPrimary(error);
              }
              if (!hasPrimaryError) {
                await Promise.race([drain(), deadlineReached]);
                if (pendingCount > 0) reportTimeout();
              }
            }
          }
        } catch (error) {
          recordPrimary(error);
        } finally {
          if (timer !== undefined) {
            try {
              timer.cancel();
            } catch (error) {
              recordPrimary(error);
            }
          }
        }

        let cleanupError: unknown;
        let hasCleanupError = false;
        try {
          await scope.dispose();
        } catch (error) {
          cleanupError = error;
          hasCleanupError = true;
        } finally {
          byType.clear();
          cleanedUp = true;
        }

        if (hasCleanupError) {
          if (cleanup.policy === SerializeCleanupPolicy.throw) {
            if (hasPrimaryError) {
              primaryError = appendCleanupErrors(primaryError, [cleanupError]);
            } else {
              primaryError = cleanupError;
              hasPrimaryError = true;
            }
          } else {
            try {
              cleanup.report({
                kind: SerializeCleanupKind.cleanupError,
                source: SERIALIZE_SOURCE,
                error: cleanupError
              });
            } catch {
              // report 自身抛错 containment：dispose 结果与 primary 不变
            }
          }
        }

        if (hasPrimaryError) throw primaryError;
      })().then(resolveDispose, rejectDispose);
      return disposePromise;
    }
  };
}
