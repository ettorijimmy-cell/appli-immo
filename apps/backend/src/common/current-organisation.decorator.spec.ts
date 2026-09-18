import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { resoudreOrganisationCourante } from "./current-organisation.decorator";

function creerContexte(user: { sub: string; email: string; organisationId: string } | undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

describe("resoudreOrganisationCourante", () => {
  it("renvoie organisationId depuis request.user (JWT décodé, jamais un lookup DB)", () => {
    const context = creerContexte({ sub: "u1", email: "a@a.com", organisationId: "org-42" });
    expect(resoudreOrganisationCourante(context)).toBe("org-42");
  });

  it("rejette explicitement si request.user est absent (jamais un organisationId undefined silencieux)", () => {
    const context = creerContexte(undefined);
    expect(() => resoudreOrganisationCourante(context)).toThrow(UnauthorizedException);
  });
});
