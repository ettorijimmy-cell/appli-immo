import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chargerContexteBail, creerCachesContexteBail } from "../finances/contexte-bail";
import { chargerBauxRecherchables, chargerEntitesRecherchables, type BailRecherchable } from "./api";
import { filtrerActions, type ActionCommande, type ActionContextuelle } from "./registre-actions";
import { filtrerEntites, filtrerParTexte, LIBELLES_TYPE, type EntiteRecherchable } from "./recherche";

type Etape = { type: "recherche" } | { type: "recherche-cible"; action: ActionContextuelle };

// Palette de commandes globale (Ctrl+K) — Module 8, docs/backlog.md. Montée
// une seule fois dans AppLayout, indépendante de l'écran affiché. Deux
// modes : recherche normale (actions + entités mélangées), et recherche
// ciblée en étape 2 pour les actions contextuelles ("Nouveau bail" cherche
// un appartement, "Nouveau paiement" cherche un bail) — voir
// docs/data-dictionary.md, section Palette de commandes, pour le contrat
// des query params consommés par PatrimoinePage/LocatairesPage/FinancesPage.
export function CommandPalette(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [requete, setRequete] = useState("");
  const [etape, setEtape] = useState<Etape>({ type: "recherche" });
  const [entites, setEntites] = useState<EntiteRecherchable[]>([]);
  const [bauxRecherchables, setBauxRecherchables] = useState<BailRecherchable[] | null>(null);
  const [indexSelectionne, setIndexSelectionne] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setRequete("");
      setEtape({ type: "recherche" });
      setBauxRecherchables(null);
      return;
    }
    void chargerEntitesRecherchables().then(setEntites);
    const focusTimeout = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(focusTimeout);
  }, [open]);

  useEffect(() => {
    if (etape.type === "recherche-cible" && etape.action.cibleRecherche === "bail" && bauxRecherchables === null) {
      const caches = creerCachesContexteBail();
      void chargerBauxRecherchables((bailId) => chargerContexteBail(bailId, caches)).then(setBauxRecherchables);
    }
  }, [etape, bauxRecherchables]);

  useEffect(() => {
    setIndexSelectionne(0);
  }, [requete, etape]);

  if (!open) {
    return <></>;
  }

  function fermer(): void {
    setOpen(false);
  }

  function allerVersEntite(entite: EntiteRecherchable): void {
    if (entite.type === "sci") {
      navigate(`/patrimoine?sciId=${entite.id}`);
    } else if (entite.type === "immeuble") {
      navigate(`/patrimoine?immeubleId=${entite.id}`);
    } else if (entite.type === "appartement") {
      navigate(`/patrimoine?appartementId=${entite.id}`);
    } else {
      navigate(`/locataires?locataireId=${entite.id}`);
    }
    fermer();
  }

  function activerAction(action: ActionCommande): void {
    if (action.categorie === "navigation") {
      navigate(action.chemin);
      fermer();
      return;
    }
    setRequete("");
    setEtape({ type: "recherche-cible", action });
  }

  function choisirAppartementCible(entite: EntiteRecherchable): void {
    navigate(`/patrimoine?appartementId=${entite.id}&nouveauBail=1`);
    fermer();
  }

  function choisirBailCible(bail: BailRecherchable): void {
    navigate(`/finances?bailId=${bail.bail.id}`);
    fermer();
  }

  const resultatsActions = etape.type === "recherche" ? filtrerActions(requete) : [];
  const resultatsEntites = etape.type === "recherche" ? filtrerEntites(entites, requete) : [];
  const resultatsAppartementsCible =
    etape.type === "recherche-cible" && etape.action.cibleRecherche === "appartement"
      ? filtrerEntites(
          entites.filter((entite) => entite.type === "appartement"),
          requete
        )
      : [];
  const resultatsBauxCible =
    etape.type === "recherche-cible" && etape.action.cibleRecherche === "bail"
      ? filtrerParTexte(bauxRecherchables ?? [], requete)
      : [];

  type LigneResultat =
    | { sorte: "action"; action: ActionCommande }
    | { sorte: "entite"; entite: EntiteRecherchable }
    | { sorte: "appartement-cible"; entite: EntiteRecherchable }
    | { sorte: "bail-cible"; bail: BailRecherchable };

  const lignes: LigneResultat[] =
    etape.type === "recherche"
      ? [
          ...resultatsActions.map((action): LigneResultat => ({ sorte: "action", action })),
          ...resultatsEntites.map((entite): LigneResultat => ({ sorte: "entite", entite }))
        ]
      : etape.action.cibleRecherche === "appartement"
        ? resultatsAppartementsCible.map((entite): LigneResultat => ({ sorte: "appartement-cible", entite }))
        : resultatsBauxCible.map((bail): LigneResultat => ({ sorte: "bail-cible", bail }));

  function activerLigne(ligne: LigneResultat): void {
    if (ligne.sorte === "action") {
      activerAction(ligne.action);
    } else if (ligne.sorte === "entite") {
      allerVersEntite(ligne.entite);
    } else if (ligne.sorte === "appartement-cible") {
      choisirAppartementCible(ligne.entite);
    } else {
      choisirBailCible(ligne.bail);
    }
  }

  function onKeyDownInput(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (etape.type === "recherche-cible") {
        setEtape({ type: "recherche" });
        setRequete("");
      } else {
        fermer();
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndexSelectionne((value) => Math.min(value + 1, Math.max(lignes.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndexSelectionne((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const ligne = lignes[indexSelectionne];
      if (ligne) {
        activerLigne(ligne);
      }
    }
  }

  function libelleLigne(ligne: LigneResultat): { texte: string; detail: string } {
    if (ligne.sorte === "action") {
      return { texte: ligne.action.libelle, detail: ligne.action.categorie === "navigation" ? "Navigation" : "Action" };
    }
    if (ligne.sorte === "entite") {
      return { texte: ligne.entite.libelle, detail: LIBELLES_TYPE[ligne.entite.type] };
    }
    if (ligne.sorte === "appartement-cible") {
      return { texte: ligne.entite.libelle, detail: "Appartement" };
    }
    return { texte: ligne.bail.libelle, detail: "Bail" };
  }

  return (
    <div
      role="presentation"
      onClick={fermer}
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-32"
    >
      <div
        role="dialog"
        aria-label="Palette de commandes"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        {etape.type === "recherche-cible" && (
          <div className="border-b border-slate-100 px-4 pt-3 text-xs font-medium text-slate-500">
            {etape.action.libelle} — choisir {etape.action.cibleRecherche === "appartement" ? "un appartement" : "un bail"}
          </div>
        )}
        <input
          ref={inputRef}
          value={requete}
          onChange={(event) => setRequete(event.target.value)}
          onKeyDown={onKeyDownInput}
          placeholder={
            etape.type === "recherche"
              ? "Rechercher une SCI, un immeuble, un appartement, un locataire, une action…"
              : "Rechercher…"
          }
          aria-label="Rechercher"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {lignes.length === 0 && requete.trim() !== "" && (
            <li className="px-4 py-3 text-sm text-slate-400">Aucun résultat.</li>
          )}
          {lignes.map((ligne, index) => {
            const { texte, detail } = libelleLigne(ligne);
            const cle =
              ligne.sorte === "action"
                ? `action-${ligne.action.id}`
                : ligne.sorte === "bail-cible"
                  ? `bail-${ligne.bail.bail.id}`
                  : `entite-${ligne.entite.id}`;
            return (
              <li key={cle}>
                <button
                  type="button"
                  onClick={() => activerLigne(ligne)}
                  onMouseEnter={() => setIndexSelectionne(index)}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                    index === indexSelectionne ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
                  }`}
                >
                  <span>{texte}</span>
                  <span className="text-xs text-slate-400">{detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
