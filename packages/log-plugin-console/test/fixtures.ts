/** Console calls retain their arguments rather than flattening native objects into text. */
export class MemoryConsole {
  /** Ordinary entries are routed to log. */
  readonly logs: unknown[][] = []
  /** Warning entries are routed to warn. */
  readonly warnings: unknown[][] = []
  /** Error and fatal entries are routed to error. */
  readonly errors: unknown[][] = []
  /** A controlled failure proves business calls stay nonthrowing. */
  failure: Error | undefined
  /** Preserve the borrowed console receiver and all original arguments. */
  log(...args: unknown[]): void {
    if (this.failure) throw this.failure
    this.logs.push(args)
  }
  /** Record warning routing independently of ordinary log output. */
  warn(...args: unknown[]): void {
    this.warnings.push(args)
  }
  /** Record error routing independently of ordinary log output. */
  error(...args: unknown[]): void {
    this.errors.push(args)
  }
}

/** A supplied stdout owns raw writes and can independently fail. */
export class MemoryStdout {
  /** TTY detection is explicit and stable for this fixture. */
  readonly isTTY: boolean
  /** Select a deterministic terminal capability for each output. */
  constructor(isTTY = false) {
    this.isTTY = isTTY
  }
  /** Raw writes preserve exact text including the absence of a newline. */
  readonly writes: string[] = []
  /** The failure instance must reach the host unchanged. */
  failure: Error | undefined
  /** Record or reject the original write without rewriting it. */
  write(text: string): void {
    if (this.failure) throw this.failure
    this.writes.push(text)
  }
}
