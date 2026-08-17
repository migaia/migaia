// Real (non-mocked) IFieldContext builder for exercising src/*.ts field builders directly,
// without going through @migaia/store-light's createStore(). Mirrors exactly how
// reactive-store.ts wires a sync field builder's create({ runtime, signal, createSource }):
// createRuntime() for the graph, createFieldSource() for the per-field Source capability.
import { createRuntime } from '@migaia/reactive';
import type { IRuntime } from '@migaia/reactive';
import { createFieldSource } from '@migaia/reactive/source';
import type { IFieldContext } from '../../src/field';

export function makeFieldContext(runtime: IRuntime = createRuntime()): {
  context: IFieldContext;
  runtime: IRuntime;
  controller: AbortController;
} {
  const controller = new AbortController();
  const context: IFieldContext = {
    runtime,
    signal: controller.signal,
    createSource: (debugName?: string) => createFieldSource(runtime, debugName)
  };
  return { context, runtime, controller };
}
