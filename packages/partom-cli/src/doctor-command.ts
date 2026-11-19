import { ExitCode, flag, type IArgs } from './args.ts'
import { formatJson, formatText, runDoctor } from './doctor.ts'
import { Project } from './project.ts'
import { collectRelease } from './release/collect.ts'
import { DEFAULT_BUILD_NAME, ReleaseMode } from './release/text.ts'

/**
 * Runs `partom doctor` and prints its result. Returns `1` when any issue is an error, `0`
 * otherwise; configuration and environment failures propagate to the caller.
 */
export async function doctorCommand(args: IArgs): Promise<number> {
  /** Project rooted at the current directory or `--project`. */
  const project = new Project(flag(args, '--project') ?? process.cwd())
  /** Internal release switch, when a release command runs this child. */
  const mode = Object.values(ReleaseMode).find((name) => args.flags.has(name))
  if (mode !== undefined) {
    console.log(
      JSON.stringify(
        await collectRelease(
          project,
          flag(args, '--config'),
          mode,
          flag(args, '--build') ?? DEFAULT_BUILD_NAME
        )
      )
    )
    return ExitCode.ok
  }
  /** Doctor result. */
  const result = await runDoctor(project, {
    config: flag(args, '--config'),
    rendered: args.flags.has('--rendered'),
    only: flag(args, '--only'),
    browser: flag(args, '--browser'),
    types: args.flags.has('--types')
  })
  console.log(
    args.flags.has('--json')
      ? formatJson(result, args.flags.has('--blueprints'))
      : formatText(result)
  )
  return result.issues.some((issue) => issue.severity === 'error') ? ExitCode.problems : ExitCode.ok
}
