import {
  avertissementDateEntreePapier,
  champsEntreeVides,
  formaterDateCourteFr,
  type ChampsVidesZone
} from "core";
import { useEffect, useState } from "react";
import { DocumentApercuModal } from "../documents/DocumentApercuModal";
import type { DocumentMetier } from "../documents/api";
import { useDocumentApercu } from "../documents/use-document-apercu";
import { ApiError } from "../lib/authenticated-fetch";
import type { Bail } from "../locataires/api";
import type { Appartement } from "../patrimoine/api";
import {
  declarerEntreePapier,
  getSignatairesAttendus,
  listerDeclarationsEntreePapier,
  type DeclarationEntreePapier,
  type EtatDesLieuxComplet,
  type SignatairesAttendus
} from "./api";
import { Modale } from "./BrouillonEtatDesLieux";
import {
  erreursSaisieEntreePapier,
  fichierEstUnPdf,
  piecesAvecPhotosEntree,
  type SaisieEntreePapier
} from "./entree-papier-formulaire";

// Date du jour à Paris (AAAA-MM-JJ), comme le backend : une date papier ne
// peut pas être dans le futur.
function aujourdHuiParis(): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

const CLASSE_BOUTON_SECONDAIRE =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const CLASSE_BOUTON_PRINCIPAL =
  "rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50";

// Reprise d'une entrée signée sur papier (2026-11-06) : déclaration tant que
// l'entrée n'est ni signée ni reprise, puis carte de la déclaration active,
// correction tant que la sortie n'est pas signée, et historique.
export function EntreePapierSection({
  etatDesLieux,
  bail,
  appartement,
  photos,
  onChange
}: {
  etatDesLieux: EtatDesLieuxComplet;
  bail: Bail;
  appartement: Appartement;
  photos: DocumentMetier[];
  onChange: () => Promise<void>;
}): React.JSX.Element | null {
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [declarations, setDeclarations] = useState<DeclarationEntreePapier[]>([]);
  const [avertissementServeur, setAvertissementServeur] = useState<string | null>(null);
  const entreePapier = etatDesLieux.entreePapier;
  const entreeNumerique = etatDesLieux.entreeSigneeParTous && entreePapier === null;

  useEffect(() => {
    if (entreePapier === null) {
      setDeclarations([]);
      return;
    }
    let annule = false;
    void listerDeclarationsEntreePapier(etatDesLieux.id).then((lignes) => {
      if (!annule) {
        setDeclarations(lignes);
      }
    });
    return () => {
      annule = true;
    };
  }, [etatDesLieux.id, entreePapier]);

  if (entreeNumerique) {
    return null;
  }

  async function apresDeclaration(avertissement: string | null): Promise<void> {
    setFormulaireOuvert(false);
    setAvertissementServeur(avertissement);
    await onChange();
  }

  if (entreePapier === null) {
    return (
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-700">Reprise d'une entrée signée sur papier</h4>
            <p className="text-xs text-slate-500">
              Si l'état des lieux d'entrée a été établi et signé sur papier, reportez ici sa date, son lieu, ses
              signataires et son scan. L'entrée ne se signera plus sur le téléphone.
            </p>
          </div>
          {!formulaireOuvert && (
            <button type="button" onClick={() => setFormulaireOuvert(true)} className={CLASSE_BOUTON_SECONDAIRE}>
              Reprendre une entrée papier
            </button>
          )}
        </div>
        {formulaireOuvert && (
          <FormulaireEntreePapier
            mode="declaration"
            etatDesLieux={etatDesLieux}
            bail={bail}
            appartement={appartement}
            photos={photos}
            initial={null}
            onAnnuler={() => setFormulaireOuvert(false)}
            onDeclare={apresDeclaration}
          />
        )}
      </div>
    );
  }

  const active = declarations.find((d) => d.archivedAt === null) ?? null;
  return (
    <EntreePapierDeclareeCard
      etatDesLieux={etatDesLieux}
      bail={bail}
      appartement={appartement}
      photos={photos}
      active={active}
      declarations={declarations}
      avertissement={avertissementServeur}
      formulaireOuvert={formulaireOuvert}
      onOuvrirCorrection={() => setFormulaireOuvert(true)}
      onFermerCorrection={() => setFormulaireOuvert(false)}
      onCorrige={apresDeclaration}
    />
  );
}

function libelleSignataires(declaration: DeclarationEntreePapier): string {
  return declaration.signataires.map((s) => (s.role === "bailleur" ? `${s.nomAffiche} (bailleur)` : s.nomAffiche)).join(", ");
}

function EntreePapierDeclareeCard({
  etatDesLieux,
  bail,
  appartement,
  photos,
  active,
  declarations,
  avertissement,
  formulaireOuvert,
  onOuvrirCorrection,
  onFermerCorrection,
  onCorrige
}: {
  etatDesLieux: EtatDesLieuxComplet;
  bail: Bail;
  appartement: Appartement;
  photos: DocumentMetier[];
  active: DeclarationEntreePapier | null;
  declarations: DeclarationEntreePapier[];
  avertissement: string | null;
  formulaireOuvert: boolean;
  onOuvrirCorrection: () => void;
  onFermerCorrection: () => void;
  onCorrige: (avertissement: string | null) => Promise<void>;
}): React.JSX.Element {
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const { apercu, erreur, ouvrir, fermer } = useDocumentApercu();
  const corrigeable = !etatDesLieux.sortieSigneeParTous;
  const anciennes = declarations.filter((d) => d.archivedAt !== null);

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-700">Entrée signée sur papier</h4>
          {active ? (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-slate-500">Date</dt>
              <dd>{formaterDateCourteFr(active.dateSignature)}</dd>
              <dt className="text-slate-500">Lieu</dt>
              <dd>{active.lieu}</dd>
              <dt className="text-slate-500">Signataires</dt>
              <dd>{libelleSignataires(active)}</dd>
            </dl>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Chargement de la déclaration…</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            L'original papier est conservé par le bailleur. Aucun PDF d'entrée n'est produit : le document de sortie
            porte la mention de cette déclaration et le scan sera joint à l'envoi de la sortie.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {active && (
            <button type="button" onClick={() => void ouvrir(active.documentId)} className={CLASSE_BOUTON_SECONDAIRE}>
              Ouvrir le scan
            </button>
          )}
          {corrigeable && !formulaireOuvert && active && (
            <button type="button" onClick={onOuvrirCorrection} className={CLASSE_BOUTON_SECONDAIRE}>
              Corriger la déclaration
            </button>
          )}
        </div>
      </div>
      {!corrigeable && (
        <p className="mt-2 text-xs text-slate-500">La sortie est signée : la déclaration ne se corrige plus.</p>
      )}
      {avertissement && (
        <p role="status" className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {avertissement}
        </p>
      )}
      {erreur && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {erreur}
        </p>
      )}
      {formulaireOuvert && active && (
        <FormulaireEntreePapier
          mode="correction"
          etatDesLieux={etatDesLieux}
          bail={bail}
          appartement={appartement}
          photos={photos}
          initial={active}
          onAnnuler={onFermerCorrection}
          onDeclare={onCorrige}
        />
      )}
      {anciennes.length > 0 && (
        <div className="mt-3 border-t border-emerald-100 pt-2">
          <button
            type="button"
            onClick={() => setHistoriqueOuvert((v) => !v)}
            className="text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            {historiqueOuvert ? "Masquer" : "Afficher"} l'historique des déclarations ({declarations.length})
          </button>
          {historiqueOuvert && (
            <ul className="mt-2 space-y-1">
              {declarations.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    <span className="font-medium text-slate-700">
                      {d.archivedAt === null ? "Active" : "Remplacée"}
                    </span>{" "}
                    — déclarée le {new Date(d.declareeLe).toLocaleDateString("fr-FR")} : papier du{" "}
                    {formaterDateCourteFr(d.dateSignature)} à {d.lieu}, {libelleSignataires(d)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void ouvrir(d.documentId)}
                    className="shrink-0 text-indigo-700 hover:text-indigo-900"
                  >
                    Scan
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {apercu && <DocumentApercuModal apercu={apercu} onClose={fermer} />}
    </div>
  );
}

function FormulaireEntreePapier({
  mode,
  etatDesLieux,
  bail,
  appartement,
  photos,
  initial,
  onAnnuler,
  onDeclare
}: {
  mode: "declaration" | "correction";
  etatDesLieux: EtatDesLieuxComplet;
  bail: Bail;
  appartement: Appartement;
  photos: DocumentMetier[];
  initial: DeclarationEntreePapier | null;
  onAnnuler: () => void;
  onDeclare: (avertissement: string | null) => Promise<void>;
}): React.JSX.Element {
  const [attendus, setAttendus] = useState<SignatairesAttendus | null>(null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [dateSignature, setDateSignature] = useState(initial?.dateSignature ?? "");
  const [lieu, setLieu] = useState(initial?.lieu ?? "");
  const [bailleurNom, setBailleurNom] = useState(
    initial?.signataires.find((s) => s.role === "bailleur")?.nomAffiche ?? ""
  );
  const [locataireIds, setLocataireIds] = useState<string[]>(
    initial?.signataires.flatMap((s) => (s.locataireId ? [s.locataireId] : [])) ?? []
  );
  const [scan, setScan] = useState<File | null>(null);
  const [scanInvalide, setScanInvalide] = useState(false);
  const [fidelite, setFidelite] = useState(false);
  const [tentative, setTentative] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  useEffect(() => {
    let annule = false;
    getSignatairesAttendus(etatDesLieux.id)
      .then((donnees) => {
        if (annule) {
          return;
        }
        setAttendus(donnees);
        // Première déclaration : bailleur et lieu pré-remplis, comme sur
        // l'écran de signature ; une correction garde la déclaration active.
        if (!initial) {
          setBailleurNom((v) => v || donnees.bailleurNomPropose);
          setLieu((v) => v || donnees.villeLogement);
        }
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreurChargement(err instanceof ApiError ? err.message : "Impossible de charger les locataires du bail.");
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieux.id, initial]);

  const saisie: SaisieEntreePapier = {
    dateSignature,
    lieu,
    bailleurNom,
    locataireIds,
    scan: scan ? { nom: scan.name, taille: scan.size } : null,
    fideliteConfirmee: fidelite
  };
  const erreurs = [
    ...erreursSaisieEntreePapier(saisie, mode, aujourdHuiParis()),
    ...(scanInvalide ? ["Le fichier choisi n'est pas un PDF."] : [])
  ];

  async function choisirScan(fichier: File | null): Promise<void> {
    setScan(fichier);
    setScanInvalide(fichier ? !(await fichierEstUnPdf(fichier)) : false);
  }

  function basculerLocataire(id: string): void {
    setLocataireIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  const idPrefixe = `entree-papier-${mode}`;
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {mode === "correction" && (
        <p className="text-xs text-slate-600">
          La correction remplace la déclaration active ; l'ancienne reste dans l'historique avec son scan. Sans nouveau
          scan, le scan actuel est conservé.
        </p>
      )}
      {erreurChargement && (
        <p role="alert" className="text-sm text-red-600">
          {erreurChargement}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Date portée sur le papier</span>
          <input
            id={`${idPrefixe}-date`}
            type="date"
            value={dateSignature}
            max={aujourdHuiParis()}
            onChange={(e) => setDateSignature(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Lieu</span>
          <input
            value={lieu}
            onChange={(e) => setLieu(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">Signataires du papier</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked disabled aria-label="Bailleur, toujours signataire" />
          <input
            aria-label="Nom du bailleur"
            value={bailleurNom}
            onChange={(e) => setBailleurNom(e.target.value)}
            className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-500">(bailleur, toujours signataire)</span>
        </label>
        {attendus?.locataires.map((l) => (
          <label key={l.locataireId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={locataireIds.includes(l.locataireId)} onChange={() => basculerLocataire(l.locataireId)} />
            {l.nomAffiche}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">
          Scan PDF de l'état des lieux signé {mode === "correction" ? "(facultatif : remplace le scan actuel)" : ""}
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Scan PDF"
          onChange={(e) => void choisirScan(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={fidelite} onChange={(e) => setFidelite(e.target.checked)} className="mt-0.5" />
        <span>Les états saisis reproduisent fidèlement l'original signé par toutes les parties.</span>
      </label>
      {tentative && erreurs.length > 0 && (
        <ul role="alert" className="list-inside list-disc text-sm text-red-600">
          {erreurs.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => {
            setTentative(true);
            if (erreurs.length === 0) {
              setConfirmation(true);
            }
          }}
          className={CLASSE_BOUTON_PRINCIPAL}
        >
          {mode === "correction" ? "Vérifier la correction" : "Vérifier la déclaration"}
        </button>
      </div>
      {confirmation && (
        <ConfirmationEntreePapierModal
          mode={mode}
          etatDesLieux={etatDesLieux}
          bail={bail}
          appartement={appartement}
          photos={photos}
          saisie={saisie}
          scan={scan}
          nomsLocataires={(attendus?.locataires ?? []).filter((l) => locataireIds.includes(l.locataireId)).map((l) => l.nomAffiche)}
          onAnnuler={() => setConfirmation(false)}
          onDeclare={onDeclare}
        />
      )}
    </div>
  );
}

function ConfirmationEntreePapierModal({
  mode,
  etatDesLieux,
  bail,
  appartement,
  photos,
  saisie,
  scan,
  nomsLocataires,
  onAnnuler,
  onDeclare
}: {
  mode: "declaration" | "correction";
  etatDesLieux: EtatDesLieuxComplet;
  bail: Bail;
  appartement: Appartement;
  photos: DocumentMetier[];
  saisie: SaisieEntreePapier;
  scan: File | null;
  nomsLocataires: string[];
  onAnnuler: () => void;
  onDeclare: (avertissement: string | null) => Promise<void>;
}): React.JSX.Element {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Refus bloquant : photos d'entrée encore actives (le backend refuse aussi).
  const piecesPhotos = mode === "declaration" ? piecesAvecPhotosEntree(photos) : [];
  // Avertissements non bloquants.
  const avertissementDate = avertissementDateEntreePapier(saisie.dateSignature, bail.dateDebut);
  const champsVides: ChampsVidesZone[] =
    mode === "declaration"
      ? champsEntreeVides({
          composition: {
            nombreChambres: appartement.nombreChambres,
            nombreSallesDeBain: appartement.nombreSallesDeBain,
            nombreWc: appartement.nombreWc,
            autresPieces: [appartement.autrePiece1, appartement.autrePiece2].filter((p): p is string => Boolean(p))
          },
          entree: etatDesLieux.entree,
          sejour: etatDesLieux.sejour,
          cuisine: etatDesLieux.cuisine,
          chambres: etatDesLieux.chambres,
          sallesDeBain: etatDesLieux.sallesDeBain,
          wc: etatDesLieux.wc,
          autres: etatDesLieux.autres,
          cles: etatDesLieux.cles,
          equipementsDivers: etatDesLieux.equipementsDivers,
          inventaire: etatDesLieux.inventaire
        })
      : [];

  async function confirmer(): Promise<void> {
    setErreur(null);
    setEnCours(true);
    try {
      const { avertissement } = await declarerEntreePapier(etatDesLieux.id, {
        dateSignature: saisie.dateSignature,
        lieu: saisie.lieu.trim(),
        bailleurNom: saisie.bailleurNom.trim(),
        locataireIds: saisie.locataireIds,
        scan
      });
      await onDeclare(avertissement);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : "La déclaration a échoué.");
      setEnCours(false);
    }
  }

  const titre = mode === "correction" ? "Corriger l'entrée signée sur papier ?" : "Déclarer l'entrée signée sur papier ?";
  return (
    <Modale titre={titre}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Date</dt>
        <dd>{formaterDateCourteFr(saisie.dateSignature)}</dd>
        <dt className="text-slate-500">Lieu</dt>
        <dd>{saisie.lieu.trim()}</dd>
        <dt className="text-slate-500">Signataires</dt>
        <dd>{[`${saisie.bailleurNom.trim()} (bailleur)`, ...nomsLocataires].join(", ")}</dd>
        <dt className="text-slate-500">Scan</dt>
        <dd>{scan ? scan.name : "Scan actuel conservé"}</dd>
      </dl>
      {piecesPhotos.length > 0 && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-700">
          Déclaration impossible : des photos d'entrée prises dans l'application ne sont pas archivées (
          {piecesPhotos.join(", ")}). Archivez-les d'abord, elles ne correspondent pas au papier.
        </p>
      )}
      {avertissementDate && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm text-amber-800">
          {avertissementDate}
        </p>
      )}
      {champsVides.length > 0 && (
        <div role="status" className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm text-amber-800">
          <p className="font-medium">Champs d'entrée encore vides (la déclaration reste possible) :</p>
          <ul className="list-inside list-disc text-xs">
            {champsVides.map((z) => (
              <li key={z.zone}>
                {z.zone} : {z.manquants.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-600">
        {mode === "correction"
          ? "La déclaration active sera archivée et remplacée."
          : "L'entrée sera figée comme après une signature, et ne pourra plus être signée sur le téléphone."}
      </p>
      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} disabled={enCours} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void confirmer()}
          disabled={enCours || piecesPhotos.length > 0}
          className={CLASSE_BOUTON_PRINCIPAL}
        >
          {enCours ? "Enregistrement…" : mode === "correction" ? "Confirmer la correction" : "Confirmer la déclaration"}
        </button>
      </div>
    </Modale>
  );
}
