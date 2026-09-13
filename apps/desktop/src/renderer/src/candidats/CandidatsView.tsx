import { calculerTauxEffort, centimesVersMontant } from "core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChecklistCategoriesEntite } from "../documents/ChecklistCategoriesEntite";
import { ApiError } from "../lib/authenticated-fetch";
import { getBien, libelleBien, listAppartements, type Appartement, type Bien } from "../patrimoine/api";
import {
  archiveCandidat,
  convertirCandidatEnLocataire,
  createCandidat,
  getCandidat,
  listCandidats,
  updateCandidat,
  CANDIDAT_STATUTS,
  CANDIDAT_STATUT_LABELS,
  type Candidat,
  type CandidatStatut
} from "./api";

type FiltreStatut = "" | CandidatStatut;

type Vue = { niveau: "liste" } | { niveau: "creation" } | { niveau: "edition"; candidatId: string };

interface FormulaireCandidat {
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  appartementId: string;
  notes: string;
  statut: CandidatStatut;
  revenuMensuelNet: string;
  loyerVise: string;
  situationProfessionnelle: string;
  garantNom: string;
  garantRevenuMensuelNet: string;
}

const FORMULAIRE_VIDE: FormulaireCandidat = {
  nom: "",
  prenom: "",
  telephone: "",
  email: "",
  appartementId: "",
  notes: "",
  statut: "en_attente",
  revenuMensuelNet: "",
  loyerVise: "",
  situationProfessionnelle: "",
  garantNom: "",
  garantRevenuMensuelNet: ""
};

export function libelleCandidat(candidat: Pick<Candidat, "nom" | "prenom">): string {
  return candidat.prenom ? `${candidat.prenom} ${candidat.nom}` : candidat.nom;
}

// Module Calendrier/Candidats (2026-09-15) : Candidats est son propre
// module de navigation, séparé du Calendrier — anticipation du futur
// portail externe de dépôt de dossier (docs/backlog.md, "Portail
// externe"), qui aura besoin d'une base candidat déjà solide. Le
// Calendrier référence un candidat (evenement_calendrier.candidatId) sans
// posséder son cycle de vie.
export function CandidatsView(): React.JSX.Element {
  const navigate = useNavigate();
  const [candidats, setCandidats] = useState<Candidat[]>([]);
  const [appartements, setAppartements] = useState<Appartement[]>([]);
  const [libellesAppartement, setLibellesAppartement] = useState<Map<string, string>>(new Map());
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>("");
  const [vue, setVue] = useState<Vue>({ niveau: "liste" });
  const [formulaire, setFormulaire] = useState<FormulaireCandidat>(FORMULAIRE_VIDE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [erreurConversion, setErreurConversion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [listeCandidats, listeAppartements] = await Promise.all([listCandidats(), listAppartements()]);
      setCandidats(listeCandidats);
      setAppartements(listeAppartements);

      const biensCache = new Map<string, Bien>();
      const libelles = new Map<string, string>();
      for (const appartement of listeAppartements) {
        let bien = biensCache.get(appartement.bienId);
        if (!bien) {
          bien = await getBien(appartement.bienId);
          biensCache.set(appartement.bienId, bien);
        }
        libelles.set(appartement.id, `${libelleBien(bien)} — n°${appartement.numero}`);
      }
      setLibellesAppartement(libelles);
      setError(null);
    } catch {
      setError("Impossible de charger les candidats");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ouvrirCandidat(candidatId: string): Promise<void> {
    const candidat = await getCandidat(candidatId);
    setFormulaire({
      nom: candidat.nom,
      prenom: candidat.prenom ?? "",
      telephone: candidat.telephone ?? "",
      email: candidat.email ?? "",
      appartementId: candidat.appartementId ?? "",
      notes: candidat.notes ?? "",
      statut: candidat.statut,
      revenuMensuelNet: candidat.revenuMensuelNet ?? "",
      loyerVise: candidat.loyerVise ?? "",
      situationProfessionnelle: candidat.situationProfessionnelle ?? "",
      garantNom: candidat.garantNom ?? "",
      garantRevenuMensuelNet: candidat.garantRevenuMensuelNet ?? ""
    });
    setVue({ niveau: "edition", candidatId });
  }

  function choisirAppartement(appartementId: string): void {
    const appartement = appartements.find((a) => a.id === appartementId);
    setFormulaire({
      ...formulaire,
      appartementId,
      // Pré-rempli depuis loyerReference si disponible, modifiable ensuite
      // — jamais recalculé automatiquement après coup.
      ...(formulaire.loyerVise === "" && appartement?.loyerReference && { loyerVise: appartement.loyerReference })
    });
  }

  async function soumettreFormulaire(e: FormEvent): Promise<void> {
    e.preventDefault();
    const input = {
      nom: formulaire.nom,
      prenom: formulaire.prenom,
      statut: formulaire.statut,
      ...(formulaire.telephone !== "" && { telephone: formulaire.telephone }),
      ...(formulaire.email !== "" && { email: formulaire.email }),
      ...(formulaire.appartementId !== "" && { appartementId: formulaire.appartementId }),
      ...(formulaire.notes !== "" && { notes: formulaire.notes }),
      ...(formulaire.revenuMensuelNet !== "" && { revenuMensuelNet: formulaire.revenuMensuelNet }),
      ...(formulaire.loyerVise !== "" && { loyerVise: formulaire.loyerVise }),
      ...(formulaire.situationProfessionnelle !== "" && {
        situationProfessionnelle: formulaire.situationProfessionnelle
      }),
      ...(formulaire.garantNom !== "" && { garantNom: formulaire.garantNom }),
      ...(formulaire.garantRevenuMensuelNet !== "" && { garantRevenuMensuelNet: formulaire.garantRevenuMensuelNet })
    };
    try {
      if (vue.niveau === "edition") {
        await updateCandidat(vue.candidatId, input);
      } else {
        await createCandidat(input);
      }
      setVue({ niveau: "liste" });
      setFormulaire(FORMULAIRE_VIDE);
      await refresh();
    } catch {
      setError("Impossible d'enregistrer ce candidat");
    }
  }

  async function archiver(candidatId: string): Promise<void> {
    await archiveCandidat(candidatId);
    setVue({ niveau: "liste" });
    setFormulaire(FORMULAIRE_VIDE);
    await refresh();
  }

  // Ne génère jamais de bail (dates/loyer réel absents du dossier
  // candidat) — la création du bail reste un geste séparé via l'écran
  // Patrimoine. nom/prenom/telephone/email sont copiés directement depuis
  // le candidat côté backend (CandidatsService.convertirEnLocataire) —
  // plus aucune ressaisie ici.
  async function handleConvertir(candidatId: string): Promise<void> {
    setIsConverting(true);
    setErreurConversion(null);
    try {
      const resultat = await convertirCandidatEnLocataire(candidatId);
      setVue({ niveau: "liste" });
      setFormulaire(FORMULAIRE_VIDE);
      await refresh();
      navigate(`/locataires?locataireId=${resultat.locataire.id}`);
    } catch (err) {
      setErreurConversion(err instanceof ApiError ? err.message : "Impossible de convertir ce candidat");
    } finally {
      setIsConverting(false);
    }
  }

  const visibles = candidats.filter((c) => (filtreStatut === "" ? true : c.statut === filtreStatut));

  const tauxEffortCentimes =
    formulaire.loyerVise !== "" && formulaire.revenuMensuelNet !== ""
      ? calculerTauxEffort(formulaire.loyerVise, formulaire.revenuMensuelNet)
      : null;

  if (vue.niveau !== "liste") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">
          {vue.niveau === "creation" ? "Nouveau candidat" : "Modifier le candidat"}
        </h1>
        <form onSubmit={soumettreFormulaire} className="max-w-md space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Nom
              <input
                type="text"
                required
                value={formulaire.nom}
                onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Prénom
              <input
                type="text"
                required
                value={formulaire.prenom}
                onChange={(e) => setFormulaire({ ...formulaire, prenom: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <label className="block text-sm">
            Statut
            <select
              value={formulaire.statut}
              onChange={(e) => setFormulaire({ ...formulaire, statut: e.target.value as CandidatStatut })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              {CANDIDAT_STATUTS.map((statut) => (
                <option key={statut} value={statut}>
                  {CANDIDAT_STATUT_LABELS[statut]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Appartement visité
            <select
              value={formulaire.appartementId}
              onChange={(e) => choisirAppartement(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Aucun —</option>
              {appartements.map((appartement) => (
                <option key={appartement.id} value={appartement.id}>
                  {libellesAppartement.get(appartement.id) ?? appartement.numero}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Téléphone
            <input
              type="text"
              value={formulaire.telephone}
              onChange={(e) => setFormulaire({ ...formulaire, telephone: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Email
            <input
              type="email"
              value={formulaire.email}
              onChange={(e) => setFormulaire({ ...formulaire, email: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Situation professionnelle
            <input
              type="text"
              value={formulaire.situationProfessionnelle}
              onChange={(e) => setFormulaire({ ...formulaire, situationProfessionnelle: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Revenu mensuel net (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.revenuMensuelNet}
                onChange={(e) => setFormulaire({ ...formulaire, revenuMensuelNet: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Loyer visé (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.loyerVise}
                onChange={(e) => setFormulaire({ ...formulaire, loyerVise: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          {tauxEffortCentimes !== null && (
            <p className="text-sm text-slate-600">
              Taux d'effort :{" "}
              <span className="font-medium">{centimesVersMontant(tauxEffortCentimes).replace(".", ",")} %</span>
              <span className="ml-1 text-xs text-slate-400">(purement informatif)</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Nom du garant
              <input
                type="text"
                value={formulaire.garantNom}
                onChange={(e) => setFormulaire({ ...formulaire, garantNom: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Revenu mensuel net du garant (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.garantRevenuMensuelNet}
                onChange={(e) => setFormulaire({ ...formulaire, garantRevenuMensuelNet: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <label className="block text-sm">
            Notes
            <textarea
              value={formulaire.notes}
              onChange={(e) => setFormulaire({ ...formulaire, notes: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              rows={3}
            />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => {
                setVue({ niveau: "liste" });
                setFormulaire(FORMULAIRE_VIDE);
              }}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Annuler
            </button>
            {vue.niveau === "edition" && (
              <button
                type="button"
                onClick={() => void archiver(vue.candidatId)}
                className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Archiver
              </button>
            )}
          </div>
        </form>

        {vue.niveau === "edition" && formulaire.statut !== "converti" && (
          <div className="max-w-md space-y-2 rounded-md border border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-700">Convertir en locataire</h2>
            <p className="text-xs text-slate-500">
              Crée un locataire depuis nom/prénom/téléphone/email de ce candidat et le marque comme converti. Ne
              génère aucun bail — à créer séparément depuis l'écran Patrimoine.
            </p>
            {erreurConversion && (
              <p role="alert" className="text-sm text-red-600">
                {erreurConversion}
              </p>
            )}
            <button
              type="button"
              disabled={isConverting}
              onClick={() => void handleConvertir(vue.candidatId)}
              className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isConverting ? "Conversion…" : "Convertir en locataire"}
            </button>
          </div>
        )}

        {vue.niveau === "edition" && (
          <div className="max-w-md space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Pièces jointes</h2>
            <ChecklistCategoriesEntite
              entiteType="candidat"
              entiteId={vue.candidatId}
              role="candidat"
              titre="Documents du candidat"
              onChanged={() => {}}
            />
            <ChecklistCategoriesEntite
              entiteType="candidat"
              entiteId={vue.candidatId}
              role="garant"
              titre="Documents du garant"
              onChanged={() => {}}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Candidats</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value as FiltreStatut)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="">Tous les statuts</option>
            {CANDIDAT_STATUTS.map((statut) => (
              <option key={statut} value={statut}>
                {CANDIDAT_STATUT_LABELS[statut]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setVue({ niveau: "creation" })}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Candidat
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun candidat pour ce filtre.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium uppercase text-slate-500">
              <th className="py-2">Statut</th>
              <th className="py-2">Nom</th>
              <th className="py-2">Appartement</th>
              <th className="py-2">Téléphone</th>
              <th className="py-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr
                key={c.id}
                onClick={() => void ouvrirCandidat(c.id)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {CANDIDAT_STATUT_LABELS[c.statut]}
                  </span>
                </td>
                <td className="py-2">{libelleCandidat(c)}</td>
                <td className="py-2">{c.appartementId ? (libellesAppartement.get(c.appartementId) ?? "—") : "—"}</td>
                <td className="py-2">{c.telephone ?? "—"}</td>
                <td className="py-2">{c.email ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
