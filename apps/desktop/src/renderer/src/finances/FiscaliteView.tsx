import { useCallback, useEffect, useState } from "react";
import {
  getAnnexe1,
  getFormulaire2044,
  sauvegarderSaisieManuelleAnnexe1,
  type Annexe1Calculee,
  type Annexe1ProrataApplique,
  type Annexe1Resultat,
  type Formulaire2044Calcule,
  type Formulaire2044Resultat
} from "../fiscalite/api";
import { libelleBien, listBiens, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";

interface LigneConfig {
  cle: keyof Annexe1Calculee;
  numero: string;
  libelle: string;
  manuel: boolean;
}

// Numérotation et intitulés du cadre VII, 2072-S-A1-SD (Module Charges et
// fiscalité, Étape 4). Intitulés des 11 lignes manuelles repris tels quels
// du formulaire officiel (fournis par Jimmy après consultation de son
// expert-comptable, 2026-09-12) — jamais une reformulation ou un résumé
// approximatif, le numéro de ligne reste entre parenthèses pour rester
// traçable au formulaire/à la téléprocédure. Lignes automatiques déjà
// dotées d'un libellé de contenu clair, laissées telles quelles.
const LIGNES_ANNEXE1: LigneConfig[] = [
  { cle: "ligne1", numero: "1", libelle: "Loyers encaissés", manuel: false },
  {
    cle: "ligne2",
    numero: "2",
    libelle: "Dépenses déductibles mises à la charge des locataires (ligne 2)",
    manuel: true
  },
  {
    cle: "ligne3",
    numero: "3",
    libelle: "Recettes brutes diverses (subventions ANAH, indemnités d'assurance) (ligne 3)",
    manuel: true
  },
  {
    cle: "ligne4",
    numero: "4",
    libelle: "Recettes théoriques (mise à disposition gratuite) (ligne 4)",
    manuel: true
  },
  { cle: "ligne5", numero: "5", libelle: "Total recettes (1+2+3+4)", manuel: false },
  { cle: "ligne6", numero: "6", libelle: "Frais de gestion", manuel: false },
  { cle: "ligne7", numero: "7", libelle: "Forfait (20 € / lot)", manuel: false },
  { cle: "ligne8", numero: "8", libelle: "Assurance", manuel: false },
  { cle: "ligne9", numero: "9", libelle: "Réparation et entretien", manuel: false },
  {
    cle: "ligne9Bis",
    numero: "9 bis",
    libelle: "Dont travaux de rénovation énergétique (ligne 9 bis)",
    manuel: true
  },
  {
    cle: "ligne10",
    numero: "10",
    libelle: "Charges récupérables non récupérées au départ du locataire (ligne 10)",
    manuel: true
  },
  {
    cle: "ligne11",
    numero: "11",
    libelle: "Indemnités d'éviction, frais de relogement (ligne 11)",
    manuel: true
  },
  { cle: "ligne12", numero: "12", libelle: "Impôts et taxes", manuel: false },
  { cle: "ligne13", numero: "13", libelle: "Charges de copropriété", manuel: false },
  {
    cle: "ligne14",
    numero: "14",
    libelle: "Régularisation des provisions de charges (année antérieure) (ligne 14)",
    manuel: true
  },
  { cle: "ligne15", numero: "15", libelle: "Montant de la déduction spécifique (ligne 15)", manuel: true },
  { cle: "ligne16", numero: "16", libelle: "Total charges déductibles", manuel: false },
  { cle: "ligne17", numero: "17", libelle: "Intérêts d'emprunt", manuel: false },
  { cle: "ligne18", numero: "18", libelle: "Résultat avant lignes 19 à 22", manuel: false },
  {
    cle: "ligne19",
    numero: "19",
    libelle: "Réintégration du supplément de déduction (ligne 19)",
    manuel: true
  },
  {
    cle: "ligne20",
    numero: "20",
    libelle: "Rémunérations et avantages en nature aux associés (ligne 20)",
    manuel: true
  },
  { cle: "ligne21", numero: "21", libelle: "Résultat (18+19-20)", manuel: false },
  {
    cle: "ligne22",
    numero: "22",
    libelle: "Revenus/déficits de parts dans d'autres sociétés immobilières (ligne 22)",
    manuel: true
  },
  { cle: "ligne23", numero: "23", libelle: "Résultat net (21+22)", manuel: false }
];

interface Ligne2044Config {
  cle: keyof Formulaire2044Calcule;
  numero: string;
  libelle: string;
}

// Formulaire 2044 (revenus fonciers, régime réel) — biens en nom propre.
// Périmètre resserré à 4 lignes automatiques (221/223/224/227), décisions
// actées avec Jimmy le 2026-09-30 après vérification des libellés officiels
// (voir packages/core/src/fiscalite/mapping-categorie-2044.ts). 212/213 et
// 240 restent affichées pour rester traçables au formulaire, avec une note
// explicite sur leur portée réduite — jamais présentées comme le calcul
// complet du formulaire officiel.
const LIGNES_2044: Ligne2044Config[] = [
  { cle: "ligne211", numero: "211", libelle: "Loyers bruts encaissés" },
  { cle: "ligne212", numero: "212", libelle: "Recettes brutes diverses — non suivi dans cette version" },
  { cle: "ligne213", numero: "213", libelle: "— non suivi dans cette version" },
  { cle: "ligne215", numero: "215", libelle: "Total des recettes (211+212+213)" },
  { cle: "ligne221", numero: "221", libelle: "Frais d'administration et de gestion" },
  { cle: "ligne223", numero: "223", libelle: "Primes d'assurance" },
  { cle: "ligne224", numero: "224", libelle: "Réparation, entretien, amélioration" },
  { cle: "ligne227", numero: "227", libelle: "Taxes foncières et annexes" },
  { cle: "ligne240", numero: "240", libelle: "Total des frais et charges (périmètre restreint — voir note)" },
  { cle: "ligne261", numero: "261", libelle: "Revenu foncier (215-240)" },
  { cle: "ligne263", numero: "263", libelle: "Revenu foncier imposable" }
];

function anneeParDefaut(): number {
  return new Date().getFullYear();
}

// Encodage "sci:<id>"/"bien:<id>" — même convention que le filtre
// bien/SCI de ComptabiliteView (finances/ComptabiliteView.tsx), réutilisée
// ici pour un seul sélecteur couvrant les deux régimes fiscaux (2072-S vs
// 2044) plutôt que deux menus déroulants séparés.
export function FiscaliteView(): React.JSX.Element {
  const [scis, setScis] = useState<Sci[]>([]);
  const [biensNomPropre, setBiensNomPropre] = useState<Bien[]>([]);
  const [selection, setSelection] = useState("");
  const [annee, setAnnee] = useState(anneeParDefaut());
  const [biens, setBiens] = useState<Bien[]>([]);
  const [resultatAnnexe1, setResultatAnnexe1] = useState<Annexe1Resultat | null>(null);
  const [resultat2044, setResultat2044] = useState<Formulaire2044Resultat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [champEnCours, setChampEnCours] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listScis(), listBiens()]).then(([toutesScis, tousBiens]) => {
      const sciIr = toutesScis.filter((sci) => sci.regimeFiscal === "IR" && sci.statut === "active");
      const biensNomPropreActifs = tousBiens.filter(
        (b) => b.proprietaireType === "personne_physique" && b.statut === "actif"
      );
      setScis(sciIr);
      setBiensNomPropre(biensNomPropreActifs);
      // Ne sélectionner une première entrée qu'au chargement initial des
      // listes, jamais re-déclencher ce choix ensuite — même principe que
      // le sciId par défaut de la version précédente de cet écran.
      if (!selection) {
        if (sciIr.length > 0) {
          setSelection(`sci:${sciIr[0]!.id}`);
        } else if (biensNomPropreActifs.length > 0) {
          setSelection(`bien:${biensNomPropreActifs[0]!.id}`);
        }
      }
    });
    // selection volontairement absente des dépendances, voir commentaire ci-dessus.
  }, []);

  const rafraichir = useCallback(() => {
    if (!selection) {
      setResultatAnnexe1(null);
      setResultat2044(null);
      return;
    }
    setError(null);
    if (selection.startsWith("sci:")) {
      const sciId = selection.slice("sci:".length);
      setResultat2044(null);
      Promise.all([getAnnexe1(sciId, annee), listBiens(sciId)])
        .then(([resultat, biensSci]) => {
          setResultatAnnexe1(resultat);
          setBiens(biensSci);
        })
        .catch(() => setError("Impossible de calculer l'Annexe 1 pour cette SCI et cette année"));
    } else if (selection.startsWith("bien:")) {
      const bienId = selection.slice("bien:".length);
      setResultatAnnexe1(null);
      getFormulaire2044(bienId, annee)
        .then(setResultat2044)
        .catch(() => setError("Impossible de calculer le formulaire 2044 pour ce bien et cette année"));
    }
  }, [selection, annee]);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  async function enregistrerLigne(bienId: string, cle: string, valeur: string): Promise<void> {
    const champId = `${bienId}-${cle}`;
    setChampEnCours(champId);
    try {
      await sauvegarderSaisieManuelleAnnexe1(bienId, annee, { [cle]: valeur });
      rafraichir();
    } catch {
      setError("Impossible d'enregistrer cette ligne");
    } finally {
      setChampEnCours(null);
    }
  }

  function libelleDuBien(bienId: string): string {
    const bien = biens.find((b) => b.id === bienId);
    return bien ? libelleBien(bien) : bienId;
  }

  // Un bien archivé en cours d'année reste dans le calcul (ses propres
  // lignes sont un fait historique réel, voir FiscaliteService) — signalé
  // ici pour que Jimmy comprenne pourquoi il apparaît encore.
  function estArchive(bienId: string): boolean {
    return biens.find((b) => b.id === bienId)?.statut === "archive";
  }

  function prorataPourLigne(prorata: Annexe1ProrataApplique[], cle: string): Annexe1ProrataApplique | undefined {
    return prorata.find((p) => p.ligne === cle);
  }

  const bienNomPropreSelectionne =
    selection.startsWith("bien:") ? biensNomPropre.find((b) => b.id === selection.slice("bien:".length)) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fiscalité</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {scis.length === 0 && biensNomPropre.length === 0 && <option value="">Aucun bien éligible</option>}
            {scis.length > 0 && (
              <optgroup label="SCI (Annexe 1 — 2072-S)">
                {scis.map((sci) => (
                  <option key={sci.id} value={`sci:${sci.id}`}>
                    {sci.nom}
                  </option>
                ))}
              </optgroup>
            )}
            {biensNomPropre.length > 0 && (
              <optgroup label="Biens en nom propre (2044)">
                {biensNomPropre.map((b) => (
                  <option key={b.id} value={`bien:${b.id}`}>
                    {libelleBien(b)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label className="flex items-center gap-2">
            Année
            <input
              type="number"
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
              className="w-24 rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {scis.length === 0 && biensNomPropre.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          Aucune SCI active au régime IR, ni aucun bien actif en nom propre — la fiscalité (2072-S ou 2044) ne
          s'applique à aucun bien pour l'instant.
        </p>
      )}

      {resultatAnnexe1 && (
        <>
          <p className="text-xs text-slate-500">
            Ce cockpit calcule les lignes de l'Annexe 1 pour recopie dans la téléprocédure sur impots.gouv.fr (ou
            transmission au comptable) — aucun document ni PDF n'est généré ici. Seul le cadre VII (revenus par
            immeuble) est couvert ; le formulaire principal (répartition entre associés) et l'Annexe 2 (données
            associés) restent hors périmètre.
          </p>

          {resultatAnnexe1.biens.length === 0 && (
            <p className="text-sm text-slate-500">Aucun bien actif pour cette SCI.</p>
          )}

          {resultatAnnexe1.biens.map((ligneBien) => (
            <div key={ligneBien.bienId} className="space-y-2 rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  {libelleDuBien(ligneBien.bienId)}
                  {estArchive(ligneBien.bienId) && (
                    <span className="ml-2 text-xs font-normal italic text-slate-400">
                      (archivé — historique conservé)
                    </span>
                  )}
                </h2>
                <span className="text-xs text-slate-500">
                  {ligneBien.nombreLots} lot{ligneBien.nombreLots > 1 ? "s" : ""} actif
                  {ligneBien.nombreLots > 1 ? "s" : ""}
                </span>
              </div>
              <table className="w-full text-left text-sm">
                <tbody>
                  {LIGNES_ANNEXE1.map((config) => {
                    const prorata = prorataPourLigne(ligneBien.proratasAppliques, config.cle);
                    const champId = `${ligneBien.bienId}-${config.cle}`;
                    return (
                      <tr key={config.cle} className="border-b border-slate-100">
                        <td className="w-12 py-1.5 align-top text-slate-400">{config.numero}</td>
                        <td className="py-1.5 align-top text-slate-600">
                          {config.libelle}
                          {config.cle === "ligne9Bis" && (
                            <p className="text-xs italic text-slate-400">
                              Ligne mémo — non incluse dans le total de la ligne 16.
                            </p>
                          )}
                          {prorata && (
                            <p className="text-xs italic text-slate-400">
                              dont {prorata.montant} € de dépenses réparties depuis le niveau SCI
                            </p>
                          )}
                        </td>
                        <td className="w-32 py-1.5 text-right align-top">
                          {config.manuel ? (
                            <input
                              type="text"
                              defaultValue={
                                (ligneBien.saisieManuelle as Record<string, string | null | undefined>)[
                                  config.cle
                                ] ?? ""
                              }
                              disabled={champEnCours === champId}
                              onBlur={(e) => {
                                void enregistrerLigne(ligneBien.bienId, config.cle, e.target.value);
                              }}
                              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm disabled:opacity-50"
                            />
                          ) : (
                            <span className="font-medium">{ligneBien.lignes[config.cle]} €</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {resultatAnnexe1.biens.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 p-4">
              <span className="text-sm font-semibold text-slate-700">
                Total {resultatAnnexe1.sciNom} (somme des lignes 23, informatif — cohérent avec R5 du formulaire
                principal)
              </span>
              <span className="text-lg font-semibold">{resultatAnnexe1.totalSci} €</span>
            </div>
          )}
        </>
      )}

      {resultat2044 && (
        <>
          <p className="text-xs text-slate-500">
            Formulaire 2044 (revenus fonciers, régime réel) pour ce bien en nom propre — pour recopie dans la
            téléprocédure sur impots.gouv.fr (ou transmission au comptable), aucun document ni PDF n'est généré
            ici. Périmètre volontairement restreint : recettes (211-215), 4 lignes de frais suivies par Briky
            (221, 223, 224, 227) et le résultat (261/263). Les charges de copropriété, le forfait de 20 €, les
            charges récupérables non récupérées, les indemnités d'éviction, les intérêts d'emprunt et le déficit
            reportable restent hors périmètre de cette version.
          </p>

          <div className="space-y-2 rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700">
              {bienNomPropreSelectionne ? libelleBien(bienNomPropreSelectionne) : resultat2044.bienId}
              {bienNomPropreSelectionne?.nomProprietaire && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  (propriétaire : {bienNomPropreSelectionne.nomProprietaire})
                </span>
              )}
            </h2>
            <table className="w-full text-left text-sm">
              <tbody>
                {LIGNES_2044.map((config) => (
                  <tr key={config.cle} className="border-b border-slate-100">
                    <td className="w-12 py-1.5 align-top text-slate-400">{config.numero}</td>
                    <td className="py-1.5 align-top text-slate-600">{config.libelle}</td>
                    <td className="w-32 py-1.5 text-right align-top">
                      <span className="font-medium">{resultat2044.lignes[config.cle]} €</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
