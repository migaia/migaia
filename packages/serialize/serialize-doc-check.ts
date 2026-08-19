import {
  createSerializeRegistry,
  jsonPlugin,
  encodeStream,
  decodeStream,
  collectStream,
  chunkToText,
  SerializeCodecError,
  assertSerializeType,
  type ISerializeChunk,
  type ISerializeParser,
  type ISerializePlugin
} from './src/index';
import { systemScheduler } from '@migaia/lifecycle';

async function readmeExample() {
  const registry = createSerializeRegistry([jsonPlugin()]);
  const chunk = await registry.encode({ answer: 42 }, { context: 'settings' });
  const value = await registry.decode(chunk, { context: 'settings' });
  registry.dispose();

  const hugeArrayOfRows: unknown[] = [];
  const stream = encodeStream(registry, hugeArrayOfRows, {
    initialItems: 500,
    maxInFlight: 2,
    scheduler: systemScheduler
  });
  const collected = await collectStream(stream);
  void value;
  void collected;
}

async function useguideExample() {
  const cborParser: ISerializeParser = {
    name: 'cbor',
    encode(value): ISerializeChunk {
      return ['bytes', new Uint8Array()];
    },
    decode(chunk): unknown {
      if (chunk[0] === 'value') return chunk[1];
      const bytes = chunk[0] === 'bytes' ? chunk[1] : new TextEncoder().encode(chunk[1]);
      return bytes;
    },
    dispose() {}
  };
  const cborPlugin: ISerializePlugin = { type: 'cbor', parser: cborParser };
  const registry = createSerializeRegistry([jsonPlugin(), cborPlugin]);

  const hugeArrayOfRows: unknown[] = [];
  const wire: unknown[] = [];
  const controller = new AbortController();
  try {
    for await (const chunk of encodeStream(registry, hugeArrayOfRows, {
      initialItems: 500,
      maxInFlight: 2,
      signal: controller.signal,
      context: 'export-rows',
      scheduler: systemScheduler
    })) {
      wire.push(chunk);
    }
  } catch (error) {
    if (error instanceof SerializeCodecError) {
      console.error(`导出在第 ${error.chunkIndex} 片失败：${error.message}`, {
        cause: error.cause
      });
    }
    throw error;
  }

  const restored: unknown[] = [];
  for await (const rows of decodeStream(registry, wire as never, { context: 'export-rows' })) {
    restored.push(...(rows as unknown[]));
  }
  registry.dispose();
  void chunkToText;
  void assertSerializeType;
}

void readmeExample;
void useguideExample;
