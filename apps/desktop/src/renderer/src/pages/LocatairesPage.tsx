import { useState } from "react";
import { LocataireDetailView } from "../locataires/LocataireDetailView";
import { LocatairesListView } from "../locataires/LocatairesListView";

type View = { level: "liste" } | { level: "locataire"; locataireId: string };

export function LocatairesPage(): React.JSX.Element {
  const [view, setView] = useState<View>({ level: "liste" });

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
