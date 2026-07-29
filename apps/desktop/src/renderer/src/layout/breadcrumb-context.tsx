import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface BreadcrumbContextValue {
  segments: string[];
  setSegments: (segments: string[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [segments, setSegments] = useState<string[]>([]);
  const value = useMemo(() => ({ segments, setSegments }), [segments]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbSegmentsValue(): string[] {
  return useContext(BreadcrumbContext)?.segments ?? [];
}

// Finalise le fil d'Ariane sur les fiches imbriquées (SCI > Immeuble >
// Appartement, Module 2 ; Locataire, Module 3) qui vivent en état local de
// composant plutôt qu'en routes séparées (voir PatrimoinePage.tsx) — une
// fiche appelle ce hook une fois ses données chargées pour ajouter ses
// propres segments après celui de la section de navigation. Réinitialisé
// au démontage pour ne jamais laisser un segment obsolète en changeant
// d'écran.
export function useBreadcrumbSegments(segments: string[]): void {
  const ctx = useContext(BreadcrumbContext);
  const setSegments = ctx?.setSegments;
  const cle = segments.join(" > ");
  // Dépendances : `setSegments` (stable, identité constante via useState)
  // et `cle` (dérivée de `segments`, elle-même un nouveau tableau à chaque
  // rendu chez l'appelant — ex. `sci ? [sci.nom] : []`). Dépendre de `ctx`
  // (l'objet de contexte entier, recréé par le Provider à chaque
  // changement de segments) déclenchait une boucle de rendu infinie :
  // l'effet appelle setSegments -> nouvel objet ctx -> effet redéclenché ->
  // nettoyage (setSegments([])) -> nouvel objet ctx -> etc., tant qu'une
  // fiche restait montée. Voir docs/error-log.md.
  useEffect(() => {
    setSegments?.(segments);
    return () => setSegments?.([]);
  }, [setSegments, cle]);
}
