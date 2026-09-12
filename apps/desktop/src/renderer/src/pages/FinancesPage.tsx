import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ComptabiliteView } from "../finances/ComptabiliteView";
import { FiscaliteView } from "../finances/FiscaliteView";
import { TransactionsView } from "../finances/TransactionsView";

type Vue = "comptabilite" | "transactions" | "fiscalite";

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) : Comptabilité
// (cockpit revenus/dépenses/résultat net) et Fiscalité (réservé, Étape 4)
// sont nouveaux ; Transactions regroupe en sous-onglets internes ce qui
// était avant trois onglets de premier niveau séparés (Paiements, Import
// CSV, Charges & fiscalité) — un seul relevé bancaire à importer
// désormais, mais Revenus et Dépenses restent deux listes distinctes
// (sources différentes en base), jamais fusionnées en un flux unique.
export function FinancesPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  // Deep-link depuis la palette de commandes (Module 8, parcours "Nouveau
  // paiement") : filtre la liste sur le bail choisi en étape 2 de
  // recherche — atterrit directement sur l'onglet Transactions (dont le
  // sous-onglet Revenus est déjà celui par défaut), jamais sur
  // Comptabilité par défaut dans ce cas.
  const bailIdFiltre = searchParams.get("bailId");
  const [vue, setVue] = useState<Vue>(bailIdFiltre ? "transactions" : "comptabilite");

  const onglets: Array<{ valeur: Vue; libelle: string }> = [
    { valeur: "comptabilite", libelle: "Comptabilité" },
    { valeur: "transactions", libelle: "Transactions" },
    { valeur: "fiscalite", libelle: "Fiscalité" }
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-4 border-b border-slate-200">
        {onglets.map((onglet) => (
          <button
            key={onglet.valeur}
            type="button"
            onClick={() => setVue(onglet.valeur)}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${
              vue === onglet.valeur
                ? "border-indigo-700 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {onglet.libelle}
          </button>
        ))}
      </div>

      {vue === "comptabilite" ? (
        <ComptabiliteView />
      ) : vue === "transactions" ? (
        <TransactionsView bailIdFiltre={bailIdFiltre} />
      ) : (
        <FiscaliteView />
      )}
    </div>
  );
}
