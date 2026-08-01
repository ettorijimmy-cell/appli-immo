import { Inject, Injectable } from "@nestjs/common";
import { indicesIrl, type Database } from "db";
import { desc } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";

// Série BDM 001515333 = "Indice de référence des loyers (IRL)" — point
// d'accès confirmé par test direct (pas supposé), voir docs/backlog.md,
// section "Édition d'un bail". `lastNObservations=1` : ne récupère que la
// dernière valeur publiée, jamais tout l'historique.
const URL_INSEE_IRL = "https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001515333?lastNObservations=1";

export interface ObservationIrl {
  annee: number;
  trimestre: number;
  valeur: string;
}

@Injectable()
export class IndicesIrlService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /**
   * Réponse INSEE en XML SDMX-ML — un seul <Obs TIME_PERIOD="AAAA-Qn"
   * OBS_VALUE="..." .../> attendu avec lastNObservations=1. Parsing par
   * expression régulière plutôt qu'un parseur XML complet : structure
   * fixe et déjà vérifiée, pas de dépendance supplémentaire pour un seul
   * usage.
   */
  parserReponseInsee(xml: string): ObservationIrl {
    const obsMatch = xml.match(/<Obs\b[^>]*\/>/);
    if (!obsMatch) {
      throw new Error("Réponse INSEE inattendue : aucune observation trouvée");
    }
    const obsTag = obsMatch[0];
    const periode = obsTag.match(/TIME_PERIOD="(\d{4})-Q([1-4])"/);
    const valeur = obsTag.match(/OBS_VALUE="([\d.]+)"/);
    if (!periode || !valeur) {
      throw new Error("Réponse INSEE inattendue : période ou valeur manquante dans l'observation");
    }
    return { annee: Number(periode[1]), trimestre: Number(periode[2]), valeur: valeur[1] as string };
  }

  async recupererDerniereObservationInsee(): Promise<ObservationIrl> {
    const reponse = await fetch(URL_INSEE_IRL);
    if (!reponse.ok) {
      throw new Error(`L'API INSEE a répondu avec le statut ${reponse.status}`);
    }
    const xml = await reponse.text();
    return this.parserReponseInsee(xml);
  }

  // Idempotent : une nouvelle ligne n'est ajoutée que pour un (année,
  // trimestre) pas encore connu — une valeur déjà publiée n'est jamais
  // réécrite (contrainte d'unicité indices_irl_annee_trimestre_unique).
  async synchroniser(): Promise<void> {
    const observation = await this.recupererDerniereObservationInsee();
    await this.db.insert(indicesIrl).values(observation).onConflictDoNothing();
  }

  async obtenirDerniereValeur() {
    const [ligne] = await this.db
      .select()
      .from(indicesIrl)
      .orderBy(desc(indicesIrl.annee), desc(indicesIrl.trimestre))
      .limit(1);
    return ligne ?? null;
  }
}
