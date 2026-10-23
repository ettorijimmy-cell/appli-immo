import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";

export interface CompteurFenetreFixe {
  echecs: number;
  debutFenetre: number;
}

export interface ResultatControleLogin {
  bloque: boolean;
  retryAfterSeconds: number;
}

export const FENETRE_LIMITATION_MS = 15 * 60 * 1000;
export const SEUIL_ECHECS_IP = 5;
export const SEUIL_ECHECS_EMAIL = 10;

export function normaliserEmail(email: string): string {
  return email.toLowerCase().replace(/\s+/g, "");
}

// Masquage pour les logs (jamais l'e-mail en clair, jamais le mot de
// passe sous aucune forme) : première lettre de la partie locale + "***"
// + le domaine en clair (utile pour distinguer en un coup d'œil "un
// attaquant cible un domaine précis" sans exposer l'identité complète).
export function masquerEmail(emailNormalise: string): string {
  const indexArobase = emailNormalise.indexOf("@");
  if (indexArobase <= 0) {
    return "***";
  }
  return `${emailNormalise[0]}***${emailNormalise.slice(indexArobase)}`;
}

// Fenêtre FIXE (pas glissante) : un compteur par clé, remis à 1 dès que
// 15 minutes se sont écoulées depuis l'ouverture de la fenêtre — pas un
// journal d'horodatages par tentative. Compromis volontaire : une fenêtre
// glissante empêcherait un sursaut jusqu'à 2x le seuil à la frontière
// entre deux fenêtres fixes consécutives, mais ce risque est accepté ici
// — la cible est un script naïf qui boucle, pas un attaquant qui
// chronomètre précisément la fenêtre. En échange : une seule paire
// {echecs, debutFenetre} par clé (jamais un tableau qui grossit avec le
// nombre de tentatives), logique de test et de nettoyage triviale.
export function incrementerCompteur(compteur: CompteurFenetreFixe | undefined, maintenant: number): CompteurFenetreFixe {
  if (!compteur || maintenant - compteur.debutFenetre >= FENETRE_LIMITATION_MS) {
    return { echecs: 1, debutFenetre: maintenant };
  }
  return { echecs: compteur.echecs + 1, debutFenetre: compteur.debutFenetre };
}

export function secondesAvantDeblocage(
  compteur: CompteurFenetreFixe | undefined,
  seuil: number,
  maintenant: number
): number {
  if (!compteur) {
    return 0;
  }
  if (maintenant - compteur.debutFenetre >= FENETRE_LIMITATION_MS) {
    return 0;
  }
  if (compteur.echecs < seuil) {
    return 0;
  }
  return Math.ceil((compteur.debutFenetre + FENETRE_LIMITATION_MS - maintenant) / 1000);
}

export function entreeExpiree(compteur: CompteurFenetreFixe, maintenant: number): boolean {
  return maintenant - compteur.debutFenetre >= FENETRE_LIMITATION_MS;
}

/**
 * Limitation maison des tentatives de connexion — volontairement pas
 * @nestjs/throttler : deux axes indépendants (IP et e-mail visé) avec une
 * sémantique métier propre (remise à zéro uniquement côté IP sur succès,
 * voir enregistrerSucces) que la lib générique ne couvre pas nativement
 * sans configuration disproportionnée pour ce besoin ponctuel.
 *
 * Limites connues, acceptées pour un usage personnel :
 * - stockage 100% en mémoire (deux Map) : perdu à CHAQUE redémarrage du
 *   process, y compris la mise en veille après inactivité des Scaleway
 *   Serverless Containers (scale-to-zero) — pas seulement un déploiement.
 *   Un attaquant qui attend (ou provoque indirectement) cette mise en
 *   veille repart avec un budget neuf ;
 * - un tiers connaissant l'adresse e-mail du propriétaire peut le
 *   bloquer pendant 15 minutes en multipliant les échecs depuis
 *   plusieurs IP (axe e-mail) — accepté : usage personnel, pas un
 *   service public à fort enjeu de disponibilité.
 */
@Injectable()
export class LimitationTentativesConnexionService {
  private readonly logger = new Logger("Auth");
  private readonly parIp = new Map<string, CompteurFenetreFixe>();
  private readonly parEmail = new Map<string, CompteurFenetreFixe>();

  // Contrôle ET réservation en UN SEUL appel synchrone (aucun `await` entre
  // la lecture des seuils et l'écriture ci-dessous) : appelé AVANT toute
  // vérification de mot de passe (voir AuthController). Nécessaire parce
  // que Node exécute le corps d'une fonction async de façon synchrone
  // jusqu'à son premier `await` — si la lecture et l'incrémentation
  // étaient séparées par un `await authService.validateUser(...)` (comme
  // dans une version antérieure de ce fichier), N requêtes lancées en
  // parallèle liraient TOUTES "pas encore bloqué" avant qu'aucune n'ait
  // incrémenté quoi que ce soit — la limite de 5 se contournerait en
  // envoyant un lot simultané. En regroupant lecture et écriture dans un
  // seul appel sans point de suspension, chaque appel s'exécute en entier
  // avant que le suivant ne commence (modèle de concurrence coopératif de
  // Node) : la réservation est atomique de fait, sans verrou explicite.
  //
  // La réservation incrémente les DEUX compteurs en anticipant un échec ;
  // si l'appelant constate ensuite un succès, enregistrerSucces() annule
  // partiellement cette anticipation (remise à zéro IP, décrément de 1
  // côté e-mail) — voir ce commentaire.
  reserverTentative(ip: string, email: string): ResultatControleLogin {
    const emailNormalise = normaliserEmail(email);
    const maintenant = Date.now();

    const compteurIpActuel = this.parIp.get(ip);
    const compteurEmailActuel = this.parEmail.get(emailNormalise);

    const retryIp = secondesAvantDeblocage(compteurIpActuel, SEUIL_ECHECS_IP, maintenant);
    const retryEmail = secondesAvantDeblocage(compteurEmailActuel, SEUIL_ECHECS_EMAIL, maintenant);
    const retryAfterSeconds = Math.max(retryIp, retryEmail);

    if (retryAfterSeconds > 0) {
      const axes = [retryIp > 0 ? "IP" : null, retryEmail > 0 ? "e-mail" : null].filter(Boolean).join("+");
      this.logger.warn(`POST /auth/login bloqué (${axes}) — ip=${ip} email=${masquerEmail(emailNormalise)}`);
      return { bloque: true, retryAfterSeconds };
    }

    this.parIp.set(ip, incrementerCompteur(compteurIpActuel, maintenant));
    this.parEmail.set(emailNormalise, incrementerCompteur(compteurEmailActuel, maintenant));
    return { bloque: false, retryAfterSeconds: 0 };
  }

  // Appelé uniquement sur un succès de connexion : reserverTentative a déjà
  // compté cette tentative comme un échec potentiel (voir ci-dessus) — ici
  // on corrige après coup. IP : remise à zéro complète (volontairement
  // différent de l'axe e-mail ci-dessous — un succès depuis cette IP
  // précise innocente entièrement cette IP). E-mail : décrément de 1
  // seulement, jamais une remise à zéro — si un attaquant martèle cet
  // e-mail depuis d'autres IP pendant que son vrai titulaire se connecte
  // avec succès depuis la sienne, le succès du titulaire ne doit pas
  // effacer la pression déjà accumulée côté e-mail par l'attaquant.
  enregistrerSucces(ip: string, email: string): void {
    this.parIp.delete(ip);

    const emailNormalise = normaliserEmail(email);
    const compteur = this.parEmail.get(emailNormalise);
    if (!compteur) {
      return;
    }
    if (compteur.echecs <= 1) {
      this.parEmail.delete(emailNormalise);
      return;
    }
    this.parEmail.set(emailNormalise, { echecs: compteur.echecs - 1, debutFenetre: compteur.debutFenetre });
  }

  // Nettoyage périodique : une entrée dont la fenêtre est expirée mais
  // jamais retouchée depuis (IP/e-mail qui n'a plus retenté) resterait en
  // mémoire indéfiniment sinon — reserverTentative ne la retire pas tant
  // que sa clé précise n'est pas sollicitée à nouveau.
  @Cron(CronExpression.EVERY_10_MINUTES)
  nettoyerEntreesExpirees(): void {
    const maintenant = Date.now();
    for (const [cle, compteur] of this.parIp) {
      if (entreeExpiree(compteur, maintenant)) {
        this.parIp.delete(cle);
      }
    }
    for (const [cle, compteur] of this.parEmail) {
      if (entreeExpiree(compteur, maintenant)) {
        this.parEmail.delete(cle);
      }
    }
  }
}
