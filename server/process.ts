import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type ExecFileSyncOptions,
  type SpawnOptions,
} from 'node:child_process'

/**
 * Boundary for every child process owned by the HTTP services.  Keeping this
 * small makes command construction visible and lets tests supply a fake
 * without ever starting Claude, Git, Jira's gh client, or desktop programs.
 */
export interface ProcessRunner {
  spawn(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess
  execFileSync(command: string, args: readonly string[], options?: ExecFileSyncOptions): string | Buffer
  execFile(
    command: string,
    args: readonly string[],
    options: ExecFileOptions,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): void
}

export const nodeProcessRunner: ProcessRunner = {
  spawn(command, args, options) {
    return options ? spawn(command, [...args], options) : spawn(command, [...args])
  },
  execFileSync(command, args, options) {
    return execFileSync(command, [...args], options)
  },
  execFile(command, args, options, callback) {
    execFile(command, [...args], options, (error, stdout, stderr) =>
      callback(error, String(stdout ?? ''), String(stderr ?? '')),
    )
  },
}

export type ProcessChild = ChildProcess

/**
 * Registry for processes that were launched by this backend instance.  This is
 * deliberately opt-in: terminal, browser and Cursor launches are external
 * user sessions and must never be registered here.
 */
export interface ProcessOwner {
  own(child: ProcessChild, options?: { tree?: boolean; label?: string }): ProcessChild
  stop(child: ProcessChild): Promise<void>
  shutdown(): Promise<void>
  readonly size: number
}

export interface ProcessOwnerOptions {
  timeoutMs?: number
  /** Injectable so lifecycle tests never send an OS signal. */
  signalTree?: (pid: number, signal: NodeJS.Signals) => void
  setTimeout?: typeof globalThis.setTimeout
}

export function createProcessOwner(options: ProcessOwnerOptions = {}): ProcessOwner {
  const children = new Map<ProcessChild, { tree: boolean }>()
  const timeoutMs = options.timeoutMs ?? 5_000
  const schedule = options.setTimeout ?? globalThis.setTimeout
  let closing: Promise<void> | undefined
  const forget = (child: ProcessChild) => {
    children.delete(child)
  }
  const waitForExit = (child: ProcessChild) =>
    new Promise<void>((resolve) => {
      if (
        (child.exitCode !== null && child.exitCode !== undefined) ||
        (child.signalCode !== null && child.signalCode !== undefined)
      )
        return resolve()
      const timer = schedule(() => resolve(), timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      child.once('error', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  const signal = (child: ProcessChild, value: NodeJS.Signals) => {
    const entry = children.get(child)
    try {
      // Detached dev/stage processes have their own process group.  The group
      // belongs to us because we created its leader; never infer a PID from a
      // persisted state file or attach to a pre-existing process.
      if (entry?.tree && child.pid && options.signalTree) options.signalTree(child.pid, value)
      else child.kill(value)
    } catch {
      /* A child can disappear between snapshot and signal. */
    }
  }
  return {
    own(child, metadata = {}) {
      children.set(child, { tree: metadata.tree === true })
      child.once('exit', () => forget(child))
      child.once('close', () => forget(child))
      child.once('error', () => forget(child))
      return child
    },
    get size() {
      return children.size
    },
    async stop(child) {
      if (!children.has(child)) return
      signal(child, 'SIGTERM')
      await waitForExit(child)
      if (children.has(child)) signal(child, 'SIGKILL')
      children.delete(child)
    },
    shutdown() {
      if (closing) return closing
      closing = (async () => {
        const snapshot = [...children.keys()]
        for (const child of snapshot) signal(child, 'SIGTERM')
        await Promise.all(snapshot.map(waitForExit))
        // A TERM-resistant child is still ours. Escalate only that recorded
        // child/group, never a PID read from disk or an external session.
        for (const child of [...children.keys()]) signal(child, 'SIGKILL')
        children.clear()
      })()
      return closing
    },
  }
}

/** Wrap a runner only where every spawned command is backend-owned (dev-env). */
export function createOwnedProcessRunner(runner: ProcessRunner, owner: ProcessOwner): ProcessRunner {
  return {
    ...runner,
    spawn(command, args, options) {
      return owner.own(runner.spawn(command, args, options), { tree: options?.detached === true, label: command })
    },
  }
}
