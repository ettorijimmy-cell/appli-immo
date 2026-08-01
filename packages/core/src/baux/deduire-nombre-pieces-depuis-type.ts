const NOMBRE_PIECES_PAR_TYPE: Record<string, number> = {
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
  T6: 6
};

/**
 * Déduit le nombre de pièces principales depuis la catégorie commerciale
 * de l'appartement (T1→1 ... T6→6). `type` accepté en `string` plutôt que
 * l'union stricte `AppartementType` : si une catégorie au-delà de T6
 * apparaît un jour (aucun cas aujourd'hui), cette fonction doit continuer
 * à compiler et renvoyer `null` plutôt que de deviner un nombre de
 * pièces — c'est alors au contrôle de complétude de bloquer la
 * génération du bail avec un message explicite (docs/backlog.md, section
 * "Édition d'un bail").
 */
export function deduireNombrePiecesDepuisType(type: string): number | null {
  return NOMBRE_PIECES_PAR_TYPE[type] ?? null;
}
