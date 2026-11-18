/** Native addon files embedded into the executable resolve to their path inside it. */
declare module '*.node' {
  /** Path of the embedded file. */
  const path: string
  export default path
}

/**
 * The doctor runner bundle (`dist/doctor-runner.js`, written by `build:exe`) embedded into the
 * executable; resolves to its path inside it.
 */
declare module '*preview-runtime.js' {
  /** Path of the embedded pre-bundled preview page runtime (`dist/preview-runtime.js`). */
  const path: string
  export default path
}

declare module '*doctor-runner.js' {
  /** Path of the embedded file. */
  const path: string
  export default path
}
