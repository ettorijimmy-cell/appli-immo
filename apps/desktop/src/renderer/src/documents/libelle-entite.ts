import { getEtatDesLieuxById } from "../etats-des-lieux/api";
import { chargerContexteBail, creerCachesContexteBail, type CachesContexteBail } from "../finances/contexte-bail";
import { getLocataire } from "../locataires/api";
import { getAppartement, getImmeuble } from "../patrimoine/api";
import { getSci } from "../scis/api";
import type { DocumentEntiteType } from "./api";

export interface CacheLibellesEntites {
  contexteBail: CachesContexteBail;
  libelles: Map<string, string>;
}

export function creerCacheLibellesEntites(): CacheLibellesEntites {
  return { contexteBail: creerCachesContexteBail(), libelles: new Map() };
}

// Un document ne porte que entiteType/entiteId (lien polymorphe) : reconstitue
// un libellé affichable pour l'écran Documents centralisé, avec mise en cache
// le temps d'un enrichissement de liste (voir finances/contexte-bail.ts pour
// le même principe appliqué aux paiements).
export async function resoudreLibelleEntite(
  entiteType: DocumentEntiteType,
  entiteId: string,
  cache: CacheLibellesEntites
): Promise<string> {
  const cle = `${entiteType}:${entiteId}`;
  const enCache = cache.libelles.get(cle);
  if (enCache) {
    return enCache;
  }

  const libelle = await (async () => {
    try {
      switch (entiteType) {
        case "sci": {
          const sci = await getSci(entiteId);
          return sci.nom;
        }
        case "immeuble": {
          const immeuble = await getImmeuble(entiteId);
          return immeuble.nom;
        }
        case "appartement": {
          const appartement = await getAppartement(entiteId);
          const immeuble = await getImmeuble(appartement.immeubleId);
          return `${immeuble.nom} — n°${appartement.numero}`;
        }
        case "locataire": {
          const locataire = await getLocataire(entiteId);
          return `${locataire.prenom} ${locataire.nom}`;
        }
        case "bail": {
          const contexte = await chargerContexteBail(entiteId, cache.contexteBail);
          return `${contexte.immeubleNom} — n°${contexte.appartementNumero}${
            contexte.locatairesNoms ? ` (${contexte.locatairesNoms})` : ""
          }`;
        }
        case "etat_des_lieux": {
          const etatDesLieux = await getEtatDesLieuxById(entiteId);
          const contexte = await chargerContexteBail(etatDesLieux.bailId, cache.contexteBail);
          return `État des lieux — ${contexte.immeubleNom} n°${contexte.appartementNumero}`;
        }
      }
    } catch {
      return "Entité introuvable";
    }
  })();

  cache.libelles.set(cle, libelle);
  return libelle;
}
