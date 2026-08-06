import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveToggle } from "../components/ArchiveFilter";
import type { Bail } from "../locataires/api";
import {
  createEtatDesLieux,
  getCatalogueInventaire,
  getEtatDesLieuxParBail,
  submitCles,
  submitCompteurs,
  submitEquipementsDivers,
  submitInventaire,
  submitPieceAutre,
  submitPieceChambre,
  submitPieceCuisine,
  submitPieceEntree,
  submitPieceSalleDeBain,
  submitPieceSejour,
  submitPieceWc,
  updateEtatDesLieuxHeader,
  type ElementInventaireMeuble,
  type EtatDesLieuxComplet,
  type StatutEtatDesLieux
} from "./api";
import { ClesSection } from "./ClesSection";
import { CompteursCard } from "./CompteursCard";
import { EquipementsDiversSection } from "./EquipementsDiversSection";
import { InventaireSection } from "./InventaireSection";
import { MultiPieceSection, PieceCard } from "./PieceGrid";
import {
  ELEMENTS_AUTRE,
  ELEMENTS_CHAMBRE,
  ELEMENTS_CUISINE,
  ELEMENTS_ENTREE,
  ELEMENTS_SALLE_DE_BAIN,
  ELEMENTS_SEJOUR,
  ELEMENTS_WC
} from "./pieces-config";

const LABEL_STATUT: Record<StatutEtatDesLieux, string> = {
  non_commence: "Non commencé",
  entree_terminee: "Entrée renseignée",
  complet: "Entrée et sortie renseignées"
};

// Vue de relecture desktop (tableau dense, même pattern que Patrimoine /
// Finances) : sert à relire/corriger l'état des lieux après la visite —
// la capture initiale se fait sur le parcours mobile pas-à-pas (à
// construire). Un seul état des lieux par bail (bail_id unique).
export function EtatDesLieuxSection({ bail }: { bail: Bail }): React.JSX.Element {
  const [etatDesLieux, setEtatDesLieux] = useState<EtatDesLieuxComplet | null>(null);
  const [catalogue, setCatalogue] = useState<ElementInventaireMeuble[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Distingue le tout premier chargement (seul cas où on démonte l'arbre
  // entier au profit de "Chargement…") des rafraîchissements silencieux
  // après chaque sauvegarde/ajout. Sans cette distinction, chaque clic sur
  // "Ajouter" ou "Enregistrer" (tous appellent refresh()) démonte
  // brièvement tout le contenu dense de la section — la page perd sa
  // hauteur de défilement, le navigateur ramène le scroll en haut, et rien
  // ne le restaure quand le contenu réapparaît. Bug remonté en test manuel
  // (2026-08-06) : "Ajouter" fonctionnait mais faisait remonter la page.
  const premierChargementEffectue = useRef(false);

  const refresh = useCallback(async () => {
    if (!premierChargementEffectue.current) {
      setIsLoading(true);
    }
    try {
      setEtatDesLieux(await getEtatDesLieuxParBail(bail.id, showArchived));
      setError(null);
    } catch {
      setError("Impossible de charger l'état des lieux");
    } finally {
      setIsLoading(false);
      premierChargementEffectue.current = true;
    }
  }, [bail.id, showArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Catalogue chargé une seule fois (indépendant du toggle des archives
  // et des rafraîchissements après chaque sauvegarde) dès qu'un état des
  // lieux existe pour un bail meublé.
  useEffect(() => {
    if (etatDesLieux && bail.typeBail === "meuble" && catalogue.length === 0) {
      void getCatalogueInventaire().then(setCatalogue);
    }
  }, [etatDesLieux, bail.typeBail, catalogue.length]);

  async function handleCreer(): Promise<void> {
    setIsCreating(true);
    try {
      await createEtatDesLieux(bail.id);
      await refresh();
    } catch {
      setError("Impossible de créer l'état des lieux");
    } finally {
      setIsCreating(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!etatDesLieux) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Aucun état des lieux pour ce bail.</p>
        <button
          type="button"
          onClick={() => void handleCreer()}
          disabled={isCreating}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isCreating ? "Création…" : "Créer l'état des lieux"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EnTeteEtatDesLieux etatDesLieux={etatDesLieux} onSaved={refresh} />

      <div className="flex justify-end">
        <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((v) => !v)} />
      </div>

      <PieceCard
        titre="Entrée"
        elements={ELEMENTS_ENTREE}
        row={etatDesLieux.entree}
        onSave={async (payload) => {
          await submitPieceEntree(etatDesLieux.id, payload);
          await refresh();
        }}
      />
      <PieceCard
        titre="Séjour"
        elements={ELEMENTS_SEJOUR}
        row={etatDesLieux.sejour}
        onSave={async (payload) => {
          await submitPieceSejour(etatDesLieux.id, payload);
          await refresh();
        }}
      />
      <PieceCard
        titre="Cuisine"
        elements={ELEMENTS_CUISINE}
        row={etatDesLieux.cuisine}
        onSave={async (payload) => {
          await submitPieceCuisine(etatDesLieux.id, payload);
          await refresh();
        }}
      />

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Chambres</h4>
        <MultiPieceSection
          titrePrefixe="Chambre"
          elements={ELEMENTS_CHAMBRE}
          rows={etatDesLieux.chambres}
          max={3}
          onSave={async (numero, payload) => {
            await submitPieceChambre(etatDesLieux.id, { numero, ...payload });
            await refresh();
          }}
        />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Salles de bain</h4>
        <MultiPieceSection
          titrePrefixe="Salle de bain"
          elements={ELEMENTS_SALLE_DE_BAIN}
          rows={etatDesLieux.sallesDeBain}
          max={2}
          onSave={async (numero, payload) => {
            await submitPieceSalleDeBain(etatDesLieux.id, { numero, ...payload });
            await refresh();
          }}
        />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">WC</h4>
        <MultiPieceSection
          titrePrefixe="WC"
          elements={ELEMENTS_WC}
          rows={etatDesLieux.wc}
          max={2}
          onSave={async (numero, payload) => {
            await submitPieceWc(etatDesLieux.id, { numero, ...payload });
            await refresh();
          }}
        />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Autres pièces</h4>
        <MultiPieceSection
          titrePrefixe="Autre pièce"
          elements={ELEMENTS_AUTRE}
          rows={etatDesLieux.autres}
          max={2}
          avecLibelle
          onSave={async (numero, payload) => {
            await submitPieceAutre(etatDesLieux.id, { numero, ...payload });
            await refresh();
          }}
        />
      </div>

      <CompteursCard
        compteurs={etatDesLieux.compteurs}
        onSave={async (payload) => {
          await submitCompteurs(etatDesLieux.id, payload);
          await refresh();
        }}
      />

      <ClesSection
        lignes={etatDesLieux.cles}
        onSaveLigne={async (ligne) => {
          await submitCles(etatDesLieux.id, [ligne]);
          await refresh();
        }}
        onArchiver={async (id) => {
          await submitCles(etatDesLieux.id, [], [id]);
          await refresh();
        }}
      />

      <EquipementsDiversSection
        lignes={etatDesLieux.equipementsDivers}
        onSaveLigne={async (ligne) => {
          await submitEquipementsDivers(etatDesLieux.id, [ligne]);
          await refresh();
        }}
        onArchiver={async (id) => {
          await submitEquipementsDivers(etatDesLieux.id, [], [id]);
          await refresh();
        }}
      />

      {bail.typeBail === "meuble" && (
        <InventaireSection
          catalogue={catalogue}
          lignes={etatDesLieux.inventaire}
          onSaveLigne={async (ligne) => {
            await submitInventaire(etatDesLieux.id, [ligne]);
            await refresh();
          }}
          onArchiver={async (elementId) => {
            await submitInventaire(etatDesLieux.id, [], [elementId]);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function EnTeteEtatDesLieux({
  etatDesLieux,
  onSaved
}: {
  etatDesLieux: EtatDesLieuxComplet;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [showEditForm, setShowEditForm] = useState(false);
  const [dateEntree, setDateEntree] = useState(etatDesLieux.dateEntree ?? "");
  const [dateSortie, setDateSortie] = useState(etatDesLieux.dateSortie ?? "");
  const [nouvelleAdresseLocataire, setNouvelleAdresseLocataire] = useState(
    etatDesLieux.nouvelleAdresseLocataire ?? ""
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      await updateEtatDesLieuxHeader(etatDesLieux.id, {
        ...(dateEntree && { dateEntree }),
        ...(dateSortie && { dateSortie }),
        ...(nouvelleAdresseLocataire && { nouvelleAdresseLocataire })
      });
      setShowEditForm(false);
      await onSaved();
    } catch {
      setError("Impossible d'enregistrer");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">État des lieux</h3>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
            {LABEL_STATUT[etatDesLieux.statut]}
          </span>
          <button
            type="button"
            onClick={() => setShowEditForm((v) => !v)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {showEditForm ? "Annuler" : "Modifier"}
          </button>
        </div>
      </div>

      {showEditForm ? (
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label htmlFor="edl-date-entree" className="text-sm font-medium text-slate-700">
              Date d'entrée
            </label>
            <input
              id="edl-date-entree"
              type="date"
              value={dateEntree}
              onChange={(e) => setDateEntree(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="edl-date-sortie" className="text-sm font-medium text-slate-700">
              Date de sortie
            </label>
            <input
              id="edl-date-sortie"
              type="date"
              value={dateSortie}
              onChange={(e) => setDateSortie(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="edl-nouvelle-adresse" className="text-sm font-medium text-slate-700">
              Nouvelle adresse du locataire
            </label>
            <input
              id="edl-nouvelle-adresse"
              value={nouvelleAdresseLocataire}
              onChange={(e) => setNouvelleAdresseLocataire(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="col-span-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="col-span-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              {isSaving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-3 gap-x-8 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Date d'entrée</dt>
            <dd>{etatDesLieux.dateEntree ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Date de sortie</dt>
            <dd>{etatDesLieux.dateSortie ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Nouvelle adresse</dt>
            <dd>{etatDesLieux.nouvelleAdresseLocataire ?? "—"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
