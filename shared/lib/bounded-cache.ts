/** Retain recent entries without letting a long-lived process accumulate every key. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>()

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Cache limit must be a positive integer')
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key)!
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
  }

  delete(key: K): void {
    this.entries.delete(key)
  }

  prune(predicate: (value: V, key: K) => boolean): void {
    for (const [key, value] of this.entries) if (predicate(value, key)) this.entries.delete(key)
  }
}
