/**
 * The commands of the scripts of the studio.
 *
 * The runtime of Bun names the code of the exit of a command
 * `exitCode`, and the types of the runtime name it `status`: a command
 * that is checked with the wrong name is a command that is always a
 * failure. The helper reads the code of the exit of a command, whatever
 * the name it carries.
 */

/** The answer of a command that ran. */
export interface CommandResult {
  readonly status?: number | null
  readonly exitCode?: number | null
}

/**
 * The code of the exit of a command.
 *
 * It is the code of the runtime when it has one, and the code of the
 * types when it does not: a command that ran and failed is a failure,
 * and a command that never ran is a failure too.
 */
export function exitCodeOf(result: CommandResult): number {
  return result.exitCode ?? result.status ?? 1
}
