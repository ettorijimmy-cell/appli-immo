import { useState } from "react";
import { DepensesListView } from "../depenses/DepensesListView";
import { ReglesCategorisationView } from "../depenses/ReglesCategorisationView";
import { FinancesListView } from "./FinancesListView";
import { ImportCsvFusionneView } from "./ImportCsvFusionneView";

type SousVue = "revenus" | "depenses" | "import-csv" | "regles-categorisation";

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) — deuxième
// restructuration : Revenus, Dépenses, Import CSV et Règles de
// catégorisation sont regroupés ici en sous-onglets sous un onglet
// "Transactions" commun, plutôt qu'en onglets de premier niveau séparés
// de FinancesPage. Précision tranchée avec Jimmy : pas de fusion des
// données — Revenus et Dépenses restent deux listes distinctes (sources
// différentes en base, paiements/versements vs depense), simplement
// rangées sous le même onglet par navigation, jamais un flux chronologique
// unifié.
export function TransactionsView({ bailIdFiltre }: { bailIdFiltre?: string | null } = {}): React.JSX.Element {
  const [sousVue, setSousVue] = useState<SousVue>("revenus");

  const onglets: Array<{ valeur: SousVue; libelle: string }> = [
    { valeur: "revenus", libelle: "Revenus" },
    { valeur: "depenses", libelle: "Dépenses" },
    { valeur: "import-csv", libelle: "Import CSV" },
    { valeur: "regles-categorisation", libelle: "Règles de catégorisation" }
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-4 border-b border-slate-200">
        {onglets.map((onglet) => (
          <button
            key={onglet.valeur}
            type="button"
            onClick={() => setSousVue(onglet.valeur)}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${
              sousVue === onglet.valeur
                ? "border-indigo-700 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {onglet.libelle}
          </button>
        ))}
      </div>

      {sousVue === "revenus" ? (
        <FinancesListView bailIdFiltre={bailIdFiltre ?? null} />
      ) : sousVue === "depenses" ? (
        <DepensesListView />
      ) : sousVue === "import-csv" ? (
        <ImportCsvFusionneView />
      ) : (
        <ReglesCategorisationView />
      )}
    </div>
  );
}
