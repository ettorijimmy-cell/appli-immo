import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LocataireDetailView } from "../locataires/LocataireDetailView";
import { LocatairesListView } from "../locataires/LocatairesListView";

type View = { level: "liste" } | { level: "locataire"; locataireId: string };

export function LocatairesPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>({ level: "liste" });

  // Deep-link depuis la palette de commandes (Module 8, Ctrl+K) : voir
  // PatrimoinePage.tsx pour l'explication du choix de dépendre de la
  // chaîne des paramètres plutôt que de l'objet searchParams.
  const locataireId = new URLSearchParams(searchParams.toString()).get("locataireId");

  useEffect(() => {
    if (locataireId) {
      setView({ level: "locataire", locataireId });
    }
  }, [locataireId]);

  if (view.level === "locataire") {
    return (
      <LocataireDetailView
        locataireId={view.locataireId}
        onBack={() => setView({ level: "liste" })}
      />
    );
  }

  return <LocatairesListView onSelect={(locataireId) => setView({ level: "locataire", locataireId })} />;
}
