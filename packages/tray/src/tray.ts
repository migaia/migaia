import {
  createCapabilityGraph,
  type IGraphNodeDefinition,
  type IGraphNodeId
} from '@migaia/capability/graph';
import { TrayErrorCode } from './error-code.js';
import { attachTrayError, createTrayError } from './errors.js';
import type {
  ITray,
  ITrayEntryDefinition,
  ITrayEntryContext,
  ITrayKey,
  ITrayState
} from './contract.js';
import type { IGraphNodeState, IReleaseDescriptor } from './types.js';

const keyOf = (key: ITrayKey): IGraphNodeId => key as unknown as IGraphNodeId;

type IAdmittedEntry = {
  readonly key: ITrayKey;
  readonly kind: ITrayEntryDefinition<unknown>['kind'];
  readonly requires: readonly ITrayKey[];
  readonly readiness: ITrayEntryDefinition<unknown>['readiness'];
  readonly start: ITrayEntryDefinition<unknown>['start'];
};

/** Creates one immutable static composition root over one Capability Graph. */
export function createTray(entries: readonly ITrayEntryDefinition<unknown>[]): ITray {
  if (!Array.isArray(entries)) throw createTrayError(TrayErrorCode.invalidEntry);
  const admitted: IAdmittedEntry[] = [];
  const definitions = new Map<ITrayKey, IAdmittedEntry>();
  let gateError: unknown;
  let gateFailed = false;
  let gatePromise: Promise<void> | undefined;
  let graphProjection = false;
  let disposed = false;
  for (const entry of entries) {
    let key: unknown, kind: unknown, requires: unknown, readiness: unknown, start: unknown;
    try {
      key = entry?.key;
      kind = entry?.kind;
      requires = entry?.requires;
      readiness = entry?.readiness;
      start = entry?.start;
    } catch (error) {
      throw createTrayError(TrayErrorCode.invalidEntry, error);
    }
    if (
      typeof key !== 'string' ||
      key.trim() === '' ||
      !['value', 'computed', 'resource', 'service'].includes(kind as string) ||
      typeof start !== 'function' ||
      (requires !== undefined && !Array.isArray(requires)) ||
      (readiness !== undefined && (typeof readiness !== 'object' || readiness === null))
    )
      throw createTrayError(TrayErrorCode.invalidEntry);
    let admittedEntry: IAdmittedEntry;
    try {
      admittedEntry = Object.freeze({
        key: key as ITrayKey,
        kind: kind as IAdmittedEntry['kind'],
        requires: Object.freeze([...((requires as readonly ITrayKey[] | undefined) ?? [])]),
        readiness: readiness as IAdmittedEntry['readiness'],
        start: start as IAdmittedEntry['start']
      });
    } catch (error) {
      throw createTrayError(TrayErrorCode.invalidEntry, error);
    }
    if (definitions.has(admittedEntry.key)) throw createTrayError(TrayErrorCode.duplicateEntry);
    definitions.set(admittedEntry.key, admittedEntry);
    admitted.push(admittedEntry);
  }
  for (const entry of admitted)
    for (const provider of entry.requires) {
      if (
        provider === entry.key ||
        typeof provider !== 'string' ||
        provider.trim() === '' ||
        !definitions.has(provider)
      )
        throw createTrayError(TrayErrorCode.invalidEntry);
    }
  const graph = createCapabilityGraph();
  const nodes: IGraphNodeDefinition<unknown>[] = admitted.map((entry) => {
    const key = entry.key;
    const dependencies = (entry.requires ?? []).map((provider) => ({
      provider: keyOf(provider),
      required: true as const
    }));
    return {
      id: keyOf(key),
      kind: entry.kind,
      dependencies,
      start: (context) => {
        const entryContext: ITrayEntryContext = {
          signal: context.signal,
          get: <T>(provider: ITrayKey): T => context.get<T>(keyOf(provider)),
          own: <T>(resource: T, descriptor: IReleaseDescriptor): T =>
            context.own(resource, descriptor)
        };
        // Return foreign thenables unchanged; Graph owns assimilation and primary release admission.
        return entry.start(entryContext);
      }
    };
  });
  for (const node of nodes) graph.register(node);
  const readiness = admitted.map((entry) => entry.readiness);
  const runGate = (): Promise<void> => {
    if (disposed) {
      graphProjection = true;
      return graph.ready();
    }
    if (gatePromise) return gatePromise;
    try {
      for (const snapshot of readiness) {
        if (!snapshot) continue;
        let state: unknown;
        try {
          state = snapshot.state;
        } catch (caught) {
          gateFailed = true;
          gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed);
          break;
        }
        if (state !== 'ready' && state !== 'blocked' && state !== 'failed') {
          gateFailed = true;
          gateError = createTrayError(TrayErrorCode.invalidEntry);
          break;
        }
        let error: unknown;
        try {
          error = snapshot.error;
        } catch (caught) {
          gateFailed = true;
          gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed);
          break;
        }
        if (state !== 'ready') {
          gateFailed = true;
          gateError = error ?? createTrayError(TrayErrorCode.unavailable);
          break;
        }
      }
      if (gateFailed) {
        gatePromise = Promise.reject(gateError);
      } else {
        graphProjection = true;
        gatePromise = graph.ready();
      }
    } catch (error) {
      gateError = error;
      gatePromise = Promise.reject(error);
    }
    return gatePromise;
  };
  const find = (key: ITrayKey): void => {
    if (!definitions.has(key)) throw createTrayError(TrayErrorCode.unknownEntry);
  };
  return {
    keys: Object.freeze(admitted.map((entry) => entry.key)),
    get state(): ITrayState {
      if (gateFailed && !graphProjection) return 'failed';
      if (graphProjection) return graph.state;
      return 'open';
    },
    get error() {
      return graphProjection ? graph.error : (gateError ?? graph.error);
    },
    ready: runGate,
    get<T>(key: ITrayKey) {
      find(key);
      const diagnostic = graph.nodeState(keyOf(key));
      if (graph.state !== 'ready' || diagnostic.state !== 'ready')
        throw createTrayError(TrayErrorCode.unavailable);
      return diagnostic.value as T;
    },
    entryState(key) {
      find(key);
      return graph.nodeState(keyOf(key)).state as IGraphNodeState;
    },
    dispose() {
      disposed = true;
      graphProjection = true;
      return graph.dispose();
    }
  };
}
