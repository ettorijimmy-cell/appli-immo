// Résolveur unique des phases d'un état des lieux (reprise d'une entrée
// papier, 2026-11-06). Deux familles d'usages, à ne jamais confondre :
//
// - A, le verrou : `entreeSignee` vaut vrai dès que l'entrée est acquise,
//   signée numériquement OU déclarée sur papier. Tout ce qui fige des
//   champs, bloque des photos, autorise la sortie ou interdit l'abandon
//   d'un brouillon lit `entreeSignee`.
// - B, les artefacts de la signature numérique (bloc de signatures du
//   document, PDF figé d'entrée, envoi de l'entrée, carte Signatures,
//   bouton d'envoi mobile) : ils n'existent que pour une entrée signée
//   numériquement, et lisent `phaseSigneeNumeriquement`.
//
// La sortie se signe toujours numériquement : `sortieSignee` sert aux deux
// familles.

type Phase = "entree" | "sortie";

// Entrée établie et signée sur papier. Lue depuis
// etat_des_lieux_entree_papier à partir du commit qui crée cette table ;
// toujours null avant.
export interface EntreePapierEtatDesLieux {
  // AAAA-MM-JJ
  dateSignature: string;
  lieu: string;
  nomsSignataires: string[];
}

export interface PhasesEtatDesLieux {
  // Famille A : entrée acquise, numérique ou papier.
  entreeSignee: boolean;
  entreePapier: EntreePapierEtatDesLieux | null;
  sortieSignee: boolean;
}

// Une phase est signée numériquement dès qu'une signature bailleur non
// archivée existe pour elle (la transaction de signature écrit toutes les
// signatures de la phase ensemble, voir docs/data-dictionary.md, section
// etat_des_lieux_signature).
export function resoudrePhasesEtatDesLieux(source: {
  phasesSigneesParBailleur: Iterable<Phase>;
  entreePapier: EntreePapierEtatDesLieux | null;
}): PhasesEtatDesLieux {
  const signees = new Set(source.phasesSigneesParBailleur);
  return {
    entreeSignee: signees.has("entree") || source.entreePapier !== null,
    entreePapier: source.entreePapier,
    sortieSignee: signees.has("sortie")
  };
}

// Même résultat depuis la forme renvoyée par l'API (entreeSigneeParTous =
// entreeSignee). Un entreePapier absent compte comme null : un client plus
// ancien que le champ n'est jamais pris pour une entrée papier.
export function phasesDepuisEtatDesLieux(etat: {
  entreeSigneeParTous: boolean;
  sortieSigneeParTous: boolean;
  entreePapier?: EntreePapierEtatDesLieux | null;
}): PhasesEtatDesLieux {
  return {
    entreeSignee: etat.entreeSigneeParTous,
    entreePapier: etat.entreePapier ?? null,
    sortieSignee: etat.sortieSigneeParTous
  };
}

// Famille B : la phase porte des signatures numériques (et donc un bloc de
// signatures, un PDF figé, un envoi). Une entrée papier n'en a aucune.
export function phaseSigneeNumeriquement(phases: PhasesEtatDesLieux, phase: Phase): boolean {
  return phase === "entree" ? phases.entreeSignee && phases.entreePapier === null : phases.sortieSignee;
}
