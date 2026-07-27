import { useState } from "react";
import { FinancesListView } from "../finances/FinancesListView";
import { RapprochementCsvView } from "../finances/RapprochementCsvView";

type Vue = "liste" | "import-csv";

export function FinancesPage(): React.JSX.Element {
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
          Paiements
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

      {vue === "liste" ? <FinancesListView /> : <RapprochementCsvView />}
    </div>
  );
}
