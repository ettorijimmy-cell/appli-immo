import { useSearchParams } from "react-router-dom";
import { CalendrierView, type CalendrierViewProps } from "../calendrier/CalendrierView";
import type { EvenementType } from "../calendrier/api";

const TYPES_VALIDES: EvenementType[] = ["intervention_artisan", "visite_candidat", "etat_des_lieux", "expertise_sinistre", "autre"];

export function CalendrierPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();

  // Deep-link depuis la fiche sinistre (bouton "Créer un rendez-vous
  // d'expertise", Module Suivi sinistre et assurance, 2026-09-16) : ouvre
  // directement le formulaire de création, pré-rempli mais jamais soumis
  // automatiquement — voir CalendrierView.prefiltrageInitial. Même pattern
  // de deep-link par query params que PatrimoinePage (Module 8).
  const sinistreId = searchParams.get("sinistreId");
  const typeBrut = searchParams.get("type");
  const type = TYPES_VALIDES.includes(typeBrut as EvenementType) ? (typeBrut as EvenementType) : null;
  const bienId = searchParams.get("bienId");
  const appartementId = searchParams.get("appartementId");

  const prefiltrageInitial: NonNullable<CalendrierViewProps["prefiltrageInitial"]> | null =
    sinistreId && type
      ? {
          type,
          sinistreId,
          ...(bienId && { bienId }),
          ...(appartementId && { appartementId })
        }
      : null;

  return <CalendrierView {...(prefiltrageInitial && { prefiltrageInitial })} />;
}
