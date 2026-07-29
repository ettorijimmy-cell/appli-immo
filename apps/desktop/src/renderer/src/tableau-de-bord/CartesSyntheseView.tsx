import { useEffect, useState } from "react";
import { getCartes, type Cartes } from "./api";

export function CartesSyntheseView(): React.JSX.Element {
  const [cartes, setCartes] = useState<Cartes | null>(null);

  useEffect(() => {
    void getCartes().then(setCartes);
  }, []);

  if (!cartes) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Impayés</p>
        <p className="text-2xl font-semibold text-red-600">{cartes.impayes.nombre}</p>
        <p className="text-sm text-slate-500">{cartes.impayes.montantRestant} € restant dû</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Documents expirés</p>
        <p className="text-2xl font-semibold text-amber-600">{cartes.documentsExpires}</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Échéances à venir</p>
        <p className="text-2xl font-semibold text-slate-900">{cartes.echeancesAVenir}</p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs font-medium uppercase text-slate-500">Alertes actives</p>
        <p className="text-2xl font-semibold text-amber-600">{cartes.alertesActives}</p>
      </div>
    </div>
  );
}
