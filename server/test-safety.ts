/** Optional test hook; production does not install it. */
const WORKSPACE_GUARD = Symbol.for('mega-brain.test-safety.workspace')

export function assertTestWorkspace(path: string): void {
  const guard = (globalThis as Record<symbol, unknown>)[WORKSPACE_GUARD]
  if (typeof guard === 'function') (guard as (candidate: string) => void)(path)
}
