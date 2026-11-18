/** Native addon files embedded into the executable resolve to their path inside it. */
declare module '*.node' {
  /** Path of the embedded file. */
  const path: string
  export default path
}
