import { getEtatDesLieuxById } from "../etats-des-lieux/api";
import { chargerContexteBail, creerCachesContexteBail, type CachesContexteBail } from "../finances/contexte-bail";
import { getGarant, getLocataire } from "../locataires/api";
import { getAppartement, getBien, libelleBien } from "../patrimoine/api";
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
// le même principe appliqué aux paiements). Migré le 2026-08-26 (migration
// bien, Étape 5) : 'immeuble' reste réservé aux documents déjà rattachés à
// une ligne immeubles existante ; 'bien' est le chemin pour tout document
// rattaché à un bien créé via BienService (y compris un immeuble créé après
// cette date).
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
          const bien = await getBien(entiteId);
          return libelleBien(bien);
        }
        case "bien": {
          const bien = await getBien(entiteId);
          return libelleBien(bien);
        }
        case "appartement": {
          const appartement = await getAppartement(entiteId);
          const bien = await getBien(appartement.bienId);
          return `${libelleBien(bien)} — n°${appartement.numero}`;
        }
        case "locataire": {
          const locataire = await getLocataire(entiteId);
          return `${locataire.prenom} ${locataire.nom}`;
        }
        case "bail": {
          const contexte = await chargerContexteBail(entiteId, cache.contexteBail);
          return `${contexte.bienNom} — n°${contexte.appartementNumero}${
            contexte.locatairesNoms ? ` (${contexte.locatairesNoms})` : ""
          }`;
        }
        case "etat_des_lieux": {
          const etatDesLieux = await getEtatDesLieuxById(entiteId);
          const contexte = await chargerContexteBail(etatDesLieux.bailId, cache.contexteBail);
          return `État des lieux — ${contexte.bienNom} n°${contexte.appartementNumero}`;
        }
        case "garant": {
          const garant = await getGarant(entiteId);
          return `${garant.prenom} ${garant.nom} (garant)`;
        }
      }
    } catch {
      return "Entité introuvable";
    }
  })();

  cache.libelles.set(cle, libelle);
  return libelle;
}
