import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  calculerDateFinEngagementCaution,
  calculerDureeBail,
  calculerPlafondCautionnement,
  formaterDateCourteFr,
  formaterDureeBail,
  formaterMontantChiffres,
  libelleMoisDepuisDate,
  montantEnCentimes,
  montantEnLettres,
  resoudreLocataireGaranti,
  validerCompletudeActeCautionnement
} from "core";
import { garants, locataires, type Database } from "db";
import Docxtemplater from "docxtemplater";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import {
  BailDocumentDocxService,
  choixDureeDuBail,
  contexteGarantiesDuBail
} from "../bail-document-docx/bail-document-docx.service";
import { BienService } from "../bien/bien.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { GenererActeCautionnementDocxDto } from "./dto/generer-acte-cautionnement-docx.dto";

// Information absente de la base, imprimée à compléter à la main plutôt
// que devinée (même principe que le bail).
export const A_COMPLETER = "[À COMPLÉTER]";
const GERANT_MANQUANT = "[À COMPLÉTER : gérant de la SCI]";

export const MESSAGE_ACTE_RESERVE_CAUTION =
  "L'acte de cautionnement est réservé à une caution personne physique.";

function ouACompleter(valeur: string | null | undefined): string {
  return valeur === null || valeur === undefined || valeur.trim() === "" ? A_COMPLETER : valeur;
}

// « 12/05/1990 à Brive », chaque morceau manquant marqué à compléter.
function naissance(date: string | null, lieu: string | null): string {
  if (date === null && (lieu === null || lieu.trim() === "")) {
    return A_COMPLETER;
  }
  return `${date === null ? A_COMPLETER : formaterDateCourteFr(date)} à ${ouACompleter(lieu)}`;
}

// « 8 rue de la Caution, 69002 Lyon ».
function adresse(rue: string | null, codePostal: string | null, ville: string | null): string {
  if ([rue, codePostal, ville].every((v) => v === null || v.trim() === "")) {
    return A_COMPLETER;
  }
  return `${ouACompleter(rue)}, ${ouACompleter(codePostal)} ${ouACompleter(ville)}`;
}

function libelleTrimestre(trimestre: number): string {
  return `${trimestre}${trimestre === 1 ? "er" : "e"} trimestre`;
}

// Acte de cautionnement d'une caution personne physique (chantier garants,
// commit 5, décisions du 2026-11-08) : modèle assets/modele-acte-
// cautionnement.docx (construit par script depuis le modèle de Jimmy),
// rendu comme le bail, ouvert dans Word côté desktop, jamais archivé.
// Même lecture des parties et même contexte des garanties que le bail
// (BailDocumentDocxService.chargerPartiesDuBail, contexteGarantiesDuBail).
@Injectable()
export class ActeCautionnementDocxService {
  private readonly logger = new Logger(ActeCautionnementDocxService.name);
  private readonly templatePath: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly bailDocumentDocxService: BailDocumentDocxService,
    private readonly bienService: BienService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    config: ConfigService
  ) {
    // Même résolution que le modèle de bail (__dirname, copié dans dist/ au
    // build, voir nest-cli.json compilerOptions.assets).
    this.templatePath =
      config.get<string>("ACTE_CAUTIONNEMENT_DOCX_TEMPLATE_PATH") ??
      path.join(__dirname, "assets", "modele-acte-cautionnement.docx");
  }

  async genererActeCautionnementDocx(garantId: string, dto: GenererActeCautionnementDocxDto): Promise<Buffer> {
    // Contrôle d'appartenance : même 404 qu'un garant inexistant.
    const [garant] = await this.db.select().from(garants).where(eq(garants.id, garantId)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!garant || garant.archivedAt !== null || (organisationId && garant.organisationId !== organisationId)) {
      throw new NotFoundException("Garant introuvable");
    }
    if (garant.typeGarantie !== "personne_physique") {
      throw new BadRequestException(MESSAGE_ACTE_RESERVE_CAUTION);
    }

    const parties = await this.bailDocumentDocxService.chargerPartiesDuBail(garant.bailId);
    const { bail, appartement, bienRow, sci, liensLocataires, locatairesDuBail } = parties;
    const { derniereValeurIrl, irlIndisponible } = await this.bailDocumentDocxService.chargerIrl();
    const nomBailleur = await this.bienService.resoudreNomBailleur(bienRow.id);
    const garanties = contexteGarantiesDuBail(parties);
    const choixDuree = choixDureeDuBail({ bail, bienRow, sci, regimeDureeMeuble: dto.regimeDureeMeuble });

    // Locataire garanti : « Caution de » (même s'il a quitté le bail depuis)
    // ou le locataire unique du bail.
    const garanti = resoudreLocataireGaranti(garant, garanties.locataires);
    const locataireGaranti =
      garanti === null
        ? null
        : (locatairesDuBail.find((l) => l.id === garanti.locataireId) ??
          (await this.db.select().from(locataires).where(eq(locataires.id, garanti.locataireId)).limit(1))[0] ??
          null);

    const champsManquants = validerCompletudeActeCautionnement({
      garantId: garant.id,
      caution: {
        typeGarantie: garant.typeGarantie,
        nom: garant.nom,
        prenom: garant.prenom,
        dateNaissance: garant.dateNaissance,
        lieuNaissance: garant.lieuNaissance,
        nationalite: garant.nationalite,
        adresse: garant.adresse,
        codePostal: garant.codePostal,
        ville: garant.ville
      },
      identitesLocataires: [
        ...locatairesDuBail,
        ...(locataireGaranti && !locatairesDuBail.some((l) => l.id === locataireGaranti.id) ? [locataireGaranti] : [])
      ].map((l) => ({ id: l.id, nom: l.nom, prenom: l.prenom })),
      bail: {
        loyerMensuel: bail.loyerMensuel,
        provisionsCharges: bail.provisionsCharges,
        dateDebut: bail.dateDebut,
        choixDuree,
        trimestreReferenceRevision: bail.trimestreReferenceRevision,
        irlIndisponible
      },
      bailleur: { nom: nomBailleur },
      garanties
    });
    if (champsManquants.length > 0) {
      throw new BadRequestException({
        message: "Génération impossible : champs obligatoires manquants",
        champsManquants
      });
    }
    // Garanti par validerCompletudeActeCautionnement (liste vide) : loyer,
    // durée, trimestre, IRL et locataire garanti renseignés.
    const dureeChoisie = choixDuree!;
    const locataire = locataireGaranti!;
    const nomLocataire = `${locataire.prenom} ${locataire.nom}`;

    const loyerCentimes = montantEnCentimes(bail.loyerMensuel!);
    const chargesCentimes = montantEnCentimes(bail.provisionsCharges ?? "0");
    const plafondCentimes = calculerPlafondCautionnement(loyerCentimes, chargesCentimes);
    const totalCentimes = loyerCentimes + chargesCentimes;

    const donnees: Record<string, string | boolean> = {
      bailleurNom: nomBailleur!,
      // Bailleur SCI : siège social et gérant, comme dans le bail. Bailleur
      // personne physique : adresse absente de la base, à compléter.
      representantSci: sci !== null,
      gerant: sci && sci.prenomGerant && sci.nomGerant ? `${sci.prenomGerant} ${sci.nomGerant}` : GERANT_MANQUANT,
      bailleurAdresse: sci ? adresse(sci.adresse, sci.codePostal, sci.ville) : A_COMPLETER,

      locataireNom: nomLocataire,
      locataireNaissance: naissance(locataire.dateNaissance, locataire.lieuNaissance),
      locataireAdresse: adresse(locataire.adresse, locataire.codePostal, locataire.ville),

      cautionNom: `${garant.prenom} ${garant.nom}`,
      cautionNaissance: naissance(garant.dateNaissance, garant.lieuNaissance),
      cautionAdresse: adresse(garant.adresse, garant.codePostal, garant.ville),

      // Colocation (art. 8-1, VI) : le colocataire garanti est identifié.
      colocation: liensLocataires.length > 1,
      colocataireGaranti: nomLocataire,

      logementAdresse: adresse(bienRow.adresse, bienRow.codePostal, bienRow.ville),
      logementType:
        bienRow.type === "maison" ? "Maison" : `Appartement (${[appartement.type, appartement.numero].filter(Boolean).join(" - ")})`,
      dateSignatureBail: bail.dateSignature ? formaterDateCourteFr(bail.dateSignature) : A_COMPLETER,
      dateEffetBail: formaterDateCourteFr(bail.dateDebut),
      dureeBail: formaterDureeBail(calculerDureeBail(dureeChoisie).dureeMois),

      loyerChiffres: formaterMontantChiffres(loyerCentimes),
      loyerLettres: montantEnLettres(loyerCentimes),
      chargesChiffres: formaterMontantChiffres(chargesCentimes),
      chargesLettres: montantEnLettres(chargesCentimes),
      totalChiffres: formaterMontantChiffres(totalCentimes),
      totalLettres: montantEnLettres(totalCentimes),

      // Clause de révision : mêmes valeurs que le bail (mois de départ,
      // dernière valeur de l'IRL), plus le trimestre de référence du bail.
      // IRL avec une virgule décimale dans l'acte (« 146,23 », décision du
      // 2026-11-10) ; le bail l'imprime encore avec un point.
      moisRevision: libelleMoisDepuisDate(bail.dateDebut),
      irlTrimestre: libelleTrimestre(bail.trimestreReferenceRevision!),
      irlValeur: derniereValeurIrl!.valeur.replace(".", ","),

      plafondChiffres: formaterMontantChiffres(plafondCentimes),
      plafondLettres: montantEnLettres(plafondCentimes),
      // Dernier jour inclus (décision du 2026-11-09).
      dateExpiration: formaterDateCourteFr(calculerDateFinEngagementCaution(bail.dateDebut, dureeChoisie))
    };

    const buffer = this.rendreDocument(donnees);

    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "acte_cautionnement_genere",
        entiteId: garant.id,
        utilisateurId
      });
    }
    return buffer;
  }

  private rendreDocument(donnees: Record<string, string | boolean>): Buffer {
    if (!existsSync(this.templatePath)) {
      // Chemin résolu jamais renvoyé au client (même règle que le bail).
      this.logger.error(`Modèle d'acte de cautionnement introuvable au chemin résolu : ${this.templatePath}`);
      throw new InternalServerErrorException(
        "Le modèle d'acte de cautionnement est introuvable sur le serveur. Contactez l'administrateur."
      );
    }
    const zip = new PizZip(readFileSync(this.templatePath, "binary"));
    const document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Une balise sans valeur est une erreur de programmation : jamais un
      // « undefined » imprimé dans un acte.
      nullGetter: (partie) => {
        throw new Error(`Balise sans valeur dans l'acte de cautionnement : ${partie.value}`);
      }
    });
    document.render(donnees);
    return document.getZip().generate({ type: "nodebuffer" }) as Buffer;
  }
}
