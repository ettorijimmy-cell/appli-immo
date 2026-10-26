import { champModifiable, type ClassificationChamp } from "core";
import { useEffect, useState } from "react";
import type { DocumentMetier } from "../documents/api";
import { ApiError, authenticatedFetchBlob } from "../lib/authenticated-fetch";
import type { EtatElement, PieceRow } from "./api";
import type { ElementDef } from "./pieces-config";

const ETATS: EtatElement[] = ["M", "P", "B", "TB"];

function EtatSelect({
  value,
  onChange,
  disabled = false
}: {
  value: string;
  onChange: (valeur: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded border border-slate-300 px-1 py-0.5 text-sm disabled:bg-slate-50 disabled:text-slate-500"
    >
      <option value="">—</option>
      {ETATS.map((etat) => (
        <option key={etat} value={etat}>
          {etat}
        </option>
      ))}
    </select>
  );
}

interface ChampsElement {
  description: string;
  etatEntree: string;
  etatSortie: string;
  nombre: string;
}

function construireValeursInitiales(elements: ElementDef[], row: PieceRow | null): Record<string, ChampsElement> {
  const valeurs: Record<string, ChampsElement> = {};
  for (const el of elements) {
    valeurs[el.prefix] = {
      description: (row?.[`${el.prefix}Description`] as string | null | undefined) ?? "",
      etatEntree: (row?.[`${el.prefix}EtatEntree`] as string | null | undefined) ?? "",
      etatSortie: (row?.[`${el.prefix}EtatSortie`] as string | null | undefined) ?? "",
      nombre: el.avecNombre ? String(row?.[`${el.prefix}Nombre`] ?? "") : ""
    };
  }
  return valeurs;
}

// Première image inline de l'app (aucun mécanisme de vignette n'existait
// avant — le reste du module Documents utilise désormais le même principe
// via useDocumentApercu/DocumentApercuModal, voir documents/DocumentsForEntite.tsx).
// L'endpoint
// /documents/:id/contenu exige un header Authorization, donc pas de
// <img src="..."> direct : on récupère le blob déchiffré via le même
// mécanisme authentifié que le reste du module (authenticatedFetchBlob),
// jamais d'URL publique (CLAUDE.md) — l'URL objet obtenue ne quitte jamais
// cette fenêtre (pas de nouvel onglet, qui rendrait le partage du blob
// incertain entre contextes) et est révoquée au démontage.
function PhotoThumbnail({
  photo,
  onOuvrir
}: {
  photo: DocumentMetier;
  onOuvrir: (url: string, nomFichier: string) => void;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let urlCourante: string | null = null;
    let annule = false;
    authenticatedFetchBlob(`/documents/${photo.id}/contenu`)
      .then(({ blob }) => {
        if (annule) {
          return;
        }
        urlCourante = URL.createObjectURL(blob);
        setUrl(urlCourante);
      })
      .catch(() => setErreur(true));
    return () => {
      annule = true;
      if (urlCourante) {
        URL.revokeObjectURL(urlCourante);
      }
    };
  }, [photo.id]);

  if (erreur) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded border border-slate-200 text-xs text-slate-400">
        Erreur
      </div>
    );
  }

  if (!url) {
    return <div className="h-16 w-16 animate-pulse rounded border border-slate-200 bg-slate-100" />;
  }

  return (
    <button
      type="button"
      onClick={() => onOuvrir(url, photo.nomFichier)}
      className="h-16 w-16 overflow-hidden rounded border border-slate-200 hover:ring-2 hover:ring-indigo-400"
    >
      <img src={url} alt={photo.nomFichier} className="h-full w-full object-cover" />
    </button>
  );
}

// Photos prises depuis le parcours mobile pour cette pièce précise (voir
// documentEtatDesLieuxPieceTypeEnum) — vignettes cliquables, agrandies
// dans une modale plein écran (pas de téléchargement forcé).
function PhotosPiece({ photos }: { photos: DocumentMetier[] }): React.JSX.Element | null {
  const [agrandie, setAgrandie] = useState<{ url: string; nomFichier: string } | null>(null);

  if (photos.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2">
        {photos.map((photo) => (
          <PhotoThumbnail
            key={photo.id}
            photo={photo}
            onOuvrir={(url, nomFichier) => setAgrandie({ url, nomFichier })}
          />
        ))}
      </div>

      {agrandie && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setAgrandie(null)}
        >
          <img
            src={agrandie.url}
            alt={agrandie.nomFichier}
            className="max-h-full max-w-full rounded shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setAgrandie(null)}
            className="absolute right-6 top-6 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Fermer
          </button>
        </div>
      )}
    </>
  );
}

// Tableau dense (Élément / Description / État entrée / État sortie) pour
// une pièce — pilote son rendu depuis `elements` (voir pieces-config.ts)
// plutôt que dupliquer un composant par pièce. Sauvegarde explicite (pas
// d'auto-save au blur, même convention que le reste de l'app — ex.
// EditBailForm) : les valeurs affichées reflètent toujours l'état
// réellement enregistré tant qu'on n'a pas cliqué "Enregistrer".
export function PieceCard({
  titre,
  elements,
  classification,
  row,
  photos = [],
  entreeSignee,
  sortieSignee,
  onSave
}: {
  titre: string;
  elements: ElementDef[];
  classification: Record<string, ClassificationChamp>;
  row: PieceRow | null;
  photos?: DocumentMetier[];
  entreeSignee: boolean;
  sortieSignee: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [valeurs, setValeurs] = useState(() => construireValeursInitiales(elements, row));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValeurs(construireValeursInitiales(elements, row));
  }, [row, elements]);

  function setChamp(prefix: string, champ: keyof ChampsElement, valeur: string): void {
    setValeurs((v) => ({ ...v, [prefix]: { ...(v[prefix] as ChampsElement), [champ]: valeur } }));
  }

  // Une pièce qui n'existe pas encore (row === null) reste créable même
  // après la signature d'entrée, exactement comme une ligne neuve de
  // clés/équipements divers (revue 2026-10-26, confirmé par le test
  // backend "submitPieceEntree : autorise un champ 'sortie'") : elle
  // décrit un élément absent/omis à l'entrée, découvert avant la sortie.
  // Pas d'exception d'identité à passer ici (contrairement aux clés) —
  // les pièces n'ont pas de champ d'identité dans `champs` (numero est une
  // colonne structurelle), donc tout champ "entree"/"commune" reste figé
  // par champModifiable (ligneExistante=false, aucun champsIdentite),
  // seuls les champs "sortie" restent éditables. Ne JAMAIS bloquer ce cas
  // par avance ici : ce serait dupliquer (et désynchroniser) la règle déjà
  // portée par champModifiable/verifierChampsAutorises.
  function champEditable(nomChamp: string): boolean {
    return champModifiable({ nomChamp, classification, ligneExistante: row !== null, entreeSignee, sortieSignee });
  }

  // Bug remonté en test manuel (revue 2026-10-26) : envoyer `description`
  // systématiquement (même vide) faisait échouer à tort toute soumission
  // de sortie sur une pièce dont la description d'entrée est NULL en
  // base — "" (valeur par défaut du champ contrôlé) != null pour
  // valeursEquivalentes, donc vu comme une tentative de modification d'un
  // champ figé. Seuls les champs réellement éditables (selon le même
  // verrou que l'affichage, champEditable ci-dessus) sont maintenant
  // inclus dans le payload — un champ figé n'est plus jamais envoyé, quel
  // que soit son contenu.
  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const el of elements) {
        const champs = valeurs[el.prefix];
        if (!champs) {
          continue;
        }
        const elementPayload: Record<string, unknown> = {};
        if (champEditable(`${el.prefix}Description`)) {
          elementPayload.description = champs.description;
        }
        if (champs.etatEntree && champEditable(`${el.prefix}EtatEntree`)) {
          elementPayload.etatEntree = champs.etatEntree;
        }
        if (champs.etatSortie && champEditable(`${el.prefix}EtatSortie`)) {
          elementPayload.etatSortie = champs.etatSortie;
        }
        if (el.avecNombre && champs.nombre !== "" && champEditable(`${el.prefix}Nombre`)) {
          elementPayload.nombre = Number(champs.nombre);
        }
        if (Object.keys(elementPayload).length > 0) {
          payload[el.prefix] = elementPayload;
        }
      }
      await onSave(payload);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cette pièce");
    } finally {
      setIsSaving(false);
    }
  }

  // Rien n'est jamais éditable une fois la sortie signée (document
  // définitivement clos) — désactiver "Enregistrer" dans ce seul cas.
  // Une pièce jamais créée après l'entrée signée n'est PAS dans ce cas :
  // ses champs "sortie" restent éditables (voir champEditable ci-dessus),
  // il ne faut donc pas désactiver le bouton pour elle.
  const toutFige = sortieSignee;

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-700">{titre}</h4>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || toutFige}
          className="shrink-0 rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <PhotosPiece photos={photos} />

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 pr-2 font-medium">Élément</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 font-medium">État entrée</th>
            <th className="py-1 font-medium">État sortie</th>
          </tr>
        </thead>
        <tbody>
          {elements.map((el) => {
            const descriptionEditable = champEditable(`${el.prefix}Description`);
            const etatEntreeEditable = champEditable(`${el.prefix}EtatEntree`);
            const etatSortieEditable = champEditable(`${el.prefix}EtatSortie`);
            const nombreEditable = el.avecNombre ? champEditable(`${el.prefix}Nombre`) : false;

            return (
              <tr key={el.prefix} className="border-b border-slate-100">
                <td className="py-1 pr-2 align-top">
                  {el.label}
                  {el.avecNombre && (
                    <input
                      value={valeurs[el.prefix]?.nombre ?? ""}
                      onChange={(e) => setChamp(el.prefix, "nombre", e.target.value)}
                      placeholder="Nb"
                      readOnly={!nombreEditable}
                      className={`ml-2 w-12 rounded border px-1 py-0.5 text-xs ${
                        nombreEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    />
                  )}
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={valeurs[el.prefix]?.description ?? ""}
                    onChange={(e) => setChamp(el.prefix, "description", e.target.value)}
                    readOnly={!descriptionEditable}
                    className={`w-full rounded border px-2 py-1 text-sm ${
                      descriptionEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  />
                </td>
                <td className="py-1 pr-2">
                  <EtatSelect
                    value={valeurs[el.prefix]?.etatEntree ?? ""}
                    onChange={(v) => setChamp(el.prefix, "etatEntree", v)}
                    disabled={!etatEntreeEditable}
                  />
                </td>
                <td className="py-1">
                  <EtatSelect
                    value={valeurs[el.prefix]?.etatSortie ?? ""}
                    onChange={(v) => setChamp(el.prefix, "etatSortie", v)}
                    disabled={!etatSortieEditable}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Pièces à occurrences multiples (chambres, salles de bain, wc, autres
// pièces) : une PieceCard par instance existante + un bouton d'ajout tant
// que le maximum réel du logement (appartement.nombreChambres/
// nombreSallesDeBain/nombreWc) n'est pas atteint — jamais le maximum du
// modèle décret codé en dur, qui autoriserait des instances fantômes au-
// delà de la composition réelle (voir EtatDesLieuxSection). Les "autres
// pièces" ont des libellés fixes définis sur l'appartement, pas de saisie
// libre à la volée : voir AutresPiecesSection dédiée.
export function MultiPieceSection({
  titrePrefixe,
  elements,
  classification,
  rows,
  max,
  photosParNumero,
  entreeSignee,
  sortieSignee,
  onSave
}: {
  titrePrefixe: string;
  elements: ElementDef[];
  classification: Record<string, ClassificationChamp>;
  rows: PieceRow[];
  max: number;
  photosParNumero?: Map<number, DocumentMetier[]>;
  entreeSignee: boolean;
  sortieSignee: boolean;
  onSave: (numero: number, payload: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const numerosExistants = rows.map((r) => r.numero ?? 0);
  const prochainNumero = numerosExistants.length > 0 ? Math.max(...numerosExistants) + 1 : 1;
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [erreurAjout, setErreurAjout] = useState<string | null>(null);

  async function handleAjouter(): Promise<void> {
    setErreurAjout(null);
    setAjoutEnCours(true);
    try {
      await onSave(prochainNumero, {});
    } catch (err) {
      setErreurAjout(err instanceof ApiError ? err.message : "Impossible d'ajouter cette pièce");
    } finally {
      setAjoutEnCours(false);
    }
  }

  return (
    <div className="space-y-3">
      {rows
        .slice()
        .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
        .map((row) => (
          <PieceCard
            key={row.id}
            titre={`${titrePrefixe} ${row.numero}`}
            elements={elements}
            classification={classification}
            row={row}
            photos={photosParNumero?.get(row.numero ?? 0) ?? []}
            entreeSignee={entreeSignee}
            sortieSignee={sortieSignee}
            onSave={(payload) => onSave(row.numero ?? 0, payload)}
          />
        ))}
      {erreurAjout && (
        <p role="alert" className="text-xs text-red-600">
          {erreurAjout}
        </p>
      )}
      {/* Une nouvelle pièce découverte seulement à la sortie reste
          autorisée entre les deux signatures (ses champs "sortie" seuls
          restent ensuite éditables, comme une ligne neuve de clés/
          équipements divers) — plus aucune création possible une fois la
          sortie signée, document définitivement clos. */}
      {numerosExistants.length < max && !sortieSignee && (
        <button
          type="button"
          onClick={() => void handleAjouter()}
          disabled={ajoutEnCours}
          className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {ajoutEnCours ? "Ajout…" : `+ Ajouter ${titrePrefixe.toLowerCase()} ${prochainNumero}`}
        </button>
      )}
    </div>
  );
}
