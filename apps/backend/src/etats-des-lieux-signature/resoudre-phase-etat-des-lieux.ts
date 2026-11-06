import { resoudrePhasesEtatDesLieux, type EntreePapierEtatDesLieux, type PhasesEtatDesLieux } from "core";
import { etatDesLieuxEntreePapier, etatDesLieuxSignature, type Database } from "db";
import { and, eq, inArray, isNull } from "drizzle-orm";

// Source de vérité UNIQUE des phases d'un état des lieux — réutilisée par
// DocumentsService (pour étiqueter une photo à l'upload), le verrou des
// champs et des photos (EtatsDesLieuxService, verrou-photos), la signature
// (EtatsDesLieuxSignatureService.chargerContexte) et le rattrapage des
// documents figés (EtatDesLieuxPdfService.trouverPhasesSigneesIncompletes).
// La règle elle-même (familles A et B) vit dans "core"
// (resoudrePhasesEtatDesLieux) ; ce fichier ne fait que relire la base.
//
// Ne dépend JAMAIS de date_entree/date_sortie : ces dates peuvent être
// posées sans aucune signature (bouton "Terminer" du parcours mobile
// actuel avant ce chantier, correction manuelle côté desktop) — seule
// l'existence d'une signature BAILLEUR pour la phase fait foi (voir
// docs/data-dictionary.md, section etat_des_lieux_signature : une
// signature bailleur garantit que toutes les signatures de la phase, y
// compris celles des locataires, ont été écrites dans la même transaction
// par EtatsDesLieuxSignatureService), ou, pour l'entrée, une déclaration
// papier.
//
// `db` typé `Pick<Database, "select">` pour accepter indifféremment le
// client racine ou une transaction (`tx`) — même principe que
// mettreAJourAvecAudit (packages/db/src/audit-write.ts).
export async function resoudrePhasesSigneesEtatDesLieux(
  db: Pick<Database, "select">,
  etatDesLieuxId: string
): Promise<PhasesEtatDesLieux> {
  const phases = await resoudrePhasesSigneesEtatsDesLieux(db, [etatDesLieuxId]);
  return phases.get(etatDesLieuxId) ?? resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: [], entreePapier: null });
}

// Même résolution pour plusieurs états des lieux en une seule requête par
// table. Sans `ids`, balaie tous les états des lieux qui ont au moins une
// signature bailleur ou une entrée papier (rattrapage système, sans
// contexte organisation) ; les autres n'ont rien de signé.
export async function resoudrePhasesSigneesEtatsDesLieux(
  db: Pick<Database, "select">,
  ids?: string[]
): Promise<Map<string, PhasesEtatDesLieux>> {
  if (ids !== undefined && ids.length === 0) {
    return new Map();
  }
  const signaturesBailleur = await db
    .select({ etatDesLieuxId: etatDesLieuxSignature.etatDesLieuxId, phase: etatDesLieuxSignature.phase })
    .from(etatDesLieuxSignature)
    .where(
      and(
        ids === undefined ? undefined : inArray(etatDesLieuxSignature.etatDesLieuxId, ids),
        eq(etatDesLieuxSignature.role, "bailleur"),
        isNull(etatDesLieuxSignature.archivedAt)
      )
    );

  // Déclaration papier active (au plus une par état des lieux, index unique
  // partiel etat_des_lieux_entree_papier_active_unique).
  const declarations = await db
    .select({
      etatDesLieuxId: etatDesLieuxEntreePapier.etatDesLieuxId,
      dateSignature: etatDesLieuxEntreePapier.dateSignature,
      lieu: etatDesLieuxEntreePapier.lieu,
      signataires: etatDesLieuxEntreePapier.signataires
    })
    .from(etatDesLieuxEntreePapier)
    .where(
      and(
        ids === undefined ? undefined : inArray(etatDesLieuxEntreePapier.etatDesLieuxId, ids),
        isNull(etatDesLieuxEntreePapier.archivedAt)
      )
    );
  const entreesPapier = new Map<string, EntreePapierEtatDesLieux>(
    declarations.map((d) => [
      d.etatDesLieuxId,
      { dateSignature: d.dateSignature, lieu: d.lieu, nomsSignataires: d.signataires.map((s) => s.nomAffiche) }
    ])
  );

  const phasesParEtat = new Map<string, ("entree" | "sortie")[]>();
  for (const id of ids ?? []) {
    phasesParEtat.set(id, []);
  }
  for (const { etatDesLieuxId, phase } of signaturesBailleur) {
    phasesParEtat.set(etatDesLieuxId, [...(phasesParEtat.get(etatDesLieuxId) ?? []), phase]);
  }
  for (const id of entreesPapier.keys()) {
    if (!phasesParEtat.has(id)) {
      phasesParEtat.set(id, []);
    }
  }

  const resultat = new Map<string, PhasesEtatDesLieux>();
  for (const [etatDesLieuxId, phasesSigneesParBailleur] of phasesParEtat) {
    resultat.set(
      etatDesLieuxId,
      resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur, entreePapier: entreesPapier.get(etatDesLieuxId) ?? null })
    );
  }
  return resultat;
}

// Famille A : une entrée papier fait aussi basculer les nouvelles photos en
// phase de sortie.
export async function resoudrePhaseEtatDesLieuxCourante(
  db: Pick<Database, "select">,
  etatDesLieuxId: string
): Promise<"entree" | "sortie"> {
  const { entreeSignee } = await resoudrePhasesSigneesEtatDesLieux(db, etatDesLieuxId);
  return entreeSignee ? "sortie" : "entree";
}
