import { join, resolve } from 'node:path'
import { resolveProjectNode } from '../lib/project-node.ts'
import { runProjectCommand } from '../lib/project-command.ts'

const [cwdArg, ...argv] = process.argv.slice(2)
if (!cwdArg || !argv.length) throw new Error('Uso: project-command <cwd> <programa> [argumentos...]')
const cwd = resolve(cwdArg)
const resolution = resolveProjectNode(cwd)
if (resolution.status !== 'resolved' || !resolution.runtime?.project)
  throw new Error(resolution.diagnostic ?? 'Runtime do projeto indisponível')
if (resolution.runtime.warning) process.stderr.write(`${resolution.runtime.warning}\n`)
const result = await runProjectCommand(
  {
    id: argv[0],
    cwd,
    argv,
    timeoutMs: Number(process.env.MEGA_BRAIN_COMMAND_TIMEOUT_MS) || 15 * 60_000,
    ...(process.env.MEGA_BRAIN_CARD_PATH?.trim()
      ? { recordFile: join(process.env.MEGA_BRAIN_CARD_PATH.trim(), 'project-command-runs.jsonl') }
      : {}),
  },
  resolution.runtime.project,
)
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
if (result.status !== 'passed')
  process.exitCode = result.status === 'timeout' ? 124 : result.status === 'cancelled' ? 130 : (result.code ?? 1)
