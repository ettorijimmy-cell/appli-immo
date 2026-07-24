# Intégrations

Référence opérationnelle des services externes. Le raisonnement et la
comparaison des alternatives sont dans l'historique de conception ; ce
document consigne uniquement ce qui est nécessaire pour configurer et
déboguer chaque intégration au fil du développement.

## Scaleway — infrastructure

| | |
|---|---|
| Usage | Base PostgreSQL managée, Object Storage, hébergement backend |
| Région | Paris (fr-par) |
| Documentation | https://www.scaleway.com/en/docs/ |
| Variables d'environnement | `DATABASE_URL`, `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_BUCKET_NAME` |
| Point de vigilance | La réplication logique (`wal_level=logical`, requise par PowerSync) doit être activée explicitement via les paramètres avancés de l'instance — vérifier à la création, ne pas supposer que c'est actif par défaut |
| Secrets | Stockés via Scaleway Secret Manager, jamais en `.env` versionné |

## PowerSync — synchronisation

| | |
|---|---|
| Usage | Synchronisation SQLite local (Electron) ↔ Postgres cloud |
| Documentation | https://docs.powersync.com |
| SDK utilisé | SDK Node.js (processus principal Electron) — pas le SDK web, pas le SDK Tauri |
| Sync Rules | Définies dans le tableau de bord PowerSync ; en MVP mono-utilisateur, règle unique : toutes les données rattachées aux organisations de l'utilisateur connecté |
| Chiffrement local | SQLite3MultipleCiphers activé — voir docs/app-spec.md section Sécurité |
| Palier tarifaire | Gratuit sous 2 Go de données synchronisées/mois — largement suffisant à l'échelle actuelle, à surveiller si évolution SaaS |

## API Claude (Anthropic) — IA

| | |
|---|---|
| Usage | Module IA (post-MVP) — lecture de documents, rédaction, analyse |
| SDK | SDK TypeScript officiel Anthropic |
| Règle absolue | Appelé exclusivement depuis apps/backend, jamais depuis apps/desktop |
| Variables d'environnement | `ANTHROPIC_API_KEY` (backend uniquement, jamais exposée au client) |
| Point de vigilance | Vérifier les conditions contractuelles applicables au traitement de données personnelles avant mise en production de ce module (voir docs/app-spec.md, Phase 8 sécurité) |

## Gmail API — emails (post-MVP)

| | |
|---|---|
| Usage | Envoi de quittances et relances, module post-MVP |
| Authentification | OAuth2, compte Gmail de l'utilisateur (pas un service transactionnel tiers) |
| Documentation | https://developers.google.com/gmail/api |
| Point de vigilance | Gestion du rafraîchissement de jeton à prévoir dès la conception du module — historiquement une source de bugs silencieux |

---

## Journal des incidents d'intégration

(À compléter au fil du développement — un incident lié à une intégration
externe spécifiquement, distinct du journal d'erreur général.)

| Date | Service | Symptôme | Résolution |
|---|---|---|---|
| — | — | — | — |
