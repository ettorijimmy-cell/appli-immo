import { centimesVersMontant, montantEnCentimes } from "core";
import { useEffect, useState } from "react";
import { PeriodeFilter } from "../components/PeriodeFilter";
import { listDepenses, DEPENSE_CATEGORIE_LABELS, type Depense, type DepenseCategorie } from "../depenses/api";
import { libelleBien, listBiens, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";
import { getRevenusLocatifs, type RevenusLocatifs } from "../tableau-de-bord/api";
import { moisParDefaut } from "../tableau-de-bord/RevenusLocatifsView";

// Palette cyclique pour l'anneau de répartition — SVG pur, pas de
// bibliothèque de graphiques (recharts n'est pas une dépendance du projet
// desktop ; décision explicite de ne pas l'introduire pour ce cockpit,
// cohérent avec le choix déjà fait pour RevenusLocatifsView).
const COULEURS_CATEGORIE: Record<DepenseCategorie, string> = {
  frais_gestion: "#4338ca",
  assurance: "#d97706",
  reparation_entretien: "#059669",
  impots_taxes: "#e11d48",
  charges_copropriete: "#0284c7",
  interets_emprunt: "#7c3aed",
  autre: "#64748b"
};

interface RepartitionCategorie {
  categorie: DepenseCategorie;
  montant: string;
  pourcentage: number;
}

function calculerRepartition(depenses: Depense[]): { total: string; parCategorie: RepartitionCategorie[] } {
  const totauxCentimes = new Map<DepenseCategorie, number>();
  let totalCentimes = 0;
  for (const depense of depenses) {
    const centimes = montantEnCentimes(depense.montant);
    totauxCentimes.set(depense.categorie, (totauxCentimes.get(depense.categorie) ?? 0) + centimes);
    totalCentimes += centimes;
  }
  const parCategorie = [...totauxCentimes.entries()]
    .map(([categorie, centimes]) => ({
      categorie,
      montant: centimesVersMontant(centimes),
      pourcentage: totalCentimes > 0 ? (centimes / totalCentimes) * 100 : 0
    }))
    .sort((a, b) => b.pourcentage - a.pourcentage);
  return { total: centimesVersMontant(totalCentimes), parCategorie };
}

// Anneau de répartition en SVG pur (cercle troué via strokeWidth < rayon,
// segments empilés via stroke-dasharray/stroke-dashoffset) — même principe
// que les barres CSS de RevenusLocatifsView : pas de dépendance externe.
function AnneauRepartition({ parCategorie }: { parCategorie: RepartitionCategorie[] }): React.JSX.Element {
  const rayon = 40;
  const circonference = 2 * Math.PI * rayon;
  let cumulPourcentage = 0;

  return (
    <svg viewBox="0 0 100 100" className="h-40 w-40">
      <circle cx="50" cy="50" r={rayon} fill="none" stroke="#e2e8f0" strokeWidth="16" />
      {parCategorie.map((segment) => {
        const longueur = (segment.pourcentage / 100) * circonference;
        const decalage = (cumulPourcentage / 100) * circonference;
        cumulPourcentage += segment.pourcentage;
        return (
          <circle
            key={segment.categorie}
            cx="50"
            cy="50"
            r={rayon}
            fill="none"
            stroke={COULEURS_CATEGORIE[segment.categorie]}
            strokeWidth="16"
            strokeDasharray={`${longueur} ${circonference - longueur}`}
            strokeDashoffset={-decalage}
            transform="rotate(-90 50 50)"
          />
        );
      })}
    </svg>
  );
}

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) : cockpit de
// synthèse ("Comptabilité", renommé depuis "Vue d'ensemble" — même
// composant, même calculs). Revenus/Dépenses/Résultat net + répartition
// des dépenses par catégorie sur la période et le bien/SCI sélectionnés.
export function ComptabiliteView(): React.JSX.Element {
  const [{ debut, fin }, setPeriode] = useState(moisParDefaut());
  // Encodage "bien:<id>" / "sci:<id>" — même convention que DepensesListView
  // — "" pour "Toutes les propriétés". Filtre RÉEL, pas seulement visuel :
  // resolu en bienId/sciId ci-dessous et transmis à getRevenusLocatifs ET
  // listDepenses, qui recalculent tous les deux côté serveur.
  const [rattachement, setRattachement] = useState("");
  const [biens, setBiens] = useState<Bien[]>([]);
  const [scis, setScis] = useState<Sci[]>([]);
  const [revenus, setRevenus] = useState<RevenusLocatifs | null>(null);
  const [depenses, setDepenses] = useState<Depense[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listBiens(), listScis()]).then(([biensBruts, scisBrutes]) => {
      setBiens(biensBruts);
      setScis(scisBrutes);
    });
  }, []);

  useEffect(() => {
    setError(null);
    const [type, id] = rattachement.split(":");
    const filtreBienId = type === "bien" ? id : undefined;
    const filtreSciId = type === "sci" ? id : undefined;
    Promise.all([
      getRevenusLocatifs(debut, fin, {
        ...(filtreBienId !== undefined && { bienId: filtreBienId }),
        ...(filtreSciId !== undefined && { sciId: filtreSciId })
      }),
      listDepenses({
        dateDebut: debut,
        dateFin: fin,
        ...(filtreBienId !== undefined && { bienId: filtreBienId }),
        ...(filtreSciId !== undefined && { sciId: filtreSciId })
      })
    ])
      .then(([revenusResultat, depensesResultat]) => {
        setRevenus(revenusResultat);
        setDepenses(depensesResultat);
      })
      .catch(() => setError("Impossible de charger la comptabilité"));
  }, [debut, fin, rattachement]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (!revenus || !depenses) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  // Même définition que le Tableau de bord (getRevenusLocatifs) : le loyer
  // NET réellement encaissé sur la période (versements réels, provisions
  // exclues) — jamais les loyers dus, jamais une deuxième définition du
  // "revenu" inventée pour ce cockpit (docs/data-dictionary.md, section
  // paiements — "Revenus locatifs").
  const revenuCentimes = montantEnCentimes(revenus.totalLoyerNet);
  const { total: totalDepenses, parCategorie } = calculerRepartition(depenses);
  const depensesCentimes = montantEnCentimes(totalDepenses);
  const resultatNetCentimes = revenuCentimes - depensesCentimes;
  const resultatNet = centimesVersMontant(resultatNetCentimes);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Comptabilité</h1>
        <div className="flex items-center gap-4">
          <select
            value={rattachement}
            onChange={(e) => setRattachement(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Toutes les propriétés</option>
            {biens.map((bien) => (
              <option key={bien.id} value={`bien:${bien.id}`}>
                {libelleBien(bien)}
              </option>
            ))}
            {scis.map((sci) => (
              <option key={sci.id} value={`sci:${sci.id}`}>
                {sci.nom} (toute la SCI)
              </option>
            ))}
          </select>
          <PeriodeFilter debut={debut} fin={fin} onChange={setPeriode} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Revenus (loyer net)</p>
          <p className="text-2xl font-semibold text-emerald-600">{revenus.totalLoyerNet} €</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Dépenses</p>
          <p className="text-2xl font-semibold text-red-600">{totalDepenses} €</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Résultat net</p>
          <p className={`text-2xl font-semibold ${resultatNetCentimes >= 0 ? "text-slate-900" : "text-red-600"}`}>
            {resultatNet} €
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Répartition des dépenses par catégorie</h2>
        {parCategorie.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune dépense sur cette période.</p>
        ) : (
          <div className="flex items-center gap-6 rounded-lg border border-slate-200 p-4">
            <AnneauRepartition parCategorie={parCategorie} />
            <ul className="space-y-1 text-sm">
              {parCategorie.map((segment) => (
                <li key={segment.categorie} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: COULEURS_CATEGORIE[segment.categorie] }}
                  />
                  <span>
                    {DEPENSE_CATEGORIE_LABELS[segment.categorie]} — {segment.montant} € (
                    {segment.pourcentage.toFixed(0)}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
