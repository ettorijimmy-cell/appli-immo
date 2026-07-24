# Roadmap

Périmètre complet (9 modules, docs/backlog.md), rythme réel validé :
5-10h/semaine (soirs et weekends). Durée estimée : 12 à 13 mois.

Cette estimation part d'un volume de travail d'environ 400-450h pour
l'ensemble du backlog, buffer de 20-30% inclus pour le rythme
soirs/weekends (plus de changements de contexte qu'un rythme temps plein).

Point d'étape recommandé à la fin de chaque trimestre : comparer le rythme
réel au prévisionnel, ajuster le trimestre suivant si besoin, revérifier
que les choix techniques de docs/app-spec.md tiennent toujours.

## Trimestre 1 (mois 1-3) — Fondations

| Semaines | Contenu |
|---|---|
| 1-4 | Monorepo, provisionnement Scaleway, schéma initial (Drizzle), première migration |
| 5-8 | Backend NestJS + authentification, configuration PowerSync |
| 9-13 | Squelette Electron + connexion PowerSync + shell de navigation + CI |

**Jalon** : l'application se lance, un utilisateur se connecte, une donnée
créée hors ligne se synchronise avec le cloud.

## Trimestre 2 (mois 4-6) — Patrimoine

- Module 1 — SCI
- Module 2 — Patrimoine (immeubles/appartements/équipements)
- Module 3 — Locataires & Baux (première moitié)

**Jalon** : enregistrer une SCI, un immeuble, un appartement, commencer à
saisir un locataire.

## Trimestre 3 (mois 7-9) — Cœur métier quotidien

- Module 3 — Locataires & Baux (fin)
- Module 5 — Finances (paiements, import CSV)
- Module 4 — Documents (début)

**Jalon** : créer un bail complet, encaisser un paiement, importer un
relevé bancaire. Jalon le plus important du projet — c'est le moment où
l'usage quotidien devient réellement possible.

## Trimestre 4 (mois 10-12) — Confort et fiabilité

- Module 4 — Documents (fin)
- Module 6 — Moteur d'alertes
- Module 7 — Tableau de bord
- Module 8 — Palette de commandes (début)

## Mois 13 — Finition et marge

Fin du Module 8, tests globaux, polish, rattrapage du retard éventuel.

---

## Risques

| Risque | Mitigation |
|---|---|
| Perte de motivation pendant le Trimestre 1 (peu de résultat visible) | Jalons hebdomadaires internes à cocher |
| Dérive de rythme non détectée avant la fin | Point d'étape obligatoire à chaque fin de trimestre |
| Imprévus sur 12 mois | Mois 13 posé explicitement comme marge |
| Trimestre 3 concentre le risque métier le plus élevé (finances) | Tests obligatoires dans packages/core (voir CLAUDE.md) |

## Journal des ajustements

*(À compléter à chaque point d'étape trimestriel : rythme réel constaté,
ajustements décidés.)*

| Date | Trimestre concerné | Constat | Ajustement décidé |
|---|---|---|---|
| — | — | — | — |
