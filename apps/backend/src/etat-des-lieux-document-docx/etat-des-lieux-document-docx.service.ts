import { readFileSync } from "fs";
import path from "path";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  calculerStatutEtatDesLieux,
  formaterListeNoms,
  trouverBalisesDesequilibrees,
  validerCompletudeEtatDesLieux,
  type DonneesCompletudeEtatDesLieuxAppartement
} from "core";
import {
  appartements,
  bailLocataires,
  baux,
  elementsInventaireMeuble,
  equipements,
  immeubles,
  locataires,
  scis,
  type Database
} from "db";
import Docxtemplater from "docxtemplater";
import { and, eq, isNull } from "drizzle-orm";
import ImageModule from "docxtemplater-image-module-free";
import PizZip from "pizzip";
import sharp from "sharp";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentsService } from "../documents/documents.service";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";

// Vide si non renseigné — même convention que BailDocumentDocxService,
// jamais "undefined"/"null" littéral dans le document final.
const VIDE = "";

// U+00A0 (espace insécable) avant le ";" — typographie française présente
// littéralement dans les deux noms de balise du modèle réel (vérifié
// caractère par caractère sur tmp/Modèle état des lieux.docx). Une
// espace normale ne matcherait pas.
const NBSP = " ";
const TAG_ENERGIE_CHAUFFAGE = `Type de chauffage${NBSP}; gaz, elec ou les deux`;
const TAG_ENERGIE_EAU_CHAUDE = `Type de chauffage${NBSP}; gaz, elec`;

const LABEL_TYPE_ENERGIE: Record<string, string> = {
  electrique: "Électrique",
  gaz: "Gaz",
  les_deux: "Gaz et électricité"
};

const LARGEUR_PHOTO_CIBLE_PX = 180;

// Ordre d'affichage des catégories dans l'inventaire meublé — doit
// correspondre à l'ordre de tri Postgres de l'enum (déclaration order,
// voir elementInventaireMeubleCategorieEnum), déjà utilisé par la requête
// ORDER BY categorie plus bas.
const ORDRE_CATEGORIES_INVENTAIRE = ["meuble", "electromenager", "vaisselle_linge"] as const;
const LABEL_CATEGORIE_INVENTAIRE: Record<(typeof ORDRE_CATEGORIES_INVENTAIRE)[number], string> = {
  meuble: "MEUBLES",
  electromenager: "ÉLECTRO-MÉNAGER",
  // "ÉQUIPEMENT 1"/"ÉQUIPEMENT 2" du modèle réel fusionnés : simple
  // artefact de mise en page à l'impression, sans signification métier.
  vaisselle_linge: "ÉQUIPEMENT"
};

type EtatInventaireValeur = "bon" | "dusage" | "mauvais" | null | undefined;
type PieceRow = Record<string, unknown> | null;

function formaterAdresse(adresse: string | null, codePostal: string | null, ville: string | null): string {
  const cpVille = [codePostal, ville].filter((p) => p && p.length > 0).join(" ");
  const parties = [adresse, cpVille].filter((p) => p && p.length > 0);
  return parties.length > 0 ? parties.join(", ") : VIDE;
}

function labelTypeEnergie(valeur: string | null): string {
  return valeur ? (LABEL_TYPE_ENERGIE[valeur] ?? VIDE) : VIDE;
}

// prefix vide (pièces en boucle : chambres/SdB/WC/autres, portée déjà
// isolée par l'instance de boucle) => clé = nomBase tel quel
// ("murDescription"). prefix non vide (pièces uniques au niveau racine du
// document : entrée/séjour/cuisine, PAS de portée de boucle) => clé
// préfixée avec nomBase capitalisé ("entreeMurDescription") pour éviter
// toute collision entre les 3 sections au même niveau racine — bug
// constaté et corrigé en amont sur le bloc photos (voir
// docs/error-log.md).
function cle(prefix: string, nomBase: string, suffixe: string): string {
  if (!prefix) {
    return `${nomBase}${suffixe}`;
  }
  return `${prefix}${nomBase[0]!.toUpperCase()}${nomBase.slice(1)}${suffixe}`;
}

function ajouterElement(cible: Record<string, unknown>, prefix: string, nomBase: string, row: PieceRow): void {
  cible[cle(prefix, nomBase, "Description")] = (row?.[`${nomBase}Description`] as string | null) ?? VIDE;
  cible[cle(prefix, nomBase, "EtatEntree")] = (row?.[`${nomBase}EtatEntree`] as string | null) ?? VIDE;
  cible[cle(prefix, nomBase, "EtatSortie")] = (row?.[`${nomBase}EtatSortie`] as string | null) ?? VIDE;
}

const ELEMENTS_SOCLE = ["mur", "sol", "vitrageVolets", "plafond", "eclairage"] as const;

// Éléments communs à toutes les pièces du modèle réel (packages/db,
// etat-des-lieux-pieces.ts) : murs, sol, vitrage/volets, plafond,
// éclairage, prises (+ son nombre, seul élément à porter une valeur
// numérique en plus de description/état).
function ajouterSocle(cible: Record<string, unknown>, prefix: string, row: PieceRow): void {
  for (const nomBase of ELEMENTS_SOCLE) {
    ajouterElement(cible, prefix, nomBase, row);
  }
  ajouterElement(cible, prefix, "prises", row);
  cible[cle(prefix, "prises", "Nombre")] = (row?.["prisesNombre"] as number | null)?.toString() ?? VIDE;
}

// Échelle Bon/D'usage/Mauvais (inventaire meublé + équipements divers) :
// 3 colonnes à cocher d'une croix "X", pas une lettre comme M/P/B/TB des
// pièces — le modèle réel imprime 3 colonnes séparées par état possible.
function xmarks(etat: EtatInventaireValeur, suffixe: "Entree" | "Sortie"): Record<string, string> {
  return {
    [`bon${suffixe}`]: etat === "bon" ? "X" : VIDE,
    [`dusage${suffixe}`]: etat === "dusage" ? "X" : VIDE,
    [`mauvais${suffixe}`]: etat === "mauvais" ? "X" : VIDE
  };
}

// Force à vide toute clé contenant "Sortie" (y compris dans les objets
// imbriqués des tableaux en boucle) quand la colonne sortie n'est pas
// applicable (date_sortie absente) — document unique à contenu adaptatif,
// décision actée avec le propriétaire. Filet de sécurité appliqué en une
// seule fois plutôt que de fiabiliser chaque mapping individuellement :
// même si une valeur de sortie existait par erreur en base sans
// date_sortie renseignée, elle n'apparaît jamais dans le document.
function viderChampsSortie(valeur: unknown): void {
  if (Array.isArray(valeur)) {
    for (const item of valeur) {
      viderChampsSortie(item);
    }
    return;
  }
  if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
      if (typeof v === "object" && v !== null) {
        viderChampsSortie(v);
      } else if (/Sortie/.test(k)) {
        (valeur as Record<string, unknown>)[k] = VIDE;
      }
    }
  }
}

interface ImageEntree {
  buffer: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class EtatDesLieuxDocumentDocxService {
  private readonly templatePath: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly etatsDesLieuxService: EtatsDesLieuxService,
    private readonly documentsService: DocumentsService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    config: ConfigService
  ) {
    this.templatePath =
      config.get<string>("ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH") ??
      path.join(process.cwd(), "..", "..", "tmp", "Modèle état des lieux.docx");
  }

  async genererDocumentEtatDesLieuxDocx(etatDesLieuxId: string): Promise<Buffer> {
    // Garde-fou avant toute génération : un modèle Word édité à la main
    // par le propriétaire peut perdre une balise de boucle par
    // inadvertance (déjà arrivé en pratique — {/meublé} disparu lors
    // d'une édition, voir docs/error-log.md) et produire silencieusement
    // un document au contenu faux (docxtemplater n'y voit parfois que du
    // feu selon l'endroit de la coupure). Comptage simple des
    // ouvertures/fermetures par nom de bloc, avant toute requête base de
    // données.
    this.verifierIntegriteTemplate();

    const donnees = await this.etatsDesLieuxService.findById(etatDesLieuxId);
    if (!donnees) {
      throw new NotFoundException("État des lieux introuvable");
    }

    const [bail] = await this.db.select().from(baux).where(eq(baux.id, donnees.bailId)).limit(1);
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
      .where(and(eq(bailLocataires.bailId, bail.id), isNull(bailLocataires.archivedAt)));
    const locatairesDuBail = (
      await Promise.all(
        liensLocataires
          .sort((a, b) => (a.role === b.role ? 0 : a.role === "titulaire" ? -1 : 1))
          .map(async (lien) => {
            const [locataire] = await this.db
              .select()
              .from(locataires)
              .where(eq(locataires.id, lien.locataireId))
              .limit(1);
            return locataire;
          })
      )
    ).filter((l): l is NonNullable<typeof l> => l !== undefined);

    // Étape obligatoire AVANT toute génération, jamais de génération
    // partielle : liste complète des blocages en un seul appel, pas
    // seulement le premier trouvé (même principe que
    // validerCompletudeGenerationBail côté bail).
    const donneesCompletude: DonneesCompletudeEtatDesLieuxAppartement = {
      nombreChambres: appartement.nombreChambres,
      nombreSallesDeBain: appartement.nombreSallesDeBain,
      nombreWc: appartement.nombreWc
    };
    const champsManquants = validerCompletudeEtatDesLieux(donneesCompletude);
    const statut = calculerStatutEtatDesLieux(donnees.dateEntree, donnees.dateSortie);
    if (statut === "non_commence") {
      champsManquants.push("L'entrée doit être terminée (date d'entrée renseignée) avant de générer le document");
    }
    if (champsManquants.length > 0) {
      throw new BadRequestException({
        // Liste inline dans le message (pas seulement dans
        // champsManquants) : contrairement au bail, ce document a un
        // vrai bouton de génération côté desktop dont l'unique canal
        // d'erreur vers l'utilisateur est ApiError.message (voir
        // authenticatedFetchBlob/extraireMessageErreur, apps/desktop) —
        // même principe que EtatsDesLieuxService.create.
        message: `Génération impossible : ${champsManquants.join(", ")}`,
        champsManquants
      });
    }

    const avecSortie = donnees.dateSortie !== null;

    // Photos : réutilise DocumentsService (jamais de déchiffrement en
    // dehors du point unique déjà en place, CLAUDE.md) — chaque
    // téléchargement consigne déjà son propre accès dans journal_audit
    // (DocumentsService.telecharger). Redressement EXIF + réencodage en
    // PNG (bug connu du module gratuit : nom de fichier généré toujours
    // "image_generated_N.png" quel que soit le contenu réel — voir
    // docs/backlog.md, test du 2026-08-02).
    const photosMeta = await this.documentsService.findAll({
      entiteType: "etat_des_lieux",
      entiteId: etatDesLieuxId,
      categorie: "photo"
    });
    const images = new Map<string, ImageEntree>();
    await Promise.all(
      photosMeta.map(async (doc) => {
        const { contenu } = await this.documentsService.telecharger(doc.id);
        const reencode = await sharp(contenu)
          .rotate()
          .resize({ width: 1600, withoutEnlargement: true })
          .png()
          .toBuffer();
        const meta = await sharp(reencode).metadata();
        images.set(doc.id, { buffer: reencode, width: meta.width ?? 1, height: meta.height ?? 1 });
      })
    );
    function idsPhotos(type: string, numero: number | null): string[] {
      return photosMeta
        .filter((p) => p.etatDesLieuxPieceType === type && p.etatDesLieuxPieceNumero === numero)
        .map((p) => p.id);
    }

    // Nombre réel de chaudières/chauffe-eau déclarés sur la fiche
    // appartement (Module 2) — calculé à chaque génération, jamais
    // stocké : les lignes "Chaudière"/"Chauffe-eau" du modèle réel sont
    // du texte libre, sans lien vers equipements ; ce comptage comble
    // l'écart sans dupliquer la donnée. Seuls les équipements actifs
    // (non archivés) sont comptés — décision actée avec l'utilisateur :
    // le nombre seul (pas de mention "voir Équipements" sur le papier,
    // déjà présente dans la vue desktop via le lien cliquable).
    const equipementsActifs = await this.db
      .select({ type: equipements.type })
      .from(equipements)
      .where(and(eq(equipements.appartementId, appartement.id), isNull(equipements.archivedAt)));
    const nombreChaudieres = equipementsActifs.filter((e) => e.type === "chaudiere").length;
    const nombreBallonsEauChaude = equipementsActifs.filter((e) => e.type === "ballon_eau_chaude").length;

    // Catalogue complet (~85 postes) : chaque poste est imprimé, avec ou
    // sans ligne saisie — même principe que la vue de relecture desktop
    // (InventaireSection.tsx), pas seulement les postes effectivement
    // renseignés.
    const catalogue =
      bail.typeBail === "meuble"
        ? await this.db
            .select()
            .from(elementsInventaireMeuble)
            .orderBy(elementsInventaireMeuble.categorie, elementsInventaireMeuble.ordreAffichage)
        : [];
    const inventaireParElementId = new Map(donnees.inventaire.map((l) => [l.elementId, l]));

    const champsEntree: Record<string, unknown> = {};
    ajouterSocle(champsEntree, "entree", donnees.entree);
    ajouterElement(champsEntree, "entree", "porte", donnees.entree);
    ajouterElement(champsEntree, "entree", "sonnette", donnees.entree);

    const champsSejour: Record<string, unknown> = {};
    ajouterSocle(champsSejour, "sejour", donnees.sejour);

    const champsCuisine: Record<string, unknown> = {};
    ajouterSocle(champsCuisine, "cuisine", donnees.cuisine);
    ajouterElement(champsCuisine, "cuisine", "placards", donnees.cuisine);
    ajouterElement(champsCuisine, "cuisine", "evier", donnees.cuisine);
    ajouterElement(champsCuisine, "cuisine", "plaquesCuisson", donnees.cuisine);
    ajouterElement(champsCuisine, "cuisine", "hotte", donnees.cuisine);
    champsCuisine["cuisineElectromenagerDescription"] =
      (donnees.cuisine?.["electromenagerDescription"] as string | null) ?? VIDE;

    const chambres = donnees.chambres.map((row) => {
      const champs: Record<string, unknown> = { titre: `Chambre ${row.numero}` };
      ajouterSocle(champs, "", row);
      champs["photos"] = idsPhotos("chambre", row.numero as number);
      return champs;
    });

    const sallesDeBain = donnees.sallesDeBain.map((row) => {
      const champs: Record<string, unknown> = { titre: `Salle de bain ${row.numero}` };
      ajouterSocle(champs, "", row);
      ajouterElement(champs, "", "lavabo", row);
      ajouterElement(champs, "", "baignoire", row);
      champs["photos"] = idsPhotos("salle_de_bain", row.numero as number);
      return champs;
    });

    const wc = donnees.wc.map((row) => {
      const champs: Record<string, unknown> = { titre: `WC ${row.numero}` };
      ajouterSocle(champs, "", row);
      ajouterElement(champs, "", "lavabo", row);
      ajouterElement(champs, "", "wc", row);
      champs["photos"] = idsPhotos("wc", row.numero as number);
      return champs;
    });

    const autres = donnees.autres.map((row) => {
      const champs: Record<string, unknown> = { titre: (row.libelle as string) ?? VIDE };
      ajouterSocle(champs, "", row);
      champs["photos"] = idsPhotos("autre", row.numero as number);
      return champs;
    });

    const equipementsDivers = donnees.equipementsDivers.map((ligne) => ({
      libelle: ligne.libelle,
      nombreEntree: ligne.nombreEntree?.toString() ?? VIDE,
      ...xmarks(ligne.etatEntree, "Entree"),
      nombreSortie: ligne.nombreSortie?.toString() ?? VIDE,
      ...xmarks(ligne.etatSortie, "Sortie"),
      commentaire: ligne.commentaire ?? VIDE
    }));

    // Rupture visuelle entre catégories (MEUBLES / ÉLECTRO-MÉNAGER /
    // ÉQUIPEMENT) — présente dans le modèle original du propriétaire
    // (en-têtes "ÉLECTRO-MÉNAGER", "ÉQUIPEMENT 1"/"ÉQUIPEMENT 2"), perdue
    // lors de la consolidation en un tableau continu (fragment Inventaire
    // meublé). Réintroduite comme une ligne de titre grisée par
    // changement de catégorie dans le tableau unique — pas la mise en
    // page en deux colonnes d'origine (écartée), juste un repère
    // textuel. "ÉQUIPEMENT 1"/"ÉQUIPEMENT 2" fusionnés en un seul intitulé
    // "ÉQUIPEMENT" : simple artefact de mise en page à l'impression, sans
    // signification métier (packages/db, elements-inventaire-meuble.ts).
    const sections = ORDRE_CATEGORIES_INVENTAIRE.map((categorie) => ({
      titreSection: LABEL_CATEGORIE_INVENTAIRE[categorie],
      lignes: catalogue
        .filter((item) => item.categorie === categorie)
        .map((item) => {
          const ligne = inventaireParElementId.get(item.id);
          return {
            libelle: item.libelle,
            nombreEntree: ligne?.nombreEntree?.toString() ?? VIDE,
            ...xmarks(ligne?.etatEntree, "Entree"),
            nombreSortie: ligne?.nombreSortie?.toString() ?? VIDE,
            ...xmarks(ligne?.etatSortie, "Sortie"),
            commentaire: ligne?.commentaire ?? VIDE
          };
        })
    })).filter((section) => section.lignes.length > 0);

    // Clés : 6 types fixes + jusqu'à 2 lignes "autre" (libellé libre) —
    // même règle que ClesSection.tsx côté desktop. Ordre des "autre" par
    // date de création, déterministe (aucun ordinal explicite en base).
    const PREFIX_CLE_FIXE: Record<string, string> = {
      immeuble: "clesImmeuble",
      porte_entree: "clesPorteEntree",
      boite_lettres: "clesBoiteLettres",
      cave: "clesCave",
      badge_portail: "clesBadgePortail",
      parking: "clesParking"
    };
    const champsCles: Record<string, unknown> = {};
    for (const [typeCle, prefix] of Object.entries(PREFIX_CLE_FIXE)) {
      const ligne = donnees.cles.find((c) => c.typeCle === typeCle);
      champsCles[`${prefix}NombreEntree`] = ligne?.nombreEntree?.toString() ?? VIDE;
      champsCles[`${prefix}NombreSortie`] = ligne?.nombreSortie?.toString() ?? VIDE;
      champsCles[`${prefix}Commentaire`] = ligne?.commentaire ?? VIDE;
    }
    const clesAutres = donnees.cles
      .filter((c) => c.typeCle === "autre")
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
      .slice(0, 2);
    for (let i = 0; i < 2; i++) {
      const ligne = clesAutres[i];
      const prefix = `clesAutre${i + 1}`;
      champsCles[`${prefix}Libelle`] = ligne?.libelleAutre ?? VIDE;
      champsCles[`${prefix}NombreEntree`] = ligne?.nombreEntree?.toString() ?? VIDE;
      champsCles[`${prefix}NombreSortie`] = ligne?.nombreSortie?.toString() ?? VIDE;
      champsCles[`${prefix}Commentaire`] = ligne?.commentaire ?? VIDE;
    }

    const donneesBalises: Record<string, unknown> = {
      "Nom de la SCI": sci.nom,
      "Adresse de la SCI": formaterAdresse(sci.adresse, sci.codePostal, sci.ville),
      "Adresse de l’appartement": formaterAdresse(immeuble.adresse, immeuble.codePostal, immeuble.ville),
      "Nom prénom du locataire": formaterListeNoms(locatairesDuBail.map((l) => `${l.prenom} ${l.nom}`)),

      "Date début bail": donnees.dateEntree ?? VIDE,
      "Date de résiliation": donnees.dateSortie ?? VIDE,

      "mode chauffage collectif ou individuel": appartement.modeChauffage ?? VIDE,
      "mode eau chaude collectif ou individuel": appartement.modeEauChaude ?? VIDE,
      [TAG_ENERGIE_CHAUFFAGE]: labelTypeEnergie(appartement.typeEnergie),
      [TAG_ENERGIE_EAU_CHAUDE]: labelTypeEnergie(appartement.typeEnergie),
      chaudiereNombreDeclare: nombreChaudieres.toString(),
      chauffeEauNombreDeclare: nombreBallonsEauChaude.toString(),

      ...champsEntree,
      ...champsSejour,
      ...champsCuisine,
      photosEntree: idsPhotos("entree", null),
      photosSejour: idsPhotos("sejour", null),
      photosCuisine: idsPhotos("cuisine", null),

      ...(donnees.compteurs
        ? {
            electriciteNumeroCompteurEntree: donnees.compteurs.electriciteNumeroCompteurEntree ?? VIDE,
            electriciteNumeroCompteurSortie: donnees.compteurs.electriciteNumeroCompteurSortie ?? VIDE,
            electriciteReleveHpEntree: donnees.compteurs.electriciteReleveHpEntree ?? VIDE,
            electriciteReleveHpSortie: donnees.compteurs.electriciteReleveHpSortie ?? VIDE,
            electriciteReleveHcEntree: donnees.compteurs.electriciteReleveHcEntree ?? VIDE,
            electriciteReleveHcSortie: donnees.compteurs.electriciteReleveHcSortie ?? VIDE,
            electriciteAncienOccupantEntree: donnees.compteurs.electriciteAncienOccupantEntree ?? VIDE,
            electriciteAncienOccupantSortie: donnees.compteurs.electriciteAncienOccupantSortie ?? VIDE,
            gazNumeroCompteurEntree: donnees.compteurs.gazNumeroCompteurEntree ?? VIDE,
            gazNumeroCompteurSortie: donnees.compteurs.gazNumeroCompteurSortie ?? VIDE,
            gazReleveEntree: donnees.compteurs.gazReleveEntree ?? VIDE,
            gazReleveSortie: donnees.compteurs.gazReleveSortie ?? VIDE,
            eauReleveFroideEntree: donnees.compteurs.eauReleveFroideEntree ?? VIDE,
            eauReleveFroideSortie: donnees.compteurs.eauReleveFroideSortie ?? VIDE,
            eauReleveChaudeEntree: donnees.compteurs.eauReleveChaudeEntree ?? VIDE,
            eauReleveChaudeSortie: donnees.compteurs.eauReleveChaudeSortie ?? VIDE
          }
        : {
            electriciteNumeroCompteurEntree: VIDE,
            electriciteNumeroCompteurSortie: VIDE,
            electriciteReleveHpEntree: VIDE,
            electriciteReleveHpSortie: VIDE,
            electriciteReleveHcEntree: VIDE,
            electriciteReleveHcSortie: VIDE,
            electriciteAncienOccupantEntree: VIDE,
            electriciteAncienOccupantSortie: VIDE,
            gazNumeroCompteurEntree: VIDE,
            gazNumeroCompteurSortie: VIDE,
            gazReleveEntree: VIDE,
            gazReleveSortie: VIDE,
            eauReleveFroideEntree: VIDE,
            eauReleveFroideSortie: VIDE,
            eauReleveChaudeEntree: VIDE,
            eauReleveChaudeSortie: VIDE
          }),
      ...champsCles,

      chambres,
      sallesDeBain,
      wc,
      autres,
      equipementsDivers,
      sections,
      meublé: bail.typeBail === "meuble"
    };

    if (!avecSortie) {
      viderChampsSortie(donneesBalises);
    }

    const utilisateurId = this.requestContext.getUtilisateurId();
    const buffer = this.rendreDocument(donneesBalises, images);

    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "etat_des_lieux_document_genere",
        entiteId: etatDesLieuxId,
        utilisateurId
      });
    }

    return buffer;
  }

  // Comptage simple des balises {#nom}/{/nom} du modèle — bloque la
  // génération si un nom de bloc n'a pas le même nombre d'ouvertures et
  // de fermetures, avant de produire quoi que ce soit. Le texte est
  // reconstruit à partir des <w:t> du document XML CONCATÉNÉS SANS
  // séparateur (pas texteDuDocx-style avec espaces) : Word scinde parfois
  // une balise entre plusieurs runs (ex. {/meublé} en 3 runs distincts,
  // "{/meubl" + "é" + "}"), un simple regex sur le XML brut la manquerait.
  private verifierIntegriteTemplate(): void {
    const contenu = readFileSync(this.templatePath, "binary");
    const zip = new PizZip(contenu);
    const documentXml = zip.file("word/document.xml")?.asText();
    if (!documentXml) {
      throw new Error("word/document.xml introuvable dans le modèle — fichier corrompu.");
    }
    const texte = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    const desequilibres = trouverBalisesDesequilibrees(texte);
    if (desequilibres.length > 0) {
      const messages = desequilibres.map((d) =>
        d.ouvertures > d.fermetures
          ? `{/${d.nom}} manquant ou en surnombre`
          : `{#${d.nom}} manquant ou en surnombre`
      );
      throw new BadRequestException(`Le modèle est corrompu : ${messages.join(", ")}`);
    }
  }

  private rendreDocument(donneesBalises: Record<string, unknown>, images: Map<string, ImageEntree>): Buffer {
    const contenu = readFileSync(this.templatePath, "binary");
    const zip = new PizZip(contenu);
    const imageModule = new ImageModule({
      centered: false,
      getImage: (tagValue: string) => {
        const image = images.get(tagValue);
        if (!image) {
          throw new Error(`Photo introuvable pour la clé ${tagValue}`);
        }
        return image.buffer;
      },
      getSize: (_img: unknown, tagValue: string) => {
        const image = images.get(tagValue);
        if (!image) {
          return [LARGEUR_PHOTO_CIBLE_PX, LARGEUR_PHOTO_CIBLE_PX];
        }
        return [LARGEUR_PHOTO_CIBLE_PX, Math.round((LARGEUR_PHOTO_CIBLE_PX * image.height) / image.width)];
      }
    });
    const document = new Docxtemplater(zip, {
      modules: [imageModule],
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => VIDE
    });
    document.render(donneesBalises);
    return document.getZip().generate({ type: "nodebuffer" }) as Buffer;
  }
}
