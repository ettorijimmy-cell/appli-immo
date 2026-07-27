import { getBail, getLocataire, listBailLocataires, type Bail } from "../locataires/api";
import { getAppartement, getImmeuble } from "../patrimoine/api";
import { getSci } from "../scis/api";

export interface ContexteBail {
  sciId: string;
  sciNom: string;
  immeubleNom: string;
  appartementNumero: string;
  locatairesNoms: string;
}

export interface CachesContexteBail {
  baux: Map<string, Bail>;
  appartements: Map<string, { immeubleId: string; numero: string }>;
  immeubles: Map<string, { sciId: string; nom: string }>;
  scis: Map<string, string>;
}

export function creerCachesContexteBail(): CachesContexteBail {
  return { baux: new Map(), appartements: new Map(), immeubles: new Map(), scis: new Map() };
}

// Un paiement ne porte que bailId : reconstitue le contexte affichable
// (SCI / immeuble / appartement / locataires) via des appels en cascade,
// mis en cache le temps d'un enrichissement (liste ou import CSV) pour ne
// pas refaire les mêmes requêtes pour chaque paiement d'un même bail.
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
    appartement = { immeubleId: data.immeubleId, numero: data.numero };
    caches.appartements.set(bail.appartementId, appartement);
  }

  let immeuble = caches.immeubles.get(appartement.immeubleId);
  if (!immeuble) {
    const data = await getImmeuble(appartement.immeubleId);
    immeuble = { sciId: data.sciId, nom: data.nom };
    caches.immeubles.set(appartement.immeubleId, immeuble);
  }

  let sciNom = caches.scis.get(immeuble.sciId);
  if (!sciNom) {
    const sci = await getSci(immeuble.sciId);
    sciNom = sci.nom;
    caches.scis.set(immeuble.sciId, sciNom);
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
    sciId: immeuble.sciId,
    sciNom,
    immeubleNom: immeuble.nom,
    appartementNumero: appartement.numero,
    locatairesNoms
  };
}
