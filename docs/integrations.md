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
| Variables d'environnement | `DATABASE_URL`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET_NAME` (nommage sans préfixe `SCW_`, réservé par la plateforme — voir docs/error-log.md, [2026-08-11]) |
| Point de vigilance | La réplication logique (`wal_level=logical`, requise par PowerSync) doit être activée explicitement via les paramètres avancés de l'instance — vérifier à la création, ne pas supposer que c'est actif par défaut |
| Secrets | Stockés via Scaleway Secret Manager, jamais en `.env` versionné |

## PowerSync — synchronisation

| | |
|---|---|
| Usage | Synchronisation SQLite local (Electron) ↔ Postgres cloud |
| Documentation | https://docs.powersync.com |
| SDK utilisé | SDK Node.js (processus principal Electron) — pas le SDK web, pas le SDK Tauri |
| Sync Streams | Définies dans le tableau de bord PowerSync (YAML, `config: edition: 3` / `streams:`) ; mécanisme recommandé par PowerSync pour tout nouveau projet — Sync Rules (terminologie initiale de ce document) est désormais qualifié de legacy. Requête de chaque stream toujours à colonnes explicites, jamais `SELECT *` (voir docs/data-dictionary.md, section Authentification et autorisation) ; en MVP mono-utilisateur, portée par stream : toutes les données rattachées aux organisations de l'utilisateur connecté (`auth.user_id()`) |
| IPs à autoriser (base source, région EU) | `79.125.70.43`, `18.200.209.88`, `18.234.18.91`, `18.233.128.219`, `34.202.251.156` (+ `2602:817::/44` en IPv6) — voir docs/backlog.md, section Dette technique, pour la restriction des IPs autorisées Scaleway encore ouvertes en 0.0.0.0/0 |
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
