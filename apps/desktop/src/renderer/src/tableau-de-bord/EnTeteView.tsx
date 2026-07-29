import { useEffect, useState } from "react";
import { getEnTete, type EnTete } from "./api";

export function EnTeteView(): React.JSX.Element {
  const [enTete, setEnTete] = useState<EnTete | null>(null);

  useEffect(() => {
    void getEnTete().then(setEnTete);
  }, []);

  if (!enTete) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Loués</p>
        <p className="text-2xl font-semibold text-slate-900">{enTete.biensLoues}</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Vacants</p>
        <p className="text-2xl font-semibold text-slate-900">{enTete.biensVacants}</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">En travaux</p>
        <p className="text-2xl font-semibold text-slate-900">{enTete.biensTravaux}</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Valeur locative (loués)</p>
        <p className="text-2xl font-semibold text-slate-900">{enTete.valeurLocativeTotale} €</p>
      </div>
    </div>
  );
}
