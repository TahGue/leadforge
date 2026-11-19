import { beforeEach, describe, expect, it } from "vitest";
import { cached, clearCache } from "@/lib/cache";

describe("cached", () => {
  beforeEach(() => clearCache());

  it("serves a hit within the TTL and reloads after it", async () => {
    let calls = 0;
    const load = async () => ++calls;
    expect(await cached("k", 1_000, load, 0)).toBe(1);
    expect(await cached("k", 1_000, load, 500)).toBe(1);
    expect(await cached("k", 1_000, load, 1_001)).toBe(2);
  });

  it("keeps organizations apart by key", async () => {
    expect(await cached("org-a", 1_000, async () => "a", 0)).toBe("a");
    expect(await cached("org-b", 1_000, async () => "b", 0)).toBe("b");
  });

  it("does not cache failures", async () => {
    await expect(cached("f", 1_000, async () => Promise.reject(new Error("db down")), 0)).rejects.toThrow("db down");
    expect(await cached("f", 1_000, async () => "ok", 1)).toBe("ok");
  });
});
