import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { chargerContexteBail, creerCachesContexteBail } from "../finances/contexte-bail";
import { listBaux, type Bail } from "../locataires/api";
import { declencherRegularisation, getHistoriqueRegularisation, LIBELLE_SENS_BILAN, type BilanRegularisationPersiste } from "./api";
import { calculerPeriodeParDefaut } from "./periode-par-defaut";

// Statuts pour lesquels une régularisation a un sens : un bail jamais
// activé (brouillon) n'a aucun mouvement à régulariser ; un bail archivé
// l'a déjà été définitivement traité. "resilie" reste inclus — un départ
// anticipé de locataire (cas explicitement cité par Jimmy) déclenche
// justement le calcul final APRÈS la résiliation, pas avant.
const STATUTS_SELECTIONNABLES: Bail["statut"][] = ["actif", "preavis", "resilie"];

interface OptionBail {
  bail: Bail;
  libelle: string;
}

export function ChargesView(): React.JSX.Element {
  const [options, setOptions] = useState<OptionBail[]>([]);
  const [isLoadingBaux, setIsLoadingBaux] = useState(true);
  const [bailId, setBailId] = useState("");
  const [historique, setHistorique] = useState<BilanRegularisationPersiste[] | null>(null);
  const [isLoadingHistorique, setIsLoadingHistorique] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodeDebut, setPeriodeDebut] = useState("");
  const [periodeFin, setPeriodeFin] = useState("");
  // "Dernier bail demandé" — permet d'ignorer la réponse d'un fetch devenu
  // obsolète (voir chargerHistorique ci-dessous : correctif d'un bug
  // rapporté par Jimmy où l'historique du bail précédemment sélectionné
  // pouvait écraser celui du bail nouvellement sélectionné si sa requête
  // réseau se terminait après, faisant croire par erreur à "aucun bilan"
  // ou à un bilan d'un autre bail pour le calcul de periodeDebut/periodeFin
  // par défaut).
  const dernierBailDemandeRef = useRef<string | null>(null);

  useEffect(() => {
    async function charger(): Promise<void> {
      setIsLoadingBaux(true);
      try {
        const tous = await listBaux();
        const candidats = tous
          .filter((bail) => STATUTS_SELECTIONNABLES.includes(bail.statut))
          .sort((a, b) => (a.dateDebut < b.dateDebut ? 1 : -1));

        const caches = creerCachesContexteBail();
        const constructedOptions: OptionBail[] = [];
        for (const bail of candidats) {
          const contexte = await chargerContexteBail(bail.id, caches);
          const locataires = contexte.locatairesNoms || "Sans locataire";
          constructedOptions.push({
            bail,
            libelle: `${locataires} — ${contexte.bienNom}, lot ${contexte.appartementNumero}`
          });
        }
        setOptions(constructedOptions);
      } catch {
        setError("Impossible de charger la liste des baux");
      } finally {
        setIsLoadingBaux(false);
      }
    }
    void charger();
  }, []);

  async function chargerHistorique(id: string): Promise<void> {
    dernierBailDemandeRef.current = id;
    setIsLoadingHistorique(true);
    try {
      const resultat = await getHistoriqueRegularisation(id);
      if (dernierBailDemandeRef.current === id) {
        setHistorique(resultat);
      }
    } catch {
      if (dernierBailDemandeRef.current === id) {
        setError("Impossible de charger l'historique des bilans de ce bail");
      }
    } finally {
      if (dernierBailDemandeRef.current === id) {
        setIsLoadingHistorique(false);
      }
    }
  }

  useEffect(() => {
    setError(null);
    // Jamais hérité du bail précédemment sélectionné, même brièvement
    // pendant le chargement — sinon periodeDebutParDefaut/periodeFinParDefaut
    // se calculeraient transitoirement sur le dernier bilan d'un AUTRE bail.
    setHistorique(null);
    dernierBailDemandeRef.current = bailId || null;
    if (!bailId) {
      return;
    }
    void chargerHistorique(bailId);
  }, [bailId]);

  const optionSelectionnee = options.find((o) => o.bail.id === bailId) ?? null;
  const bilanRecent = historique?.[0] ?? null;
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // Formule testée indépendamment (periode-par-defaut.test.ts) — reste
  // modifiable via les champs ci-dessous avant de cliquer, pour couvrir le
  // cas d'un départ anticipé qui ne correspond à aucune des deux bornes
  // par défaut.
  const { periodeDebut: periodeDebutParDefaut, periodeFin: periodeFinParDefaut } = calculerPeriodeParDefaut(
    bilanRecent,
    optionSelectionnee?.bail ?? null,
    aujourdhui
  );

  // Resynchronise les champs modifiables sur ces valeurs par défaut à
  // chaque changement de bail sélectionné ou de résultat de calcul (après
  // un "Calculer maintenant" réussi, propose la suite logique) — jamais à
  // chaque frappe dans les champs, qui restent librement modifiables par
  // Jimmy entre ces deux moments (cas du départ anticipé notamment).
  useEffect(() => {
    setPeriodeDebut(periodeDebutParDefaut);
    setPeriodeFin(periodeFinParDefaut);
  }, [bailId, historique]);

  async function handleCalculer(): Promise<void> {
    if (!bailId || !periodeDebut || !periodeFin) return;
    setIsCalculating(true);
    setError(null);
    try {
      await declencherRegularisation(bailId, periodeDebut, periodeFin);
      await chargerHistorique(bailId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de calculer le bilan");
    } finally {
      setIsCalculating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Charges</h1>
        <p className="text-sm text-slate-500">
          Consultation et déclenchement manuel de la régularisation des charges d'un bail.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="charges-bail" className="text-sm font-medium text-slate-700">
          Bail
        </label>
        <select
          id="charges-bail"
          value={bailId}
          onChange={(e) => setBailId(e.target.value)}
          disabled={isLoadingBaux}
          className="w-full max-w-xl rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">{isLoadingBaux ? "Chargement…" : "Sélectionner un bail…"}</option>
          {options.map(({ bail, libelle }) => (
            <option key={bail.id} value={bail.id}>
              {libelle} {bail.statut !== "actif" ? `(${bail.statut})` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {bailId && (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          {isLoadingHistorique ? (
            <p className="text-sm text-slate-500">Chargement du bilan…</p>
          ) : bilanRecent ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Bilan le plus récent ({bilanRecent.periodeDebut} → {bilanRecent.periodeFin})
              </h2>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Provisions perçues</dt>
                  <dd className="font-medium">{bilanRecent.provisionsRecues} €</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Charges réelles récupérables</dt>
                  <dd className="font-medium">{bilanRecent.chargesReelles} €</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Solde</dt>
                  <dd className="font-medium">{bilanRecent.solde} €</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sens</dt>
                  <dd className="font-medium">{LIBELLE_SENS_BILAN[bilanRecent.sens]}</dd>
                </div>
              </dl>
              {bilanRecent.sens === "faveur_proprietaire" && bilanRecent.tacheId && (
                <p className="text-sm text-indigo-700">
                  Une tâche de rappel existe pour cette période — voir{" "}
                  <Link to="/taches" className="underline">
                    l'onglet Tâches
                  </Link>
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Aucun bilan calculé pour ce bail pour le moment.</p>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor="charges-periode-debut" className="text-xs font-medium text-slate-700">
                  Début de période
                </label>
                <input
                  id="charges-periode-debut"
                  type="date"
                  value={periodeDebut}
                  onChange={(e) => setPeriodeDebut(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="charges-periode-fin" className="text-xs font-medium text-slate-700">
                  Fin de période
                </label>
                <input
                  id="charges-periode-fin"
                  type="date"
                  value={periodeFin}
                  onChange={(e) => setPeriodeFin(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            {/* Dates proposées par défaut (modifiables ci-dessus) : fin de la
                dernière période couverte (ou début du bail) jusqu'à la date de
                fin réelle du bail s'il est résilié, sinon aujourd'hui — voir
                le calcul de periodeDebutParDefaut/periodeFinParDefaut ci-dessus. */}
            <button
              type="button"
              onClick={() => {
                void handleCalculer();
              }}
              disabled={isCalculating || !periodeDebut || !periodeFin || periodeFin < periodeDebut}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              {isCalculating ? "Calcul…" : "Calculer le bilan maintenant"}
            </button>
            {periodeFin < periodeDebut && (
              <p className="text-sm text-red-600">La fin de période ne peut pas précéder le début de période.</p>
            )}
          </div>

          {historique && historique.length > 1 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-700">Historique</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pr-4 font-medium">Période</th>
                      <th className="pr-4 font-medium">Provisions</th>
                      <th className="pr-4 font-medium">Charges</th>
                      <th className="pr-4 font-medium">Solde</th>
                      <th className="font-medium">Sens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historique.slice(1).map((bilan) => (
                      <tr key={bilan.id} className="border-t border-slate-100">
                        <td className="pr-4 py-1">
                          {bilan.periodeDebut} → {bilan.periodeFin}
                        </td>
                        <td className="pr-4 py-1">{bilan.provisionsRecues} €</td>
                        <td className="pr-4 py-1">{bilan.chargesReelles} €</td>
                        <td className="pr-4 py-1">{bilan.solde} €</td>
                        <td className="py-1">{LIBELLE_SENS_BILAN[bilan.sens]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
