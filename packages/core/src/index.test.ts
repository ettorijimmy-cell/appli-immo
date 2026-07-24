import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_NAME } from "./index";

describe("core package scaffold", () => {
  it("expose un point d'entrée", () => {
    expect(CORE_PACKAGE_NAME).toBe("core");
  });
});
