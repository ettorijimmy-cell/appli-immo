import { listBaux, listLocataires, type Bail } from "../locataires/api";
import { libelleBien, listAppartements, listBiens, type Bien } from "../patrimoine/api";
import { listScis } from "../scis/api";
import type { EntiteRecherchable } from "./recherche";

// Charge tout le patrimoine + tous les locataires en une fois : à l'échelle
// visée (~20 logements), un chargement complet à chaque ouverture de la
// palette est trivial, et évite d'introduire un vrai moteur de recherche
// côté backend pour ce module.
export async function chargerEntitesRecherchables(): Promise<EntiteRecherchable[]> {
  const [scis, biens, appartements, locataires] = await Promise.all([
    listScis(),
    listBiens(),
    listAppartements(),
    listLocataires()
  ]);

  const biensParId = new Map<string, Bien>(biens.map((bien) => [bien.id, bien]));

  const entitesScis: EntiteRecherchable[] = scis
    .filter((sci) => sci.statut !== "archive")
    .map((sci) => ({
      type: "sci",
      id: sci.id,
      libelle: sci.nom,
      detail: "SCI",
      texteRecherchable: sci.nom.toLowerCase()
    }));

  const entitesBiens: EntiteRecherchable[] = biens
    .filter((bien) => bien.statut !== "archive")
    .map((bien) => ({
      type: "bien",
      id: bien.id,
      libelle: libelleBien(bien),
      detail: "Bien",
      texteRecherchable: `${libelleBien(bien)} ${bien.adresse}`.toLowerCase()
    }));

  const entitesAppartements: EntiteRecherchable[] = appartements
    .filter((appartement) => appartement.statut !== "archive")
    .map((appartement) => {
      const bien = biensParId.get(appartement.bienId);
      const nomBien = bien ? libelleBien(bien) : "bien inconnu";
      return {
        type: "appartement",
        id: appartement.id,
        libelle: `Appartement ${appartement.numero} — ${nomBien}`,
        detail: "Appartement",
        texteRecherchable: `${appartement.numero} ${nomBien}`.toLowerCase()
      };
    });

  const entitesLocataires: EntiteRecherchable[] = locataires
    .filter((locataire) => locataire.statut !== "archive")
    .map((locataire) => ({
      type: "locataire",
      id: locataire.id,
      libelle: `${locataire.prenom} ${locataire.nom}`,
      detail: "Locataire",
      texteRecherchable: `${locataire.prenom} ${locataire.nom}`.toLowerCase()
    }));

  return [...entitesScis, ...entitesBiens, ...entitesAppartements, ...entitesLocataires];
}

export interface BailRecherchable {
  bail: Bail;
  libelle: string;
  texteRecherchable: string;
}

const STATUTS_BAIL_ELIGIBLES_PAIEMENT = new Set(["actif", "preavis"]);

// Baux éligibles à un nouveau paiement (mêmes critères que
// NewPaiementForm dans FinancesListView.tsx) — pas de doublon de règle,
// juste une réutilisation du même filtre de statut.
export async function chargerBauxRecherchables(
  chargerContexte: (bailId: string) => Promise<{
    sciNom: string | null;
    bienNom: string;
    appartementNumero: string;
    locatairesNoms: string;
  }>
): Promise<BailRecherchable[]> {
  const tousLesBaux = await listBaux();
  const eligibles = tousLesBaux.filter((bail) => STATUTS_BAIL_ELIGIBLES_PAIEMENT.has(bail.statut));
  return Promise.all(
    eligibles.map(async (bail) => {
      const contexte = await chargerContexte(bail.id);
      const libelle = `${contexte.sciNom ? `${contexte.sciNom} / ` : ""}${contexte.bienNom} / n°${contexte.appartementNumero} — ${contexte.locatairesNoms || "sans locataire"}`;
      return { bail, libelle, texteRecherchable: libelle.toLowerCase() };
    })
  );
}
