import { expectTypeOf, it } from 'vitest';
import type {
  IDiscriminatedByField,
  IDiscriminatedByPath,
  IObjectPathInput,
  IObjectPathValue
} from '../src/typing.js';

type IEvent =
  | {
      readonly type: 'created';
      readonly meta: { readonly category: 'write' };
      readonly payload: { readonly userId: string };
    }
  | {
      readonly type: 'deleted';
      readonly meta: { readonly category: 'write' };
      readonly payload: { readonly reason: string };
    }
  | {
      readonly type: 'read';
      readonly meta: { readonly category: 'read' };
      readonly payload: { readonly cache: boolean };
    };

it('groups discriminated unions by top-level fields and nested paths', () => {
  type IByType = IDiscriminatedByField<'type', IEvent>;
  type IByCategory = IDiscriminatedByPath<IEvent, 'meta.category'>;
  type IByTupleCategory = IDiscriminatedByPath<IEvent, readonly ['meta', 'category']>;

  expectTypeOf<IByType['created']>().toEqualTypeOf<Extract<IEvent, { type: 'created' }>>();
  expectTypeOf<IByType['deleted']>().toEqualTypeOf<Extract<IEvent, { type: 'deleted' }>>();
  expectTypeOf<IByCategory['write']>().toEqualTypeOf<
    Extract<IEvent, { meta: { category: 'write' } }>
  >();
  expectTypeOf<IByCategory['read']>().toEqualTypeOf<
    Extract<IEvent, { meta: { category: 'read' } }>
  >();
  expectTypeOf<IByTupleCategory>().toEqualTypeOf<IByCategory>();
});

it('re-exports canonical object-path inputs and values', () => {
  expectTypeOf<'meta.category'>().toMatchTypeOf<IObjectPathInput<IEvent>>();
  expectTypeOf<IObjectPathValue<IEvent, 'meta.category'>>().toEqualTypeOf<'write' | 'read'>();

  // @ts-expect-error unknown paths are rejected before discriminator extraction
  type IInvalidPath = IDiscriminatedByPath<IEvent, 'meta.unknown'>;
  expectTypeOf<IInvalidPath>();

  // @ts-expect-error unknown tuple segments are rejected before discriminator extraction
  type IInvalidTuplePath = IDiscriminatedByPath<IEvent, readonly ['meta', 'unknown']>;
  expectTypeOf<IInvalidTuplePath>();
});

it('rejects non-property-key discriminator fields', () => {
  type IInvalid = { readonly discriminator: { readonly nested: true } };

  // @ts-expect-error object-valued fields cannot become mapped-type keys
  type IInvalidMap = IDiscriminatedByField<'discriminator', IInvalid>;
  expectTypeOf<IInvalidMap>();
});
