import { describe, expect, it } from "vitest";
import { parserReleveCsv } from "./parser-releve-csv";

describe("parserReleveCsv", () => {
  it("parse un CSV simple séparé par des virgules", () => {
    const csv = "Date,Montant,Libelle\n2026-08-05,850.00,VIR DUPONT LOYER AOUT\n";
    expect(parserReleveCsv(csv)).toEqual([
      { date: "2026-08-05", montant: "850.00", libelle: "VIR DUPONT LOYER AOUT" }
    ]);
  });

  it("parse un CSV séparé par des points-virgules (export bancaire français)", () => {
    const csv = "Date;Montant;Libelle\n05/08/2026;850,00;VIR DUPONT LOYER AOUT\n";
    expect(parserReleveCsv(csv)).toEqual([
      { date: "2026-08-05", montant: "850,00", libelle: "VIR DUPONT LOYER AOUT" }
    ]);
  });

  it("reconnaît les en-têtes insensibles à la casse et aux accents", () => {
    const csv = "DATE;MONTANT;LIBELLÉ\n2026-08-05;850.00;Test\n";
    expect(parserReleveCsv(csv)).toHaveLength(1);
  });

  it("gère les champs entre guillemets contenant le délimiteur", () => {
    const csv = 'Date,Montant,Libelle\n2026-08-05,850.00,"VIR, DUPONT, LOYER"\n';
    expect(parserReleveCsv(csv)[0]?.libelle).toBe("VIR, DUPONT, LOYER");
  });

  it("gère les guillemets doublés (guillemet littéral échappé)", () => {
    const csv = 'Date,Montant,Libelle\n2026-08-05,850.00,"Virement ""DUPONT"" loyer"\n';
    expect(parserReleveCsv(csv)[0]?.libelle).toBe('Virement "DUPONT" loyer');
  });

  it("ignore les lignes vides", () => {
    const csv = "Date,Montant,Libelle\n2026-08-05,850.00,A\n\n2026-08-06,900.00,B\n";
    expect(parserReleveCsv(csv)).toHaveLength(2);
  });

  it("fonctionne sans retour à la ligne final", () => {
    const csv = "Date,Montant,Libelle\n2026-08-05,850.00,A";
    expect(parserReleveCsv(csv)).toHaveLength(1);
  });

  it("rejette un fichier vide", () => {
    expect(() => parserReleveCsv("")).toThrow(/vide/i);
  });

  it("rejette un CSV sans colonne date", () => {
    const csv = "Montant,Libelle\n850.00,A\n";
    expect(() => parserReleveCsv(csv)).toThrow(/date/i);
  });

  it("rejette un CSV sans colonne montant", () => {
    const csv = "Date,Libelle\n2026-08-05,A\n";
    expect(() => parserReleveCsv(csv)).toThrow(/montant/i);
  });

  it("rejette une ligne incomplète (montant manquant)", () => {
    const csv = "Date,Montant,Libelle\n2026-08-05,,A\n";
    expect(() => parserReleveCsv(csv)).toThrow(/ligne 2/i);
  });

  it("rejette une date dans un format non reconnu", () => {
    const csv = "Date,Montant,Libelle\n2026/08/05,850.00,A\n";
    expect(() => parserReleveCsv(csv)).toThrow(/date invalide/i);
  });

  it("rejette un en-tête ambigu plutôt que de deviner (deux colonnes candidates pour le même champ)", () => {
    // "Libelle" et "Reference" correspondent tous deux aux candidats du
    // champ libellé — prendre la première trouvée serait exactement le
    // genre de supposition silencieuse que ce parseur refuse par ailleurs.
    const csv = "Date,Montant,Libelle,Reference\n2026-08-05,850.00,A,B\n";
    expect(() => parserReleveCsv(csv)).toThrow(/ambiguë/i);
  });

  describe("format à deux colonnes Débit/Crédit", () => {
    it("fusionne une ligne de débit en montant négatif", () => {
      const csv = "Date,Debit,Credit,Libelle\n2026-08-05,450.00,,ASSURANCE HABITATION\n";
      expect(parserReleveCsv(csv)).toEqual([
        { date: "2026-08-05", montant: "-450.00", libelle: "ASSURANCE HABITATION" }
      ]);
    });

    it("fusionne une ligne de crédit en montant positif", () => {
      const csv = "Date,Debit,Credit,Libelle\n2026-08-05,,850.00,VIR DUPONT LOYER AOUT\n";
      expect(parserReleveCsv(csv)).toEqual([
        { date: "2026-08-05", montant: "850.00", libelle: "VIR DUPONT LOYER AOUT" }
      ]);
    });

    it("reconnaît les en-têtes Débit/Crédit accentués, insensibles à la casse", () => {
      const csv = "Date;DÉBIT;CRÉDIT;Libelle\n05/08/2026;120,00;;Facture entretien\n";
      expect(parserReleveCsv(csv)).toEqual([
        { date: "2026-08-05", montant: "-120,00", libelle: "Facture entretien" }
      ]);
    });

    it("retire un signe déjà présent dans la cellule source avant d'appliquer le sien", () => {
      // Un débit stocké avec un signe négatif dans le fichier source (rare
      // mais possible) ne doit jamais devenir positif par double négation.
      const csv = "Date,Debit,Credit,Libelle\n2026-08-05,-450.00,,ASSURANCE\n";
      expect(parserReleveCsv(csv)[0]?.montant).toBe("-450.00");
    });

    it("rejette une ligne avec débit ET crédit renseignés simultanément", () => {
      const csv = "Date,Debit,Credit,Libelle\n2026-08-05,100.00,50.00,ERREUR FORMAT\n";
      expect(() => parserReleveCsv(csv)).toThrow(/ligne 2.*ambiguë/i);
    });

    it("rejette une ligne sans débit ni crédit renseigné", () => {
      const csv = "Date,Debit,Credit,Libelle\n2026-08-05,,,LIGNE VIDE\n";
      expect(() => parserReleveCsv(csv)).toThrow(/ligne 2/i);
    });

    it("rejette un en-tête avec une colonne débit mais sans colonne crédit", () => {
      const csv = "Date,Debit,Libelle\n2026-08-05,450.00,ASSURANCE\n";
      expect(() => parserReleveCsv(csv)).toThrow(/crédit/i);
    });

    it("ne bascule jamais en mode deux colonnes sur la seule présence d'une colonne crédit", () => {
      // "credit" est aussi un candidat du format historique à colonne
      // unique — seule la présence d'une colonne "débit" doit faire
      // basculer le format, jamais "crédit" seule.
      const csv = "Date,Credit,Libelle\n2026-08-05,850.00,VIR DUPONT LOYER AOUT\n";
      expect(parserReleveCsv(csv)).toEqual([
        { date: "2026-08-05", montant: "850.00", libelle: "VIR DUPONT LOYER AOUT" }
      ]);
    });
  });
});
