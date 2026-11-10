import { describe, expect, it } from "vitest";
import { fromBase64 } from "./builds";

describe("fromBase64", () => {
  it("returns every byte value unchanged", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = btoa(String.fromCharCode(...bytes));
    expect(fromBase64(text)).toEqual(bytes);
  });

  it("decodes an empty file", () => {
    expect(fromBase64("")).toEqual(new Uint8Array(0));
  });

  it("decodes a blueprint-sized file", () => {
    // 12 MB took over 300 MB of heap with Uint8Array.from(string, fn), past a Worker's 128 MB.
    const size = 12 * 1024 * 1024;
    const text = btoa("\x07".repeat(size));
    const bytes = fromBase64(text);
    expect(bytes.length).toBe(size);
    expect(bytes[0]).toBe(7);
    expect(bytes[size - 1]).toBe(7);
  });
});
