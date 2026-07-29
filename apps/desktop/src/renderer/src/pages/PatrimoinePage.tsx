import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppartementDetailView } from "../patrimoine/AppartementDetailView";
import { getAppartement, getImmeuble } from "../patrimoine/api";
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
  | { level: "appartement"; sciId: string; immeubleId: string; appartementId: string; nouveauBail: boolean };

export function PatrimoinePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>({ level: "scis" });

  // Deep-link depuis la palette de commandes (Module 8, Ctrl+K) :
  // ?appartementId / ?immeubleId / ?sciId ouvrent directement la fiche
  // correspondante, sans repasser par la liste des SCI. Dépend de la
  // représentation textuelle des query params (pas de l'objet
  // `searchParams`, recréé à chaque rendu) pour ne réagir qu'à un vrai
  // changement d'URL — même principe que le correctif du fil d'Ariane
  // (docs/error-log.md, [2026-07-29]) : ne jamais dépendre d'un objet
  // recréé si seule sa valeur importe.
  const parametresBruts = searchParams.toString();

  useEffect(() => {
    const params = new URLSearchParams(parametresBruts);
    const appartementId = params.get("appartementId");
    const immeubleId = params.get("immeubleId");
    const sciId = params.get("sciId");
    const nouveauBail = params.get("nouveauBail") === "1";

    if (!appartementId && !immeubleId && !sciId) {
      return;
    }

    void (async () => {
      if (appartementId) {
        const appartement = await getAppartement(appartementId);
        const immeuble = await getImmeuble(appartement.immeubleId);
        setView({
          level: "appartement",
          sciId: immeuble.sciId,
          immeubleId: immeuble.id,
          appartementId,
          nouveauBail
        });
      } else if (immeubleId) {
        const immeuble = await getImmeuble(immeubleId);
        setView({ level: "immeuble", sciId: immeuble.sciId, immeubleId });
      } else if (sciId) {
        setView({ level: "sci", sciId });
      }
    })();
  }, [parametresBruts]);

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
          setView({ level: "appartement", sciId: view.sciId, immeubleId: view.immeubleId, appartementId, nouveauBail: false })
        }
      />
    );
  }

  return (
    <AppartementDetailView
      appartementId={view.appartementId}
      onBack={() => setView({ level: "immeuble", sciId: view.sciId, immeubleId: view.immeubleId })}
      ongletInitial={view.nouveauBail ? "bail" : "infos"}
      ouvrirNouveauBailInitial={view.nouveauBail}
    />
  );
}
