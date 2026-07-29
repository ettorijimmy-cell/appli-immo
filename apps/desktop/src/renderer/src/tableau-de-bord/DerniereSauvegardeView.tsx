import { useEffect, useState } from "react";
import { getDerniereSauvegarde } from "./api";

export function DerniereSauvegardeView(): React.JSX.Element {
  const [dateIso, setDateIso] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void getDerniereSauvegarde().then((r) => setDateIso(r.dateIso));
  }, []);

  if (dateIso === undefined) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <p className="text-sm text-slate-500">
      {dateIso ? (
        <>Dernière sauvegarde locale : {dateIso.replace("T", " ")}</>
      ) : (
        <>Aucune sauvegarde locale trouvée — pense à lancer `pnpm backup:local`.</>
      )}
    </p>
  );
}
