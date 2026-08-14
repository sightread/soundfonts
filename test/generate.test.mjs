import { describe, it, expect } from "bun:test";

import { resolveProgram } from "../scripts/generate.mjs";

describe("resolveProgram", () => {
  it("resolves a GM instrument name by table position", () => {
    expect(resolveProgram("violin")).toEqual({ bank: 0, program: 40 });
  });

  it("resolves percussion to the GM percussion bank", () => {
    expect(resolveProgram("percussion")).toEqual({ bank: 128, program: 0 });
  });

  it("returns null for a name found nowhere", () => {
    expect(resolveProgram("not_a_real_instrument")).toBeNull();
  });
});
