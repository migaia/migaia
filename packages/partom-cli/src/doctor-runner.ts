/**
 * Doctor-only entry. `build:exe` bundles it into `dist/doctor-runner.js` and embeds that file in
 * the executable; the executable runs it as plain Bun (see `delegate.ts`), where scoped, symlinked
 * project packages resolve normally. It imports no native addon, so the bundle is one JS file.
 */
import { failureExit, parseArgs } from './args.ts'
import { doctorCommand } from './doctor-command.ts'

/** Runs `partom doctor` with the given argv (including the `doctor` command name). */
async function runDoctor(argv: readonly string[]): Promise<number> {
  try {
    return await doctorCommand(parseArgs(argv))
  } catch (error) {
    return failureExit(error)
  }
}

process.exit(await runDoctor(process.argv.slice(2)))
