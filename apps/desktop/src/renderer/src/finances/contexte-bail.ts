import { getBail, getLocataire, listBailLocataires, type Bail } from "../locataires/api";
import { getAppartement, getBien, libelleBien } from "../patrimoine/api";
import { getSci } from "../scis/api";

export interface ContexteBail {
  sciId: string | null;
  sciNom: string | null;
  bienNom: string;
  appartementNumero: string;
  locatairesNoms: string;
}

export interface CachesContexteBail {
  baux: Map<string, Bail>;
  appartements: Map<string, { bienId: string; numero: string }>;
  biens: Map<string, { sciId: string | null; nom: string }>;
  scis: Map<string, string>;
}

export function creerCachesContexteBail(): CachesContexteBail {
  return { baux: new Map(), appartements: new Map(), biens: new Map(), scis: new Map() };
}

// Un paiement ne porte que bailId : reconstitue le contexte affichable
// (SCI / bien / appartement / locataires) via des appels en cascade, mis
// en cache le temps d'un enrichissement (liste ou import CSV) pour ne pas
// refaire les mêmes requêtes pour chaque paiement d'un même bail. Migré le
// 2026-08-26 (migration bien, Étape 5) : un bien en nom propre
// (proprietaireType='personne_physique') n'a pas de SCI — sciId/sciNom
// restent alors null plutôt que d'appeler /scis/:id avec un id absent.
export async function chargerContexteBail(
  bailId: string,
  caches: CachesContexteBail
): Promise<ContexteBail> {
  let bail = caches.baux.get(bailId);
  if (!bail) {
    bail = await getBail(bailId);
    caches.baux.set(bailId, bail);
  }

  let appartement = caches.appartements.get(bail.appartementId);
  if (!appartement) {
    const data = await getAppartement(bail.appartementId);
    appartement = { bienId: data.bienId, numero: data.numero };
    caches.appartements.set(bail.appartementId, appartement);
  }

  let bien = caches.biens.get(appartement.bienId);
  if (!bien) {
    const data = await getBien(appartement.bienId);
    bien = { sciId: data.sciId, nom: libelleBien(data) };
    caches.biens.set(appartement.bienId, bien);
  }

  let sciNom: string | null = null;
  if (bien.sciId) {
    sciNom = caches.scis.get(bien.sciId) ?? null;
    if (!sciNom) {
      const sci = await getSci(bien.sciId);
      sciNom = sci.nom;
      caches.scis.set(bien.sciId, sciNom);
    }
  }

  const liens = await listBailLocataires({ bailId });
  const locataires = await Promise.all(
    liens
      .filter((lien) => lien.archivedAt === null)
      .map((lien) => getLocataire(lien.locataireId).catch(() => null))
  );
  const locatairesNoms = locataires
    .filter((locataire): locataire is NonNullable<typeof locataire> => locataire !== null)
    .map((locataire) => `${locataire.prenom} ${locataire.nom}`)
    .join(", ");

  return {
    sciId: bien.sciId,
    sciNom,
    bienNom: bien.nom,
    appartementNumero: appartement.numero,
    locatairesNoms
  };
}
