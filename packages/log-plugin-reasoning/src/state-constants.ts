/** Reasoning phases retain the established state values independently of completed entry tags. */
export const ReasoningPhase = {
  /** No unfinished phase exists. */
  idle: 'idle',
  /** Thinking deltas accumulate for a later thinking entry. */
  thinking: 'thinking',
  /** Response deltas accumulate for a later response entry. */
  responding: 'responding'
} as const

/** The phase constant and its value union intentionally use one enum-like namespace. */
export type ReasoningPhase = keyof typeof ReasoningPhase

/** Completed entries preserve their public thinking/response tags. */
export const ReasoningTag = { thinking: 'thinking', response: 'response' } as const

/** Completed entry tag values; the constant and its value union share one enum-like namespace. */
export type ReasoningTag = (typeof ReasoningTag)[keyof typeof ReasoningTag]

/** Public `data` key carrying the completed phase on reasoning entries; consumers filter by it. */
export const REASONING_PHASE_DATA_KEY = 'reasoningPhase'

/** Stable registration identity replaces the old factory without a compatibility alias. */
export const REASONING_PLUGIN_NAME = 'reasoning'

/** The existing automatic thinking label is emitted only when a phase starts without a label. */
export const DEFAULT_THINKING_LABEL = 'Thinking...'
