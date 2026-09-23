/**
 * Small runtime seams for code whose outcome depends on the machine instead of
 * an HTTP request.  They intentionally cover only clock reads and text-file
 * reads; workspace operations retain Node's filesystem APIs because their
 * real-path and symlink guarantees are security-sensitive.
 */
export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

export interface TextFileReader {
  readText(path: string): string
}
