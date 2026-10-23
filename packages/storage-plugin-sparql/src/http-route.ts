import type { ISparqlEndpoint } from './endpoint.js'
/** Routing metadata belongs to the original HTTP endpoint; it grants no request or lifecycle handle. */
const routes = new WeakMap<
  ISparqlEndpoint,
  { readonly query: string; readonly update: string; readonly graph?: string }
>()
/** Register only the native HTTP adapter's sanitized route paths. */
export function registerHttpRoutes(
  endpoint: ISparqlEndpoint,
  value: { readonly query: string; readonly update: string; readonly graph?: string }
): void {
  routes.set(endpoint, Object.freeze(value))
}
/** Native observation omits non-HTTP endpoints and never returns credentials or URL queries. */
export function readHttpRoute(
  endpoint: ISparqlEndpoint,
  operation: 'query' | 'update' | 'graph'
): string | undefined {
  return routes.get(endpoint)?.[operation]
}
