import { describe, expect, it } from "vitest";
import { requireForkDatabase } from "./fork-stack.js";

describe("fork development database", () => {
  it("refuses the shared integration database before a destructive reset", () => {
    expect(() =>
      requireForkDatabase(
        "postgres://perago:local@127.0.0.1:56432/perago_test",
      ),
    ).toThrow(/perago_fork/u);
  });

  it("refuses a hosted database even when its name matches", () => {
    expect(() =>
      requireForkDatabase("postgres://perago:local@db.example.net/perago_fork"),
    ).toThrow(/local/u);
  });

  it("accepts only the dedicated fork database", () => {
    expect(
      requireForkDatabase(
        "postgres://perago:local@127.0.0.1:56432/perago_fork",
      ),
    ).toBe("postgres://perago:local@127.0.0.1:56432/perago_fork");
  });
});
