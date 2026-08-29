/** Stable reactive diagnostics and public error messages owned by this package. */
export const ReactiveErrorText = {
  /** Identifies the option getter that failed before Runtime state allocation. */
  runtimeOptionGetterFailed: (option: string): string => `runtime option "${option}" getter failed`,
  /** Identifies the adapter method getter that failed during Runtime admission. */
  runtimeAdapterGetterFailed: (method: string): string =>
    `runtime adapter "${method}" getter failed`,
  /** Identifies the adapter method that violated the callable adapter contract. */
  runtimeAdapterMustBeFunction: (method: string): string =>
    `runtime adapter "${method}" must be a function`,
  /** Identifies the Runtime option that violated its callable option contract. */
  runtimeOptionMustBeFunction: (option: string): string =>
    `runtime option "${option}" must be a function`,
  /** Explains the accepted domain for the flush-loop guard. */
  maxFlushPassesInvalid: 'maxFlushPasses must be a positive integer',
  /** Explains the accepted VersionClock constructor bound. */
  maximumReactiveVersionInvalid: 'maximum reactive version must be a positive safe integer',
  /** Explains invalid traced action names at the Runtime boundary. */
  tracedActionNameInvalid: 'traced action name must be a non-empty string',
  /** Explains why a signal cannot be used after disposal. */
  disposedSignal: 'cannot use a disposed signal',
  /** Explains why an extension field source cannot be used after disposal. */
  disposedFieldSource: 'reactive field source is disposed',
  /** Explains why a computed value cannot be read after disposal. */
  disposedComputed: 'cannot read a disposed computed',
  /** Explains a self-dependent computed derivation. */
  circularComputedDependency: 'circular computed dependency detected',
  /** Explains a node claimed by a second Runtime. */
  ownershipConflict: 'this node is already owned by another Runtime',
  /** Describes a value owned by a different Runtime scope. */
  belongsToDifferentRuntime: (what: string): string =>
    `${what} belongs to a different Runtime than this scope`,
  /** Describes an unregistered value at a reactive graph boundary. */
  notRuntimeOwned: (what: string): string => `${what} is not a Runtime-owned reactive node`,
  /** Describes a node belonging to another Runtime. */
  belongsToAnotherRuntime: (what: string): string => `${what} belongs to another Runtime`,
  /** Explains duplicate internal registration for a Runtime. */
  internalsAlreadyRegistered: 'runtime internals are already registered',
  /** Explains use of an object that did not come from createRuntime(). */
  runtimeNotCreatedByFactory: 'this object is not a Runtime created by createRuntime()',
  /** Explains duplicate observation registration on one binding. */
  observerBindingAlreadyObserved: 'observer binding is already observed',
  /** Explains a cross-Runtime dependency read during tracking. */
  crossRuntimeDependency:
    'cross-runtime dependency is not allowed: a node was read while a node from another runtime was being tracked',
  /** Explains capture commit against a different Runtime tracker. */
  captureDifferentRuntime: 'cannot commit a capture to an observer from another runtime',
  /** Explains capture commit against a disposed observer. */
  captureDisposedObserver: 'cannot commit a capture to a disposed observer',
  /** Explains an invalid, consumed, or foreign capture token. */
  captureInvalid: 'capture is invalid, already consumed, or belongs to another tracker',
  /** Explains an incompatible global copy registry. */
  copyRegistryInvalid: 'runtime copy registry is incompatible or corrupted',
  /** Explains an object branded by another library copy. */
  foreignCopyValue: 'this value was created by a different copy of this library',
  /** Explains a foreign branded value and the remediation. */
  foreignCopyDependency:
    'this value was created by a different copy of this library; deduplicate the dependency',
  /** Explains a corrupted ownership brand. */
  ownershipBrandCorrupted: 'reactive ownership brand is corrupted',
  /** Explains why duplicate library copies are dangerous. */
  multipleCopiesWarning:
    'more than one copy of this library is live in this process. ' +
    'Ownership tables and the synchronous tracking context are per copy, so: ' +
    'nodes created by one copy are rejected as foreign by the other, and ' +
    'cross-runtime dependency reads between copies are not detected. ' +
    'Deduplicate the dependency, or call assertSingleRuntimeCopy() to fail loudly.',
  /** Reports the number of copies found by the explicit single-copy assertion. */
  expectedSingleCopy: (count: number): string =>
    `expected a single copy of this library, found ${count}`,
  /** Explains the version clock terminal state and recovery action. */
  versionClockExhausted: 'reactive version clock exhausted; stop writes and create a fresh Runtime',
  /** Explains the callable-only scheduler strategy contract at the Runtime boundary. */
  schedulerStrategyInvalid: 'scheduler strategy must be a function',
  /** Explains why a strategy return value cannot participate in synchronous scheduling. */
  schedulerStrategyReturnedThenable: 'scheduler strategy must return void',
  /** Explains why synchronous callbacks cannot return PromiseLike values. */
  synchronousCallbackReturnedThenable: (callback: string): string =>
    `${callback} must return void; PromiseLike results are not supported`,
  /** Explains observer failures preceding the flush-loop guard. */
  observersBeforeFlushLoop: 'observers failed before the flush-loop guard fired',
  /** Explains multiple observer failures in one flush. */
  multipleObserversFailed: 'multiple observers failed during flush',
  /** Explains a pre-existing action cause combined with a later flush failure. */
  actionCauseAndFlushFailed: 'action cause and subsequent flush both failed',
  /** Explains an action failure combined with a later flush failure. */
  actionAndFlushFailed: 'action failed; a subsequent flush also failed',
  /** Explains multiple observable lifecycle hook failures. */
  multipleLifecycleHooksFailed: 'multiple observable lifecycle hooks failed',
  /** Builds the bounded flush-loop diagnostic while retaining dropped-item detail. */
  flushLoopDetected: (maxPasses: number, droppedCount: number, names: string[]): string =>
    'possible infinite effect loop: exceeded ' +
    maxPasses +
    ' flush passes; dropped ' +
    droppedCount +
    ' pending item(s): ' +
    names.join(', ') +
    (droppedCount > names.length ? ', …' : '')
} as const

export type IReactiveErrorText = string
