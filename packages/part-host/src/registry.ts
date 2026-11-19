/** Type registry filled by `partom types` through declaration merging, and types derived from it. */

/**
 * Declaration-merging extension point. Generated `.d.ts` files augment it with up to four members:
 * `addresses` (a union of part addresses), `states` (path to value type), `events` (address to
 * event name to `detail` type) and `resources` (id to `{ params; result; commands }`). It must be
 * an interface: type aliases cannot be merged across modules.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/consistent-type-definitions
export interface IPartTypeRegistry {}

/** Registry member `K` when present, otherwise `F`. */
type IMember<K extends string, F> = IPartTypeRegistry extends { readonly [P in K]: infer M } ? M : F

/** Part addresses: the registered union, or any string. */
export type IPartAddressOf = IMember<'addresses', string>

/** Registered state table, or an open table. */
type IStateTable = IMember<'states', Readonly<Record<string, unknown>>>

/** State paths: the registered keys, or any string. */
export type IStatePathOf = keyof IStateTable & string

/** Value type of a state path; `unknown` for unregistered paths. */
export type IStateValueOf<P extends string> = P extends keyof IStateTable ? IStateTable[P] : unknown

/** Registered event table, or an empty one. */
type IEventTable = IMember<'events', Record<never, never>>

/** Event names of an address; never restricted, since only events with a detail are registered. */
export type IEventNameOf<_A extends string> = string

/** Detail type of an event of an address; `unknown` unless registered. */
export type IEventDetailOf<A extends string, E extends string> = A extends keyof IEventTable
  ? E extends keyof IEventTable[A]
    ? IEventTable[A][E]
    : unknown
  : unknown

/** Registered resource table, or an open table. */
type IResourceTable = IMember<
  'resources',
  Readonly<
    Record<
      string,
      {
        readonly params: unknown
        readonly result: unknown
        readonly commands: Readonly<Record<string, unknown>>
      }
    >
  >
>

/** Resource ids: the registered keys, or any string. */
export type IResourceIdOf = keyof IResourceTable & string

/** Parameter type of a resource. */
export type IResourceParamsOf<R extends string> = R extends keyof IResourceTable
  ? IResourceTable[R]['params']
  : unknown

/** Result type of a resource. */
export type IResourceResultOf<R extends string> = R extends keyof IResourceTable
  ? IResourceTable[R]['result']
  : unknown

/** Command names of a resource. */
export type ICommandNameOf<R extends string> = R extends keyof IResourceTable
  ? keyof IResourceTable[R]['commands'] & string
  : string

/** Argument type of a resource command. */
export type ICommandArgsOf<R extends string, C extends string> = R extends keyof IResourceTable
  ? C extends keyof IResourceTable[R]['commands']
    ? IResourceTable[R]['commands'][C]
    : unknown
  : unknown
