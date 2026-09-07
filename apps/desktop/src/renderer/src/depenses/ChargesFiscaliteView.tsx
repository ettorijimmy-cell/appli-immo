import { useState } from "react";
import { DepensesListView } from "./DepensesListView";
import { ImportCsvDepensesView } from "./ImportCsvDepensesView";

type Vue = "liste" | "import-csv";

// Même motif d'onglets internes que FinancesPage (hand-rolled, aucun
// <TabBar> partagé — décision documentée, docs/backlog.md) : réplication
// volontaire plutôt qu'une abstraction prématurée pour deux usages.
export function ChargesFiscaliteView(): React.JSX.Element {
  const [vue, setVue] = useState<Vue>("liste");

  return (
    <div className="space-y-4">
      <div className="flex gap-4 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setVue("liste")}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${
            vue === "liste"
              ? "border-indigo-700 text-indigo-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Dépenses
        </button>
        <button
          type="button"
          onClick={() => setVue("import-csv")}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${
            vue === "import-csv"
              ? "border-indigo-700 text-indigo-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Import CSV
        </button>
      </div>

      {vue === "liste" ? <DepensesListView /> : <ImportCsvDepensesView />}
    </div>
  );
}
