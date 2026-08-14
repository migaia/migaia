import { describe, expectTypeOf, it } from 'vitest';
import { createEndpoint } from '../src/factory';
import { connect } from '../src/middleware/connect';
import { ping } from '../src/middleware/ping';
import type { IWebRpcPingOptions } from '../src/typing';

type IAutomaticMiddlewareList = readonly [ReturnType<typeof connect>];
type IManualMiddlewareList = readonly [
  ReturnType<typeof connect<'manual'>>,
  ReturnType<typeof ping>
];
type IAutomaticEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'automatic-target', IAutomaticMiddlewareList>>
>;
type IManualEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'manual-target', IManualMiddlewareList>>
>;

async function assertInferredFactoryContract(): Promise<void> {
  const automatic = await createEndpoint({
    id: 'automatic-target',
    middlewares: [connect({ transport: undefined as never })]
  });
  // @ts-expect-error automatic discovery does not expose manual query controls
  void automatic.connect.query;
  const manual = await createEndpoint({
    id: 'manual-target',
    middlewares: [connect({ transport: undefined as never, discoveryMode: 'manual' }), ping()]
  });
  void manual.connect.query;
  void manual.ping;
}
void assertInferredFactoryContract;

describe('factory type contract', () => {
  it('discriminates discovery mode and ping capability', () => {
    expectTypeOf<
      'query' extends keyof IAutomaticEndpoint['connect'] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'query' extends keyof IManualEndpoint['connect'] ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<'ping' extends keyof IAutomaticEndpoint ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'ping' extends keyof IManualEndpoint ? true : false>().toEqualTypeOf<true>();
    expectTypeOf<IManualEndpoint['ping']>().toEqualTypeOf<
      (targetId: string, receiverId?: string, options?: IWebRpcPingOptions) => Promise<boolean>
    >();
  });
});
