import { createHash } from "crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import { construireMailRemiseEtatDesLieux, phaseSigneeNumeriquement, phasesDepuisEtatDesLieux } from "core";
import {
  appartements,
  baux,
  bien,
  etatDesLieuxEnvoi,
  etatDesLieuxSignature,
  locataires,
  mettreAJourAvecAudit,
  type Database
} from "db";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import {
  EtatDesLieuxPdfService,
  MESSAGE_ENTREE_PAPIER_SANS_DOCUMENT,
  type PhaseEtatDesLieux
} from "../etat-des-lieux-pdf/etat-des-lieux-pdf.service";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { SmtpEnvoiService, type AccuseEnvoiSmtp, type PieceJointeEmail } from "../messagerie/smtp-envoi.service";
import { OrganisationResolutionService } from "../organisation-resolution/organisation-resolution.service";
import { adresseEnvoiValide } from "./adresse-envoi";
import type { DestinataireEnvoiDto, EnvoyerEtatDesLieuxDto } from "./dto/envoyer-etat-des-lieux.dto";

// 18 Mo de PDF deviennent environ 24,7 Mo une fois encodés en base64, sous
// la limite de 25 Mo couramment appliquée aux pièces jointes.
export const TAILLE_MAX_PDF_ENVOI_OCTETS = 18 * 1024 * 1024;

// Bien au-delà de la durée maximale d'une requête d'envoi : passé ce délai,
// la tentative a forcément été interrompue et le mail a pu partir ou non.
export const DELAI_ABANDON_ENVOI_MS = 10 * 60 * 1000;

const CODE_ERREUR_INATTENDUE = "ERREUR_INATTENDUE";
const MESSAGE_ERREUR_INATTENDUE = "L'envoi a échoué. Réessayez dans quelques minutes.";

type LigneEnvoi = typeof etatDesLieuxEnvoi.$inferSelect;

interface Signataire {
  locataireId: string;
  nomAffiche: string;
}

// Nom de la pièce jointe, indépendant du nom du fichier envoyé au desktop.
export const NOM_FICHIER_SCAN_ENTREE_PAPIER = "etat-des-lieux-entree-papier-scan.pdf";

interface ContexteMail {
  objet: string;
  corps: string;
  // Le PDF figé de la phase, puis, pour une sortie après une entrée papier,
  // le scan de l'entrée.
  piecesJointes: PieceJointeEmail[];
  documentId: string;
  pdfSha256: string;
  // Preuve du scan d'entrée papier joint (null s'il n'y en a pas) :
  // empreinte des octets exacts de la pièce jointe.
  scanDocumentId: string | null;
  scanSha256: string | null;
}

export interface ResultatEnvoi {
  locataireId: string;
  nomDestinataire: string;
  adresseUtilisee: string;
  statut: LigneEnvoi["statut"];
  tenteLe: Date;
  envoyeLe: Date | null;
  codeErreur: string | null;
  messageErreur: string | null;
}

function versResultat(ligne: LigneEnvoi): ResultatEnvoi {
  return {
    locataireId: ligne.locataireId,
    nomDestinataire: ligne.nomDestinataire,
    adresseUtilisee: ligne.adresseUtilisee,
    statut: ligne.statut,
    tenteLe: ligne.tenteLe,
    envoyeLe: ligne.envoyeLe,
    codeErreur: ligne.codeErreur,
    messageErreur: ligne.messageErreur
  };
}

function versHistorique(ligne: LigneEnvoi) {
  return {
    ...versResultat(ligne),
    id: ligne.id,
    phase: ligne.phase,
    adresseExpediteur: ligne.adresseExpediteur,
    objet: ligne.objet,
    smtpMessageId: ligne.smtpMessageId,
    pdfSha256: ligne.pdfSha256,
    // Non null pour une sortie qui a joint le scan d'une entrée papier.
    scanSha256: ligne.scanSha256
  };
}

function libelleErreur(erreur: unknown): { codeErreur: string; messageErreur: string } {
  if (erreur instanceof HttpException) {
    const reponse = erreur.getResponse() as { code?: unknown; message?: unknown };
    return {
      codeErreur: typeof reponse.code === "string" ? reponse.code : CODE_ERREUR_INATTENDUE,
      messageErreur: typeof reponse.message === "string" ? reponse.message : MESSAGE_ERREUR_INATTENDUE
    };
  }
  return { codeErreur: CODE_ERREUR_INATTENDUE, messageErreur: MESSAGE_ERREUR_INATTENDUE };
}

// Remise de l'état des lieux signé au locataire, sur action explicite
// uniquement (bouton), jamais automatiquement. Chaque tentative laisse une
// ligne dans etat_des_lieux_envoi, écrite AVANT l'appel SMTP. Aucune méthode
// ne supprime de ligne, et la base le refuserait (voir la migration 0070).
@Injectable()
export class EtatDesLieuxEnvoiService {
  private readonly logger = new Logger(EtatDesLieuxEnvoiService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly organisationResolution: OrganisationResolutionService,
    private readonly etatsDesLieuxService: EtatsDesLieuxService,
    private readonly etatDesLieuxPdfService: EtatDesLieuxPdfService,
    private readonly smtpEnvoiService: SmtpEnvoiService
  ) {}

  // Fail-closed : l'absence de contexte organisation est un refus, comme pour
  // la signature et le PDF, dont ces envois sont la suite directe.
  private async verifierAppartenance(etatDesLieuxId: string): Promise<string> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      throw new NotFoundException("État des lieux introuvable");
    }
    const idsValides = await this.organisationResolution.resoudreEntiteIdsOrganisation("etat_des_lieux", organisationId);
    if (!idsValides.includes(etatDesLieuxId)) {
      throw new NotFoundException("État des lieux introuvable");
    }
    return organisationId;
  }

  private async verifierPhaseSignee(etatDesLieuxId: string, phase: PhaseEtatDesLieux) {
    const etat = await this.etatsDesLieuxService.findById(etatDesLieuxId);
    // Famille B : on n'envoie que le PDF d'une phase signée numériquement.
    if (phase === "entree" && etat.entreePapier !== null) {
      throw new ConflictException(MESSAGE_ENTREE_PAPIER_SANS_DOCUMENT);
    }
    if (!phaseSigneeNumeriquement(phasesDepuisEtatDesLieux(etat), phase)) {
      throw new ConflictException("Cette partie de l'état des lieux n'est pas encore signée.");
    }
    return etat;
  }

  private async signatairesLocataires(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<Signataire[]> {
    const lignes = await this.db
      .select({ locataireId: etatDesLieuxSignature.locataireId, nomAffiche: etatDesLieuxSignature.nomAffiche })
      .from(etatDesLieuxSignature)
      .where(
        and(
          eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId),
          eq(etatDesLieuxSignature.phase, phase),
          eq(etatDesLieuxSignature.role, "locataire"),
          isNull(etatDesLieuxSignature.archivedAt)
        )
      )
      .orderBy(etatDesLieuxSignature.signeLe);
    return lignes.flatMap((l) => (l.locataireId ? [{ locataireId: l.locataireId, nomAffiche: l.nomAffiche }] : []));
  }

  // Écran de confirmation : signataires de la phase, adresse actuelle de leur
  // fiche, dernier envoi connu et disponibilité du PDF.
  async listerDestinataires(etatDesLieuxId: string, phase: PhaseEtatDesLieux) {
    await this.verifierAppartenance(etatDesLieuxId);
    await this.classerEnvoisAbandonnes(etatDesLieuxId);
    await this.verifierPhaseSignee(etatDesLieuxId, phase);

    const signataires = await this.signatairesLocataires(etatDesLieuxId, phase);
    const fiches = await this.fichesLocataires(signataires.map((s) => s.locataireId));
    const envois = await this.db
      .select()
      .from(etatDesLieuxEnvoi)
      .where(and(eq(etatDesLieuxEnvoi.etatDesLieuxId, etatDesLieuxId), eq(etatDesLieuxEnvoi.phase, phase)))
      .orderBy(desc(etatDesLieuxEnvoi.tenteLe));
    const documents = await this.etatDesLieuxPdfService.listerDocumentsFiges(etatDesLieuxId);

    return {
      pdfDisponible: Boolean(documents.find((d) => d.phase === phase)?.pdf),
      destinataires: signataires.map((s) => {
        const dernier = envois.find((e) => e.locataireId === s.locataireId);
        return {
          locataireId: s.locataireId,
          nomAffiche: s.nomAffiche,
          email: fiches.get(s.locataireId) ?? null,
          dernierEnvoi: dernier ? versResultat(dernier) : null
        };
      })
    };
  }

  async listerHistorique(etatDesLieuxId: string) {
    await this.verifierAppartenance(etatDesLieuxId);
    await this.classerEnvoisAbandonnes(etatDesLieuxId);
    const lignes = await this.db
      .select()
      .from(etatDesLieuxEnvoi)
      .where(eq(etatDesLieuxEnvoi.etatDesLieuxId, etatDesLieuxId))
      .orderBy(desc(etatDesLieuxEnvoi.tenteLe));
    return lignes.map(versHistorique);
  }

  async envoyer(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    dto: EnvoyerEtatDesLieuxDto
  ): Promise<{ resultats: ResultatEnvoi[] }> {
    const organisationId = await this.verifierAppartenance(etatDesLieuxId);
    await this.classerEnvoisAbandonnes(etatDesLieuxId);

    // Avant toute autre vérification : un rejeu renvoie ce qui s'est passé,
    // même si la fiche a changé entre-temps, et ne produit jamais de mail.
    const existantes = await this.lignesDeLaDemande(etatDesLieuxId, phase, dto.demandeId);
    if (existantes.length > 0) {
      return { resultats: existantes.map(versResultat) };
    }

    const etat = await this.verifierPhaseSignee(etatDesLieuxId, phase);
    const signataires = await this.verifierDestinataires(etatDesLieuxId, phase, dto.destinataires);
    const contexte = await this.preparerMail(etatDesLieuxId, phase, etat);

    const resultats: ResultatEnvoi[] = [];
    for (const destinataire of dto.destinataires) {
      const nomAffiche = signataires.get(destinataire.locataireId);
      if (nomAffiche === undefined) {
        continue;
      }
      resultats.push(
        await this.envoyerA(etatDesLieuxId, phase, organisationId, dto.demandeId, destinataire, nomAffiche, contexte)
      );
    }
    return { resultats };
  }

  private lignesDeLaDemande(etatDesLieuxId: string, phase: PhaseEtatDesLieux, demandeId: string): Promise<LigneEnvoi[]> {
    return this.db
      .select()
      .from(etatDesLieuxEnvoi)
      .where(
        and(
          eq(etatDesLieuxEnvoi.demandeId, demandeId),
          eq(etatDesLieuxEnvoi.etatDesLieuxId, etatDesLieuxId),
          eq(etatDesLieuxEnvoi.phase, phase)
        )
      );
  }

  private async fichesLocataires(ids: string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) {
      return new Map();
    }
    const lignes = await this.db
      .select({ id: locataires.id, email: locataires.email })
      .from(locataires)
      .where(inArray(locataires.id, ids));
    return new Map(lignes.map((l) => [l.id, l.email]));
  }

  // Tout ou rien, avant le premier mail : une erreur sur un destinataire
  // n'envoie rien aux autres.
  private async verifierDestinataires(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    destinataires: DestinataireEnvoiDto[]
  ): Promise<Map<string, string>> {
    const signataires = new Map(
      (await this.signatairesLocataires(etatDesLieuxId, phase)).map((s) => [s.locataireId, s.nomAffiche])
    );
    const fiches = await this.fichesLocataires(destinataires.map((d) => d.locataireId));
    for (const { locataireId, email } of destinataires) {
      const nom = signataires.get(locataireId);
      if (nom === undefined) {
        throw new BadRequestException("Ce destinataire n'a pas signé cette partie de l'état des lieux.");
      }
      if (!adresseEnvoiValide(email)) {
        throw new BadRequestException(`L'adresse e-mail de ${nom} n'est pas valide.`);
      }
      if (fiches.get(locataireId) !== email) {
        throw new ConflictException(`L'adresse de ${nom} a changé. Vérifiez-la avant d'envoyer.`);
      }
    }
    return signataires;
  }

  private async preparerMail(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    etat: Awaited<ReturnType<EtatsDesLieuxService["findById"]>>
  ): Promise<ContexteMail> {
    const pdf = await this.etatDesLieuxPdfService.lirePdfFige(etatDesLieuxId, phase);
    if (!pdf) {
      throw new ConflictException("Le PDF n'est pas encore prêt.");
    }
    if (pdf.contenu.byteLength > TAILLE_MAX_PDF_ENVOI_OCTETS) {
      throw new PayloadTooLargeException(
        "Le PDF est trop volumineux pour être envoyé par mail. Remettez-le par un autre moyen."
      );
    }
    // Décision 7 : la sortie qui suit une entrée papier part avec le scan de
    // l'entrée. Le plafond porte sur l'ensemble des pièces jointes.
    const scanEntree =
      phase === "sortie" && etat.entreePapier !== null
        ? await this.etatDesLieuxPdfService.lireScanEntreePapier(etatDesLieuxId)
        : null;
    if (phase === "sortie" && etat.entreePapier !== null && !scanEntree) {
      throw new NotFoundException("Le scan de l'état des lieux d'entrée papier est introuvable.");
    }
    if (scanEntree && pdf.contenu.byteLength + scanEntree.contenu.byteLength > TAILLE_MAX_PDF_ENVOI_OCTETS) {
      throw new PayloadTooLargeException(
        "Le PDF de sortie et le scan de l'entrée sont ensemble trop volumineux pour être envoyés par mail. Remettez-les par un autre moyen."
      );
    }

    const [logement] = await this.db
      .select({ adresse: bien.adresse, codePostal: bien.codePostal, ville: bien.ville })
      .from(baux)
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(eq(baux.id, etat.bailId))
      .limit(1);
    const [bailleur] = await this.db
      .select({ nomAffiche: etatDesLieuxSignature.nomAffiche })
      .from(etatDesLieuxSignature)
      .where(
        and(
          eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId),
          eq(etatDesLieuxSignature.phase, phase),
          eq(etatDesLieuxSignature.role, "bailleur"),
          isNull(etatDesLieuxSignature.archivedAt)
        )
      )
      .limit(1);
    const dateSignature = phase === "entree" ? etat.dateEntree : etat.dateSortie;
    if (!logement || !bailleur || !dateSignature) {
      throw new NotFoundException("État des lieux introuvable");
    }

    const { objet, corps } = construireMailRemiseEtatDesLieux({
      phase,
      adresseLogement: logement.adresse,
      codePostalLogement: logement.codePostal,
      villeLogement: logement.ville,
      dateSignature,
      lieuSignature: (phase === "entree" ? etat.lieuEntree : etat.lieuSortie) ?? logement.ville,
      nomBailleur: bailleur.nomAffiche,
      scanEntreePapierJoint: scanEntree !== null
    });
    return {
      objet,
      corps,
      piecesJointes: [
        { nomFichier: pdf.nomFichier, contenu: pdf.contenu, mimeType: "application/pdf" },
        ...(scanEntree
          ? [{ nomFichier: NOM_FICHIER_SCAN_ENTREE_PAPIER, contenu: scanEntree.contenu, mimeType: "application/pdf" }]
          : [])
      ],
      documentId: pdf.documentId,
      pdfSha256: createHash("sha256").update(pdf.contenu).digest("hex"),
      // Même Buffer que celui joint ci-dessus : l'empreinte porte sur les
      // octets exacts envoyés.
      scanDocumentId: scanEntree?.documentId ?? null,
      scanSha256: scanEntree ? createHash("sha256").update(scanEntree.contenu).digest("hex") : null
    };
  }

  private async envoyerA(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    organisationId: string,
    demandeId: string,
    destinataire: DestinataireEnvoiDto,
    nomDestinataire: string,
    contexte: ContexteMail
  ): Promise<ResultatEnvoi> {
    const { locataireId, email } = destinataire;
    // DO NOTHING plutôt qu'une erreur : une requête concurrente a déjà pris
    // ce destinataire, jamais un second mail.
    const [ligne] = await this.db
      .insert(etatDesLieuxEnvoi)
      .values({
        etatDesLieuxId,
        phase,
        locataireId,
        documentId: contexte.documentId,
        pdfSha256: contexte.pdfSha256,
        scanDocumentId: contexte.scanDocumentId,
        scanSha256: contexte.scanSha256,
        demandeId,
        nomDestinataire,
        adresseUtilisee: email,
        objet: contexte.objet,
        tenteLe: new Date(),
        organisationId
      })
      .onConflictDoNothing()
      .returning();
    if (!ligne) {
      return versResultat(await this.ligneEnConflit(etatDesLieuxId, phase, demandeId, locataireId));
    }

    let accuse: AccuseEnvoiSmtp;
    try {
      accuse = await this.smtpEnvoiService.envoyerAvecAccuse(
        organisationId,
        email,
        contexte.objet,
        contexte.corps,
        contexte.piecesJointes,
        { type: "locataire", id: locataireId }
      );
    } catch (erreur) {
      if (!(erreur instanceof HttpException)) {
        this.logger.error(
          `Échec inattendu de l'envoi ${ligne.id}`,
          erreur instanceof Error ? erreur.stack : String(erreur)
        );
      }
      return versResultat(await this.finaliser(ligne, { statut: "echec", ...libelleErreur(erreur) }));
    }

    // Hors du bloc ci-dessus : le mail est parti, un échec d'écriture ici ne
    // doit jamais le faire passer pour un échec d'envoi. La ligne reste
    // en_cours et deviendra indetermine.
    const valeurs: Partial<LigneEnvoi> = {
      statut: "envoye",
      envoyeLe: new Date(),
      adresseExpediteur: accuse.expediteur,
      smtpMessageId: accuse.smtpMessageId,
      smtpReponse: accuse.reponseServeur,
      messageCommunicationId: accuse.messageCommunicationId
    };
    try {
      return versResultat(await this.finaliser(ligne, valeurs));
    } catch (erreur) {
      this.logger.error(
        `Mail parti mais résultat non enregistré pour l'envoi ${ligne.id}`,
        erreur instanceof Error ? erreur.stack : String(erreur)
      );
      return versResultat({ ...ligne, ...valeurs });
    }
  }

  private async finaliser(ligne: LigneEnvoi, valeurs: Partial<LigneEnvoi>): Promise<LigneEnvoi> {
    const [miseAJour] = await mettreAJourAvecAudit(
      this.db,
      etatDesLieuxEnvoi,
      ligne.id,
      valeurs,
      this.requestContext.getUtilisateurId()
    );
    return (miseAJour as LigneEnvoi | undefined) ?? { ...ligne, ...valeurs };
  }

  private async ligneEnConflit(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    demandeId: string,
    locataireId: string
  ): Promise<LigneEnvoi> {
    const [memeDemande] = await this.db
      .select()
      .from(etatDesLieuxEnvoi)
      .where(and(eq(etatDesLieuxEnvoi.demandeId, demandeId), eq(etatDesLieuxEnvoi.locataireId, locataireId)))
      .limit(1);
    if (memeDemande) {
      return memeDemande;
    }
    const [enCours] = await this.db
      .select()
      .from(etatDesLieuxEnvoi)
      .where(
        and(
          eq(etatDesLieuxEnvoi.etatDesLieuxId, etatDesLieuxId),
          eq(etatDesLieuxEnvoi.phase, phase),
          eq(etatDesLieuxEnvoi.locataireId, locataireId),
          eq(etatDesLieuxEnvoi.statut, "en_cours")
        )
      )
      .limit(1);
    if (!enCours) {
      throw new ConflictException("Un envoi vient de se terminer pour ce destinataire. Vérifiez l'historique.");
    }
    return enCours;
  }

  // Une ligne en_cours n'a pas de fin si le serveur s'arrête en plein envoi.
  // Appelée à chaque lecture ou envoi de cet état des lieux, et toutes les
  // 10 minutes pour tous (EtatDesLieuxEnvoiJobService) : une telle ligne
  // devient indetermine entre 10 et 20 minutes après sa tentative.
  async classerEnvoisAbandonnes(etatDesLieuxId?: string): Promise<number> {
    const limite = new Date(Date.now() - DELAI_ABANDON_ENVOI_MS);
    const lignes = await this.db
      .select({ id: etatDesLieuxEnvoi.id })
      .from(etatDesLieuxEnvoi)
      .where(
        and(
          eq(etatDesLieuxEnvoi.statut, "en_cours"),
          lt(etatDesLieuxEnvoi.tenteLe, limite),
          etatDesLieuxId ? eq(etatDesLieuxEnvoi.etatDesLieuxId, etatDesLieuxId) : undefined
        )
      );
    for (const { id } of lignes) {
      await mettreAJourAvecAudit(this.db, etatDesLieuxEnvoi, id, { statut: "indetermine" }, this.requestContext.getUtilisateurId());
    }
    return lignes.length;
  }
}
