import { describe, expect, it } from "vitest";
import {
  PHRASE_ARCHIVAGE_IRREVERSIBLE,
  texteArchivageAppartement,
  texteArchivageDocument,
  texteArchivageEquipement,
  texteArchivageLocataire,
  texteArchivageSinistre,
  texteResiliationBail,
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
  const FIN_COMMUNE =
    "Plus aucune échéance de loyer ne sera générée ; celles déjà créées restent dues. L'appartement repassera vacant s'il était loué. Cette action est définitive : un bail résilié ne peut pas être réactivé.";

  it("avec une date saisie : date de fin et prorata du mois de fin", () => {
    const texte = texteResiliationBail({
      numeroAppartement: "T2 - 1",
      dateDebut: "2026-08-01",
      dateFinEnregistree: null,
      dateFinSaisie: "2027-01-15"
    });
    expect(texte.titre).toBe("Résilier le bail ?");
    expect(texte.objet).toBe("Logement n° T2 - 1, bail du 01/08/2026");
    expect(texte.explication).toBe(
      `Le bail passera en statut résilié, avec une fin d'occupation au 15/01/2027. Le loyer de ce mois sera ramené au prorata des jours occupés : l'échéance est ajustée si elle n'est pas entièrement payée, ou créée si elle n'existe pas ; une échéance déjà payée n'est pas modifiée. Un trop-perçu éventuel est signalé, jamais remboursé automatiquement. ${FIN_COMMUNE}`
    );
    expect(texte.libelleConfirmer).toBe("Résilier le bail");
    expect(texte.messageRepli).toBe("Impossible de résilier le bail.");
  });

  it("la date saisie prime sur la date déjà enregistrée", () => {
    const texte = texteResiliationBail({
      numeroAppartement: "3B",
      dateDebut: "2026-08-01",
      dateFinEnregistree: "2029-07-31",
      dateFinSaisie: "2027-01-15"
    });
    expect(texte.explication).toContain("fin d'occupation au 15/01/2027.");
    expect(texte.explication).not.toContain("31/07/2029");
  });

  it("sans date saisie, date déjà enregistrée : conservée, aucun prorata", () => {
    const texte = texteResiliationBail({
      numeroAppartement: "3B",
      dateDebut: "2026-08-01",
      dateFinEnregistree: "2029-07-31",
      dateFinSaisie: ""
    });
    expect(texte.explication).toBe(
      `Le bail passera en statut résilié. Aucune date de fin n'est saisie : la date déjà enregistrée (31/07/2029) est conservée et aucun loyer n'est proratisé. ${FIN_COMMUNE}`
    );
  });

  it("sans date saisie ni enregistrée : bail sans date de fin, aucun prorata", () => {
    const texte = texteResiliationBail({
      numeroAppartement: "3B",
      dateDebut: "2026-08-01",
      dateFinEnregistree: null,
      dateFinSaisie: ""
    });
    expect(texte.explication).toContain("le bail restera sans date de fin et aucun loyer n'est proratisé.");
    expect(texte.explication).not.toContain("prorata des jours");
  });
});
