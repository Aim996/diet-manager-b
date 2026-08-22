export class BoundedInsertionCache<K, V> {
  readonly #capacity: number;
  readonly #entries = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("BOUNDED_CACHE_CAPACITY_INVALID");
    }
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  set(key: K, value: V): void {
    if (this.#entries.has(key)) {
      this.#entries.set(key, value);
      return;
    }

    this.#entries.set(key, value);
    if (this.#entries.size <= this.#capacity) return;

    const oldest = this.#entries.keys().next();
    if (!oldest.done) this.#entries.delete(oldest.value);
  }
}
