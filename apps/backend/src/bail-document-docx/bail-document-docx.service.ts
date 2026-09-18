import { readFileSync } from "fs";
import path from "path";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ajouterMois,
  calculerDureeBail,
  calculerLibelleDepotGarantie,
  calculerLoyerPrecedentLocataire,
  calculerMontantEcheanceLoyer,
  determinerRegimeClauseResolutoire,
  irlEstPerime,
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
  bien,
  documents,
  garants,
  indicesIrl,
  locataires,
  paiements,
  scis,
  versements,
  type Database
} from "db";
import Docxtemplater from "docxtemplater";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { BienService } from "../bien/bien.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { GenererDocumentBailDocxDto } from "./dto/generer-document-bail-docx.dto";

// Vide si non renseigné (colocataire absent, honoraires nuls...) — jamais
// "undefined" littéral dans le document final.
const VIDE = "";
const NEANT = "Néant";

@Injectable()
export class BailDocumentDocxService {
  private readonly templatePath: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly bienService: BienService,
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

    // typeHabitat/regimeJuridique vivent sur bien directement (déplacés
    // depuis bien_immeuble_detail le 2026-08-26) : dérivés automatiquement
    // pour type='maison' (jamais null), requis explicitement pour tout
    // autre type — validerCompletudeGenerationBail bloque la génération
    // plus bas avec un message clair si absents, plutôt que d'imprimer une
    // mention légale devinée.
    const [bienRow] = await this.db.select().from(bien).where(eq(bien.id, appartement.bienId)).limit(1);
    if (!bienRow) {
      throw new NotFoundException("Bien introuvable");
    }

    // Contrôle d'appartenance (Commit B1, chantier scoping multi-organisation,
    // 2026-09-18) : NotFoundException avec le même message que le bail
    // inexistant ci-dessus — jamais de distinction observable entre "bail
    // introuvable" et "bail d'une autre organisation", même principe qu'au
    // Sous-commit 4d. Placé avant toute donnée supplémentaire (SCI,
    // locataires, garants, IRL) et avant le rendu du docx.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId && bienRow.organisationId !== organisationId) {
      throw new NotFoundException("Bail introuvable");
    }

    // Bailleur : sci.nom (bien en SCI) ou bien.nomProprietaire (nom propre,
    // atteignable depuis la migration Bien, 2026-08-25) — résolu via le
    // service partagé BienService.resoudreNomBailleur (corrige le bug
    // découvert lors de l'audit Étape 4 quittance, docs/backlog.md,
    // 2026-08-31 : cette méthode levait NotFoundException dès que
    // bien.sciId était NULL, cas réel et valide pour un bien en nom
    // propre, pas seulement théorique). `sci` reste chargé séparément
    // (uniquement quand bienRow.sciId est renseigné) pour les balises de
    // siège social propres à une SCI (adresse/CP/ville/téléphone), qui
    // n'ont pas d'équivalent pour un bailleur en nom propre.
    const sci = bienRow.sciId ? ((await this.db.select().from(scis).where(eq(scis.id, bienRow.sciId)).limit(1))[0] ?? null) : null;
    const nomBailleur = await this.bienService.resoudreNomBailleur(bienRow.id);
    if (!nomBailleur) {
      throw new NotFoundException("Bailleur introuvable (nom de la SCI ou du propriétaire manquant)");
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

    const [derniereValeurIrl] = await this.db
      .select()
      .from(indicesIrl)
      .orderBy(desc(indicesIrl.annee), desc(indicesIrl.trimestre))
      .limit(1);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const irlIndisponible =
      !derniereValeurIrl || irlEstPerime(derniereValeurIrl.dateRecuperation.toISOString().slice(0, 10), aujourdhui);

    // Étape obligatoire AVANT toute génération : liste complète des champs
    // manquants en un seul appel, jamais un blocage au premier trouvé
    // (packages/core, validerCompletudeGenerationBail).
    const donneesCompletude: DonneesCompletudeGenerationBail = {
      bienType: bienRow.type,
      // null pour un bailleur en nom propre : aucun champ sci.* à exiger
      // (voir DonneesCompletudeGenerationBail.sci, packages/core).
      sci: sci
        ? {
            telephone: sci.telephone,
            estFamiliale: sci.estFamiliale,
            adresse: sci.adresse,
            codePostal: sci.codePostal,
            ville: sci.ville
          }
        : null,
      immeuble: {
        anneeConstruction: bienRow.anneeConstruction,
        typeHabitat: bienRow.typeHabitat,
        regimeJuridique: bienRow.regimeJuridique
      },
      appartement: {
        equipementCuisine: appartement.equipementCuisine,
        dependancesAnnexes: appartement.dependancesAnnexes,
        nombrePiecesPrincipales: appartement.nombrePiecesPrincipales,
        modeChauffage: appartement.modeChauffage,
        modeEauChaude: appartement.modeEauChaude
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
      })),
      irlIndisponible
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

    // Mention obligatoire loi n° 89-462, art. 3 : montant et date de
    // versement du dernier loyer du précédent locataire, si celui-ci a
    // quitté le logement moins de 18 mois avant la signature du bail
    // (dateReference, pas dateDebut — le texte parle de la signature).
    // "Précédent locataire" = le bail le plus récemment terminé (résilié ou
    // archivé — jamais un brouillon, qui n'a jamais représenté une
    // occupation réelle même s'il porte une date_fin) sur ce même
    // appartement, hors le bail en cours de génération.
    const [bailPrecedent] = await this.db
      .select()
      .from(baux)
      .where(
        and(
          eq(baux.appartementId, appartement.id),
          ne(baux.id, bailId),
          inArray(baux.statut, ["resilie", "archive"]),
          isNotNull(baux.dateFin)
        )
      )
      .orderBy(desc(baux.dateFin), desc(baux.dateResiliation))
      .limit(1);
    const montantLoyerPrecedent = calculerLoyerPrecedentLocataire(
      bailPrecedent ? { loyerMensuel: bailPrecedent.loyerMensuel, dateFin: bailPrecedent.dateFin } : null,
      dateReference
    );
    let dateVersementLoyerPrecedent: string | null = null;
    if (montantLoyerPrecedent !== null && bailPrecedent) {
      const [dernierVersement] = await this.db
        .select({ dateVersement: versements.dateVersement })
        .from(versements)
        .innerJoin(paiements, eq(versements.paiementId, paiements.id))
        .where(
          and(
            eq(paiements.bailId, bailPrecedent.id),
            eq(paiements.type, "loyer"),
            isNull(versements.archivedAt)
          )
        )
        .orderBy(desc(versements.dateVersement))
        .limit(1);
      dateVersementLoyerPrecedent = dernierVersement?.dateVersement ?? null;
    }

    // Présence des diagnostics en pièce annexée (section XI du contrat-type,
    // décret n° 2015-587) : simple détection de présence, jamais un résultat
    // structuré (la table `diagnostics`, prévue pour ça, n'est reliée à
    // aucun module/UI à ce jour — docs/data-dictionary.md). Rien n'impose
    // qu'un diagnostic soit rattaché au bien ou à l'appartement : les deux
    // niveaux sont vérifiés pour chacune des 4 catégories.
    const documentsDiagnostics = await this.db
      .select({ categorie: documents.categorie })
      .from(documents)
      .where(
        and(
          or(
            and(eq(documents.entiteType, "appartement"), eq(documents.entiteId, appartement.id)),
            and(eq(documents.entiteType, "bien"), eq(documents.entiteId, bienRow.id))
          ),
          inArray(documents.categorie, ["dpe", "elec_gaz", "crep_plomb", "erp"]),
          isNull(documents.archivedAt)
        )
      );
    const categoriesDiagnosticsPresentes = new Set(documentsDiagnostics.map((d) => d.categorie));

    // Durée légale, bail vide : automatique pour un bailleur en nom propre
    // (regime 'personne_physique', aucun choix — voir calculerDureeBail,
    // packages/core), sinon dérivée de scis.est_familiale (déjà validé
    // non-null ci-dessus, aucun choix humain requis non plus — `sci` est
    // garanti non-null ici par la contrainte bien_sci_id_coherent dès que
    // proprietaireType='sci'). Bail meublé : rien dans le schéma ne
    // distingue standard/étudiant — choix explicite (DTO), "standard" par
    // défaut si omis.
    const choixDuree: ChoixDureeBail =
      bail.typeBail === "vide"
        ? bienRow.proprietaireType === "personne_physique"
          ? { typeBail: "vide", regime: "personne_physique" }
          : { typeBail: "vide", regime: sci!.estFamiliale ? "sci_familiale" : "sci_non_familiale" }
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

      // Balise nommée "Nom de la SCI" dans le fichier Word d'origine (figée
      // côté propriétaire, non renommable) mais porte désormais le nom du
      // bailleur quel que soit son mode de détention — voir nomBailleur
      // ci-dessus. Les 4 balises suivantes (siège social) restent propres
      // à une SCI, sans équivalent pour un bailleur en nom propre : VIDE
      // dans ce cas, jamais bloquant (voir DonneesCompletudeGenerationBail
      // .sci, packages/core).
      "Nom de la SCI": nomBailleur,
      "Adresse de la SCI": sci?.adresse ?? VIDE,
      "code postal SCI": sci?.codePostal ?? VIDE,
      "Ville SCI": sci?.ville ?? VIDE,
      "téléphone SCI": sci?.telephone ?? VIDE,

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
      "adresse appartement": bienRow.adresse,
      "code postal appartement": bienRow.codePostal ?? VIDE,
      "ville appartement": bienRow.ville ?? VIDE,
      "Année construction immeuble": bienRow.anneeConstruction?.toString() ?? VIDE,

      "date début bail": bail.dateDebut,
      // Nom de balise hérité du modèle ("+ 3ans" figé dans le libellé de la
      // balise elle-même côté propriétaire) — la VALEUR injectée est la
      // vraie date de fin calculée depuis la durée légale réelle (3 ou 6
      // ans selon scis.est_familiale, ou 1 an / 9 mois si meublé), jamais
      // 3 ans en dur.
      "date début bail + 3ans": dateFin,

      // `irlIndisponible` a déjà bloqué la génération plus haut si cette
      // valeur n'était pas disponible/fraîche — jamais un texte à
      // compléter inséré ici (docs/backlog.md, section "Édition d'un
      // bail").
      "dernière valeur indice Insee IRL": derniereValeurIrl?.valeur ?? VIDE,
      "dernier indice Insee IRL connu": derniereValeurIrl?.valeur ?? VIDE,

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

      "Ville de l’appartement": bienRow.ville ?? VIDE,
      // Balise du bloc signature ("Fait à ..., le ...") — malgré son nom
      // hérité du modèle, la valeur est date_signature (repli dateDebut),
      // jamais littéralement dateDebut (voir dateReference ci-dessus).
      "date de début du bail": dateReference,

      "montant loyer précédent locataire": montantLoyerPrecedent ?? VIDE,
      "date de versement loyer précédent locataire": dateVersementLoyerPrecedent ?? VIDE
    };

    const buffer = this.rendreDocument(donneesBalises, {
      clauseResolutoireAvant: regime === "avant_2026_10_01",
      clauseResolutoireApres: regime === "depuis_2026_10_01",
      servitude: servitudeApplicable,
      // Remplacent les 4 lignes à cases à cocher du modèle (type
      // d'habitat/régime juridique de l'immeuble, chauffage/eau chaude de
      // l'appartement) — noms de balises confirmés avec l'utilisateur,
      // à ne plus renommer sans le transmettre au propriétaire.
      collectif: bienRow.typeHabitat === "collectif",
      individuel: bienRow.typeHabitat === "individuel",
      copropriete: bienRow.regimeJuridique === "copropriete",
      monopropriete: bienRow.regimeJuridique === "mono_propriete",
      chauffageIndividuel: appartement.modeChauffage === "individuel",
      chauffageCollectif: appartement.modeChauffage === "collectif",
      eauChaudeIndividuelle: appartement.modeEauChaude === "individuel",
      eauChaudeCollective: appartement.modeEauChaude === "collectif",
      // Section GARANTS SOLIDAIRES + ligne "Acte de caution solidaire" des
      // pièces annexées : un bail sans garant reste valide (donnees-
      // completude.ts ne l'exige jamais) — sans ce drapeau, les deux
      // mentions "caution solidaire" restaient imprimées avec des champs
      // vides plutôt que masquées, un vrai gap constaté sur le bail
      // Ilan Devos (aucun garant).
      aGarant: garantsDuBail.length > 0,
      // "Etat descriptif et inventaire du mobilier" (pièces annexées) :
      // mention meublé uniquement, décision arrêtée avant ce chantier
      // (docs/backlog.md, "Édition d'un bail") — l'inventaire lui-même
      // reste différé au futur module État des lieux, seule cette ligne
      // du bail vide/meublé est concernée ici.
      meuble: bail.typeBail === "meuble",
      // Clause d'extinction de solidarité (art. 8-1, VI, loi n° 89-462) :
      // n'a de sens qu'en cas de colocation réelle (plusieurs locataires
      // effectivement liés au bail), jamais pour un locataire seul.
      colocation: liensLocataires.length > 1,
      // Mention obligatoire loi n° 89-462, art. 3 (loyer du précédent
      // locataire) : deux variantes mutuellement exclusives selon que la
      // date de versement a pu être retrouvée ou non (aucun versement
      // enregistré pour le bail précédent — données antérieures au
      // rapprochement CSV, ou paiement jamais tracé).
      mentionLoyerPrecedentComplete: montantLoyerPrecedent !== null && dateVersementLoyerPrecedent !== null,
      mentionLoyerPrecedentMontantSeul: montantLoyerPrecedent !== null && dateVersementLoyerPrecedent === null,
      // Section XI (annexes) : simple présence, immeuble ou appartement
      // confondus (voir documentsDiagnostics ci-dessus).
      diagnosticDpePresent: categoriesDiagnosticsPresentes.has("dpe"),
      diagnosticElecGazPresent: categoriesDiagnosticsPresentes.has("elec_gaz"),
      diagnosticCrepPresent: categoriesDiagnosticsPresentes.has("crep_plomb"),
      diagnosticErpPresent: categoriesDiagnosticsPresentes.has("erp")
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
    drapeaux: {
      clauseResolutoireAvant: boolean;
      clauseResolutoireApres: boolean;
      servitude: boolean;
      collectif: boolean;
      individuel: boolean;
      copropriete: boolean;
      monopropriete: boolean;
      chauffageIndividuel: boolean;
      chauffageCollectif: boolean;
      eauChaudeIndividuelle: boolean;
      eauChaudeCollective: boolean;
      aGarant: boolean;
      meuble: boolean;
      colocation: boolean;
      mentionLoyerPrecedentComplete: boolean;
      mentionLoyerPrecedentMontantSeul: boolean;
      diagnosticDpePresent: boolean;
      diagnosticElecGazPresent: boolean;
      diagnosticCrepPresent: boolean;
      diagnosticErpPresent: boolean;
    }
  ): Buffer {
    const contenu = readFileSync(this.templatePath, "binary");
    const zip = new PizZip(contenu);
    const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    document.render({ ...donneesBalises, ...drapeaux });
    return document.getZip().generate({ type: "nodebuffer" }) as Buffer;
  }
}
