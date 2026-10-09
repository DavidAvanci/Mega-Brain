// Reproduce with: node --import tsx docs/performance/audit-2026-10-08.ts
// Only synthetic fixtures in a fresh temporary directory; no agents or network.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createAgentSessionService } from '../../server/agents/service'

const root = mkdtempSync(join(tmpdir(), 'mega-brain-perf-audit-'))
const samples: Record<string, unknown>[] = []
try {
  const claudeProjects = join(root, 'claude-projects')
  const workspaceDir = join(root, 'workspace')
  const worktreesDir = join(root, 'worktrees')
  for (const directory of [claudeProjects, workspaceDir, worktreesDir]) mkdirSync(directory)
  let created = 0
  for (const count of [100, 1000, 5000]) {
    for (; created < count; created++) {
      writeFileSync(
        join(claudeProjects, `${created}.jsonl`),
        JSON.stringify({
          type: 'user',
          sessionId: `synthetic-${created}`,
          cwd: root,
          timestamp: '2026-10-08T12:00:00Z',
          message: { content: 'Synthetic benchmark' },
        }) + '\n',
      )
    }
    const service = createAgentSessionService({
      home: root,
      claudeHome: join(root, 'claude'),
      claudeProjects,
      codexHomes: [join(root, 'codex')],
      workspaceDir,
      worktreesDir,
      processes: () => [],
    })
    const started = performance.now()
    const response = service.list()
    const firstMs = performance.now() - started
    const repeatedMs: number[] = []
    for (let index = 0; index < 5; index++) {
      const before = performance.now()
      service.list()
      repeatedMs.push(performance.now() - before)
    }
    repeatedMs.sort((a, b) => a - b)
    samples.push({
      files: count,
      returned: response.sessions.length,
      firstMs: +firstMs.toFixed(2),
      medianRepeatedMs: +repeatedMs[2].toFixed(2),
    })
  }
  console.log(
    JSON.stringify(
      { benchmark: 'synthetic-agent-session-scan', platform: process.platform, node: process.version, samples },
      null,
      2,
    ),
  )
} finally {
  // Verify the resolved target before deleting the synthetic fixture tree.
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('mega-brain-perf-audit-')) {
    throw new Error('Refusing to remove a path outside the audit temporary directory')
  }
  rmSync(root, { recursive: true, force: true })
}
