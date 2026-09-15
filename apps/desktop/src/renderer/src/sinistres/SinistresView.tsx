import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { listEvenements, type EvenementCalendrier } from "../calendrier/api";
import { listContacts, type Contact } from "../contacts/api";
import { DocumentsForEntite } from "../documents/DocumentsForEntite";
import { libelleBien, listAppartements, listBiens, type Appartement, type Bien } from "../patrimoine/api";
import {
  archiveSinistre,
  createSinistre,
  getSinistre,
  listSinistres,
  updateSinistre,
  SINISTRE_STATUTS,
  SINISTRE_STATUT_LABELS,
  SINISTRE_TYPES,
  SINISTRE_TYPE_LABELS,
  type Sinistre,
  type SinistreStatut,
  type SinistreType
} from "./api";

type FiltreStatut = "" | SinistreStatut;

type Vue = { niveau: "liste" } | { niveau: "creation" } | { niveau: "edition"; sinistreId: string };

interface FormulaireSinistre {
  type: SinistreType;
  statut: SinistreStatut;
  bienId: string;
  appartementId: string;
  contactAssureurId: string;
  dateDeclaration: string;
  description: string;
  montantReclame: string;
  montantIndemnise: string;
  franchise: string;
  notes: string;
}

const FORMULAIRE_VIDE: FormulaireSinistre = {
  type: "autre",
  statut: "declare",
  bienId: "",
  appartementId: "",
  contactAssureurId: "",
  dateDeclaration: "",
  description: "",
  montantReclame: "",
  montantIndemnise: "",
  franchise: "",
  notes: ""
};

// Module Suivi sinistre et assurance (2026-09-16) : l'objectif principal
// n'est pas le simple enregistrement, mais la détection de stagnation
// (AlertesJobService.genererAlertesSinistreStagnation) — cet écran reste un
// CRUD classique, la valeur ajoutée vit côté job + Tâches. Montant indemnisé
// purement informatif, jamais de lien automatique vers Charges et
// fiscalité (décision explicite).
export function SinistresView(): React.JSX.Element {
  const navigate = useNavigate();
  const [sinistres, setSinistres] = useState<Sinistre[]>([]);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [appartements, setAppartements] = useState<Appartement[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [evenements, setEvenements] = useState<EvenementCalendrier[]>([]);
  const [libellesBien, setLibellesBien] = useState<Map<string, string>>(new Map());
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>("");
  const [filtreBienId, setFiltreBienId] = useState<string>("");
  const [vue, setVue] = useState<Vue>({ niveau: "liste" });
  const [formulaire, setFormulaire] = useState<FormulaireSinistre>(FORMULAIRE_VIDE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [listeSinistres, listeBiens, listeAppartements, listeContacts, listeEvenements] = await Promise.all([
        listSinistres(),
        listBiens(),
        listAppartements(),
        listContacts(),
        listEvenements()
      ]);
      setSinistres(listeSinistres);
      setBiens(listeBiens);
      setAppartements(listeAppartements);
      setContacts(listeContacts);
      setEvenements(listeEvenements);

      const libelles = new Map<string, string>();
      for (const bien of listeBiens) {
        libelles.set(bien.id, libelleBien(bien));
      }
      setLibellesBien(libelles);
      setError(null);
    } catch {
      setError("Impossible de charger les sinistres");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ouvrirSinistre(sinistreId: string): Promise<void> {
    const sinistre = await getSinistre(sinistreId);
    setFormulaire({
      type: sinistre.type,
      statut: sinistre.statut,
      bienId: sinistre.bienId ?? "",
      appartementId: sinistre.appartementId ?? "",
      contactAssureurId: sinistre.contactAssureurId ?? "",
      dateDeclaration: sinistre.dateDeclaration,
      description: sinistre.description ?? "",
      montantReclame: sinistre.montantReclame ?? "",
      montantIndemnise: sinistre.montantIndemnise ?? "",
      franchise: sinistre.franchise ?? "",
      notes: sinistre.notes ?? ""
    });
    setVue({ niveau: "edition", sinistreId });
  }

  async function soumettreFormulaire(e: FormEvent): Promise<void> {
    e.preventDefault();
    const input = {
      type: formulaire.type,
      ...(vue.niveau === "edition" && { statut: formulaire.statut }),
      ...(formulaire.bienId !== "" && { bienId: formulaire.bienId }),
      ...(formulaire.appartementId !== "" && { appartementId: formulaire.appartementId }),
      ...(formulaire.contactAssureurId !== "" && { contactAssureurId: formulaire.contactAssureurId }),
      dateDeclaration: formulaire.dateDeclaration,
      ...(formulaire.description !== "" && { description: formulaire.description }),
      ...(formulaire.montantReclame !== "" && { montantReclame: formulaire.montantReclame }),
      ...(formulaire.montantIndemnise !== "" && { montantIndemnise: formulaire.montantIndemnise }),
      ...(formulaire.franchise !== "" && { franchise: formulaire.franchise }),
      ...(formulaire.notes !== "" && { notes: formulaire.notes })
    };
    try {
      if (vue.niveau === "edition") {
        await updateSinistre(vue.sinistreId, input);
      } else {
        await createSinistre(input);
      }
      setVue({ niveau: "liste" });
      setFormulaire(FORMULAIRE_VIDE);
      await refresh();
    } catch {
      setError("Impossible d'enregistrer ce sinistre");
    }
  }

  async function archiver(sinistreId: string): Promise<void> {
    await archiveSinistre(sinistreId);
    setVue({ niveau: "liste" });
    setFormulaire(FORMULAIRE_VIDE);
    await refresh();
  }

  // Ouvre le formulaire de création d'événement déjà existant (Calendrier),
  // pré-rempli avec type='expertise_sinistre', sinistreId, et bienId/
  // appartementId déjà connus du sinistre (formulaire.bienId/appartementId,
  // posés par ouvrirSinistre) — jamais une création directe sans
  // confirmation (retour de Jimmy après test manuel, 2026-09-16) : la date
  // reste à choisir dans ce formulaire, jamais devinée ici. Ne duplique pas
  // le formulaire de création (voir CalendrierPage.prefiltrageInitial /
  // CalendrierView).
  function ouvrirCreationRendezVousExpertise(sinistreId: string): void {
    const params = new URLSearchParams({ sinistreId, type: "expertise_sinistre" });
    if (formulaire.bienId !== "") {
      params.set("bienId", formulaire.bienId);
    }
    if (formulaire.appartementId !== "") {
      params.set("appartementId", formulaire.appartementId);
    }
    navigate(`/calendrier?${params.toString()}`);
  }

  const visibles = sinistres.filter(
    (s) => (filtreStatut === "" ? true : s.statut === filtreStatut) && (filtreBienId === "" ? true : s.bienId === filtreBienId)
  );

  const appartementsDuBien = appartements.filter((a) => a.bienId === formulaire.bienId);
  const contactsAssureur = contacts.filter((c) => c.role === "assureur");
  const evenementsDuSinistre =
    vue.niveau === "edition" ? evenements.filter((e) => e.sinistreId === vue.sinistreId) : [];

  if (vue.niveau !== "liste") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">{vue.niveau === "creation" ? "Nouveau sinistre" : "Modifier le sinistre"}</h1>
        <form onSubmit={soumettreFormulaire} className="max-w-md space-y-3">
          <label className="block text-sm">
            Type
            <select
              value={formulaire.type}
              onChange={(e) => setFormulaire({ ...formulaire, type: e.target.value as SinistreType })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              {SINISTRE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SINISTRE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          {vue.niveau === "edition" && (
            <label className="block text-sm">
              Statut
              <select
                value={formulaire.statut}
                onChange={(e) => setFormulaire({ ...formulaire, statut: e.target.value as SinistreStatut })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              >
                {SINISTRE_STATUTS.map((statut) => (
                  <option key={statut} value={statut}>
                    {SINISTRE_STATUT_LABELS[statut]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            Bien
            <select
              value={formulaire.bienId}
              onChange={(e) => setFormulaire({ ...formulaire, bienId: e.target.value, appartementId: "" })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Aucun —</option>
              {biens.map((bien) => (
                <option key={bien.id} value={bien.id}>
                  {libelleBien(bien)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Appartement (si le sinistre ne concerne pas le bien entier)
            <select
              value={formulaire.appartementId}
              onChange={(e) => setFormulaire({ ...formulaire, appartementId: e.target.value })}
              disabled={formulaire.bienId === ""}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 disabled:opacity-50"
            >
              <option value="">— Aucun —</option>
              {appartementsDuBien.map((appartement) => (
                <option key={appartement.id} value={appartement.id}>
                  n°{appartement.numero}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Assureur (Carnet de contacts)
            <select
              value={formulaire.contactAssureurId}
              onChange={(e) => setFormulaire({ ...formulaire, contactAssureurId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Aucun —</option>
              {contactsAssureur.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Date de déclaration
            <input
              type="date"
              required
              value={formulaire.dateDeclaration}
              onChange={(e) => setFormulaire({ ...formulaire, dateDeclaration: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              value={formulaire.description}
              onChange={(e) => setFormulaire({ ...formulaire, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              rows={3}
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              Montant réclamé (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.montantReclame}
                onChange={(e) => setFormulaire({ ...formulaire, montantReclame: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Franchise (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.franchise}
                onChange={(e) => setFormulaire({ ...formulaire, franchise: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Montant indemnisé (€)
              <input
                type="text"
                inputMode="decimal"
                value={formulaire.montantIndemnise}
                onChange={(e) => setFormulaire({ ...formulaire, montantIndemnise: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Le montant indemnisé reste purement informatif — aucune écriture automatique dans Charges et fiscalité (le
            traitement fiscal d'une indemnisation est incertain, à traiter manuellement si besoin).
          </p>
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
                onClick={() => void archiver(vue.sinistreId)}
                className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Archiver
              </button>
            )}
          </div>
        </form>

        {vue.niveau === "edition" && (
          <div className="max-w-md space-y-2 rounded-md border border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-700">Rendez-vous d'expertise</h2>
            {evenementsDuSinistre.length > 0 ? (
              <ul className="space-y-1 text-sm text-slate-600">
                {evenementsDuSinistre.map((evenement) => (
                  <li key={evenement.id}>
                    {evenement.titre} — {new Date(evenement.dateDebut).toLocaleString("fr-FR")}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-xs text-slate-500">Aucun rendez-vous d'expertise créé pour ce sinistre.</p>
                <button
                  type="button"
                  onClick={() => ouvrirCreationRendezVousExpertise(vue.sinistreId)}
                  className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Créer un rendez-vous d'expertise
                </button>
              </>
            )}
          </div>
        )}

        {vue.niveau === "edition" && (
          <div className="max-w-md space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Pièces jointes</h2>
            <DocumentsForEntite entiteType="sinistre" entiteId={vue.sinistreId} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sinistres</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value as FiltreStatut)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="">Tous les statuts</option>
            {SINISTRE_STATUTS.map((statut) => (
              <option key={statut} value={statut}>
                {SINISTRE_STATUT_LABELS[statut]}
              </option>
            ))}
          </select>
          <select
            value={filtreBienId}
            onChange={(e) => setFiltreBienId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="">Tous les biens</option>
            {biens.map((bien) => (
              <option key={bien.id} value={bien.id}>
                {libelleBien(bien)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setVue({ niveau: "creation" })}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Sinistre
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
        <p className="text-sm text-slate-500">Aucun sinistre pour ce filtre.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium uppercase text-slate-500">
              <th className="py-2">Statut</th>
              <th className="py-2">Type</th>
              <th className="py-2">Bien</th>
              <th className="py-2">Déclaré le</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((s) => (
              <tr
                key={s.id}
                onClick={() => void ouvrirSinistre(s.id)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {SINISTRE_STATUT_LABELS[s.statut]}
                  </span>
                </td>
                <td className="py-2">{SINISTRE_TYPE_LABELS[s.type]}</td>
                <td className="py-2">{s.bienId ? (libellesBien.get(s.bienId) ?? "—") : "—"}</td>
                <td className="py-2">{s.dateDeclaration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
