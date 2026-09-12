import { useCallback, useEffect, useState } from "react";
import {
  getAnnexe1,
  sauvegarderSaisieManuelleAnnexe1,
  type Annexe1Calculee,
  type Annexe1ProrataApplique,
  type Annexe1Resultat
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

function anneeParDefaut(): number {
  return new Date().getFullYear();
}

export function FiscaliteView(): React.JSX.Element {
  const [scis, setScis] = useState<Sci[]>([]);
  const [sciId, setSciId] = useState("");
  const [annee, setAnnee] = useState(anneeParDefaut());
  const [biens, setBiens] = useState<Bien[]>([]);
  const [resultat, setResultat] = useState<Annexe1Resultat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [champEnCours, setChampEnCours] = useState<string | null>(null);

  useEffect(() => {
    void listScis().then((toutes) => {
      const sciIr = toutes.filter((sci) => sci.regimeFiscal === "IR" && sci.statut === "active");
      setScis(sciIr);
      if (sciIr.length > 0 && !sciId) {
        setSciId(sciIr[0]!.id);
      }
    });
    // sciId volontairement absent des dépendances : ne sélectionner un
    // premier SCI par défaut qu'au chargement initial de la liste, jamais
    // re-déclencher ce choix ensuite (l'utilisateur reste maître de sa
    // sélection une fois la liste chargée).
  }, []);

  const rafraichir = useCallback(() => {
    if (!sciId) {
      setResultat(null);
      return;
    }
    setError(null);
    Promise.all([getAnnexe1(sciId, annee), listBiens(sciId)])
      .then(([resultatAnnexe1, biensSci]) => {
        setResultat(resultatAnnexe1);
        setBiens(biensSci);
      })
      .catch(() => setError("Impossible de calculer l'Annexe 1 pour cette SCI et cette année"));
  }, [sciId, annee]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fiscalité — Annexe 1 (2072-S-A1-SD)</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={sciId}
            onChange={(e) => setSciId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {scis.length === 0 && <option value="">Aucune SCI à l'IR</option>}
            {scis.map((sci) => (
              <option key={sci.id} value={sci.id}>
                {sci.nom}
              </option>
            ))}
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

      <p className="text-xs text-slate-500">
        Ce cockpit calcule les lignes de l'Annexe 1 pour recopie dans la téléprocédure sur impots.gouv.fr (ou
        transmission au comptable) — aucun document ni PDF n'est généré ici. Seul le cadre VII (revenus par immeuble)
        est couvert ; le formulaire principal (répartition entre associés) et l'Annexe 2 (données associés) restent
        hors périmètre.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {scis.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          Aucune SCI active au régime IR — l'Annexe 1 (2072-S) ne s'applique qu'à ce régime.
        </p>
      )}

      {resultat && resultat.biens.length === 0 && (
        <p className="text-sm text-slate-500">Aucun bien actif pour cette SCI.</p>
      )}

      {resultat &&
        resultat.biens.map((ligneBien) => (
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
                              (ligneBien.saisieManuelle as Record<string, string | null | undefined>)[config.cle] ??
                              ""
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

      {resultat && resultat.biens.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 p-4">
          <span className="text-sm font-semibold text-slate-700">
            Total {resultat.sciNom} (somme des lignes 23, informatif — cohérent avec R5 du formulaire principal)
          </span>
          <span className="text-lg font-semibold">{resultat.totalSci} €</span>
        </div>
      )}
    </div>
  );
}
