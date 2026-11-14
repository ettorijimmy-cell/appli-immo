import { describe, expect, it } from "vitest";
import { aujourdHuiParis } from "./date-paris";

describe("aujourdHuiParis", () => {
  it("donne la date AAAA-MM-JJ à Paris", () => {
    expect(aujourdHuiParis(new Date("2026-11-13T10:00:00Z"))).toBe("2026-11-13");
  });

  it("passe au lendemain à minuit heure de Paris, pas à minuit UTC (hiver, UTC+1)", () => {
    expect(aujourdHuiParis(new Date("2026-11-13T22:59:00Z"))).toBe("2026-11-13");
    expect(aujourdHuiParis(new Date("2026-11-13T23:01:00Z"))).toBe("2026-11-14");
  });

  it("été (UTC+2)", () => {
    expect(aujourdHuiParis(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });
});
