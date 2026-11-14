import { describe, expect, it } from "vitest";
import {
  PHRASE_ARCHIVAGE_IRREVERSIBLE,
  texteAnnulationVersement,
  texteArchivageAppartement,
  texteArchivageBien,
  texteArchivageCandidat,
  texteArchivageContact,
  texteArchivageDocument,
  texteArchivageEquipement,
  texteArchivageEvenement,
  texteArchivageLocataire,
  texteArchivagePaiement,
  texteArchivageSci,
  texteArchivageSinistre,
  texteResiliationBail,
  texteResultatResiliation,
  texteRetraitRegle,
  texteRetraitGarant
} from "./textes-confirmation";

describe("texteArchivageLocataire", () => {
  it("interpole le nom et dit que l'archivage est irréversible", () => {
    const texte = texteArchivageLocataire({ prenom: "Ilan", nom: "Devos" });
    expect(texte.titre).toBe("Archiver ce locataire ?");
    expect(texte.explication).toBe(
      "Ilan Devos n'apparaîtra plus dans la liste des locataires. Ses baux, paiements et documents sont conservés. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.messageRepli).toBe("Impossible d'archiver ce locataire.");
  });
});

describe("texteArchivageAppartement", () => {
  it("interpole le numéro de l'appartement", () => {
    const texte = texteArchivageAppartement({ numero: "3B" });
    expect(texte.titre).toBe("Archiver l'appartement n° 3B ?");
    expect(texte.explication).toContain("tableau de bord, la fiscalité ni la répartition des charges");
    expect(texte.explication.endsWith(PHRASE_ARCHIVAGE_IRREVERSIBLE)).toBe(true);
  });
});

describe("texteArchivageEquipement", () => {
  it("nomme l'équipement par son libellé, jamais par son code", () => {
    expect(texteArchivageEquipement({ type: "ballon_eau_chaude" }).explication).toMatch(
      /^Le ballon d'eau chaude n'apparaîtra plus dans la liste des équipements\./
    );
    expect(texteArchivageEquipement({ type: "chaudiere" }).explication).toMatch(/^La chaudière /);
    expect(texteArchivageEquipement({ type: "autre" }).explication).toMatch(/^L'équipement /);
  });
});

describe("texteArchivageSinistre", () => {
  it("interpole le type et le statut en libellés", () => {
    const texte = texteArchivageSinistre({ type: "degat_eaux", statut: "expertise_planifiee" });
    expect(texte.explication).toBe(
      "Le sinistre (dégât des eaux, statut expertise planifiée) sortira de la liste et son alerte de suivi sera close. Ses documents sont conservés. L'archivage ne peut pas être annulé depuis l'application."
    );
  });
});

describe("texteArchivageDocument", () => {
  it("document : nom du fichier en objet, consultable dans les archives", () => {
    const texte = texteArchivageDocument({ nomFichier: "attestation-assurance-2026.pdf", categorie: "assurance" });
    expect(texte.titre).toBe("Archiver le document ?");
    expect(texte.objet).toBe("attestation-assurance-2026.pdf");
    expect(texte.explication).toBe(
      "Le document sera archivé, pas supprimé. Il reste consultable dans les archives. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.messageRepli).toBe("Impossible d'archiver ce document.");
  });

  it("photo : même phrase que la confirmation des photos de l'état des lieux", () => {
    const texte = texteArchivageDocument({ nomFichier: "sejour.jpg", categorie: "photo" });
    expect(texte.titre).toBe("Archiver la photo ?");
    expect(texte.objet).toBe("sejour.jpg");
    expect(texte.explication).toContain("La photo sera archivée, pas supprimée.");
    expect(texte.messageRepli).toBe("Impossible d'archiver cette photo.");
  });
});

describe("texteRetraitGarant", () => {
  const caution = { nom: "Martin", prenom: "Claire", typeGarantie: "personne_physique" as const };
  const PREFIXE =
    "Claire Martin n'apparaîtra plus sur ce bail ni dans le document de bail généré. Les déclarations de remise et l'acte de cautionnement sont conservés. ";

  it("caution avec date d'engagement, sans congé : « qui court jusqu'au » JJ/MM/AAAA", () => {
    const texte = texteRetraitGarant(caution, { dateFinEngagement: "2035-08-31", colocation: null });
    expect(texte.titre).toBe("Retirer Claire Martin du bail ?");
    expect(texte.explication).toBe(
      `${PREFIXE}Le retrait dans Briky ne met pas fin à l'engagement de la caution, qui court jusqu'au 31/08/2035. L'archivage ne peut pas être annulé depuis l'application.`
    );
  });

  it("colocataire ayant donné congé : la date la plus proche (congé + 6 mois), « au plus tard »", () => {
    const texte = texteRetraitGarant(caution, {
      dateFinEngagement: "2035-08-31",
      colocation: { auPlusTard: "2027-03-15" }
    });
    expect(texte.explication).toBe(
      `${PREFIXE}Le retrait dans Briky ne met pas fin à l'engagement de la caution, qui court au plus tard jusqu'au 15/03/2027. L'archivage ne peut pas être annulé depuis l'application.`
    );
  });

  it("colocataire ayant donné congé : la fin d'engagement si elle est plus proche que congé + 6 mois", () => {
    const texte = texteRetraitGarant(caution, {
      dateFinEngagement: "2027-01-31",
      colocation: { auPlusTard: "2027-03-15" }
    });
    expect(texte.explication).toContain("qui court au plus tard jusqu'au 31/01/2027.");
  });

  it("colocataire ayant donné congé, fin d'engagement inconnue : congé + 6 mois, « au plus tard »", () => {
    const texte = texteRetraitGarant(caution, { dateFinEngagement: null, colocation: { auPlusTard: "2027-03-15" } });
    expect(texte.explication).toContain("qui court au plus tard jusqu'au 15/03/2027.");
  });

  it("caution sans date d'engagement (durée indéterminée) : phrase sans date", () => {
    const texte = texteRetraitGarant(caution, { dateFinEngagement: null, colocation: null });
    expect(texte.explication).toBe(
      `${PREFIXE}Le retrait dans Briky ne met pas fin à l'engagement de la caution. L'archivage ne peut pas être annulé depuis l'application.`
    );
  });

  it("caution, lecture de l'engagement en échec : phrase sans date", () => {
    const texte = texteRetraitGarant(caution, null);
    expect(texte.explication).toContain("Le retrait dans Briky ne met pas fin à l'engagement de la caution. ");
    expect(texte.explication).not.toContain("court");
  });

  it("garantie Visale : aucune phrase d'engagement", () => {
    const texte = texteRetraitGarant(
      { nom: "Visale", prenom: null, typeGarantie: "garantie_visale" },
      { dateFinEngagement: "2035-08-31", colocation: null }
    );
    expect(texte.titre).toBe("Retirer Visale du bail ?");
    expect(texte.explication).toBe(
      "Visale n'apparaîtra plus sur ce bail ni dans le document de bail généré. Ses documents sont conservés. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("ancien type « autre » : même traitement que Visale, aucune phrase d'engagement", () => {
    const texte = texteRetraitGarant({ nom: "Garantie SCI", prenom: null, typeGarantie: "autre" }, null);
    expect(texte.explication).toBe(
      "Garantie SCI n'apparaîtra plus sur ce bail ni dans le document de bail généré. Ses documents sont conservés. L'archivage ne peut pas être annulé depuis l'application."
    );
  });
});

describe("texteResiliationBail", () => {
  it("date de fin, prorata du mois de fin, mois suivants, trop-perçu, définitif", () => {
    const texte = texteResiliationBail({
      numeroAppartement: "T2 - 1",
      dateDebut: "2026-08-01",
      dateFin: "2027-01-15"
    });
    expect(texte.titre).toBe("Résilier le bail ?");
    expect(texte.objet).toBe("Logement n° T2 - 1, bail du 01/08/2026");
    expect(texte.explication).toBe(
      "Le bail passera en statut résilié, avec une fin d'occupation au 15/01/2027. " +
        "Le loyer du mois de fin sera ramené au prorata des jours occupés : l'échéance est ajustée si elle n'est pas entièrement payée, ou créée si elle n'existe pas ; une échéance déjà payée n'est pas modifiée. " +
        "Les échéances de loyer des mois suivants seront archivées si elles n'ont reçu aucun versement ; celles qui ont déjà reçu un versement sont gardées et la somme reçue est signalée comme trop-perçu. " +
        "Un trop-perçu est signalé dans « Remboursements en attente », jamais remboursé automatiquement. " +
        "Les échéances des mois précédents restent dues et plus aucune échéance de loyer ne sera générée. " +
        "L'appartement repassera vacant s'il était loué. " +
        "Cette action est définitive : un bail résilié ne peut pas être réactivé."
    );
    expect(texte.libelleConfirmer).toBe("Résilier le bail");
    expect(texte.messageRepli).toBe("Impossible de résilier le bail.");
  });

  it("plus aucune variante « sans date » (la date de fin est obligatoire)", () => {
    const texte = texteResiliationBail({ numeroAppartement: "3B", dateDebut: "2026-08-01", dateFin: "2026-11-14" });
    expect(texte.explication).not.toMatch(/Aucune date de fin|sans date de fin|restent dues\b.*celles déjà créées/);
    expect(texte.explication).toContain("fin d'occupation au 14/11/2026.");
  });
});

describe("texteResultatResiliation", () => {
  it("rien à signaler : null", () => {
    expect(texteResultatResiliation({ echeancesArchivees: 0, echeancesConservees: 0, resteARembourser: "0.00" })).toBeNull();
  });

  it("une échéance archivée, au singulier", () => {
    expect(texteResultatResiliation({ echeancesArchivees: 1, echeancesConservees: 0, resteARembourser: "0.00" })).toBe(
      "1 échéance de loyer d'un mois après la date de fin, sans versement, a été archivée."
    );
  });

  it("plusieurs archivées et gardées, avec le trop-perçu total en euros", () => {
    expect(texteResultatResiliation({ echeancesArchivees: 2, echeancesConservees: 1, resteARembourser: "833.88" })).toBe(
      "2 échéances de loyer de mois après la date de fin, sans versement, ont été archivées. " +
        "1 échéance d'un mois après la date de fin avait déjà reçu un versement : elle est gardée. " +
        "Trop-perçu à rembourser au locataire : 833,88 €, visible dans « Remboursements en attente » tant qu'aucun remboursement ne le couvre."
    );
  });

  it("trop-perçu du seul mois de fin (aucune échéance après la fin)", () => {
    expect(texteResultatResiliation({ echeancesArchivees: 0, echeancesConservees: 0, resteARembourser: "283.88" })).toBe(
      "Trop-perçu à rembourser au locataire : 283,88 €, visible dans « Remboursements en attente » tant qu'aucun remboursement ne le couvre."
    );
  });

  it("plusieurs échéances gardées, au pluriel", () => {
    expect(
      texteResultatResiliation({ echeancesArchivees: 0, echeancesConservees: 2, resteARembourser: "750.00" })
    ).toContain("2 échéances de mois après la date de fin avaient déjà reçu un versement : elles sont gardées.");
  });
});

describe("photo : formulation commune une seule fois (décision 13)", () => {
  it("la phrase n'apparaît qu'une fois dans la modale photo des fiches", () => {
    const texte = texteArchivageDocument({ nomFichier: "sejour.jpg", categorie: "photo" });
    expect(texte.explication).toBe(
      "La photo sera archivée, pas supprimée. Elle reste consultable dans les archives. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.explication.split(PHRASE_ARCHIVAGE_IRREVERSIBLE)).toHaveLength(2);
  });
});

describe("texteArchivageSci", () => {
  it("nomme la SCI, dit ce qui sort et l'absence de cascade", () => {
    expect(texteArchivageSci({ nom: "SCI Turgot" }).explication).toBe(
      "SCI Turgot sera masquée du patrimoine (visible avec « Afficher les archivés ») et n'apparaîtra plus dans l'écran Fiscalité. Ses biens, appartements et baux ne sont pas archivés. L'archivage ne peut pas être annulé depuis l'application."
    );
  });
});

describe("texteArchivageBien", () => {
  it("bien d'une SCI : prorata des dépenses communes, pas de cascade", () => {
    expect(
      texteArchivageBien({ nom: "Immeuble turgot", adresse: "12 rue Turgot", proprietaireType: "sci" }).explication
    ).toBe(
      "Immeuble turgot sera masqué de la liste (visible avec « Afficher les archivés »). Dans la déclaration fiscale de la SCI, ses propres loyers et dépenses restent comptés, mais il ne reçoit plus de part des dépenses communes de la SCI. Ses appartements et leurs baux ne sont pas archivés. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("bien en nom propre : sort de l'écran Fiscalité, jamais de mention de SCI", () => {
    const texte = texteArchivageBien({ nom: null, adresse: "12 rue Turgot", proprietaireType: "personne_physique" });
    expect(texte.explication).toBe(
      "12 rue Turgot sera masqué de la liste (visible avec « Afficher les archivés »). Il ne sera plus proposé dans l'écran Fiscalité (déclaration 2044). Ses appartements et leurs baux ne sont pas archivés. L'archivage ne peut pas être annulé depuis l'application."
    );
    expect(texte.explication).not.toContain("SCI");
  });
});

describe("texteArchivagePaiement", () => {
  const loyer = { montant: "550.00", dateEcheance: "2026-10-05", type: "loyer" as const };

  it("loyer avec plusieurs versements : nombre, cascade et revenus locatifs", () => {
    expect(texteArchivagePaiement(loyer, 2).explication).toBe(
      "Le paiement de 550.00 € (loyer, échéance du 05/10/2026) et ses 2 versements seront archivés. Les sommes versées ne compteront plus dans les revenus locatifs (tableau de bord, fiscalité). Ils restent visibles avec « Afficher les archivés ». L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("un seul versement : au singulier", () => {
    expect(texteArchivagePaiement(loyer, 1).explication).toContain("et son versement seront archivés.");
  });

  it("aucun versement : ni cascade ni revenus", () => {
    const texte = texteArchivagePaiement(loyer, 0).explication;
    expect(texte).toContain("sera archivé ; aucun versement n'y est enregistré.");
    expect(texte).toContain("Il reste visible avec « Afficher les archivés ».");
    expect(texte).not.toContain("revenus locatifs");
  });

  it("nombre inconnu (lecture en cours ou en échec) : sans nombre", () => {
    expect(texteArchivagePaiement(loyer, null).explication).toContain("et ses versements éventuels seront archivés.");
  });

  it("dépôt de garantie : jamais de phrase sur les revenus locatifs", () => {
    const texte = texteArchivagePaiement({ ...loyer, type: "depot_garantie" }, 1).explication;
    expect(texte).toContain("(dépôt de garantie, échéance du 05/10/2026)");
    expect(texte).not.toContain("revenus locatifs");
  });
});

describe("texteAnnulationVersement", () => {
  it("loyer : sommes reçues, revenus locatifs, statut recalculé", () => {
    const texte = texteAnnulationVersement({ montant: "550.00", dateVersement: "2026-10-07" }, "loyer");
    expect(texte.titre).toBe("Annuler ce versement ?");
    expect(texte.explication).toBe(
      "Le versement de 550.00 € du 07/10/2026 ne comptera plus dans les sommes reçues ni dans les revenus locatifs, et le statut du paiement sera recalculé. Il reste affiché, grisé, sous le paiement. Cette annulation ne peut pas être défaite depuis l'application."
    );
  });

  it("charges : pas de mention des revenus locatifs", () => {
    expect(
      texteAnnulationVersement({ montant: "50.00", dateVersement: "2026-10-07" }, "charges").explication
    ).not.toContain("revenus locatifs");
  });
});

describe("événement, candidat, contact, règle", () => {
  it("événement : titre, calendrier et abonnement", () => {
    expect(texteArchivageEvenement({ titre: "Visite chaudière" }).explication).toBe(
      "« Visite chaudière » sera masqué du calendrier (visible avec « Afficher les archivés ») et retiré du calendrier abonné. L'archivage ne peut pas être annulé depuis l'application."
    );
  });

  it("candidat : prénom et nom, ou nom seul", () => {
    expect(texteArchivageCandidat({ prenom: "Léa", nom: "Roux" }).explication).toMatch(/^Léa Roux sera masqué de la liste des candidats/);
    expect(texteArchivageCandidat({ prenom: null, nom: "Roux" }).explication).toMatch(/^Roux sera masqué/);
  });

  it("contact : carnet et messagerie", () => {
    expect(texteArchivageContact({ nom: "Plomberie Martin" }).explication).toContain(
      "Plomberie Martin sera masqué du carnet de contacts (visible avec « Afficher les archivés ») et ne sera plus proposé comme destinataire dans la messagerie."
    );
  });

  it("règle : mot-clé", () => {
    expect(texteRetraitRegle({ motCle: "EDF" }).explication).toBe(
      "Le mot-clé « EDF » ne présélectionnera plus de catégorie à l'import CSV. L'archivage ne peut pas être annulé depuis l'application."
    );
  });
});
