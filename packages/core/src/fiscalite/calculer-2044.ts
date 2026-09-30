import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

// Formulaire 2044 (revenus fonciers, régime réel) — biens détenus en nom
// propre (bien.proprietaireType = 'personne_physique'), périmètre resserré
// à 4 lignes de frais automatiques (voir mapping-categorie-2044.ts pour le
// détail des lignes exclues et pourquoi). Fonction pure, même principe que
// calculerAnnexe1 (2072-S) : les lignes automatiques (déjà agrégées côté
// backend depuis getRevenusLocatifs/depense) sont fournies en entrée,
// jamais recalculées ici depuis une source de données. Pas de paramètre de
// saisie manuelle pour l'instant — aucune ligne de ce périmètre n'en a
// besoin (225/226, qui en auraient eu besoin, sont hors périmètre).
export interface Formulaire2044LignesAutomatiques {
  ligne211: string;
  ligne221: string;
  ligne223: string;
  ligne224: string;
  ligne227: string;
}

export interface Formulaire2044Calcule {
  ligne211: string;
  // 212 (recettes brutes diverses) et 213 : aucune source de données dans
  // cette tranche (pas de saisie manuelle ouverte côté 2044) — toujours
  // "0.00", présentes dans le calcul uniquement pour rester fidèles à la
  // formule officielle (215 = 211+212+213) et permettre un futur
  // branchement sans changer la signature de cette fonction.
  ligne212: string;
  ligne213: string;
  ligne215: string;
  ligne221: string;
  ligne223: string;
  ligne224: string;
  ligne227: string;
  // Somme des 4 lignes automatiques du périmètre retenu UNIQUEMENT — PAS
  // la vraie ligne 240 du formulaire officiel, qui somme aussi 222, 225,
  // 226, 229-230 et 250, toutes hors périmètre ici. Nom conservé pour
  // rester traçable au formulaire ; la limite de périmètre doit être
  // rappelée partout où cette ligne est affichée (voir FiscaliteView).
  ligne240: string;
  ligne261: string;
  ligne263: string;
}

export function calculerFormulaire2044(automatiques: Formulaire2044LignesAutomatiques): Formulaire2044Calcule {
  const c211 = montantEnCentimes(automatiques.ligne211);
  const c212 = 0;
  const c213 = 0;
  const c215 = c211 + c212 + c213;

  const c221 = montantEnCentimes(automatiques.ligne221);
  const c223 = montantEnCentimes(automatiques.ligne223);
  const c224 = montantEnCentimes(automatiques.ligne224);
  const c227 = montantEnCentimes(automatiques.ligne227);
  const c240 = c221 + c223 + c224 + c227;

  // 261 = revenu foncier (215-240) ; 263 = revenu foncier imposable, sans
  // ligne 262 dans ce périmètre (déficit reportable des années
  // antérieures, hors périmètre — voir lignes 430-451).
  const c261 = c215 - c240;
  const c263 = c261;

  return {
    ligne211: centimesVersMontant(c211),
    ligne212: centimesVersMontant(c212),
    ligne213: centimesVersMontant(c213),
    ligne215: centimesVersMontant(c215),
    ligne221: centimesVersMontant(c221),
    ligne223: centimesVersMontant(c223),
    ligne224: centimesVersMontant(c224),
    ligne227: centimesVersMontant(c227),
    ligne240: centimesVersMontant(c240),
    ligne261: centimesVersMontant(c261),
    ligne263: centimesVersMontant(c263)
  };
}
