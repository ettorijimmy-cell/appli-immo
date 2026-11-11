import { formaterDateCourteFr, LIBELLES_MODE_REMISE_BAIL, remiseBailNonDeclareeASignaler } from "core";
import type { Bail, BailLocataire, DeclarationRemiseBail, EngagementCaution, Garant, SuiviCaution } from "./api";
import { nomAfficheGarant } from "./garant-formulaire";

// Suivi d'une caution personne physique (chantier garants, commit 6) :
// textes affichés sous chaque caution (onglet « Bail actuel », fiche
// locataire) et lignes de l'encadré d'avertissements.

export const MENTION_REMISE_NON_DECLAREE =
  "Non déclarée — un exemplaire du bail doit être remis à la caution (loi n° 89-462, art. 22-1)";

export const LIBELLE_AVERTISSEMENT_REMISE_NON_DECLAREE = "Remise du bail non déclarée";

// « Remis le 20/06/2026 (En main propre) ».
export function libelleRemiseBail(declaration: Pick<DeclarationRemiseBail, "dateRemise" | "mode">): string {
  return `Remis le ${formaterDateCourteFr(declaration.dateRemise)} (${LIBELLES_MODE_REMISE_BAIL[declaration.mode]})`;
}

// « Engagement jusqu'au 30/06/2035 », même date que l'acte. Sans durée de
// bail déterminable, le motif renvoyé par le backend.
export function libelleEngagement(engagement: EngagementCaution): string {
  return engagement.dateFinEngagement === null
    ? (engagement.motifIndisponible ?? "Fin d'engagement non calculable.")
    : `Engagement jusqu'au ${formaterDateCourteFr(engagement.dateFinEngagement)}`;
}

// Colocation (art. 8-1, VI) : affiché seulement si le colocataire garanti a
// une date d'effet de congé. Le remplacement n'est pas détecté : la règle
// est énoncée, les deux dates données.
export function libelleFinEngagementColocation(engagement: EngagementCaution): string | null {
  if (engagement.colocation === null) {
    return null;
  }
  const { siRemplace, auPlusTard } = engagement.colocation;
  return (
    `Engagement terminé à la date d'effet du congé (${formaterDateCourteFr(siRemplace)}) ` +
    `si un nouveau colocataire a été ajouté au bail, sinon au plus tard le ${formaterDateCourteFr(auPlusTard)}`
  );
}

export interface LigneRemiseNonDeclaree {
  cle: string;
  libelle: string;
  lieu: string;
}

// Une ligne par caution personne physique sans déclaration active, une fois
// le bail sorti du brouillon (règle dans packages/core). Une caution dont le
// suivi n'a pas pu être lu n'est pas signalée (rien d'affirmé sans donnée).
export function lignesRemiseNonDeclaree(
  bail: Pick<Bail, "statut">,
  garants: readonly Garant[],
  suivis: ReadonlyMap<string, SuiviCaution>
): LigneRemiseNonDeclaree[] {
  return garants.flatMap((garant) => {
    const suivi = suivis.get(garant.id);
    if (
      suivi === undefined ||
      !remiseBailNonDeclareeASignaler({
        statutBail: bail.statut,
        typeGarantie: garant.typeGarantie,
        garantArchive: garant.archivedAt !== null,
        declarationActive: suivi.remise.active !== null
      })
    ) {
      return [];
    }
    return [{ cle: `remise-${garant.id}`, libelle: LIBELLE_AVERTISSEMENT_REMISE_NON_DECLAREE, lieu: nomAfficheGarant(garant) }];
  });
}

// Champ « Date d'effet du congé » : proposé sur un bail à plusieurs
// locataires, ou dès qu'une date est déjà posée (pour pouvoir la vider).
export function proposerDateEffetConge(nombreLocatairesAuBail: number, dateEffetConge: string | null): boolean {
  return nombreLocatairesAuBail > 1 || dateEffetConge !== null;
}

// Colocataire garanti déjà retiré du bail (mention « n'est plus au bail ») :
// son lien le plus récemment retiré, où la date d'effet du congé reste
// saisissable depuis sa caution. null si la caution ne vise personne ou si
// le colocataire est toujours au bail (le champ est alors dans la liste des
// colocataires).
export function lienRetireDuGaranti(
  garant: Pick<Garant, "locataireId">,
  liens: readonly BailLocataire[]
): BailLocataire | null {
  if (garant.locataireId === null) {
    return null;
  }
  const liensDuGaranti = liens.filter((lien) => lien.locataireId === garant.locataireId);
  if (liensDuGaranti.length === 0 || liensDuGaranti.some((lien) => lien.archivedAt === null)) {
    return null;
  }
  return [...liensDuGaranti].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))[0] ?? null;
}
