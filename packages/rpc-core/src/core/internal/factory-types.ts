/** Private factory inference declarations; public call signatures retain their exact projections. */
import type { IRpcFeature } from '../feature.js'
import type { IRpcEndpoint, IRpcProvider, IRpcMiddleware } from '../typing.js'
import type { IRpcNativeMiddleware, IRpcMiddlewareComponentContribution } from '../middleware.js'
import type { IRpcPublicFirstPartyRootNames } from './first-party-roots.js'

/**
 * Reads component slots only from native middleware definitions. The optional unique-symbol marker
 * is otherwise structurally compatible with legacy middleware and would incorrectly infer a ping
 * capability from an ordinary `connect()` descriptor.
 */
type INativeMiddlewareComponentContribution<TMiddleware> =
  TMiddleware extends IRpcNativeMiddleware & IRpcMiddlewareComponentContribution<infer TComponents>
    ? TComponents
    : never
/** Select manual discovery only from the actual preserved middleware tuple. */
export type IFactoryDiscoveryMode<TMiddlewares extends readonly IRpcMiddleware[]> = [
  Extract<
    TMiddlewares[number] | INativeMiddlewareComponentContribution<TMiddlewares[number]>,
    { readonly discoveryMode: 'manual' }
  >
] extends [never]
  ? 'automatic'
  : 'manual'
/** Distinguishes an explicitly selected ping capability from the optional legacy slot. */
type IRequiredPingCapability<TMiddleware> = TMiddleware extends object
  ? 'pingCapability' extends keyof TMiddleware
    ? {} extends Pick<TMiddleware, 'pingCapability'>
      ? false
      : TMiddleware extends { readonly pingCapability: true }
        ? true
        : false
    : false
  : false
/** Selects the public ping surface only when a middleware actually requires that capability. */
export type IFactoryPingCapability<TMiddlewares extends readonly IRpcMiddleware[]> =
  true extends IRequiredPingCapability<
    TMiddlewares[number] | INativeMiddlewareComponentContribution<TMiddlewares[number]>
  >
    ? true
    : false

/** Mirrors the runtime branch: only private first-party roots prepare then project `public`. */
type IRpcFeatureRootSurface<TName extends string, TFeature> =
  TFeature extends IRpcFeature<infer TOutput>
    ? TName extends `first-party-${string}`
      ? TOutput extends { readonly prepare: (...args: readonly never[]) => infer TPrepared }
        ? TPrepared extends { readonly public: infer TPublic extends object }
          ? TPublic
          : Record<never, never>
        : Record<never, never>
      : TOutput
    : Record<never, never>

/** Intersects only explicitly selected roots; private closure dependencies never widen this type. */
export type IRpcRootProjection<TRoots extends Readonly<Record<string, IRpcFeature>>> =
  IUnionToIntersection<
    {
      [TName in IRpcPublicFirstPartyRootNames<TRoots>]: IRpcFeatureRootSurface<TName, TRoots[TName]>
    }[IRpcPublicFirstPartyRootNames<TRoots>]
  >

/** Reprojects the completed endpoint so detached `provide()` remains fluent over every surface. */
export type IRecursiveProvideSurface<TSurface extends object> = Omit<TSurface, 'provide'> &
  ('provide' extends keyof TSurface
    ? {
        provide(method: string, provider: IRpcProvider): IRecursiveProvideSurface<TSurface>
      }
    : {})

/** Combine selected root surfaces without widening their individual keys. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Every factory retains the canonical endpoint disposal capability. */
export type IRpcKernelSurface = Pick<IRpcEndpoint, 'dispose'>
