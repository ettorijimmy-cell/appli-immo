import { describe, expect, it } from "vitest";
import type { Garant } from "./api";
import { champsGarantDepuis, champsGarantVides, creationGarant, modificationGarant } from "./garant-formulaire";

const garant: Garant = {
  id: "g1",
  bailId: "b1",
  nom: "Martin",
  prenom: "Paul",
  email: null,
  telephone: "0600000000",
  typeGarantie: "garantie_visale",
  dateNaissance: "1970-01-02",
  lieuNaissance: null,
  nationalite: "française",
  archivedAt: null
};

describe("formulaires garant", () => {
  it("champs vides : personne physique par défaut, tout le reste vide", () => {
    expect(champsGarantVides()).toEqual({
      nom: "",
      prenom: "",
      email: "",
      telephone: "",
      typeGarantie: "personne_physique",
      dateNaissance: "",
      lieuNaissance: "",
      nationalite: ""
    });
  });

  it("création : les champs facultatifs vides sont omis", () => {
    const champs = { ...champsGarantVides(), nom: "Martin", prenom: "Paul", telephone: "0600000000" };
    expect(creationGarant("b1", champs)).toEqual({
      bailId: "b1",
      nom: "Martin",
      prenom: "Paul",
      typeGarantie: "personne_physique",
      telephone: "0600000000"
    });
  });

  it("modification : préremplie depuis le garant, null en base devient chaîne vide", () => {
    expect(champsGarantDepuis(garant)).toEqual({
      nom: "Martin",
      prenom: "Paul",
      email: "",
      telephone: "0600000000",
      typeGarantie: "garantie_visale",
      dateNaissance: "1970-01-02",
      lieuNaissance: "",
      nationalite: "française"
    });
  });

  it("modification : un champ vidé est envoyé en null explicite, jamais omis", () => {
    const champs = { ...champsGarantDepuis(garant), telephone: "", nationalite: "" };
    expect(modificationGarant(champs)).toEqual({
      nom: "Martin",
      prenom: "Paul",
      typeGarantie: "garantie_visale",
      email: null,
      telephone: null,
      dateNaissance: "1970-01-02",
      lieuNaissance: null,
      nationalite: null
    });
  });
});
