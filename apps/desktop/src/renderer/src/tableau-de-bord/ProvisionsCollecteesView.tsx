import type { RevenusLocatifs } from "./api";

// "Provisions collectées" — jamais "vs charges réelles" (aucune charge
// réelle n'est trackée dans le MVP actuel, voir docs/backlog.md, dette
// technique). Section distincte de "Revenus locatifs" : les deux ne se
// recoupent jamais (docs/data-dictionary.md, section paiements).
export function ProvisionsCollecteesView({ revenus }: { revenus: RevenusLocatifs | null }): React.JSX.Element {
  if (!revenus) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  const maxValeur = Math.max(1, ...revenus.parMois.map((m) => Number(m.provisions)));

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Provisions collectées</h2>
      <div className="flex items-end gap-3 rounded-lg border border-slate-200 p-4" style={{ height: 160 }}>
        {revenus.parMois.map((m) => (
          <div key={m.mois} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-col justify-end" style={{ height: 120 }}>
              <div
                className="w-full bg-emerald-500"
                style={{ height: (Number(m.provisions) / maxValeur) * 120 }}
                title={`${m.provisions} €`}
              />
            </div>
            <span className="text-xs text-slate-500">{m.mois}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">Total sur la période : {revenus.totalProvisions} €</p>
    </div>
  );
}
