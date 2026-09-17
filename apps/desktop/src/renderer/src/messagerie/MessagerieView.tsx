import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CONTACT_ROLE_LABELS, listContactsUnifies, type ContactUnifie } from "../contacts/api";
import { DocumentApercuModal } from "../documents/DocumentApercuModal";
import { CATEGORIE_LABELS } from "../documents/labels";
import type { DocumentCategorie, DocumentEntiteType } from "../documents/api";
import { ApiError } from "../lib/authenticated-fetch";
import {
  classerPieceJointeDansDocuments,
  composerMessage,
  getMessage,
  listMessages,
  type ClassificationTypeChoisie,
  type MessageClassificationType,
  type MessageCommunication,
  type MessageCommunicationDetail,
  type PieceJointeMessage
} from "./api";
import { useMessagerieApercu } from "./use-messagerie-apercu";

const CLASSIFICATION_LABELS: Record<MessageClassificationType, string> = {
  contact: "Contact",
  locataire: "Locataire",
  candidat: "Candidat",
  garant: "Garant",
  non_classe: "Non classé"
};

// "Classer dans Documents" n'est proposé que pour locataire/garant/candidat :
// ce sont les seuls types de classification qui correspondent à une vraie
// valeur de documentEntiteType existante (contact ne peut être rattaché à
// aucun document aujourd'hui — voir packages/db/src/schema/documents.ts,
// aucune régression introduite ici). "garant" ajouté en même temps que le
// sélecteur de destinataire (2026-09-16) : documentEntiteType le supportait
// déjà, seule la classification de message ne le permettait pas.
const CLASSIFICATIONS_CLASSABLES: MessageClassificationType[] = ["locataire", "garant", "candidat"];

// Mappe le type du Carnet de contacts (qui distingue chaque rôle de contact
// professionnel : artisan/diagnostiqueur/syndic/assureur/autre) vers le type
// de classification d'un message (plus grossier : tout contact pro devient
// "contact") — sélecteur de destinataire, 2026-09-16.
function resoudreClassificationDepuisCarnet(type: ContactUnifie["type"]): ClassificationTypeChoisie {
  if (type === "locataire" || type === "garant" || type === "candidat") {
    return type;
  }
  return "contact";
}

function libelleTypeCarnet(type: ContactUnifie["type"]): string {
  if (type === "locataire") return "Locataire";
  if (type === "garant") return "Garant";
  if (type === "candidat") return "Candidat";
  return CONTACT_ROLE_LABELS[type];
}

// Résout le nom + rôle affichable d'un fil classé à partir du carnet déjà
// chargé pour le sélecteur de destinataire (2026-09-16) — évite un appel
// réseau dédié. "contact" est générique côté classification (tout rôle pro
// confondu), donc recherché par id seul plutôt que par (type, id) comme
// pour locataire/garant/candidat. Retourne null si le fil n'est pas classé
// ou si l'entité n'est plus dans le carnet (ex. archivée depuis) — la vue
// retombe alors sur l'affichage de l'adresse email brute, comportement
// préexistant.
function resoudreCorrespondantAffichage(
  fil: Fil,
  contactsCarnet: ContactUnifie[]
): { nom: string; role: string } | null {
  if (fil.classificationType === "non_classe" || fil.classificationId === null) {
    return null;
  }
  const contactTrouve =
    fil.classificationType === "contact"
      ? contactsCarnet.find((c) => c.id === fil.classificationId)
      : contactsCarnet.find((c) => c.type === fil.classificationType && c.id === fil.classificationId);
  if (!contactTrouve) {
    return null;
  }
  return { nom: contactTrouve.nom, role: libelleTypeCarnet(contactTrouve.type) };
}

interface Fil {
  cle: string;
  correspondant: string;
  classificationType: MessageClassificationType;
  classificationId: string | null;
  messages: MessageCommunication[];
  derniereDateMessage: string;
}

function resoudreCorrespondant(message: MessageCommunication): string {
  return message.direction === "recu" ? message.emailExpediteur : message.emailDestinataire;
}

function construireFils(messages: MessageCommunication[]): Fil[] {
  const fils = new Map<string, Fil>();
  for (const message of messages) {
    const cle =
      message.classificationType !== "non_classe"
        ? `${message.classificationType}:${message.classificationId}`
        : `email:${resoudreCorrespondant(message)}`;
    const existant = fils.get(cle);
    if (existant) {
      existant.messages.push(message);
      if (message.dateMessage > existant.derniereDateMessage) {
        existant.derniereDateMessage = message.dateMessage;
      }
    } else {
      fils.set(cle, {
        cle,
        correspondant: resoudreCorrespondant(message),
        classificationType: message.classificationType,
        classificationId: message.classificationId,
        messages: [message],
        derniereDateMessage: message.dateMessage
      });
    }
  }
  return [...fils.values()].sort((a, b) => b.derniereDateMessage.localeCompare(a.derniereDateMessage));
}

// Module Messagerie (2026-09-16) : niveau "boîte mail dédiée avec lecture +
// envoi", délibérément moins ambitieux qu'un portail externe (voir
// docs/backlog.md) — outil interne consulté uniquement par Jimmy. Fils
// groupés par (classificationType, classificationId), ou par adresse email
// du correspondant pour les messages non classés — aucune résolution de
// nom d'affichage depuis locataires/contacts/candidats à cette itération
// (l'adresse email suffit à identifier le correspondant).
export function MessagerieView(): React.JSX.Element {
  const [messages, setMessages] = useState<MessageCommunication[]>([]);
  const [filSelectionne, setFilSelectionne] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsParMessage, setDetailsParMessage] = useState<Map<string, MessageCommunicationDetail>>(new Map());
  const { apercu, ouvrir: ouvrirApercu, fermer: fermerApercu } = useMessagerieApercu();

  const [destinataire, setDestinataire] = useState("");
  const [objet, setObjet] = useState("");
  const [corps, setCorps] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Sélecteur de destinataire depuis le Carnet de contacts (2026-09-16) :
  // chargé une fois à l'ouverture de l'écran, jamais rafraîchi
  // automatiquement (même principe que boiteMailConfiguree dans
  // TachesListView) — un carnet modifié pendant que l'écran est ouvert
  // nécessite juste de rouvrir l'écran, cas rare pour un usage interne.
  const [contactsCarnet, setContactsCarnet] = useState<ContactUnifie[]>([]);
  const [carnetSelectionneCle, setCarnetSelectionneCle] = useState("");
  const [classificationChoisie, setClassificationChoisie] = useState<{
    type: ClassificationTypeChoisie;
    id: string;
  } | null>(null);

  useEffect(() => {
    listContactsUnifies()
      .then(setContactsCarnet)
      .catch(() => setContactsCarnet([]));
  }, []);

  // Sélection dans le carnet : préremplit l'email (laissé vide si la
  // personne n'en a pas — saisie manuelle possible, jamais bloquant, voir
  // docs/backlog.md) et classe le message immédiatement, sans attendre une
  // résolution a posteriori par adresse. La saisie manuelle du destinataire
  // (handleDestinataireManuel) efface cette classification : une fois
  // l'adresse modifiée à la main, elle ne correspond plus forcément à la
  // personne choisie.
  function handleSelectionnerCarnet(cle: string): void {
    setCarnetSelectionneCle(cle);
    if (cle === "") {
      setClassificationChoisie(null);
      return;
    }
    const contactChoisi = contactsCarnet.find((c) => `${c.type}:${c.id}` === cle);
    if (!contactChoisi) return;
    setDestinataire(contactChoisi.email ?? "");
    setClassificationChoisie({ type: resoudreClassificationDepuisCarnet(contactChoisi.type), id: contactChoisi.id });
  }

  function handleDestinataireManuel(valeur: string): void {
    setDestinataire(valeur);
    setCarnetSelectionneCle("");
    setClassificationChoisie(null);
  }

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setMessages(await listMessages());
      setError(null);
    } catch {
      setError("Impossible de charger les messages");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fils = useMemo(() => construireFils(messages), [messages]);
  const fil = fils.find((f) => f.cle === filSelectionne) ?? null;
  const messagesTries = useMemo(
    () => (fil ? [...fil.messages].sort((a, b) => a.dateMessage.localeCompare(b.dateMessage)) : []),
    [fil]
  );

  // Détails (avec pièces jointes) chargés à la demande, un message à la
  // fois — la liste (findAll) ne les renvoie pas pour rester légère.
  useEffect(() => {
    if (!fil) return;
    for (const message of fil.messages) {
      if (detailsParMessage.has(message.id)) continue;
      void (async () => {
        try {
          const detail = await getMessage(message.id);
          setDetailsParMessage((precedent) => new Map(precedent).set(message.id, detail));
        } catch {
          // Silencieux : l'absence de détail masque juste les pièces
          // jointes de ce message précis, jamais bloquant pour le fil.
        }
      })();
    }
  }, [fil]);

  function ouvrirFil(f: Fil): void {
    setFilSelectionne(f.cle);
    setDestinataire(f.correspondant);
    setObjet("");
    setCorps("");
    setSendError(null);
    setCarnetSelectionneCle("");
    setClassificationChoisie(null);
  }

  async function handleEnvoyer(e: FormEvent): Promise<void> {
    e.preventDefault();
    setIsSending(true);
    setSendError(null);
    try {
      await composerMessage({
        destinataire,
        objet,
        corps,
        ...(classificationChoisie && {
          classificationType: classificationChoisie.type,
          classificationId: classificationChoisie.id
        })
      });
      setObjet("");
      setCorps("");
      await refresh();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Impossible d'envoyer le message");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex h-full gap-4">
      <div className="w-64 shrink-0 space-y-2 overflow-y-auto border-r border-slate-200 pr-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Fils</h2>
          <button
            type="button"
            onClick={() => {
              setFilSelectionne(null);
              setDestinataire("");
              setObjet("");
              setCorps("");
              setSendError(null);
              setCarnetSelectionneCle("");
              setClassificationChoisie(null);
            }}
            className="text-xs text-indigo-700 hover:text-indigo-800"
          >
            Nouveau
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : fils.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun message.</p>
        ) : (
          <ul className="space-y-1">
            {fils.map((f) => {
              const correspondantAffiche = resoudreCorrespondantAffichage(f, contactsCarnet);
              return (
                <li key={f.cle}>
                  <button
                    type="button"
                    onClick={() => ouvrirFil(f)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                      filSelectionne === f.cle ? "bg-indigo-100 text-indigo-800" : "hover:bg-slate-100"
                    }`}
                  >
                    {correspondantAffiche ? (
                      <>
                        <div className="truncate font-medium">
                          {correspondantAffiche.nom} — {correspondantAffiche.role}
                        </div>
                        <span className="block truncate text-xs text-slate-400" title={f.correspondant}>
                          {f.correspondant}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="truncate font-medium">{f.correspondant}</div>
                        {f.classificationType !== "non_classe" && (
                          <span className="text-xs text-slate-500">{CLASSIFICATION_LABELS[f.classificationType]}</span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {fil && (
          <ul className="space-y-3">
            {messagesTries.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                piecesJointes={detailsParMessage.get(message.id)?.piecesJointes ?? []}
                onOuvrirPieceJointe={ouvrirApercu}
                onRefresh={refresh}
              />
            ))}
          </ul>
        )}

        <form onSubmit={handleEnvoyer} className="max-w-lg space-y-2 rounded-md border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-700">{fil ? "Répondre" : "Nouveau message"}</h3>
          <label className="block text-sm">
            Choisir dans le carnet de contacts
            <select
              value={carnetSelectionneCle}
              onChange={(e) => handleSelectionnerCarnet(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            >
              <option value="">— Saisie manuelle —</option>
              {contactsCarnet.map((c) => (
                <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                  {c.nom} — {libelleTypeCarnet(c.type)}
                  {c.email ? "" : " (pas d'email enregistré)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Destinataire
            <input
              type="email"
              required
              value={destinataire}
              onChange={(e) => handleDestinataireManuel(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Objet
            <input
              type="text"
              required
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Message
            <textarea
              required
              value={corps}
              onChange={(e) => setCorps(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={isSending}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSending ? "Envoi…" : "Envoyer"}
          </button>
          {sendError && (
            <p role="alert" className="text-xs text-red-600">
              {sendError}
            </p>
          )}
        </form>
      </div>

      {apercu && <DocumentApercuModal apercu={apercu} onClose={fermerApercu} />}
    </div>
  );
}

function MessageItem({
  message,
  piecesJointes,
  onOuvrirPieceJointe,
  onRefresh
}: {
  message: MessageCommunication;
  piecesJointes: PieceJointeMessage[];
  onOuvrirPieceJointe: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            message.direction === "envoye" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {message.direction === "envoye" ? "Envoyé" : "Reçu"}
        </span>
        <span>{new Date(message.dateMessage).toLocaleString("fr-FR")}</span>
      </div>
      {message.objet && <p className="mt-1 text-sm font-medium text-slate-700">{message.objet}</p>}
      {message.corps && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{message.corps}</p>}
      {piecesJointes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {piecesJointes.map((piece) => (
            <PieceJointeItem
              key={piece.id}
              piece={piece}
              classificationType={message.classificationType}
              classificationId={message.classificationId}
              onOuvrir={onOuvrirPieceJointe}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function PieceJointeItem({
  piece,
  classificationType,
  classificationId,
  onOuvrir,
  onRefresh
}: {
  piece: PieceJointeMessage;
  classificationType: MessageClassificationType;
  classificationId: string | null;
  onOuvrir: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [isClassing, setIsClassing] = useState(false);
  const [classe, setClasse] = useState(false);
  const [categorie, setCategorie] = useState<DocumentCategorie>("courrier");
  const [error, setError] = useState<string | null>(null);

  const peutClasser =
    !classe && classificationId !== null && CLASSIFICATIONS_CLASSABLES.includes(classificationType);

  async function handleClasser(): Promise<void> {
    if (!classificationId || !peutClasser) return;
    setIsClassing(true);
    setError(null);
    try {
      // peutClasser garantit classificationType ∈ {locataire, garant,
      // candidat} (CLASSIFICATIONS_CLASSABLES) — ces trois valeurs
      // correspondent exactement à des DocumentEntiteType valides.
      const entiteType = classificationType as Extract<DocumentEntiteType, "locataire" | "garant" | "candidat">;
      await classerPieceJointeDansDocuments(piece.id, {
        entiteType,
        entiteId: classificationId,
        categorie
      });
      setClasse(true);
      await onRefresh();
    } catch {
      setError("Impossible de classer dans Documents");
    } finally {
      setIsClassing(false);
    }
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => void onOuvrir(piece.id)}
        className="text-indigo-700 underline hover:text-indigo-800"
      >
        {piece.nomFichier}
      </button>
      {peutClasser ? (
        <>
          <select
            value={categorie}
            onChange={(e) => setCategorie(e.target.value as DocumentCategorie)}
            className="rounded-md border border-slate-300 px-1 py-0.5 text-xs"
          >
            {Object.entries(CATEGORIE_LABELS).map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isClassing}
            onClick={() => void handleClasser()}
            className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            {isClassing ? "Classement…" : "Classer dans Documents"}
          </button>
        </>
      ) : classe ? (
        <span className="text-xs text-emerald-600">Classé dans Documents</span>
      ) : null}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </li>
  );
}
