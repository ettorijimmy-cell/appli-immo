# Bascule de la base de dev de PostgreSQL 16 à 17.11

Procédure exécutée avec succès le 2026-11-08 pour la bascule 16 → 17.11. Pour une prochaine version majeure, remplacer les numéros de version, le nom du nouveau volume et les comptages de repère ; à partir de PostgreSQL 18, l'image officielle monte les données ailleurs (/var/lib/postgresql/18/docker) : vérifier la page Docker Hub avant toute bascule.

À lancer soi-même, en **Git Bash**, depuis `C:\dev\appli-immo`, avec la modification de docker-compose.yml (nouvelle image et nouveau volume) présente dans l'arbre de travail : `docker-compose.yml` en `postgres:17.11`, volume `appli_immo_pg17_data`.

Noms réels, vérifiés le 2026-11-08 :

| Élément | Nom |
|---|---|
| Projet compose de dev | `appli-immo` (service `postgres`) |
| Conteneur actuel (16.14) | `appli-immo-postgres-1` |
| Volume actuel, à conserver | `appli-immo_appli_immo_pg_data` |
| Nouveau volume, créé à l'étape 4 | `appli-immo_appli_immo_pg17_data` |
| Réseau compose | `appli-immo_default` |
| Base | `appli_immo_dev` |
| Utilisateur | `postgres` (mot de passe de dev `postgres`, déjà dans `docker-compose.yml`) |
| Port hôte | 5433 |

`backups/` est ignoré par git (`.gitignore`, ligne 35, vérifié avec `git check-ignore`). Aucun fichier de sauvegarde ne peut être committé par erreur.

Les étapes 0 à 3 se font **pendant que le conteneur 16 tourne encore**. Modifier `docker-compose.yml` ne l'affecte pas : seul `docker compose up` le recrée.

---

## 0 bis. Shell propre

Ouvrir un **Git Bash NEUF**. La commande suivante doit afficher `non défini` ; sinon, faire `unset DATABASE_URL` avant de continuer.

```bash
echo "${DATABASE_URL:-non défini}"
cd /c/dev/appli-immo
```

## 0. Préalables

Le backend de dev doit être arrêté, pour qu'aucune connexion ne reste ouverte, et le conteneur 16 doit être en marche.

```bash
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep appli-immo-postgres-1
# attendu : appli-immo-postgres-1 postgres:16 Up … (healthy)
docker exec appli-immo-postgres-1 psql -U postgres -d appli_immo_dev -tAc "select version()"
# attendu : PostgreSQL 16.14 …
git diff --stat docker-compose.yml
# attendu : docker-compose.yml | 6 +++--- (modification de docker-compose.yml, nouvelle image et nouveau volume, présente dans l'arbre de travail)
```

## 1. Deux sauvegardes indépendantes

```bash
# a) SQL texte, pg_dump 16, par le script du dépôt
pnpm backup:local
# b) Format custom, pg_dump 17.11 (recommandé par la doc PostgreSQL pour une montée de version),
#    dans un conteneur jetable branché sur le réseau compose
MSYS_NO_PATHCONV=1 docker run --rm --network appli-immo_default -e PGPASSWORD=postgres \
  -v "$(pwd -W)/backups:/backups" postgres:17.11 \
  pg_dump -h postgres -U postgres -d appli_immo_dev -Fc -f /backups/appli_immo_dev_avant_pg17.dump
ls -l backups/
# les deux nouveaux fichiers doivent être non vides
```

L'image `postgres:17.11` est téléchargée à la première commande (environ 150 Mo).

## 2. Vérifier le dump

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups:/backups" postgres:17.11 \
  pg_restore --list /backups/appli_immo_dev_avant_pg17.dump | grep -c "TABLE DATA"
# attendu : 56 (55 tables public + drizzle.__drizzle_migrations)
```

## 3. Comptages de référence sur la 16

```bash
cat > backups/comptes.sql <<'SQL'
select table_schema||'.'||table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema in ('public','drizzle') and table_type='BASE TABLE' order by 1;
SQL
docker exec -i appli-immo-postgres-1 psql -U postgres -d appli_immo_dev -qtA -v ON_ERROR_STOP=1 < backups/comptes.sql > backups/comptes-avant.txt
wc -l < backups/comptes-avant.txt
# attendu : 56
grep -E "^drizzle|public\.(baux|locataires|garants|documents)\|" backups/comptes-avant.txt
# repère (2026-11-08) : drizzle 78, baux 9, locataires 11, garants 5, documents 48
```

**Jusqu'ici, rien n'a changé** : seuls des fichiers ont été ajoutés dans `backups/`.

## 4. Bascule

Compose recrée le conteneur en 17.11 sur le **nouveau** volume, vide. L'ancien volume `appli-immo_appli_immo_pg_data` n'est ni supprimé ni modifié.

```bash
docker compose up -d --wait
docker compose exec postgres psql -U postgres -d appli_immo_dev -tAc "select version()"
# attendu : PostgreSQL 17.11 …
docker volume ls | grep appli_immo_pg
# attendu : appli-immo_appli_immo_pg_data ET appli-immo_appli_immo_pg17_data
```

## 5. Restauration

La restauration se fait dans la base vide créée par l'image (`POSTGRES_DB=appli_immo_dev`), en une seule transaction : tout ou rien.

```bash
MSYS_NO_PATHCONV=1 docker compose cp backups/appli_immo_dev_avant_pg17.dump postgres:/tmp/avant_pg17.dump
MSYS_NO_PATHCONV=1 docker compose exec -T postgres pg_restore -U postgres -d appli_immo_dev \
  --no-owner --single-transaction --exit-on-error /tmp/avant_pg17.dump
echo "code de sortie pg_restore : $?"
# attendu : 0
```

## 6. Contrôle

```bash
docker compose exec -T postgres psql -U postgres -d appli_immo_dev -qtA -v ON_ERROR_STOP=1 < backups/comptes.sql > backups/comptes-apres.txt
diff backups/comptes-avant.txt backups/comptes-apres.txt && echo "COMPTAGES IDENTIQUES"
pnpm --filter db db:migrate
# attendu : rien à appliquer (78 migrations, 0000 à 0077)
```

## 7. Essai fonctionnel

Dans deux terminaux :

```bash
unset DATABASE_URL; pnpm --filter backend dev   # attendre « Nest application successfully started »
pnpm --filter desktop dev
```

Ensuite, se connecter avec un compte d'essai (par exemple `essai-papier@example.com`), ouvrir un bail et générer le document.

---

## Retour arrière

- **Avant l'étape 4 :** rien à défaire.
- **Après l'étape 4 ou 5, en cas d'échec :** revenir au conteneur 16 sur l'ancien volume, intact, en mettant de côté la modification de docker-compose.yml (nouvelle image et nouveau volume) :

  ```bash
  cp docker-compose.yml backups/docker-compose.pg17.yml   # garder la version 17 de côté
  git checkout -- docker-compose.yml                      # revient à postgres:16 + appli_immo_pg_data
  docker compose up -d --wait
  docker exec appli-immo-postgres-1 psql -U postgres -d appli_immo_dev -tAc "select version()"
  # attendu : PostgreSQL 16.14
  # Pour réessayer plus tard : cp backups/docker-compose.pg17.yml docker-compose.yml
  ```

- **Restauration en échec :** elle n'est jamais partielle, grâce à `--single-transaction`. Pour recommencer sur un volume 17 vierge :

  ```bash
  docker compose down                                   # SANS -v
  docker volume rm appli-immo_appli_immo_pg17_data      # le NOUVEAU volume uniquement
  # puis reprendre à l'étape 4
  ```

- **Après validation**, quelques jours d'usage, et seulement sur décision explicite : supprimer l'ancien volume avec `docker volume rm appli-immo_appli_immo_pg_data`. Les dumps restent dans `backups/`.

## Points d'attention

- Git Bash convertit en chemin Windows tout argument qui commence par `/` (par exemple `/tmp/…` devient `C:/Users/…/Temp/…`). Chaque commande qui passe un chemin du conteneur porte donc `MSYS_NO_PATHCONV=1`. Ce correctif date du 2026-11-08 : sans lui, `pg_restore` cherchait `C:/Users/jimmy/AppData/Local/Temp/avant_pg17.dump` et sortait en code 1, sans rien écrire.

- Un `docker compose up` lancé par erreur avant les étapes 1 à 3 fait repartir le conteneur en 17, sur un volume vide. Rien n'est perdu : appliquer le premier retour arrière, puis reprendre à l'étape 0.
- Les triggers de la migration 0075 (pas de suppression ni de modification des déclarations d'entrée papier) sont créés par `pg_restore` après le chargement des données, comme les contraintes : ils ne bloquent pas la restauration.
- `restart: unless-stopped` reste en place : le conteneur 17 redémarre seul avec Docker Desktop, comme avant.
