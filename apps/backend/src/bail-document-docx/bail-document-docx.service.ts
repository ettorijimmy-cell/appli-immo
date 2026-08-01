import { readFileSync } from "fs";
import path from "path";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ajouterMois,
  calculerDureeBail,
  calculerLibelleDepotGarantie,
  calculerMontantEcheanceLoyer,
  determinerRegimeClauseResolutoire,
  libelleMoisDepuisDate,
  regimesDureeApplicables,
  validerCompletudeGenerationBail,
  type ChoixDureeBail,
  type DonneesCompletudeGenerationBail
} from "core";
import {
  appartements,
  bailLocataires,
  baux,
  garants,
  immeubles,
  locataires,
  scis,
  type Database
} from "db";
import Docxtemplater from "docxtemplater";
import { and, eq, isNull } from "drizzle-orm";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { GenererDocumentBailDocxDto } from "./dto/generer-document-bail-docx.dto";

// Vide si non renseigné (colocataire absent, honoraires nuls...) — jamais
// "undefined" littéral dans le document final.
const VIDE = "";
const NEANT = "Néant";
// L'infrastructure IRL (table indices_irl + tâche planifiée, voir
// docs/backlog.md) n'est pas encore implémentée : impossible d'insérer une
// vraie valeur ici sans en inventer une — jamais silencieusement, un
// repère visible tant que ce n'est pas construit.
const IRL_NON_DISPONIBLE = "[Indice IRL non disponible — infrastructure à implémenter, voir docs/backlog.md]";

@Injectable()
export class BailDocumentDocxService {
  private readonly templatePath: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    config: ConfigService
  ) {
    this.templatePath =
      config.get<string>("BAIL_DOCUMENT_DOCX_TEMPLATE_PATH") ??
      path.join(process.cwd(), "..", "..", "tmp", "Modèle bail.docx");
  }

  async genererDocumentBailDocx(bailId: string, dto: GenererDocumentBailDocxDto): Promise<Buffer> {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, bailId)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }

    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, bail.appartementId))
      .limit(1);
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }

    const [immeuble] = await this.db
      .select()
      .from(immeubles)
      .where(eq(immeubles.id, appartement.immeubleId))
      .limit(1);
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }

    const [sci] = await this.db.select().from(scis).where(eq(scis.id, immeuble.sciId)).limit(1);
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }

    const liensLocataires = await this.db
      .select()
      .from(bailLocataires)
      .where(and(eq(bailLocataires.bailId, bailId), isNull(bailLocataires.archivedAt)));
    const locatairesDuBail = (
      await Promise.all(
        liensLocataires.map(async (lien) => {
          const [locataire] = await this.db
            .select()
            .from(locataires)
            .where(eq(locataires.id, lien.locataireId))
            .limit(1);
          return locataire;
        })
      )
    ).filter((l): l is NonNullable<typeof l> => l !== undefined);

    const garantsDuBail = await this.db
      .select()
      .from(garants)
      .where(and(eq(garants.bailId, bailId), isNull(garants.archivedAt)));

    // Étape obligatoire AVANT toute génération : liste complète des champs
    // manquants en un seul appel, jamais un blocage au premier trouvé
    // (packages/core, validerCompletudeGenerationBail).
    const donneesCompletude: DonneesCompletudeGenerationBail = {
      sci: { telephone: sci.telephone, estFamiliale: sci.estFamiliale },
      immeuble: { anneeConstruction: immeuble.anneeConstruction },
      appartement: {
        equipementCuisine: appartement.equipementCuisine,
        dependancesAnnexes: appartement.dependancesAnnexes
      },
      locataires: locatairesDuBail.map((l) => ({
        adresse: l.adresse,
        codePostal: l.codePostal,
        ville: l.ville
      })),
      garants: garantsDuBail.map((g) => ({
        dateNaissance: g.dateNaissance,
        lieuNaissance: g.lieuNaissance,
        nationalite: g.nationalite
      }))
    };
    const champsManquants = validerCompletudeGenerationBail(donneesCompletude);
    if (champsManquants.length > 0) {
      throw new BadRequestException({
        message: "Génération impossible : champs obligatoires manquants",
        champsManquants
      });
    }

    // `dateReference` : la loi parle de contrats "conclus" à telle date —
    // date_signature quand elle est renseignée, repli documenté sur
    // dateDebut sinon (baux signés avant l'introduction de ce champ, ou
    // non encore renseigné — docs/data-dictionary.md).
    const dateReference = bail.dateSignature ?? bail.dateDebut;
    const regime = determinerRegimeClauseResolutoire(dateReference);
    const servitudeResidencePrincipale = dto.servitudeResidencePrincipale ?? false;
    const servitudeApplicable = servitudeResidencePrincipale && regime === "depuis_2026_10_01";

    // Durée légale : bail vide dérivé automatiquement de scis.est_familiale
    // (déjà validé non-null ci-dessus, aucun choix humain requis) ; bail
    // meublé, rien dans le schéma ne distingue standard/étudiant — choix
    // explicite (DTO), "standard" par défaut si omis.
    const choixDuree: ChoixDureeBail =
      bail.typeBail === "vide"
        ? { typeBail: "vide", regime: sci.estFamiliale ? "sci_familiale" : "sci_non_familiale" }
        : {
            typeBail: "meuble",
            regime: dto.regimeDureeMeuble ?? (regimesDureeApplicables("meuble").parDefaut as "standard")
          };
    const duree = calculerDureeBail(choixDuree);
    const dateFin = ajouterMois(bail.dateDebut, duree.dureeMois);

    const titulaire = locatairesDuBail[0] ?? null;
    const colocataire = locatairesDuBail[1] ?? null;
    const caution = garantsDuBail[0] ?? null;

    const donneesBalises: Record<string, string> = {
      "Nom de l’appartement": `${appartement.type} - ${appartement.numero}`,

      "Nom de la SCI": sci.nom,
      "Adresse de la SCI": sci.adresse ?? VIDE,
      "code postal SCI": sci.codePostal ?? VIDE,
      "Ville SCI": sci.ville ?? VIDE,
      "téléphone SCI": sci.telephone ?? VIDE,

      "Nom prénom du locataire": titulaire ? `${titulaire.prenom} ${titulaire.nom}` : VIDE,
      "Adresse locataire": titulaire?.adresse ?? VIDE,
      "CP locataire": titulaire?.codePostal ?? VIDE,
      "Ville locataire": titulaire?.ville ?? VIDE,
      "Date de naissance locataire": titulaire?.dateNaissance ?? VIDE,
      "Téléphone du locataire": titulaire?.telephone ?? VIDE,
      "adresse mail du locataire": titulaire?.email ?? VIDE,

      "Nom prénom du colocataire": colocataire ? `${colocataire.prenom} ${colocataire.nom}` : VIDE,
      "adresse colocataire": colocataire?.adresse ?? VIDE,
      "code postale colocataire": colocataire?.codePostal ?? VIDE,
      "ville colocataire": colocataire?.ville ?? VIDE,
      "téléphone colocataire": colocataire?.telephone ?? VIDE,
      "adresse mail colocataire": colocataire?.email ?? VIDE,
      "date de naissance collocataire": colocataire?.dateNaissance ?? VIDE,

      loyer: bail.loyerMensuel ?? VIDE,
      charges: bail.provisionsCharges ?? VIDE,
      "somme loyer + charges": calculerMontantEcheanceLoyer(bail.loyerMensuel ?? "0", bail.provisionsCharges),
      "dépôt de garantie": bail.depotGarantie ?? VIDE,

      "nombre de pièce": appartement.nombrePiecesPrincipales?.toString() ?? VIDE,
      surface: appartement.surface ?? VIDE,
      "liste des dépendances": appartement.dependancesAnnexes ?? VIDE,
      "Equipement de la cuisine": appartement.equipementCuisine ?? VIDE,
      "adresse appartement": immeuble.adresse,
      "code postal appartement": immeuble.codePostal ?? VIDE,
      "ville appartement": immeuble.ville ?? VIDE,
      "Année construction immeuble": immeuble.anneeConstruction?.toString() ?? VIDE,

      "date début bail": bail.dateDebut,
      // Nom de balise hérité du modèle ("+ 3ans" figé dans le libellé de la
      // balise elle-même côté propriétaire) — la VALEUR injectée est la
      // vraie date de fin calculée depuis la durée légale réelle (3 ou 6
      // ans selon scis.est_familiale, ou 1 an / 9 mois si meublé), jamais
      // 3 ans en dur.
      "date début bail + 3ans": dateFin,

      "dernière valeur indice Insee IRL": IRL_NON_DISPONIBLE,
      "dernier indice Insee IRL connu": IRL_NON_DISPONIBLE,

      "mettre un champ à compléter le cas échéant": bail.honorairesLocataire ?? NEANT,

      "Nom prénom de la personne caution": caution ? `${caution.prenom} ${caution.nom}` : VIDE,
      "adresse caution": caution?.adresse ?? VIDE,
      "code postale caution": caution?.codePostal ?? VIDE,
      "ville caution": caution?.ville ?? VIDE,
      "téléphone caution": caution?.telephone ?? VIDE,
      "date de naissance caution": caution?.dateNaissance ?? VIDE,
      "ville de naissance caution ": caution?.lieuNaissance ?? VIDE,
      "nationalité caution": caution?.nationalite ?? VIDE,
      "adresse mail caution": caution?.email ?? VIDE,

      "montant loyer": bail.loyerMensuel ?? VIDE,
      "mois de départ du bail": libelleMoisDepuisDate(bail.dateDebut),
      "montant des charges": bail.provisionsCharges ?? VIDE,
      "un mois appartement vide ou deux mois appartement meublé": calculerLibelleDepotGarantie(bail.typeBail),
      "montant dépôt de garantie": bail.depotGarantie ?? VIDE,

      "Ville de l’appartement": immeuble.ville ?? VIDE,
      // Balise du bloc signature ("Fait à ..., le ...") — malgré son nom
      // hérité du modèle, la valeur est date_signature (repli dateDebut),
      // jamais littéralement dateDebut (voir dateReference ci-dessus).
      "date de début du bail": dateReference
    };

    const buffer = this.rendreDocument(donneesBalises, {
      clauseResolutoireAvant: regime === "avant_2026_10_01",
      clauseResolutoireApres: regime === "depuis_2026_10_01",
      servitude: servitudeApplicable
    });

    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "bail_document_genere",
        entiteId: bailId,
        utilisateurId
      });
    }

    return buffer;
  }

  private rendreDocument(
    donneesBalises: Record<string, string>,
    drapeaux: { clauseResolutoireAvant: boolean; clauseResolutoireApres: boolean; servitude: boolean }
  ): Buffer {
    const contenu = readFileSync(this.templatePath, "binary");
    const zip = new PizZip(contenu);
    const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    document.render({ ...donneesBalises, ...drapeaux });
    return document.getZip().generate({ type: "nodebuffer" }) as Buffer;
  }
}
