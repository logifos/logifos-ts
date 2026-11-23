import { describe, it, expect } from "vitest";
import { render, NotImplementedError } from "../src/index";

describe("render", () => {
  it("refuses until the engine boundary lands", () => {
    expect(() => render({})).toThrow(NotImplementedError);
  });
});
