// Répliqué depuis packages/db/src/schema/bien.ts (bienTypeEnum) — packages/core
// reste indépendant de Drizzle/Node (CLAUDE.md), donc pas d'import direct du
// schéma ; cette liste doit rester synchronisée avec l'enum SQL `bien_type`.
export type TypeBien = "immeuble" | "maison" | "appartement_isole" | "parking" | "bureau" | "local_commercial";

// Un immeuble/maison/appartement_isole est un logement d'habitation, régi
// par le contrat-type résidentiel (décret n° 2015-587) : nombre de pièces
// principales, mode de chauffage/eau chaude, équipement de cuisine et
// composition (chambres/salles de bain/WC) y ont un sens légal.
// Un parking/bureau/local_commercial n'est pas un logement : ces champs
// n'ont pas d'équivalent et la génération de bail/état des lieux au format
// résidentiel actuel ne s'applique pas (docs/backlog.md, audit du
// 2026-08-27). `Record<TypeBien, boolean>` plutôt qu'une liste positive ou
// négative isolée : le compilateur force la mise à jour de cette table si
// un type est ajouté à `TypeBien`, au lieu d'un défaut implicite qui
// classerait silencieusement un nouveau type dans la mauvaise catégorie.
const RESIDENTIEL_PAR_TYPE: Record<TypeBien, boolean> = {
  immeuble: true,
  maison: true,
  appartement_isole: true,
  parking: false,
  bureau: false,
  local_commercial: false
};

export function estTypeResidentiel(type: TypeBien): boolean {
  return RESIDENTIEL_PAR_TYPE[type];
}
