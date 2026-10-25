import { etatDesLieuxSignature, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";

// Source de vérité UNIQUE de la phase courante d'un état des lieux —
// réutilisée par DocumentsService (pour étiqueter une photo à l'upload)
// et par le futur verrou (EtatsDesLieuxService). Ne dépend JAMAIS de
// date_entree/date_sortie : ces dates peuvent être posées sans aucune
// signature (bouton "Terminer" du parcours mobile actuel avant ce
// chantier, correction manuelle côté desktop, état des lieux papier
// ressaisi après coup) — seule l'existence d'une signature BAILLEUR pour
// la phase fait foi (voir docs/data-dictionary.md, section
// etat_des_lieux_signature : une signature bailleur garantit que toutes
// les signatures de la phase, y compris celles des locataires, ont été
// écrites dans la même transaction par EtatsDesLieuxSignatureService).
//
// `db` typé `Pick<Database, "select">` pour accepter indifféremment le
// client racine ou une transaction (`tx`) — même principe que
// mettreAJourAvecAudit (packages/db/src/audit-write.ts).
//
// Centralise la requête déjà dupliquée à trois endroits avant le commit du
// verrou (EtatsDesLieuxService.versDto, EtatsDesLieuxSignatureService
// .chargerContexte, resoudrePhaseEtatDesLieuxCourante ci-dessous) — un seul
// point de vérité pour "quelles phases sont signées côté bailleur",
// consommé aussi par le verrou des submitX()/updateHeader() et par le
// verrou des photos (verrou-photos-etat-des-lieux.ts).
export async function resoudrePhasesSigneesEtatDesLieux(
  db: Pick<Database, "select">,
  etatDesLieuxId: string
): Promise<{ entreeSignee: boolean; sortieSignee: boolean }> {
  const signaturesBailleur = await db
    .select({ phase: etatDesLieuxSignature.phase })
    .from(etatDesLieuxSignature)
    .where(
      and(
        eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId),
        eq(etatDesLieuxSignature.role, "bailleur"),
        isNull(etatDesLieuxSignature.archivedAt)
      )
    );
  const phasesSignees = new Set(signaturesBailleur.map((ligne) => ligne.phase));
  return { entreeSignee: phasesSignees.has("entree"), sortieSignee: phasesSignees.has("sortie") };
}

export async function resoudrePhaseEtatDesLieuxCourante(
  db: Pick<Database, "select">,
  etatDesLieuxId: string
): Promise<"entree" | "sortie"> {
  const { entreeSignee } = await resoudrePhasesSigneesEtatDesLieux(db, etatDesLieuxId);
  return entreeSignee ? "sortie" : "entree";
}
