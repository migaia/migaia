/** Streaming options borrow a writer while the plugin owns only its phase buffer. */
export type IReasoningPluginConfig = {
  /** Raw token fragments bypass structured output and receive no plugin-owned ANSI. */
  write?: (text: string) => void
  /** A call-level label overrides the corresponding configured label. */
  labels?: { thinking?: string; response?: string }
  /** Defer stream writes and completed-entry dispatch through the real host, default false. */
  asyncOutput?: boolean
}

/** Six phase methods preserve the existing streaming and explicit completion surface. */
export type IReasoningExtension = {
  startThinking(label?: string): void
  thinking(delta: string): void
  endThinking(): void
  startResponse(label?: string): void
  response(delta: string): void
  endResponse(): void
}
