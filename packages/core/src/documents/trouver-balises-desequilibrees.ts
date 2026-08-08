/**
 * Garde-fou avant toute génération de document docxtemplater : compte les
 * ouvertures {#nom} et fermetures {/nom} de chaque bloc de boucle dans le
 * texte du modèle, et signale tout nom dont les comptes ne s'équilibrent
 * pas. Comptage simple (pas de vérification d'imbrication/d'ordre) — un
 * modèle Word édité à la main (ajout/suppression d'une balise par
 * inadvertance) est le scénario réel visé, pas une attaque adversariale.
 *
 * `texte` doit être le texte déjà reconstruit à partir des <w:t> du
 * document (concaténés SANS séparateur, pour recoller les balises que
 * Word peut scinder entre plusieurs runs — voir docs/error-log.md,
 * [2026-08-08] balise {/meublé} disparue lors d'une édition manuelle).
 */
export interface BaliseDesequilibree {
  nom: string;
  ouvertures: number;
  fermetures: number;
}

export function trouverBalisesDesequilibrees(texte: string): BaliseDesequilibree[] {
  const ouvertures = new Map<string, number>();
  const fermetures = new Map<string, number>();

  for (const m of texte.matchAll(/\{#([^}]+)\}/g)) {
    const nom = m[1]!;
    ouvertures.set(nom, (ouvertures.get(nom) ?? 0) + 1);
  }
  for (const m of texte.matchAll(/\{\/([^}]+)\}/g)) {
    const nom = m[1]!;
    fermetures.set(nom, (fermetures.get(nom) ?? 0) + 1);
  }

  const noms = new Set([...ouvertures.keys(), ...fermetures.keys()]);
  const desequilibres: BaliseDesequilibree[] = [];
  for (const nom of noms) {
    const o = ouvertures.get(nom) ?? 0;
    const f = fermetures.get(nom) ?? 0;
    if (o !== f) {
      desequilibres.push({ nom, ouvertures: o, fermetures: f });
    }
  }
  return desequilibres;
}
