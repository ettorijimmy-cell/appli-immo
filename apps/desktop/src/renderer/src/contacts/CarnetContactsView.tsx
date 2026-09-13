import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getBail } from "../locataires/api";
import {
  archiveContact,
  createContact,
  getContact,
  listContactsUnifies,
  updateContact,
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  type ContactRole,
  type ContactTypeEntite,
  type ContactUnifie
} from "./api";

type FiltreType = "" | "locataire" | "garant" | ContactRole;

const LABELS_TYPE: Record<ContactUnifie["type"], string> = {
  locataire: "Locataire",
  garant: "Garant",
  ...CONTACT_ROLE_LABELS
};

type Vue = { niveau: "liste" } | { niveau: "creation" } | { niveau: "edition"; contactId: string };

interface FormulaireContact {
  nom: string;
  typeEntite: ContactTypeEntite;
  role: ContactRole;
  telephone: string;
  email: string;
  notes: string;
}

const FORMULAIRE_VIDE: FormulaireContact = {
  nom: "",
  typeEntite: "entreprise",
  role: "artisan",
  telephone: "",
  email: "",
  notes: ""
};

// Module Carnet de contacts (2026-09-13) : écran transversal agrégeant
// locataires + garants (lecture seule, gérés depuis leurs propres écrans)
// et les nouveaux contacts professionnels (artisans, diagnostiqueurs,
// syndic, assureurs — jamais rattachés à un bien précis). Le formulaire
// de création/édition est limité aux contacts pro.
export function CarnetContactsView(): React.JSX.Element {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactUnifie[]>([]);
  const [filtreType, setFiltreType] = useState<FiltreType>("");
  const [vue, setVue] = useState<Vue>({ niveau: "liste" });
  const [formulaire, setFormulaire] = useState<FormulaireContact>(FORMULAIRE_VIDE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setContacts(await listContactsUnifies());
      setError(null);
    } catch {
      setError("Impossible de charger le carnet de contacts");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ouvrirLigne(c: ContactUnifie): Promise<void> {
    if (c.type === "locataire") {
      navigate(`/locataires?locataireId=${c.id}`);
      return;
    }
    if (c.type === "garant") {
      if (!c.bailId) {
        return;
      }
      // Un garant n'a pas de fiche autonome — ouvre l'onglet Bail de
      // l'appartement concerné (même deep-link que le Module 8).
      const bail = await getBail(c.bailId);
      navigate(`/patrimoine?appartementId=${bail.appartementId}&onglet=bail`);
      return;
    }
    // Contact professionnel : ouvre sa propre fiche en édition.
    const contact = await getContact(c.id);
    setFormulaire({
      nom: contact.nom,
      typeEntite: contact.typeEntite,
      role: contact.role,
      telephone: contact.telephone ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? ""
    });
    setVue({ niveau: "edition", contactId: c.id });
  }

  async function soumettreFormulaire(e: FormEvent): Promise<void> {
    e.preventDefault();
    const input = {
      nom: formulaire.nom,
      typeEntite: formulaire.typeEntite,
      role: formulaire.role,
      ...(formulaire.telephone !== "" && { telephone: formulaire.telephone }),
      ...(formulaire.email !== "" && { email: formulaire.email }),
      ...(formulaire.notes !== "" && { notes: formulaire.notes })
    };
    try {
      if (vue.niveau === "edition") {
        await updateContact(vue.contactId, input);
      } else {
        await createContact(input);
      }
      setVue({ niveau: "liste" });
      setFormulaire(FORMULAIRE_VIDE);
      await refresh();
    } catch {
      setError("Impossible d'enregistrer ce contact");
    }
  }

  async function archiver(contactId: string): Promise<void> {
    await archiveContact(contactId);
    setVue({ niveau: "liste" });
    setFormulaire(FORMULAIRE_VIDE);
    await refresh();
  }

  const visibles = contacts.filter((c) => (filtreType === "" ? true : c.type === filtreType));

  if (vue.niveau !== "liste") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">
          {vue.niveau === "creation" ? "Nouveau contact professionnel" : "Modifier le contact"}
        </h1>
        <form onSubmit={soumettreFormulaire} className="max-w-md space-y-3">
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
            Type
            <select
              value={formulaire.typeEntite}
              onChange={(e) => setFormulaire({ ...formulaire, typeEntite: e.target.value as ContactTypeEntite })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="entreprise">Entreprise</option>
              <option value="personne_physique">Personne physique</option>
            </select>
          </label>
          <label className="block text-sm">
            Rôle
            <select
              value={formulaire.role}
              onChange={(e) => setFormulaire({ ...formulaire, role: e.target.value as ContactRole })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              {CONTACT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {CONTACT_ROLE_LABELS[role]}
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
                onClick={() => void archiver(vue.contactId)}
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
        <h1 className="text-lg font-semibold">Carnet de contacts</h1>
        <div className="flex items-center gap-4 text-sm">
          <select
            value={filtreType}
            onChange={(e) => setFiltreType(e.target.value as FiltreType)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="">Tous les types</option>
            {Object.entries(LABELS_TYPE).map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setVue({ niveau: "creation" })}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            + Contact professionnel
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
        <p className="text-sm text-slate-500">Aucun contact pour ce filtre.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium uppercase text-slate-500">
              <th className="py-2">Type</th>
              <th className="py-2">Nom</th>
              <th className="py-2">Téléphone</th>
              <th className="py-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr
                key={`${c.type}-${c.id}`}
                onClick={() => void ouvrirLigne(c)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {LABELS_TYPE[c.type]}
                  </span>
                </td>
                <td className="py-2">{c.nom}</td>
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
