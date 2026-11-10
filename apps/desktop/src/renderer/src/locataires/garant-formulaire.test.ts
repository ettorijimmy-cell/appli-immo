import { describe, expect, it } from "vitest";
import type { Garant } from "./api";
import {
  cautionDeObligatoire,
  champsGarantDepuis,
  champsGarantVides,
  changerTypeGarant,
  confirmationChangementType,
  creationGarant,
  GARANT_TYPES_SAISISSABLES,
  LIBELLES_TYPE_GARANTIE,
  mentionCautionDe,
  modificationGarant,
  NOM_GARANT_VISALE,
  nomAfficheGarant,
  optionsCautionDe
} from "./garant-formulaire";

const garant: Garant = {
  id: "g1",
  bailId: "b1",
  nom: "Martin",
  prenom: "Paul",
  email: null,
  telephone: "0600000000",
  typeGarantie: "personne_physique",
  numeroContratVisale: null,
  adresse: "4 rue des Lilas",
  codePostal: "69003",
  ville: null,
  dateNaissance: "1970-01-02",
  lieuNaissance: null,
  nationalite: "française",
  locataireId: "loc-1",
  archivedAt: null
};

const visale: Garant = {
  ...garant,
  id: "g2",
  nom: NOM_GARANT_VISALE,
  prenom: null,
  email: "contact@example.com",
  typeGarantie: "garantie_visale",
  numeroContratVisale: "V0001",
  adresse: null,
  codePostal: null,
  dateNaissance: null,
  nationalite: null,
  locataireId: null
};

describe("formulaires garant", () => {
  it("champs vides : personne physique par défaut, tout le reste vide", () => {
    expect(champsGarantVides()).toEqual({
      nom: "",
      prenom: "",
      email: "",
      telephone: "",
      typeGarantie: "personne_physique",
      numeroContratVisale: "",
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
      typeGarantie: "personne_physique",
      numeroContratVisale: "",
      adresse: "4 rue des Lilas",
      codePostal: "69003",
      ville: "",
      dateNaissance: "1970-01-02",
      lieuNaissance: "",
      nationalite: "française",
      locataireId: "loc-1"
    });
  });

  it("modification : un champ vidé est envoyé en null explicite, jamais omis ; aucun numéro Visale", () => {
    const champs = { ...champsGarantDepuis(garant), telephone: "", nationalite: "", adresse: "" };
    expect(modificationGarant(champs)).toEqual({
      nom: "Martin",
      prenom: "Paul",
      typeGarantie: "personne_physique",
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

describe("types de garant (chantier garants)", () => {
  it("saisie : caution ou Visale seulement ; libellés lisibles, « autre » marqué ancien type", () => {
    expect(GARANT_TYPES_SAISISSABLES).toEqual(["personne_physique", "garantie_visale"]);
    expect(LIBELLES_TYPE_GARANTIE).toEqual({
      personne_physique: "Caution (personne physique)",
      garantie_visale: "Garantie Visale",
      autre: "Autre (ancien type)"
    });
  });

  it("nom affiché : prénom et nom, ou le nom seul sans prénom (Visale)", () => {
    expect(nomAfficheGarant(garant)).toBe("Paul Martin");
    expect(nomAfficheGarant(visale)).toBe(NOM_GARANT_VISALE);
  });

  it("création Visale : seulement numéro, e-mail et téléphone ; jamais nom, prénom ni champs de personne", () => {
    const champs = {
      ...champsGarantVides("loc-1"),
      typeGarantie: "garantie_visale" as const,
      nom: "Saisi avant",
      prenom: "Saisi avant",
      dateNaissance: "1970-01-02",
      numeroContratVisale: "V0001",
      telephone: "0600000000"
    };
    expect(creationGarant("b1", champs)).toEqual({
      bailId: "b1",
      typeGarantie: "garantie_visale",
      numeroContratVisale: "V0001",
      telephone: "0600000000"
    });
    expect(creationGarant("b1", { ...champs, numeroContratVisale: "" })).not.toHaveProperty("numeroContratVisale");
  });

  it("modification Visale : numéro, e-mail et téléphone, vidés en null", () => {
    expect(modificationGarant({ ...champsGarantDepuis(visale), numeroContratVisale: "", telephone: "" })).toEqual({
      typeGarantie: "garantie_visale",
      numeroContratVisale: null,
      email: "contact@example.com",
      telephone: null
    });
  });

  it("ligne « autre » gardée telle quelle : type omis (refusé par l'API), prénom vide omis", () => {
    const autre: Garant = { ...garant, typeGarantie: "autre", nom: "Garantie bancaire", prenom: null };
    const payload = modificationGarant(champsGarantDepuis(autre));
    expect(payload).not.toHaveProperty("typeGarantie");
    expect(payload).not.toHaveProperty("prenom");
    expect(payload).toMatchObject({ nom: "Garantie bancaire", telephone: "0600000000" });
  });

  it("changement de type dans le formulaire : rien n'est effacé, sauf le nom imposé de Visale en passant en caution", () => {
    const enVisale = changerTypeGarant(champsGarantDepuis(garant), "garantie_visale");
    expect(enVisale).toMatchObject({ typeGarantie: "garantie_visale", nom: "Martin", dateNaissance: "1970-01-02" });
    expect(changerTypeGarant(enVisale, "personne_physique")).toEqual(champsGarantDepuis(garant));
    expect(changerTypeGarant(champsGarantDepuis(visale), "personne_physique")).toMatchObject({
      typeGarantie: "personne_physique",
      nom: ""
    });
  });

  it("confirmation caution → Visale : dit que le nom est remplacé et liste les champs renseignés vidés", () => {
    const message = confirmationChangementType("personne_physique", changerTypeGarant(champsGarantDepuis(garant), "garantie_visale"));
    expect(message).toBe(
      [
        "Passer ce garant en « Garantie Visale » :",
        "- le nom sera remplacé par « Action Logement Services (Visale) » ;",
        "- seront vidés : prénom, adresse, code postal, date de naissance, nationalité, « Caution de » ;",
        "- l'e-mail et le téléphone sont conservés.",
        "Continuer ?"
      ].join("\n")
    );
  });

  it("confirmation Visale → caution : le numéro de contrat sera effacé ; rien à confirmer sans numéro", () => {
    const enCaution = { ...changerTypeGarant(champsGarantDepuis(visale), "personne_physique"), nom: "Martin", prenom: "Paul" };
    expect(confirmationChangementType("garantie_visale", enCaution)).toBe(
      [
        "Passer ce garant en « Caution (personne physique) » :",
        "- le numéro de contrat Visale (V0001) sera effacé.",
        "Continuer ?"
      ].join("\n")
    );
    expect(confirmationChangementType("garantie_visale", { ...enCaution, numeroContratVisale: "" })).toBeNull();
  });

  it("pas de confirmation sans changement de type", () => {
    expect(confirmationChangementType("personne_physique", champsGarantDepuis(garant))).toBeNull();
    expect(confirmationChangementType("garantie_visale", champsGarantDepuis(visale))).toBeNull();
  });

  it("« Caution de » signalé obligatoire seulement si le bail a plusieurs locataires", () => {
    expect(cautionDeObligatoire([])).toBe(false);
    expect(cautionDeObligatoire([{ id: "loc-1" }])).toBe(false);
    expect(cautionDeObligatoire([{ id: "loc-1" }, { id: "loc-2" }])).toBe(true);
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
