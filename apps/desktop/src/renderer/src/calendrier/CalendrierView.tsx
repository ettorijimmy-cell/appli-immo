import { useCallback, useEffect, useState, type FormEvent } from "react";
import { listCandidats, type Candidat } from "../candidats/api";
import { libelleCandidat } from "../candidats/CandidatsView";
import { listContacts, type Contact } from "../contacts/api";
import { getBien, libelleBien, listAppartements, listBiens, type Appartement, type Bien } from "../patrimoine/api";
import {
  archiveEvenement,
  createEvenement,
  getEvenement,
  listEvenements,
  updateEvenement,
  EVENEMENT_TYPES,
  EVENEMENT_TYPE_LABELS,
  type EvenementCalendrier,
  type EvenementType
} from "./api";

type FiltreType = "" | EvenementType;

type Vue = { niveau: "liste" } | { niveau: "creation" } | { niveau: "edition"; evenementId: string };

interface FormulaireEvenement {
  type: EvenementType;
  titre: string;
  dateDebut: string;
  dateFin: string;
  bienId: string;
  appartementId: string;
  contactId: string;
  candidatId: string;
  notes: string;
}

const FORMULAIRE_VIDE: FormulaireEvenement = {
  type: "autre",
  titre: "",
  dateDebut: "",
  dateFin: "",
  bienId: "",
  appartementId: "",
  contactId: "",
  candidatId: "",
  notes: ""
};

// Convertit un ISO (stocké/renvoyé par le backend) vers le format attendu
// par <input type="datetime-local">, et inversement — pas de fuseau
// horaire distinct géré ici (heure locale du poste, cohérent avec un
// usage mono-utilisateur).
function versInputDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const decalage = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - decalage).toISOString().slice(0, 16);
}

function depuisInputDatetimeLocal(valeur: string): string {
  return new Date(valeur).toISOString();
}

function formaterDateAffichage(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

// Module Calendrier d'interventions (2026-09-15) : vue liste (pas de grille
// mensuelle) — cohérente avec le reste de l'application (aucune autre vue
// n'utilise de grille calendaire) et avec la consigne de rester simple tant
// qu'un besoin réel de vue mensuelle ne se fait pas sentir. bienId/
// appartementId/contactId/candidatId sont tous des rattachements
// indépendamment optionnels, quel que soit le type choisi (aucune
// contrainte imposée ici, voir packages/db/src/schema/evenement-calendrier.ts).
export function CalendrierView(): React.JSX.Element {
  const [evenements, setEvenements] = useState<EvenementCalendrier[]>([]);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [appartements, setAppartements] = useState<Appartement[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [candidats, setCandidats] = useState<Candidat[]>([]);
  const [libellesAppartement, setLibellesAppartement] = useState<Map<string, string>>(new Map());
  const [filtreType, setFiltreType] = useState<FiltreType>("");
  const [vue, setVue] = useState<Vue>({ niveau: "liste" });
  const [formulaire, setFormulaire] = useState<FormulaireEvenement>(FORMULAIRE_VIDE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [listeEvenements, listeBiens, listeAppartements, listeContacts, listeCandidats] = await Promise.all([
        listEvenements(),
        listBiens(),
        listAppartements(),
        listContacts(),
        listCandidats()
      ]);
      setEvenements(listeEvenements);
      setBiens(listeBiens);
      setAppartements(listeAppartements);
      setContacts(listeContacts);
      setCandidats(listeCandidats);

      const biensCache = new Map<string, Bien>(listeBiens.map((bien) => [bien.id, bien]));
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
      setError("Impossible de charger le calendrier");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ouvrirEvenement(evenementId: string): Promise<void> {
    const evenement = await getEvenement(evenementId);
    setFormulaire({
      type: evenement.type,
      titre: evenement.titre,
      dateDebut: versInputDatetimeLocal(evenement.dateDebut),
      dateFin: evenement.dateFin ? versInputDatetimeLocal(evenement.dateFin) : "",
      bienId: evenement.bienId ?? "",
      appartementId: evenement.appartementId ?? "",
      contactId: evenement.contactId ?? "",
      candidatId: evenement.candidatId ?? "",
      notes: evenement.notes ?? ""
    });
    setVue({ niveau: "edition", evenementId });
  }

  async function soumettreFormulaire(e: FormEvent): Promise<void> {
    e.preventDefault();
    const input = {
      type: formulaire.type,
      titre: formulaire.titre,
      dateDebut: depuisInputDatetimeLocal(formulaire.dateDebut),
      ...(formulaire.dateFin !== "" && { dateFin: depuisInputDatetimeLocal(formulaire.dateFin) }),
      ...(formulaire.bienId !== "" && { bienId: formulaire.bienId }),
      ...(formulaire.appartementId !== "" && { appartementId: formulaire.appartementId }),
      ...(formulaire.contactId !== "" && { contactId: formulaire.contactId }),
      ...(formulaire.candidatId !== "" && { candidatId: formulaire.candidatId }),
      ...(formulaire.notes !== "" && { notes: formulaire.notes })
    };
    try {
      if (vue.niveau === "edition") {
        await updateEvenement(vue.evenementId, input);
      } else {
        await createEvenement(input);
      }
      setVue({ niveau: "liste" });
      setFormulaire(FORMULAIRE_VIDE);
      await refresh();
    } catch {
      setError("Impossible d'enregistrer cet événement");
    }
  }

  async function archiver(evenementId: string): Promise<void> {
    await archiveEvenement(evenementId);
    setVue({ niveau: "liste" });
    setFormulaire(FORMULAIRE_VIDE);
    await refresh();
  }

  const visibles = evenements
    .filter((e) => (filtreType === "" ? true : e.type === filtreType))
    .slice()
    .sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));

  if (vue.niveau !== "liste") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">
          {vue.niveau === "creation" ? "Nouvel événement" : "Modifier l'événement"}
        </h1>
        <form onSubmit={soumettreFormulaire} className="max-w-md space-y-3">
          <label className="block text-sm">
            Type
            <select
              value={formulaire.type}
              onChange={(e) => setFormulaire({ ...formulaire, type: e.target.value as EvenementType })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              {EVENEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENEMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Titre
            <input
              type="text"
              required
              value={formulaire.titre}
              onChange={(e) => setFormulaire({ ...formulaire, titre: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Début
              <input
                type="datetime-local"
                required
                value={formulaire.dateDebut}
                onChange={(e) => setFormulaire({ ...formulaire, dateDebut: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              Fin (optionnelle)
              <input
                type="datetime-local"
                value={formulaire.dateFin}
                onChange={(e) => setFormulaire({ ...formulaire, dateFin: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          <label className="block text-sm">
            Bien
            <select
              value={formulaire.bienId}
              onChange={(e) => setFormulaire({ ...formulaire, bienId: e.target.value })}
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
            Appartement
            <select
              value={formulaire.appartementId}
              onChange={(e) => setFormulaire({ ...formulaire, appartementId: e.target.value })}
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
            Contact
            <select
              value={formulaire.contactId}
              onChange={(e) => setFormulaire({ ...formulaire, contactId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Aucun —</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Candidat
            <select
              value={formulaire.candidatId}
              onChange={(e) => setFormulaire({ ...formulaire, candidatId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Aucun —</option>
              {candidats.map((candidat) => (
                <option key={candidat.id} value={candidat.id}>
                  {libelleCandidat(candidat)}
                </option>
              ))}
            </select>
          </label>
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
                onClick={() => void archiver(vue.evenementId)}
                className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Archiver
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Calendrier</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={filtreType}
            onChange={(e) => setFiltreType(e.target.value as FiltreType)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="">Tous les types</option>
            {EVENEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENEMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setVue({ niveau: "creation" })}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Événement
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
        <p className="text-sm text-slate-500">Aucun événement pour ce filtre.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium uppercase text-slate-500">
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2">Titre</th>
              <th className="py-2">Rattachement</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((e) => (
              <tr
                key={e.id}
                onClick={() => void ouvrirEvenement(e.id)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2">{formaterDateAffichage(e.dateDebut)}</td>
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {EVENEMENT_TYPE_LABELS[e.type]}
                  </span>
                </td>
                <td className="py-2">{e.titre}</td>
                <td className="py-2">
                  {e.appartementId
                    ? (libellesAppartement.get(e.appartementId) ?? "—")
                    : e.bienId
                      ? (() => {
                          const bien = biens.find((b) => b.id === e.bienId);
                          return bien ? libelleBien(bien) : "—";
                        })()
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
