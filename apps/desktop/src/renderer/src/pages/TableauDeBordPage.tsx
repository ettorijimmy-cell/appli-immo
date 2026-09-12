import { useEffect, useState } from "react";
import { AlertesListView } from "../alertes/AlertesListView";
import { PeriodeFilter } from "../components/PeriodeFilter";
import { AccesRapidesView } from "../tableau-de-bord/AccesRapidesView";
import { getRevenusLocatifs, type RevenusLocatifs } from "../tableau-de-bord/api";
import { CartesSyntheseView } from "../tableau-de-bord/CartesSyntheseView";
import { ChecklistDocumentaireCard } from "../tableau-de-bord/ChecklistDocumentaireCard";
import { DerniereSauvegardeView } from "../tableau-de-bord/DerniereSauvegardeView";
import { EnTeteView } from "../tableau-de-bord/EnTeteView";
import { ProvisionsCollecteesView } from "../tableau-de-bord/ProvisionsCollecteesView";
import { RemboursementsEnAttenteView } from "../tableau-de-bord/RemboursementsEnAttenteView";
import { moisParDefaut, RevenusLocatifsView } from "../tableau-de-bord/RevenusLocatifsView";
import { SyntheseParEntiteView } from "../tableau-de-bord/SyntheseParEntiteView";
import { TachesSyntheseView } from "../tableau-de-bord/TachesSyntheseView";

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
      <RemboursementsEnAttenteView />
      <ChecklistDocumentaireCard />
      <CartesSyntheseView />

      <PeriodeFilter debut={debut} fin={fin} onChange={setPeriode} />

      <div className="grid grid-cols-2 gap-6">
        <RevenusLocatifsView revenus={revenus} />
        <ProvisionsCollecteesView revenus={revenus} />
      </div>

      <SyntheseParEntiteView debut={debut} fin={fin} />

      <DerniereSauvegardeView />

      <AlertesListView />
      <TachesSyntheseView />
    </div>
  );
}
