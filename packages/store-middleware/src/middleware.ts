import type { IDisposer, IRuntime } from '@migaia/reactive';
import type { IMutationGuard } from '@migaia/store-light';

export type { IMutationGuard, IMutationPolicy } from '@migaia/store-light';

/** 严格写入策略；默认关闭，避免改变既有 Store 行为。 */
export type IMutationPolicyMode = 'off' | 'actions-only';

export class MutationPolicy implements IMutationGuard {
  #actionDepth = 0;
  #mode: IMutationPolicyMode;

  constructor(mode: IMutationPolicyMode = 'off') {
    this.#mode = mode;
  }

  get insideAction(): boolean {
    return this.#actionDepth > 0;
  }

  assertMutationAllowed(operation = 'mutation'): void {
    if (this.#mode === 'actions-only' && this.#actionDepth === 0) {
      throw new Error(`[store] ${operation} is not allowed outside an action`);
    }
  }

  runInAction<T>(fn: () => T): T {
    this.#actionDepth++;
    try {
      return fn();
    } finally {
      this.#actionDepth--;
    }
  }
}

export function createMutationPolicy(mode: IMutationPolicyMode = 'off'): MutationPolicy {
  return new MutationPolicy(mode);
}

export type IMiddlewareActionEvent =
  | {
      readonly type: 'action';
      readonly phase: 'start';
      readonly name: string;
      readonly timestamp: number;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'action';
      readonly phase: 'end';
      readonly name: string;
      readonly timestamp: number;
      readonly durationMs: number;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'action';
      readonly phase: 'error';
      readonly name: string;
      readonly timestamp: number;
      readonly durationMs: number;
      readonly error: unknown;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };

export type IMiddlewareStateEvent<S> = {
  readonly type: 'state';
  readonly name: string;
  readonly timestamp: number;
  readonly previous: S;
  readonly next: S;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type IMiddlewareErrorEvent = {
  readonly type: 'error';
  readonly phase: string;
  readonly timestamp: number;
  readonly error: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type IMiddlewareEvent<S> =
  | IMiddlewareActionEvent
  | IMiddlewareStateEvent<S>
  | IMiddlewareErrorEvent;

/** 迁移适配器使用的旧 middleware 形状；新代码请使用 IStoreMiddlewarePlugin。 */
export type IMiddlewareContext<S> = {
  readonly runtime: IRuntime;
  readonly getState: () => S;
};

export type IStoreMiddleware<S> = (
  event: IMiddlewareEvent<S>,
  context: IMiddlewareContext<S>,
  next: () => void
) => void;

export type IDevToolsCommand<S> =
  | { readonly type: 'jump'; readonly state: S }
  | { readonly type: 'reset'; readonly state: S }
  | { readonly type: 'commit' };

export type IDevToolsAdapter<S> = {
  init(state: S): void;
  send(event: IMiddlewareEvent<S>, state: S): void;
  subscribe?(listener: (command: IDevToolsCommand<S>) => void): IDisposer;
};

export type IReduxDevToolsMessage = {
  readonly type?: string;
  readonly payload?: { readonly type?: string };
  readonly state?: string;
};

export type IReduxDevToolsConnection<S> = {
  init(state: S): void;
  send(action: unknown, state: S): void;
  subscribe(listener: (message: IReduxDevToolsMessage) => void): IDisposer;
};

/** 将 Redux DevTools 消息转换为 Store middleware 领域事件。 */
export function createReduxDevToolsAdapter<S>(
  connection: IReduxDevToolsConnection<S>
): IDevToolsAdapter<S> {
  return {
    init: (state) => connection.init(state),
    send: (event, state) => connection.send({ type: middlewareEventLabel(event), event }, state),
    subscribe(listener) {
      return connection.subscribe((message) => {
        if (message.type !== 'DISPATCH') return;
        const type = message.payload?.type;
        if (type === 'COMMIT') {
          listener({ type: 'commit' });
          return;
        }
        if (
          type !== 'JUMP_TO_STATE' &&
          type !== 'JUMP_TO_ACTION' &&
          type !== 'ROLLBACK' &&
          type !== 'RESET'
        )
          return;
        if (message.state === undefined) return;
        let state: S;
        try {
          state = JSON.parse(message.state) as S;
        } catch {
          return;
        }
        listener({ type: type === 'RESET' ? 'reset' : 'jump', state });
      });
    }
  };
}

function middlewareEventLabel<S>(event: IMiddlewareEvent<S>): string {
  if (event.type === 'action') return `${event.name}:${event.phase}`;
  if (event.type === 'state') return event.name;
  return `error:${event.phase}`;
}
