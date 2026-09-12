import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerAnnexe1,
  LIGNE_ANNEXE1_PAR_CATEGORIE_DEPENSE,
  montantEnCentimes,
  centimesVersMontant,
  repartirCentimesEgalement,
  type Annexe1Calculee,
  type Annexe1LignesAutomatiques,
  type Annexe1SaisieManuelle
} from "core";
import { annexe1SaisieManuelle, appartements, bien, depense, mettreAJourAvecAudit, scis, type Database } from "db";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { TableauDeBordService } from "../tableau-de-bord/tableau-de-bord.service";
import { UsersService } from "../users/users.service";
import type { SaisieManuelleAnnexe1Dto } from "./dto/saisie-manuelle-annexe1.dto";

const CHAMPS_SAISIE_MANUELLE = [
  "ligne2",
  "ligne3",
  "ligne4",
  "ligne9Bis",
  "ligne10",
  "ligne11",
  "ligne14",
  "ligne15",
  "ligne19",
  "ligne20",
  "ligne22"
] as const;

type SaisieManuelleRow = typeof annexe1SaisieManuelle.$inferSelect;

export interface Annexe1ProrataApplique {
  ligne: "ligne6" | "ligne8" | "ligne9" | "ligne12" | "ligne13" | "ligne17";
  montant: string;
}

export interface Annexe1ResultatBien {
  bienId: string;
  nombreLots: number;
  lignes: Annexe1Calculee;
  saisieManuelle: Annexe1SaisieManuelle;
  proratasAppliques: Annexe1ProrataApplique[];
}

@Injectable()
export class FiscaliteService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly tableauDeBordService: TableauDeBordService
  ) {}

  // Module Charges et fiscalité, Étape 4 (2072-S-A1-SD, cadre VII). Calcule
  // l'Annexe 1 pour chaque bien d'une SCI à l'IR, pour une année civile
  // donnée — jamais stocké, recalculé à chaque lecture depuis
  // getRevenusLocatifs/depense/annexe1_saisie_manuelle.
  //
  // Volontairement AUCUN filtre archivedAt sur la sélection des biens
  // (`tousLesBiens` ci-dessous) : le revenu/les dépenses perçus sur l'année
  // sont un fait historique, jamais invalidé par un archivage survenu APRÈS
  // coup (bien vendu en cours d'année). Même principe et même bug déjà
  // corrigé sur getSynthese (tableau-de-bord.service.ts) — sans ça, un bien
  // archivé disparaîtrait entièrement de l'Annexe 1 de l'année de sa
  // sortie, alors que ses loyers/dépenses jusqu'à cette date sont réels.
  // Revue financial-logic-reviewer, 2026-09-12.
  //
  // Le prorata des dépenses de niveau SCI (bienId NULL) reste, lui, scopé
  // aux seuls biens ACTIFS (`biensActifsPourProrata`) : hypothèse actée
  // explicitement avec Jimmy — un bien archivé ne reçoit pas de part du
  // prorata et ne compte pas dans son diviseur, contrairement à ses propres
  // lignes 1/6/8/9/12/13/17 qui restent, elles, toujours incluses.
  //
  // Deux limites connues, acceptées pour cette première version (voir
  // docs/data-dictionary.md) :
  // 1. Ligne 7 (forfait 20€/lot) compte les lots NON ARCHIVÉS au moment du
  //    calcul, sans reconstitution de l'état réel du bien à une date
  //    passée — un lot créé ou archivé en cours d'année compte comme s'il
  //    avait existé toute l'année.
  // 2. Le prorata des dépenses de niveau SCI compte les biens ACTIFS au
  //    moment du calcul, sans pondération temporelle — un bien acquis en
  //    cours d'année compte comme un bien entier dans le prorata.
  async calculerAnnexe1PourSci(userId: string, sciId: string, annee: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [sci] = await this.db.select().from(scis).where(eq(scis.id, sciId)).limit(1);
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    if (sci.regimeFiscal !== "IR") {
      throw new BadRequestException(
        "L'Annexe 1 (2072-S-A1-SD) ne s'applique qu'aux SCI au régime IR — cette SCI est à l'IS, hors périmètre de cette étape."
      );
    }

    const tousLesBiens = await this.db
      .select()
      .from(bien)
      .where(and(eq(bien.sciId, sciId), eq(bien.organisationId, user.organisationId)));

    if (tousLesBiens.length === 0) {
      return { sciId, sciNom: sci.nom, annee, biens: [], totalSci: "0.00" };
    }

    const biensActifsPourProrata = tousLesBiens.filter((b) => b.archivedAt === null);
    const bienIds = tousLesBiens.map((b) => b.id);
    const periodeDebut = `${annee}-01-01`;
    const periodeFin = `${annee}-12-31`;

    const [appartementsActifs, depensesSci, saisiesManuelles, revenusParBien] = await Promise.all([
      this.db
        .select({ id: appartements.id, bienId: appartements.bienId })
        .from(appartements)
        .where(and(inArray(appartements.bienId, bienIds), isNull(appartements.archivedAt))),
      this.db
        .select()
        .from(depense)
        .where(
          and(
            eq(depense.sciId, sciId),
            isNull(depense.archivedAt),
            gte(depense.dateDepense, periodeDebut),
            lte(depense.dateDepense, periodeFin)
          )
        ),
      this.db
        .select()
        .from(annexe1SaisieManuelle)
        .where(and(inArray(annexe1SaisieManuelle.bienId, bienIds), eq(annexe1SaisieManuelle.annee, annee))),
      Promise.all(
        tousLesBiens.map((b) =>
          this.tableauDeBordService.getRevenusLocatifs(periodeDebut, periodeFin, { bienId: b.id })
        )
      )
    ]);

    const nombreLotsParBien = new Map<string, number>();
    for (const a of appartementsActifs) {
      nombreLotsParBien.set(a.bienId, (nombreLotsParBien.get(a.bienId) ?? 0) + 1);
    }

    const manuellesParBien = new Map<string, SaisieManuelleRow>(saisiesManuelles.map((s) => [s.bienId, s]));

    // Dépenses de niveau SCI (bienId NULL) : réparties à parts égales entre
    // les seuls biens ACTIFS, catégorie par catégorie — voir le
    // commentaire de fonction ci-dessus.
    const totauxNiveauSciParCategorie = new Map<string, number>();
    for (const d of depensesSci) {
      if (d.bienId === null) {
        totauxNiveauSciParCategorie.set(
          d.categorie,
          (totauxNiveauSciParCategorie.get(d.categorie) ?? 0) + montantEnCentimes(d.montant)
        );
      }
    }
    const partsParCategorie = new Map<string, number[]>();
    for (const [categorie, totalCentimes] of totauxNiveauSciParCategorie) {
      partsParCategorie.set(categorie, repartirCentimesEgalement(totalCentimes, biensActifsPourProrata.length));
    }
    const indexActifParBienId = new Map(biensActifsPourProrata.map((b, index) => [b.id, index]));

    const resultatsBiens: Annexe1ResultatBien[] = tousLesBiens.map((b, index) => {
      const sommeParCategorie = new Map<string, number>();
      for (const d of depensesSci) {
        if (d.bienId === b.id) {
          sommeParCategorie.set(d.categorie, (sommeParCategorie.get(d.categorie) ?? 0) + montantEnCentimes(d.montant));
        }
      }

      const proratasAppliques: Annexe1ProrataApplique[] = [];
      const indexActif = indexActifParBienId.get(b.id);
      if (indexActif !== undefined) {
        for (const [categorie, parts] of partsParCategorie) {
          const part = parts[indexActif] ?? 0;
          if (part > 0) {
            sommeParCategorie.set(categorie, (sommeParCategorie.get(categorie) ?? 0) + part);
            const ligne = LIGNE_ANNEXE1_PAR_CATEGORIE_DEPENSE[categorie];
            if (ligne) {
              proratasAppliques.push({ ligne, montant: centimesVersMontant(part) });
            }
          }
        }
      }

      const getSomme = (categorie: string) => centimesVersMontant(sommeParCategorie.get(categorie) ?? 0);

      const automatiques: Annexe1LignesAutomatiques = {
        ligne1: revenusParBien[index]!.totalLoyerNet,
        ligne6: getSomme("frais_gestion"),
        ligne8: getSomme("assurance"),
        ligne9: getSomme("reparation_entretien"),
        ligne12: getSomme("impots_taxes"),
        ligne13: getSomme("charges_copropriete"),
        ligne17: getSomme("interets_emprunt"),
        nombreLots: nombreLotsParBien.get(b.id) ?? 0
      };

      const manuelleRow = manuellesParBien.get(b.id);
      const saisieManuelle: Annexe1SaisieManuelle = manuelleRow ? this.versSaisieManuelle(manuelleRow) : {};

      return {
        bienId: b.id,
        nombreLots: automatiques.nombreLots,
        lignes: calculerAnnexe1(automatiques, saisieManuelle),
        saisieManuelle,
        proratasAppliques
      };
    });

    const totalSciCentimes = resultatsBiens.reduce((total, r) => total + montantEnCentimes(r.lignes.ligne23), 0);

    return {
      sciId,
      sciNom: sci.nom,
      annee,
      biens: resultatsBiens,
      totalSci: centimesVersMontant(totalSciCentimes)
    };
  }

  async sauvegarderSaisieManuelle(userId: string, bienId: string, annee: number, dto: SaisieManuelleAnnexe1Dto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [bienConcerne] = await this.db.select().from(bien).where(eq(bien.id, bienId)).limit(1);
    if (!bienConcerne || bienConcerne.organisationId !== user.organisationId) {
      throw new NotFoundException("Bien introuvable");
    }

    // undefined = champ absent du corps PATCH, colonne inchangée ; null ou
    // "" = effacement explicite (voir SaisieManuelleAnnexe1Dto).
    const valeurs: Record<string, string | null> = {};
    for (const champ of CHAMPS_SAISIE_MANUELLE) {
      const valeurBrute = dto[champ];
      if (valeurBrute !== undefined) {
        valeurs[champ] = valeurBrute === null || valeurBrute === "" ? null : valeurBrute;
      }
    }

    const [existant] = await this.db
      .select()
      .from(annexe1SaisieManuelle)
      .where(and(eq(annexe1SaisieManuelle.bienId, bienId), eq(annexe1SaisieManuelle.annee, annee)))
      .limit(1);

    if (existant) {
      const [misAJour] = await mettreAJourAvecAudit(
        this.db,
        annexe1SaisieManuelle,
        existant.id,
        valeurs,
        this.requestContext.getUtilisateurId()
      );
      if (!misAJour) {
        throw new Error("Échec de la mise à jour de la saisie manuelle Annexe 1");
      }
      return this.versSaisieManuelle(misAJour as SaisieManuelleRow);
    }

    const [cree] = await this.db
      .insert(annexe1SaisieManuelle)
      .values({ bienId, annee, organisationId: bienConcerne.organisationId, ...valeurs })
      .returning();
    if (!cree) {
      throw new Error("Échec de la création de la saisie manuelle Annexe 1");
    }
    return this.versSaisieManuelle(cree);
  }

  private versSaisieManuelle(ligne: SaisieManuelleRow): Annexe1SaisieManuelle {
    return {
      ligne2: ligne.ligne2,
      ligne3: ligne.ligne3,
      ligne4: ligne.ligne4,
      ligne9Bis: ligne.ligne9Bis,
      ligne10: ligne.ligne10,
      ligne11: ligne.ligne11,
      ligne14: ligne.ligne14,
      ligne15: ligne.ligne15,
      ligne19: ligne.ligne19,
      ligne20: ligne.ligne20,
      ligne22: ligne.ligne22
    };
  }
}
