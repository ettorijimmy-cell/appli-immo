import { describe, expect, it } from "vitest";
import { RequestContextService } from "./request-context";

describe("RequestContextService", () => {
  it("getUtilisateurId()/getOrganisationId() renvoient null hors contexte (scripts, tests directs)", () => {
    const service = new RequestContextService();
    expect(service.getUtilisateurId()).toBeNull();
    expect(service.getOrganisationId()).toBeNull();
  });

  it("expose utilisateurId et organisationId posés par executerAvecContexte", () => {
    const service = new RequestContextService();
    service.executerAvecContexte({ utilisateurId: "u1", organisationId: "org-1" }, () => {
      expect(service.getUtilisateurId()).toBe("u1");
      expect(service.getOrganisationId()).toBe("org-1");
    });
  });

  it("organisationId absent du contexte (appelants existants, ~15 tests d'intégration) équivaut à null", () => {
    const service = new RequestContextService();
    service.executerAvecContexte({ utilisateurId: "u1" }, () => {
      expect(service.getOrganisationId()).toBeNull();
    });
  });
});
