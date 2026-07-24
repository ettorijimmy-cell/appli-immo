# Journal d'erreur

Objectif : éviter de retomber deux fois dans le même piège, et donner à
Claude Code une mémoire des problèmes déjà résolus sur ce projet — un bug
similaire dans un module différent se résout souvent de la même façon.

À consigner : tout bug non trivial, toute erreur qui a pris plus de
quelques minutes à diagnostiquer, tout comportement surprenant d'une
librairie (PowerSync, Drizzle, Electron en particulier).
Pas besoin de consigner une simple faute de frappe ou un oubli d'import.

## Format

Copier ce modèle pour chaque entrée, la plus récente en premier.

```
### [AAAA-MM-JJ] Titre court du problème

**Symptôme** : ce qui a été observé (message d'erreur, comportement inattendu)

**Contexte** : module concerné, ce qui était en cours de développement

**Cause** : la cause réelle, une fois identifiée — pas juste le correctif

**Solution** : ce qui a résolu le problème

**Fichiers concernés** : chemins des fichiers modifiés

**À surveiller** : si le problème peut resurgir ailleurs dans le code
```

---

## Entrées

*(Aucune entrée pour l'instant — le journal s'alimente à partir du
démarrage du développement, Phase 12.)*
