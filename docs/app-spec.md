# Spécification de l'application

Document de référence unique, synthétisant les décisions validées au fil du
projet. En cas de doute sur une décision, ce document fait foi ; les détails
complets restent consultables dans l'historique de conception.

## 1. Contexte et objectif

Logiciel desktop de gestion locative pour un patrimoine d'environ 20
logements répartis dans plusieurs SCI. Conçu pour un usage personnel
immédiat, mais architecturé dès le départ pour une évolution possible vers
un produit SaaS commercialisable, destiné à des particuliers multi-lots et à
des syndics.

Contraintes fondatrices :
- Fonctionnement hors ligne garanti (pas un besoin terrain, une garantie de
  continuité en cas de panne)
- Synchronisation cloud automatique
- Windows en priorité, autres OS envisageables plus tard
- Développement solo, assisté par Claude Code
- Budget MVP cible : 25 à 35 €/mois

## 2. Organisation des données

Hiérarchie : SCI → Immeuble → Appartement → Locataire → Historique.
Une SCI est rattachée à une Organisation (particulier ou syndic) via une
table de liaison, pour ne jamais supposer un seul propriétaire par bien.

Principe non négociable : aucune suppression définitive. Toute donnée
"supprimée" passe par un statut d'archivage (`statut = archive`,
`archived_at` renseigné). Le détail des tables est dans
docs/data-dictionary.md.

## 3. Architecture technique

**Pattern retenu : local-first avec synchronisation cloud managée.**

- Poste de travail (Windows, Electron) : base locale SQLite chiffrée,
  source de vérité pendant l'usage hors ligne
- Synchronisation gérée par PowerSync (pas de moteur de sync développé
  maison) vers un backend cloud
- Backend cloud (NestJS, monolithe modulaire) : PostgreSQL managé
  (Scaleway) comme source de vérité côté cloud
- Documents stockés sur Scaleway Object Storage, chiffrés
- Toute la logique métier vit dans un package partagé (packages/core),
  utilisé identiquement en local et côté cloud — pas de duplication de
  règles

Le détail du raisonnement (comparatif Electron/Tauri, choix de PowerSync,
choix de Scaleway) reste disponible dans l'historique de conception du
projet si besoin de le retracer.

## 3bis. Navigation

Sidebar à 6 entrées, dans cet ordre exact :
`Tableau de bord` · `Patrimoine` (SCI/Immeubles/Appartements réunis) ·
`Locataires` · `Finances` · `Documents` · `Paramètres`.

Règle : ajouter une 7e entrée nécessite d'en fusionner deux — pas
d'ajout libre, pour préserver la sobriété visée en Phase 6.

Navigation secondaire : palette de commandes (Ctrl+K), développée en
dernier (Module 8) — voir docs/backlog.md.

## 4. Modules du MVP (3 mois)

Périmètre fonctionnel du MVP :
- Gestion des SCI (informations, régime fiscal IS/IR, comptes bancaires)
- Gestion des immeubles, appartements, équipements
- Gestion des locataires, garants, baux (avec colocation)
- Documents : stockage et catégorisation (sans checklist automatique avancée)
- Finances : paiements, impayés, import CSV pour rapprochement bancaire
  semi-automatique
- Moteur de détection d'échéances (alertes) : fin de bail, document expiré,
  entretien équipement, impayé — affichées au tableau de bord, sans envoi
  automatique
- Tableau de bord, navigation à 6 entrées + palette de commandes (Ctrl+K)

## 5. Explicitement hors périmètre MVP

- Calcul et régularisation de charges (Module 6)
- Révision annuelle automatique indice INSEE (Module 7)
- Gestion des travaux (Module 9)
- Assistant IA intégré (Module 10)
- Envoi automatique d'emails (quittances, relances) — nécessite l'intégration
  Gmail OAuth2, prévue en première itération post-MVP
- Connexion bancaire automatique (agrégateur DSP2) — import CSV en attendant

Ordre de la feuille de route post-MVP : génération de quittance PDF →
connexion Gmail OAuth2 → envoi automatique de quittances → relances impayés
→ révision INSEE → module travaux.

## 6. Sécurité (résumé — détail dans docs/integrations.md pour la config)

- Chiffrement au repos : base locale (SQLite via PowerSync), base cloud
  (Postgres géré Scaleway) + chiffrement applicatif sur les champs sensibles
  (IBAN, pièce d'identité), documents chiffrés côté stockage
- Chiffrement en transit : TLS systématique sur tous les échanges
- Clé de chiffrement locale protégée par le trousseau Windows via
  `safeStorage` d'Electron — pas de mot de passe maître à ressaisir
- Authentification : JWT + Argon2, construits dans NestJS, pas de service
  d'auth tiers en MVP
- Electron durci : `contextIsolation: true`, `nodeIntegration: false`,
  aucune interaction avec du contenu web distant
- RGPD : mécanisme d'archivage + anonymisation distincts pour concilier le
  principe "jamais de suppression" avec le droit à l'effacement

## 7. Décisions volontairement différées

- Résolution de conflits multi-appareils (CRDT) : non nécessaire tant qu'un
  seul utilisateur actif ; les colonnes d'audit sont prêtes pour l'ajouter
  sans migration lourde
- RBAC complet (permissions fines multi-utilisateur) : la table de liaison
  organisation/SCI porte déjà un rôle, mais le système de permissions
  détaillé attend un vrai besoin multi-utilisateur
- Clé de chiffrement applicative par organisation cliente (plutôt qu'une
  clé unique) : à mettre en place avant toute ouverture SaaS multi-client
