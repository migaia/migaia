/** Stable control and business names are shared by both Chromium sides and the trace reader. */
export const BrowserBenchText = Object.freeze({
  /** Preparation cannot substitute driver resources for absent endpoint mapping. */
  missing: 'Browser endpoint PID mapping unavailable',
  /** Native resource counters must stay monotonic during one actual browser window. */
  cpu: 'Browser PID observation incomplete',
  /** Both browser endpoints register this same business echo method. */
  echo: 'bench.echo',
  /** The separate control port signals provider readiness before warmup. */
  ready: 'ready',
  /** The separate control port asks the Worker to mark its actual host thread. */
  mark: 'mark',
  /** The pre-window trace binds the page endpoint to its renderer PID and thread. */
  pageMark: 'da1-page-target',
  /** The pre-window trace binds the Worker endpoint to its host PID and thread. */
  workerMark: 'da1-worker-target',
  /** An echo payload mismatch invalidates this side instead of yielding a timing verdict. */
  mismatch: 'browser benchmark echo mismatch',
  /** The existing rejection hook supplies semantic classification after formal timing. */
  rejected: 'provider rejection event'
})
