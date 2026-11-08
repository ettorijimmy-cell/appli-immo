import { describe, expect, it } from "vitest";
import type { Garant } from "./api";
import {
  champsGarantDepuis,
  champsGarantVides,
  creationGarant,
  mentionCautionDe,
  modificationGarant,
  optionsCautionDe
} from "./garant-formulaire";

const garant: Garant = {
  id: "g1",
  bailId: "b1",
  nom: "Martin",
  prenom: "Paul",
  email: null,
  telephone: "0600000000",
  typeGarantie: "garantie_visale",
  adresse: "4 rue des Lilas",
  codePostal: "69003",
  ville: null,
  dateNaissance: "1970-01-02",
  lieuNaissance: null,
  nationalite: "française",
  locataireId: "loc-1",
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
      adresse: "",
      codePostal: "",
      ville: "",
      dateNaissance: "",
      lieuNaissance: "",
      nationalite: "",
      locataireId: ""
    });
  });

  it("champs vides depuis la fiche d'un locataire : « Caution de » prérempli avec ce locataire", () => {
    expect(champsGarantVides("loc-1").locataireId).toBe("loc-1");
  });

  it("création : le locataire choisi est envoyé, « Non précisé » est omis", () => {
    const champs = { ...champsGarantVides(), nom: "Martin", prenom: "Paul" };
    expect(creationGarant("b1", { ...champs, locataireId: "loc-1" })).toMatchObject({ locataireId: "loc-1" });
    expect(creationGarant("b1", champs)).not.toHaveProperty("locataireId");
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

  it("création : l'adresse saisie est envoyée", () => {
    const champs = {
      ...champsGarantVides(),
      nom: "Martin",
      prenom: "Paul",
      adresse: "4 rue des Lilas",
      codePostal: "69003",
      ville: "Lyon"
    };
    expect(creationGarant("b1", champs)).toMatchObject({ adresse: "4 rue des Lilas", codePostal: "69003", ville: "Lyon" });
  });

  it("modification : préremplie depuis le garant, null en base devient chaîne vide", () => {
    expect(champsGarantDepuis(garant)).toEqual({
      nom: "Martin",
      prenom: "Paul",
      email: "",
      telephone: "0600000000",
      typeGarantie: "garantie_visale",
      adresse: "4 rue des Lilas",
      codePostal: "69003",
      ville: "",
      dateNaissance: "1970-01-02",
      lieuNaissance: "",
      nationalite: "française",
      locataireId: "loc-1"
    });
  });

  it("modification : un champ vidé est envoyé en null explicite, jamais omis", () => {
    const champs = { ...champsGarantDepuis(garant), telephone: "", nationalite: "", adresse: "" };
    expect(modificationGarant(champs)).toEqual({
      nom: "Martin",
      prenom: "Paul",
      typeGarantie: "garantie_visale",
      email: null,
      telephone: null,
      adresse: null,
      codePostal: "69003",
      ville: null,
      dateNaissance: "1970-01-02",
      lieuNaissance: null,
      nationalite: null,
      locataireId: "loc-1"
    });
  });

  it("modification : « Non précisé » est envoyé en null pour effacer le lien", () => {
    expect(modificationGarant({ ...champsGarantDepuis(garant), locataireId: "" }).locataireId).toBeNull();
  });
});

describe("« Caution de »", () => {
  const locatairesDuBail = [
    { id: "loc-1", prenom: "Lucie", nom: "Bernard" },
    { id: "loc-2", prenom: "Hugo", nom: "Petit" }
  ];
  const noms = new Map([
    ["loc-1", "Lucie Bernard"],
    ["loc-2", "Hugo Petit"],
    ["loc-3", "Nina Partie"]
  ]);

  it("options : « Non précisé » puis les locataires du bail", () => {
    expect(optionsCautionDe(locatairesDuBail, "", noms)).toEqual([
      { valeur: "", libelle: "Non précisé" },
      { valeur: "loc-1", libelle: "Lucie Bernard" },
      { valeur: "loc-2", libelle: "Hugo Petit" }
    ]);
  });

  it("options : un locataire déjà enregistré mais retiré du bail reste proposé, avec la mention", () => {
    expect(optionsCautionDe(locatairesDuBail, "loc-3", noms).at(-1)).toEqual({
      valeur: "loc-3",
      libelle: "Nina Partie (n'est plus au bail)"
    });
  });

  it("liste : caution de X, « (n'est plus au bail) » si retiré, rien si non précisé", () => {
    const auBail = ["loc-1", "loc-2"];
    expect(mentionCautionDe("loc-2", auBail, noms)).toBe("caution de Hugo Petit");
    expect(mentionCautionDe("loc-3", auBail, noms)).toBe("caution de Nina Partie (n'est plus au bail)");
    expect(mentionCautionDe(null, auBail, noms)).toBeNull();
  });
});
