/** Hub-owned diagnostics use the registered devtools codes rather than message matching. */
export const HubErrorText = {
  /** Construction accepts bounded positive retention and an optional positive realignment period. */
  invalidOptions: 'invalid rpc devtools hub options',
  /** Targets expose the frozen request/stream service boundary through an existing connection. */
  invalidTarget: 'rpc devtools hub target requires a name and a request/stream client',
  /** Timeline limits represent a finite nonnegative number of retained events. */
  invalidQuery: 'invalid rpc devtools hub timeline query',
  /** A closed hub cannot acquire or inspect target resources. */
  closed: 'rpc devtools hub is closed',
  /** Duplicate names must be removed before another live or offline target uses them. */
  duplicate: 'rpc devtools hub target already exists',
  /** A name that was never registered has no state or watch to release. */
  unknown: 'rpc devtools hub target is unknown',
  /** Release collects every original failure in target registration order. */
  release: 'rpc devtools hub watch release failed',
  /** A failing report callback must itself remain visible through the host reporter. */
  reporter: 'rpc devtools hub error reporter failed'
} as const

/** Bare service methods match IRpcDevtoolsServiceApi; callers own any Peer namespace binding. */
export const HubServiceMethod = {
  describe: 'describe',
  query: 'query',
  watch: 'watch',
  stats: 'stats'
} as const

/** The public on overloads and their listener storage share this event vocabulary. */
export const HubEventName = { status: 'status', event: 'event' } as const
