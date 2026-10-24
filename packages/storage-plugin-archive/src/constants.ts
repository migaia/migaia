/** Stable wire layout and event names shared by archive writers, readers and observers. */
export const Archive = Object.freeze({
  backend: 'archive',
  root: '$archive',
  blobPrefix: 'archive:',
  lineFeed: '\n',
  control: 'control',
  manifest: 'manifest',
  segment: 'segment',
  version: 1,
  segmentBytes: 1_048_576,
  pageSize: 100,
  format: 'migaia-archive',
  compression: 'gzip',
  contentType: 'application/x-ndjson',
  /** Flat extension names append these stable suffixes to the configured plugin id. */
  runSuffix: 'Run',
  /** Read function suffix shared by runtime publication and the public mapped type. */
  getSuffix: 'Get',
  /** Cleanup function suffix shared by runtime publication and the public mapped type. */
  sweepSuffix: 'Sweep',
  run: 'archive.run',
  get: 'archive.get',
  sweep: 'archive.sweep',
  beforeRun: 'beforeArchiveRun',
  afterRun: 'afterArchiveRun',
  runError: 'onArchiveRunError',
  afterRestore: 'afterArchiveRestore',
  afterSweep: 'afterArchiveSweep'
} as const)
