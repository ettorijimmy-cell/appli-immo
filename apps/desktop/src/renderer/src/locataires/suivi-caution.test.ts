import { describe, expect, it } from "vitest";
import type { BailLocataire, EngagementCaution, Garant, SuiviCaution } from "./api";
import {
  LIBELLE_AVERTISSEMENT_REMISE_NON_DECLAREE,
  libelleEngagement,
  libelleFinEngagementColocation,
  libelleRemiseBail,
  lienRetireDuGaranti,
  lignesRemiseNonDeclaree,
  MENTION_REMISE_NON_DECLAREE,
  proposerDateEffetConge
} from "./suivi-caution";

const caution: Garant = {
  id: "g1",
  bailId: "b1",
  nom: "Durand",
  prenom: "Claire",
  email: null,
  telephone: null,
  typeGarantie: "personne_physique",
  numeroContratVisale: null,
  adresse: null,
  codePostal: null,
  ville: null,
  dateNaissance: null,
  lieuNaissance: null,
  nationalite: null,
  locataireId: null,
  archivedAt: null
};

const engagement: EngagementCaution = { dateFinEngagement: "2035-06-30", motifIndisponible: null, colocation: null };

function suivi(active: boolean): SuiviCaution {
  return {
    remise: {
      active: active
        ? { id: "r1", dateRemise: "2026-06-20", mode: "main_propre", declareeLe: "2026-06-20T10:00:00Z", declareePar: "u1", archivedAt: null }
        : null,
      historique: []
    },
    engagement
  };
}

describe("textes du suivi de la caution", () => {
  it("mention orange quand rien n'est déclaré", () => {
    expect(MENTION_REMISE_NON_DECLAREE).toBe(
      "Non déclarée — un exemplaire du bail doit être remis à la caution (loi n° 89-462, art. 22-1)"
    );
  });

  it("remise déclarée : date courte et libellé du mode", () => {
    expect(libelleRemiseBail({ dateRemise: "2026-06-20", mode: "main_propre" })).toBe("Remis le 20/06/2026 (En main propre)");
    expect(libelleRemiseBail({ dateRemise: "2026-06-21", mode: "lettre_recommandee" })).toBe(
      "Remis le 21/06/2026 (Lettre recommandée)"
    );
    expect(libelleRemiseBail({ dateRemise: "2026-06-22", mode: "courrier_simple" })).toBe("Remis le 22/06/2026 (Courrier simple)");
    expect(libelleRemiseBail({ dateRemise: "2026-06-23", mode: "email" })).toBe("Remis le 23/06/2026 (E-mail)");
  });

  it("engagement : date de fin, ou motif quand elle n'est pas calculable", () => {
    expect(libelleEngagement(engagement)).toBe("Engagement jusqu'au 30/06/2035");
    expect(
      libelleEngagement({ dateFinEngagement: null, motifIndisponible: "Caractère familial non renseigné.", colocation: null })
    ).toBe("Caractère familial non renseigné.");
  });

  it("colocation : rien sans congé, la règle et les deux dates avec", () => {
    expect(libelleFinEngagementColocation(engagement)).toBeNull();
    expect(
      libelleFinEngagementColocation({
        ...engagement,
        colocation: { dateEffetConge: "2027-03-15", siRemplace: "2027-03-15", auPlusTard: "2027-09-15" }
      })
    ).toBe(
      "Engagement terminé à la date d'effet du congé (15/03/2027) si un nouveau colocataire a été ajouté au bail, sinon au plus tard le 15/09/2027"
    );
  });
});

describe("lignesRemiseNonDeclaree", () => {
  it("une ligne par caution sans déclaration, bail signé, avec le nom de la caution", () => {
    const autre = { ...caution, id: "g2", nom: "Petit", prenom: "Marc" };
    const suivis = new Map([
      ["g1", suivi(false)],
      ["g2", suivi(false)]
    ]);
    expect(lignesRemiseNonDeclaree({ statut: "actif" }, [caution, autre], suivis)).toEqual([
      { cle: "remise-g1", libelle: LIBELLE_AVERTISSEMENT_REMISE_NON_DECLAREE, lieu: "Claire Durand" },
      { cle: "remise-g2", libelle: LIBELLE_AVERTISSEMENT_REMISE_NON_DECLAREE, lieu: "Marc Petit" }
    ]);
  });

  it("rien en brouillon, rien si déclarée, rien pour Visale, un garant archivé ou un suivi illisible", () => {
    const suivis = new Map([["g1", suivi(false)]]);
    expect(lignesRemiseNonDeclaree({ statut: "brouillon" }, [caution], suivis)).toEqual([]);
    expect(lignesRemiseNonDeclaree({ statut: "actif" }, [caution], new Map([["g1", suivi(true)]]))).toEqual([]);
    expect(lignesRemiseNonDeclaree({ statut: "actif" }, [{ ...caution, typeGarantie: "garantie_visale" }], suivis)).toEqual([]);
    expect(lignesRemiseNonDeclaree({ statut: "actif" }, [{ ...caution, archivedAt: "2026-11-01T00:00:00Z" }], suivis)).toEqual([]);
    expect(lignesRemiseNonDeclaree({ statut: "actif" }, [caution], new Map())).toEqual([]);
  });
});

describe("proposerDateEffetConge", () => {
  it("colocation, ou date déjà posée (pour la vider)", () => {
    expect(proposerDateEffetConge(2, null)).toBe(true);
    expect(proposerDateEffetConge(1, null)).toBe(false);
    expect(proposerDateEffetConge(1, "2027-03-15")).toBe(true);
  });
});

describe("lienRetireDuGaranti", () => {
  const lien = (id: string, locataireId: string, archivedAt: string | null): BailLocataire => ({
    id,
    bailId: "b1",
    locataireId,
    role: "colocataire",
    dateEffetConge: null,
    archivedAt
  });

  it("colocataire garanti retiré : son lien retiré le plus récent", () => {
    const liens = [
      lien("l1", "loc-2", "2026-01-10T10:00:00Z"),
      lien("l2", "loc-1", null),
      lien("l3", "loc-2", "2026-06-30T10:00:00Z")
    ];
    expect(lienRetireDuGaranti({ locataireId: "loc-2" }, liens)?.id).toBe("l3");
  });

  it("rien si le garanti est encore au bail, inconnu ou non précisé", () => {
    const liens = [lien("l1", "loc-2", "2026-01-10T10:00:00Z"), lien("l2", "loc-2", null)];
    expect(lienRetireDuGaranti({ locataireId: "loc-2" }, liens)).toBeNull();
    expect(lienRetireDuGaranti({ locataireId: "loc-9" }, liens)).toBeNull();
    expect(lienRetireDuGaranti({ locataireId: null }, liens)).toBeNull();
  });
});
