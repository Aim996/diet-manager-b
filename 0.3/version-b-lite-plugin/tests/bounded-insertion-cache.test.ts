import { describe, expect, it } from "vitest";

import { BoundedInsertionCache } from "../src/openclaw/bounded-insertion-cache.js";

describe("bounded insertion-order cache", () => {
  it("evicts the oldest insertion at capacity without refreshing it on retry reads", () => {
    const cache = new BoundedInsertionCache<string, number>(2);
    cache.set("oldest", 1);
    cache.set("newer", 2);

    expect(cache.get("oldest")).toBe(1);
    cache.set("newest", 3);

    expect(cache.size).toBe(2);
    expect(cache.get("oldest")).toBeUndefined();
    expect(cache.get("newer")).toBe(2);
    expect(cache.get("newest")).toBe(3);
  });

  it("updates an existing key without evicting another entry or changing insertion order", () => {
    const cache = new BoundedInsertionCache<string, number>(2);
    cache.set("first", 1);
    cache.set("second", 2);
    cache.set("first", 10);

    expect(cache.size).toBe(2);
    expect(cache.get("first")).toBe(10);
    cache.set("third", 3);
    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe(2);
    expect(cache.get("third")).toBe(3);
  });

  it("rejects an invalid capacity instead of becoming accidentally unbounded", () => {
    expect(() => new BoundedInsertionCache(0)).toThrow("BOUNDED_CACHE_CAPACITY_INVALID");
    expect(() => new BoundedInsertionCache(1.5)).toThrow("BOUNDED_CACHE_CAPACITY_INVALID");
  });
});
