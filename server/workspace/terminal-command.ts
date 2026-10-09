import { resolveOptionalExecutable } from '../platform'

/** Keep agent arguments as positional data, including prompts containing shell syntax. */
export function terminalCommand(args: string[], shell: string | undefined): string[] {
  if (!shell?.trim()) return args
  const executable = resolveOptionalExecutable({ configured: shell.trim(), candidates: [], label: 'Shell' })
  return [executable, '-lc', 'exec "$@"', 'mega-brain', ...args]
}
