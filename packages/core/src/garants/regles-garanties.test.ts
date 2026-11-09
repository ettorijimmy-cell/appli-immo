import { describe, expect, it } from "vitest";
import {
  resoudreLocataireGaranti,
  verifierGarantiesBail,
  type ContexteGarantiesBail,
  type GarantPourRegles,
  type StatutEtudes
} from "./regles-garanties";

const caution = (id: string, locataireId: string | null = null): GarantPourRegles => ({
  id,
  typeGarantie: "personne_physique",
  locataireId,
  numeroContratVisale: null
});
const visale = (id: string, numero: string | null = "V0001"): GarantPourRegles => ({
  id,
  typeGarantie: "garantie_visale",
  locataireId: null,
  numeroContratVisale: numero
});

function contexte(surcharges: Partial<ContexteGarantiesBail> = {}): ContexteGarantiesBail {
  return {
    assuranceLoyersImpayes: false,
    bailleur: { type: "personne_physique" },
    locataires: [{ id: "L1", statutEtudes: "aucun" }],
    garants: [],
    ...surcharges
  };
}
const codes = (c: ContexteGarantiesBail) => verifierGarantiesBail(c).map((v) => `${v.garantId}:${v.code}`);

describe("resoudreLocataireGaranti", () => {
  it("« Caution de » renseigné : ce locataire, même s'il n'est plus au bail", () => {
    expect(resoudreLocataireGaranti({ locataireId: "L9" }, [{ id: "L1" }, { id: "L2" }])).toEqual({
      locataireId: "L9",
      source: "caution_de"
    });
  });

  it("bail à un seul locataire : ce locataire", () => {
    expect(resoudreLocataireGaranti({ locataireId: null }, [{ id: "L1" }])).toEqual({
      locataireId: "L1",
      source: "locataire_unique"
    });
  });

  it("colocation sans « Caution de », ou bail sans locataire : absent", () => {
    expect(resoudreLocataireGaranti({ locataireId: null }, [{ id: "L1" }, { id: "L2" }])).toBeNull();
    expect(resoudreLocataireGaranti({ locataireId: null }, [])).toBeNull();
  });
});

describe("verifierGarantiesBail", () => {
  it("aucun garant, ou une caution valide : aucune violation", () => {
    expect(verifierGarantiesBail(contexte())).toEqual([]);
    expect(verifierGarantiesBail(contexte({ garants: [caution("G1")] }))).toEqual([]);
  });

  it("type « autre » refusé", () => {
    expect(codes(contexte({ garants: [{ ...caution("G1"), typeGarantie: "autre" }] }))).toEqual([
      "G1:type_autre_refuse"
    ]);
  });

  describe("Visale", () => {
    it("seul, bail à un locataire, numéro renseigné : valide", () => {
      expect(verifierGarantiesBail(contexte({ garants: [visale("V1")] }))).toEqual([]);
    });

    it("pas seul garant du bail", () => {
      expect(codes(contexte({ garants: [visale("V1"), caution("G2")] }))).toEqual(["V1:visale_pas_seul_garant"]);
    });

    it("interdit sur un bail à plusieurs locataires", () => {
      const c = contexte({
        locataires: [
          { id: "L1", statutEtudes: "aucun" },
          { id: "L2", statutEtudes: "aucun" }
        ],
        garants: [visale("V1")]
      });
      expect(codes(c)).toEqual(["V1:visale_colocation"]);
    });

    it("numéro de contrat requis (null ou blanc)", () => {
      expect(codes(contexte({ garants: [visale("V1", null)] }))).toEqual(["V1:visale_numero_contrat_manquant"]);
      expect(codes(contexte({ garants: [visale("V1", "  ")] }))).toEqual(["V1:visale_numero_contrat_manquant"]);
    });

    it("les règles 22-1 ne s'appliquent pas à Visale", () => {
      const c = contexte({
        assuranceLoyersImpayes: true,
        bailleur: { type: "sci", estFamiliale: false },
        garants: [visale("V1")]
      });
      expect(verifierGarantiesBail(c)).toEqual([]);
    });
  });

  describe("colocation", () => {
    const deuxLocataires = [
      { id: "L1", statutEtudes: "aucun" as StatutEtudes },
      { id: "L2", statutEtudes: "aucun" as StatutEtudes }
    ];

    it("caution sans « Caution de » : violation", () => {
      expect(codes(contexte({ locataires: deuxLocataires, garants: [caution("G1")] }))).toEqual([
        "G1:caution_sans_locataire_garanti"
      ]);
    });

    it("caution avec « Caution de » : valide", () => {
      expect(verifierGarantiesBail(contexte({ locataires: deuxLocataires, garants: [caution("G1", "L2")] }))).toEqual(
        []
      );
    });
  });

  describe("art. 22-1 : assurance loyers impayés", () => {
    it.each<[StatutEtudes, boolean]>([
      ["aucun", true],
      ["non_renseigne", true],
      ["etudiant_boursier", false],
      ["etudiant_non_boursier", false],
      ["apprenti", false]
    ])("locataire garanti %s → bloquée : %s", (statut, bloquee) => {
      const c = contexte({
        assuranceLoyersImpayes: true,
        locataires: [{ id: "L1", statutEtudes: statut }],
        garants: [caution("G1")]
      });
      expect(codes(c)).toEqual(bloquee ? ["G1:caution_interdite_assurance_loyers_impayes"] : []);
    });

    it("statut non renseigné : le message invite à le renseigner", () => {
      const c = contexte({
        assuranceLoyersImpayes: true,
        locataires: [{ id: "L1", statutEtudes: "non_renseigne" }],
        garants: [caution("G1")]
      });
      expect(verifierGarantiesBail(c)[0]?.message).toMatch(/n'est pas renseigné : à renseigner/);
    });

    it("statut « aucun » : pas d'invitation", () => {
      const c = contexte({ assuranceLoyersImpayes: true, garants: [caution("G1")] });
      expect(verifierGarantiesBail(c)[0]?.message).not.toMatch(/à renseigner/);
    });
  });

  describe("art. 22-1 : bailleur SCI non familiale", () => {
    it.each<[StatutEtudes, boolean]>([
      ["aucun", true],
      ["non_renseigne", true],
      ["etudiant_boursier", true],
      ["apprenti", true],
      ["etudiant_non_boursier", false]
    ])("locataire garanti %s → bloquée : %s", (statut, bloquee) => {
      const c = contexte({
        bailleur: { type: "sci", estFamiliale: false },
        locataires: [{ id: "L1", statutEtudes: statut }],
        garants: [caution("G1")]
      });
      expect(codes(c)).toEqual(bloquee ? ["G1:caution_interdite_sci_non_familiale"] : []);
    });

    it("SCI familiale ou bailleur personne physique : aucune restriction", () => {
      expect(
        verifierGarantiesBail(contexte({ bailleur: { type: "sci", estFamiliale: true }, garants: [caution("G1")] }))
      ).toEqual([]);
      expect(verifierGarantiesBail(contexte({ garants: [caution("G1")] }))).toEqual([]);
    });

    it("SCI familiale non renseignée : une seule violation commune, à renseigner", () => {
      const c = contexte({ bailleur: { type: "sci", estFamiliale: null }, garants: [caution("G1"), caution("G2")] });
      expect(codes(c)).toEqual(["null:sci_familiale_non_renseignee"]);
    });

    it("SCI familiale non renseignée sans caution personne physique : rien à signaler", () => {
      expect(
        verifierGarantiesBail(contexte({ bailleur: { type: "sci", estFamiliale: null }, garants: [visale("V1")] }))
      ).toEqual([]);
    });
  });

  it("cumul des règles et libellés « Garant n »", () => {
    const c = contexte({
      assuranceLoyersImpayes: true,
      bailleur: { type: "sci", estFamiliale: false },
      locataires: [
        { id: "L1", statutEtudes: "etudiant_boursier" },
        { id: "L2", statutEtudes: "aucun" }
      ],
      garants: [caution("G1", "L1"), caution("G2")]
    });
    const violations = verifierGarantiesBail(c);
    expect(violations.map((v) => `${v.garantId}:${v.code}`)).toEqual([
      "G1:caution_interdite_sci_non_familiale",
      "G2:caution_sans_locataire_garanti",
      "G2:caution_interdite_assurance_loyers_impayes",
      "G2:caution_interdite_sci_non_familiale"
    ]);
    expect(violations[0]?.message).toMatch(/^Garant 1 — /);
    expect(violations[1]?.message).toMatch(/^Garant 2 — /);
  });

  it("un seul garant : libellé « Garant » sans numéro", () => {
    const c = contexte({ garants: [{ ...caution("G1"), typeGarantie: "autre" }] });
    expect(verifierGarantiesBail(c)[0]?.message).toMatch(/^Garant — /);
  });
});
