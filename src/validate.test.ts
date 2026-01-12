import { describe, expect, test } from "bun:test";
import { validateQbiFile } from "./validate.js";

describe("validateQbiFile", () => {
  test("accepts a minimal valid file", () => {
    const res = validateQbiFile({
      qbiVersion: "0.1",
      contract: { name: "Test" },
      entries: [
        {
          kind: "function",
          name: "Ping",
          inputType: 1,
          input: { type: "nodata" },
          output: { type: "nodata" },
          inputSize: 1,
          outputSize: 1,
        },
      ],
    });
    expect(res.ok).toBe(true);
  });

  test("rejects invalid shape", () => {
    const res = validateQbiFile({ qbiVersion: "nope" });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
