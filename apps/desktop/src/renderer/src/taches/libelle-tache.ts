import { chargerContexteBail, creerCachesContexteBail, type CachesContexteBail } from "../finances/contexte-bail";
import { getAppartement, getBien, libelleBien } from "../patrimoine/api";
import type { Tache } from "./api";

export interface CacheLibellesTaches {
  contexteBail: CachesContexteBail;
  libelles: Map<string, string>;
}

export function creerCacheLibellesTaches(): CacheLibellesTaches {
  return { contexteBail: creerCachesContexteBail(), libelles: new Map() };
}

// Une tâche référence bailId/appartementId/bienId directement (pas de lien
// polymorphe entiteType/entiteId comme documents/alertes) : résout le
// libellé le plus précis disponible, dans cet ordre — bail (via
// finances/contexte-bail.ts, même mécanisme que la liste Finances) puis
// appartement puis bien seul.
export async function resoudreLibelleTache(tache: Tache, cache: CacheLibellesTaches): Promise<string> {
  const cle = tache.bailId ?? tache.appartementId ?? tache.bienId ?? tache.id;
  const enCache = cache.libelles.get(cle);
  if (enCache) {
    return enCache;
  }

  const libelle = await (async () => {
    try {
      if (tache.bailId) {
        const contexte = await chargerContexteBail(tache.bailId, cache.contexteBail);
        return `${contexte.bienNom} — n°${contexte.appartementNumero}`;
      }
      if (tache.appartementId) {
        const appartement = await getAppartement(tache.appartementId);
        const bien = await getBien(appartement.bienId);
        return `${libelleBien(bien)} — n°${appartement.numero}`;
      }
      if (tache.bienId) {
        const bien = await getBien(tache.bienId);
        return libelleBien(bien);
      }
      return "—";
    } catch {
      return "Entité introuvable";
    }
  })();

  cache.libelles.set(cle, libelle);
  return libelle;
}
