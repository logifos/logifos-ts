import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { render, NotImplementedError } from "../src/index.js";

describe("render", () => {
  it("refuses until the engine boundary lands", () => {
    assert.throws(() => render({}), NotImplementedError);
  });
});
