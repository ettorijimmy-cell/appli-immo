// Config déclarative des éléments par pièce — même contenu que
// apps/desktop/src/renderer/src/etats-des-lieux/pieces-config.ts (schéma
// partagé, reproduit ici pour rester une app autonome sans dépendance
// croisée entre apps/desktop et apps/mobile-web).
export interface ElementDef {
  prefix: string;
  label: string;
  avecNombre?: boolean;
}

const SOCLE: ElementDef[] = [
  { prefix: "mur", label: "Mur" },
  { prefix: "sol", label: "Sol" },
  { prefix: "vitrageVolets", label: "Vitrage et volets" },
  { prefix: "plafond", label: "Plafond" },
  { prefix: "eclairage", label: "Éclairage et interrupteurs" },
  { prefix: "prises", label: "Prises électriques", avecNombre: true }
];

export const ELEMENTS_ENTREE: ElementDef[] = [
  { prefix: "porte", label: "Porte" },
  { prefix: "sonnette", label: "Sonnette ou interphone" },
  ...SOCLE
];

export const ELEMENTS_SEJOUR: ElementDef[] = SOCLE;

export const ELEMENTS_CUISINE: ElementDef[] = [
  ...SOCLE,
  { prefix: "placards", label: "Placards et tiroirs" },
  { prefix: "evier", label: "Évier (et robinetterie)" },
  { prefix: "plaquesCuisson", label: "Plaques de cuisson et four" },
  { prefix: "hotte", label: "Hotte" }
];

export const ELEMENTS_CHAMBRE: ElementDef[] = SOCLE;

export const ELEMENTS_SALLE_DE_BAIN: ElementDef[] = [
  ...SOCLE,
  { prefix: "lavabo", label: "Lavabo et robinetterie" },
  { prefix: "baignoire", label: "Baignoire / douche" }
];

export const ELEMENTS_WC: ElementDef[] = [
  ...SOCLE,
  { prefix: "lavabo", label: "Lavabo et robinetterie" },
  { prefix: "wc", label: "WC" }
];

export const ELEMENTS_AUTRE: ElementDef[] = SOCLE;
