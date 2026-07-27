import { useState } from "react";
import { AppartementDetailView } from "../patrimoine/AppartementDetailView";
import { ImmeubleDetailView } from "../patrimoine/ImmeubleDetailView";
import { SciDetailView } from "../patrimoine/SciDetailView";
import { ScisListView } from "../patrimoine/ScisListView";

// Hiérarchie SCI -> Immeuble -> Appartement parcourue depuis ce seul écran
// (état local, pas de routes séparées) — voir docs/app-spec.md §3bis et le
// critère de complétion du Module 2 (docs/backlog.md).
type View =
  | { level: "scis" }
  | { level: "sci"; sciId: string }
  | { level: "immeuble"; sciId: string; immeubleId: string }
  | { level: "appartement"; sciId: string; immeubleId: string; appartementId: string };

export function PatrimoinePage(): React.JSX.Element {
  const [view, setView] = useState<View>({ level: "scis" });

  if (view.level === "scis") {
    return <ScisListView onSelect={(sciId) => setView({ level: "sci", sciId })} />;
  }

  if (view.level === "sci") {
    return (
      <SciDetailView
        sciId={view.sciId}
        onBack={() => setView({ level: "scis" })}
        onSelectImmeuble={(immeubleId) => setView({ level: "immeuble", sciId: view.sciId, immeubleId })}
      />
    );
  }

  if (view.level === "immeuble") {
    return (
      <ImmeubleDetailView
        immeubleId={view.immeubleId}
        onBack={() => setView({ level: "sci", sciId: view.sciId })}
        onSelectAppartement={(appartementId) =>
          setView({ level: "appartement", sciId: view.sciId, immeubleId: view.immeubleId, appartementId })
        }
      />
    );
  }

  return (
    <AppartementDetailView
      appartementId={view.appartementId}
      onBack={() => setView({ level: "immeuble", sciId: view.sciId, immeubleId: view.immeubleId })}
    />
  );
}
