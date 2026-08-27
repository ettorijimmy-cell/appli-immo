import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppartementDetailView, type Tab as OngletAppartement } from "../patrimoine/AppartementDetailView";

const ONGLETS_APPARTEMENT: OngletAppartement[] = ["infos", "equipements", "bail", "historique", "documents"];
import { getAppartement, getBien } from "../patrimoine/api";
import { BienDetailView } from "../patrimoine/BienDetailView";
import { SciDetailView } from "../patrimoine/SciDetailView";
import { ScisListView } from "../patrimoine/ScisListView";

// Hiérarchie SCI -> Bien -> Appartement parcourue depuis ce seul écran
// (état local, pas de routes séparées) — voir docs/app-spec.md §3bis et le
// critère de complétion du Module 2 (docs/backlog.md). Migré le 2026-08-26
// (migration bien, Étape 5) : "immeuble" -> "bien", sciId devient nullable
// (un bien en nom propre, proprietaireType='personne_physique', n'a pas de
// SCI parente — voir ScisListView, section "Biens en nom propre").
type View =
  | { level: "scis" }
  | { level: "sci"; sciId: string }
  | { level: "bien"; sciId: string | null; bienId: string }
  | {
      level: "appartement";
      sciId: string | null;
      bienId: string;
      appartementId: string;
      nouveauBail: boolean;
      onglet: OngletAppartement | null;
    };

export function PatrimoinePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>({ level: "scis" });

  // Deep-link depuis la palette de commandes (Module 8, Ctrl+K) :
  // ?appartementId / ?bienId / ?sciId ouvrent directement la fiche
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
    const bienId = params.get("bienId");
    const sciId = params.get("sciId");
    const nouveauBail = params.get("nouveauBail") === "1";
    const ongletBrut = params.get("onglet");
    const onglet = ONGLETS_APPARTEMENT.includes(ongletBrut as OngletAppartement)
      ? (ongletBrut as OngletAppartement)
      : null;

    if (!appartementId && !bienId && !sciId) {
      return;
    }

    void (async () => {
      if (appartementId) {
        const appartement = await getAppartement(appartementId);
        const bien = await getBien(appartement.bienId);
        setView({
          level: "appartement",
          sciId: bien.sciId,
          bienId: bien.id,
          appartementId,
          nouveauBail,
          onglet
        });
      } else if (bienId) {
        const bien = await getBien(bienId);
        setView({ level: "bien", sciId: bien.sciId, bienId });
      } else if (sciId) {
        setView({ level: "sci", sciId });
      }
    })();
  }, [parametresBruts]);

  if (view.level === "scis") {
    return (
      <ScisListView
        onSelect={(sciId) => setView({ level: "sci", sciId })}
        onSelectBien={(bienId) => setView({ level: "bien", sciId: null, bienId })}
      />
    );
  }

  if (view.level === "sci") {
    return (
      <SciDetailView
        sciId={view.sciId}
        onBack={() => setView({ level: "scis" })}
        onSelectBien={(bienId) => setView({ level: "bien", sciId: view.sciId, bienId })}
      />
    );
  }

  if (view.level === "bien") {
    return (
      <BienDetailView
        bienId={view.bienId}
        onBack={() => (view.sciId ? setView({ level: "sci", sciId: view.sciId }) : setView({ level: "scis" }))}
        onSelectAppartement={(appartementId) =>
          setView({
            level: "appartement",
            sciId: view.sciId,
            bienId: view.bienId,
            appartementId,
            nouveauBail: false,
            onglet: null
          })
        }
      />
    );
  }

  return (
    <AppartementDetailView
      appartementId={view.appartementId}
      onBack={() => setView({ level: "bien", sciId: view.sciId, bienId: view.bienId })}
      ongletInitial={view.onglet ?? (view.nouveauBail ? "bail" : "infos")}
      ouvrirNouveauBailInitial={view.nouveauBail}
    />
  );
}
