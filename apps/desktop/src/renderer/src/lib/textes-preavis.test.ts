import { describe, expect, it } from "vitest";
import type { RealignementPreavis } from "../locataires/api";
import { texteResiliationBail } from "./textes-confirmation";
import {
  avertissementPreavisEcoule,
  dateMaxResiliation,
  libelleDureePreavis,
  LIBELLES_MOTIF_PREAVIS_REDUIT,
  texteAnnulationPreavis,
  texteCorrectionPreavis,
  texteDateFinProposee,
  texteDeclarationPreavis,
  texteRappelLoyerPreavis,
  texteResultatPreavis
} from "./textes-preavis";

const AUCUN_REALIGNEMENT: RealignementPreavis = {
  echeancesRecalculees: [],
  echeancesArchivees: [],
  echeancesConservees: [],
  echeancesCreees: [],
  tropPercuMoisFin: null,
  tropPercuTotal: "0.00",
  resteARembourserTotal: "0.00"
};

describe("date de fin proposée", () => {
  it("présentée comme proposée, à confirmer, avec la lecture « la veille »", () => {
    expect(texteDateFinProposee("2027-04-15")).toBe(
      "Date de fin proposée : 15/04/2027 (réception + durée), à confirmer — selon l'interprétation, le préavis peut s'achever la veille, le 14/04/2027."
    );
    expect(texteDateFinProposee("2027-03-01")).toContain("la veille, le 28/02/2027.");
  });
});

describe("rappel du loyer pendant le préavis (art. 15 / 25-8)", () => {
  it("congé du locataire : dû jusqu'à la fin du préavis, sauf relocation ; article selon le type de bail", () => {
    expect(texteRappelLoyerPreavis("locataire", "vide")).toBe(
      "Congé du locataire : le loyer et les charges restent dus jusqu'à la fin du préavis, même s'il part avant, sauf si le logement est reloué plus tôt avec votre accord (loi du 6 juillet 1989, art. 15)."
    );
    expect(texteRappelLoyerPreavis("locataire", "meuble")).toContain("art. 25-8");
  });

  it("congé du bailleur : dû pour l'occupation réelle, résilier au départ réel", () => {
    expect(texteRappelLoyerPreavis("bailleur", "vide")).toBe(
      "Congé du bailleur : le loyer et les charges ne sont dus que pour le temps où le locataire occupe réellement le logement ; résiliez le bail à son départ réel (loi du 6 juillet 1989, art. 15)."
    );
  });
});

describe("libellés", () => {
  it("motifs du préavis réduit lisibles, durée au singulier ou au pluriel", () => {
    expect(Object.keys(LIBELLES_MOTIF_PREAVIS_REDUIT)).toHaveLength(9);
    expect(LIBELLES_MOTIF_PREAVIS_REDUIT.zone_tendue).toBe("Logement situé en zone tendue");
    expect(libelleDureePreavis(1)).toBe("1 mois");
    expect(libelleDureePreavis(3)).toBe("3 mois");
  });
});

describe("confirmations", () => {
  it("déclaration : préavis, fin, génération jusqu'au mois de fin au prorata, recalage", () => {
    const texte = texteDeclarationPreavis({ numeroAppartement: "T2 - 1", auteur: "locataire", dateFin: "2027-04-15" });
    expect(texte.titre).toBe("Enregistrer le préavis ?");
    expect(texte.objet).toBe("Logement n° T2 - 1 — congé du locataire");
    expect(texte.explication).toBe(
      "Le bail passera en préavis, avec une fin au 15/04/2027. " +
        "Les loyers seront générés jusqu'au mois de fin, ce dernier au prorata des jours occupés, puis plus rien. " +
        "Les échéances de loyer déjà créées sont recalées : celle du mois de fin est ramenée au prorata si elle n'est pas entièrement payée (sinon, la somme reçue en trop est signalée) ; celles des mois suivants sont archivées si elles n'ont reçu aucun versement, gardées sinon avec la somme reçue signalée comme trop-perçu. " +
        "Le préavis pourra être corrigé, ou annulé jusqu'à sa date de fin."
    );
    expect(texte.libelleConfirmer).toBe("Enregistrer le préavis");
  });

  it("correction avancée, reculée, ou à la même date", () => {
    const avancee = texteCorrectionPreavis({ numeroAppartement: "1", ancienneFin: "2027-04-15", nouvelleFin: "2027-03-31" });
    expect(avancee.explication).toMatch(/^La fin du préavis sera avancée du 15\/04\/2027 au 31\/03\/2027\. Les échéances de loyer déjà créées sont recalées/);
    expect(avancee.explication).toMatch(/L'ancienne version du préavis reste dans l'historique\.$/);

    const reculee = texteCorrectionPreavis({ numeroAppartement: "1", ancienneFin: "2027-04-15", nouvelleFin: "2027-05-15" });
    expect(reculee.explication).toContain("La fin du préavis sera reculée du 15/04/2027 au 15/05/2027.");
    expect(reculee.explication).toContain("même déjà payés (ils repassent alors en paiement partiel)");
    expect(reculee.explication).toContain("L'action est refusée si un trop-perçu de ces mois a déjà été remboursé.");

    const meme = texteCorrectionPreavis({ numeroAppartement: "1", ancienneFin: "2027-04-15", nouvelleFin: "2027-04-15" });
    expect(meme.explication).toBe(
      "La date de fin reste le 15/04/2027 : seules les autres informations du préavis changent, aucune échéance n'est modifiée. L'ancienne version du préavis reste dans l'historique."
    );
  });

  it("annulation : bail actif, date de fin d'origine rétablie ou retirée, mois remis pleins", () => {
    const avecDate = texteAnnulationPreavis({ numeroAppartement: "1", dateFinPreavis: "2027-04-15", dateFinBailAvant: "2029-09-30" });
    expect(avecDate.titre).toBe("Annuler le préavis ?");
    expect(avecDate.objet).toBe("Logement n° 1, préavis jusqu'au 15/04/2027");
    expect(avecDate.explication).toMatch(/^Le bail redeviendra actif, avec sa date de fin d'origine \(30\/09\/2029\)\. Les loyers seront de nouveau générés chaque mois en entier\./);
    expect(avecDate.explication).toMatch(/Le préavis annulé reste dans l'historique\.$/);
    const sansDate = texteAnnulationPreavis({ numeroAppartement: "1", dateFinPreavis: "2027-04-15", dateFinBailAvant: null });
    expect(sansDate.explication).toMatch(/^Le bail redeviendra actif, sans date de fin\./);
  });

  it("résiliation d'un bail en préavis : phrase propre à l'auteur du congé, en tête", () => {
    const locataire = texteResiliationBail({
      numeroAppartement: "1",
      dateDebut: "2026-10-01",
      dateFin: "2027-04-15",
      preavis: { auteur: "locataire", dateFin: "2027-04-15" }
    });
    expect(locataire.explication).toMatch(
      /^Bail en préavis \(congé du locataire\) : résiliez à la date de fin du préavis, le 15\/04\/2027 ; une date antérieure ne se justifie que par une relocation du logement, le loyer restant dû jusqu'à la fin du préavis\. Le bail passera en statut résilié/
    );
    const bailleur = texteResiliationBail({
      numeroAppartement: "1",
      dateDebut: "2026-10-01",
      dateFin: "2027-05-20",
      preavis: { auteur: "bailleur", dateFin: "2027-07-10" }
    });
    expect(bailleur.explication).toMatch(
      /^Bail en préavis \(congé du bailleur\) : résiliez à la date de départ réel du locataire, au plus tard le 10\/07\/2027\./
    );
    const sansPreavis = texteResiliationBail({ numeroAppartement: "1", dateDebut: "2026-10-01", dateFin: "2027-04-15" });
    expect(sansPreavis.explication).toMatch(/^Le bail passera en statut résilié/);
  });
});

describe("résultat d'une action (totaux de cette action)", () => {
  it("rien touché : null", () => {
    expect(texteResultatPreavis(AUCUN_REALIGNEMENT)).toBeNull();
  });

  it("comptes au singulier et au pluriel, trop-perçu et reste à rembourser en euros", () => {
    expect(
      texteResultatPreavis({
        ...AUCUN_REALIGNEMENT,
        echeancesRecalculees: [{ paiementId: "a", montant: "550.00", statut: "partiel" }],
        echeancesArchivees: ["b", "c"],
        echeancesConservees: [{ paiementId: "d", dateEcheance: "2027-05-05", tropPercu: "550.00", resteARembourser: "550.00" }],
        echeancesCreees: [{ paiementId: "e", dateEcheance: "2027-05-05", montant: "266.12" }],
        tropPercuTotal: "825.00",
        resteARembourserTotal: "825.00"
      })
    ).toBe(
      "Pour cette action : 1 échéance recalculée, 2 échéances archivées, 1 échéance gardée (déjà payée), 1 échéance créée. " +
        "Trop-perçu signalé pour cette action : 825,00 € ; reste à rembourser : 825,00 €, visible dans « Remboursements en attente »."
    );
  });
});

describe("garde-fous d'affichage", () => {
  it("avertissement seulement si le préavis est écoulé (le jour même : non)", () => {
    expect(avertissementPreavisEcoule("2027-04-15", "2027-04-15")).toBeNull();
    expect(avertissementPreavisEcoule("2027-04-15", "2027-04-16")).toBe(
      "Préavis écoulé depuis le 15/04/2027 : pensez à résilier le bail (au plus tard à cette date)."
    );
  });

  it("date max de résiliation : aujourd'hui, ou la fin du préavis si elle est plus tôt", () => {
    expect(dateMaxResiliation("2027-05-20", "2027-04-15")).toBe("2027-04-15");
    expect(dateMaxResiliation("2027-03-20", "2027-04-15")).toBe("2027-03-20");
    expect(dateMaxResiliation("2027-03-20", null)).toBe("2027-03-20");
  });
});
