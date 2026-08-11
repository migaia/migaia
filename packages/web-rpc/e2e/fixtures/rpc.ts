import { createEndpoint } from '../../src/factory';
import { connect } from '../../src/middleware/connect';
import { timeout } from '../../src/middleware/timeout';
import { uuid } from '../../src/middleware/uuid';
import { ping } from '../../src/middleware/ping';
import { authentication } from '../../src/middleware/authentication';
import type { IWebRpcProvider } from '../../src/typing';
import type { IWebRpcEndpoint } from '../../src/typing';
import type { IWebRpcTransport } from '../../src/transport';

export const createRpc = (
  id: string,
  targetIds: readonly string[],
  transport: IWebRpcTransport,
  provider: Readonly<Record<string, IWebRpcProvider>> = {},
  identity?: {
    readonly uniqueTargetId: string;
    readonly identifier?: (context: { readonly data?: unknown }) => boolean;
  },
  fixedUuid?: string | (() => string),
  authenticated = false
): Promise<IWebRpcEndpoint<string, 'automatic', true>> =>
  createEndpoint({
    id,
    targetIds,
    provider,
    middlewares: [
      connect({
        transport,
        ...(identity
          ? {
              useBaseIdVerifyOnly: false,
              uniqueTargetId: identity.uniqueTargetId,
              identifier: identity.identifier ?? (() => true)
            }
          : {})
      }),
      ...(authenticated
        ? [
            authentication({
              sign: (value) => ({ value, signature: 'trusted' }),
              verify: (value) => {
                const candidate = value as { signature?: unknown; value?: unknown };
                if (candidate.signature !== 'trusted') throw new Error('invalid signature');
                return candidate.value;
              }
            })
          ]
        : []),
      timeout({ timeoutMs: 2_000 }),
      ping(),
      ...(fixedUuid === undefined
        ? []
        : [uuid({ generate: typeof fixedUuid === 'function' ? fixedUuid : () => fixedUuid })])
    ]
  }) as Promise<IWebRpcEndpoint<string, 'automatic', true>>;

export const echoProvider: IWebRpcProvider = (context) => context.success(context.data);

export const installErrorGuards = (): string[] => {
  const errors: string[] = [];
  globalThis.addEventListener('error', (event) =>
    errors.push(String(event.error ?? event.message))
  );
  globalThis.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  return errors;
};
