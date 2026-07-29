import { useEffect, useState } from "react";
import { AlertesListView } from "../alertes/AlertesListView";
import { AccesRapidesView } from "../tableau-de-bord/AccesRapidesView";
import { getRevenusLocatifs, type RevenusLocatifs } from "../tableau-de-bord/api";
import { CartesSyntheseView } from "../tableau-de-bord/CartesSyntheseView";
import { DerniereSauvegardeView } from "../tableau-de-bord/DerniereSauvegardeView";
import { EnTeteView } from "../tableau-de-bord/EnTeteView";
import { ProvisionsCollecteesView } from "../tableau-de-bord/ProvisionsCollecteesView";
import { moisParDefaut, RevenusLocatifsView } from "../tableau-de-bord/RevenusLocatifsView";
import { SyntheseParEntiteView } from "../tableau-de-bord/SyntheseParEntiteView";

export function TableauDeBordPage(): React.JSX.Element {
  const [{ debut, fin }, setPeriode] = useState(moisParDefaut());
  const [revenus, setRevenus] = useState<RevenusLocatifs | null>(null);

  useEffect(() => {
    void getRevenusLocatifs(debut, fin).then(setRevenus);
  }, [debut, fin]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tableau de bord</h1>
        <AccesRapidesView />
      </div>

      <EnTeteView />
      <CartesSyntheseView />

      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-slate-700">Période</span>
        <input
          type="date"
          value={debut}
          onChange={(e) => setPeriode((p) => ({ ...p, debut: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1"
        />
        <span className="text-slate-400">→</span>
        <input
          type="date"
          value={fin}
          onChange={(e) => setPeriode((p) => ({ ...p, fin: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <RevenusLocatifsView revenus={revenus} />
        <ProvisionsCollecteesView revenus={revenus} />
      </div>

      <SyntheseParEntiteView debut={debut} fin={fin} />

      <DerniereSauvegardeView />

      <AlertesListView />
    </div>
  );
}
