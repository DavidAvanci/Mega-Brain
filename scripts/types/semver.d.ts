declare module 'semver' {
  export function validRange(value: string): string | null
  export function satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean
  export function compare(left: string, right: string): number
  export function valid(value: string): string | null
}
