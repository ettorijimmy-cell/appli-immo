export interface RattachementOrganisationSciInput {
  organisationId: string;
  sciId: string;
  dateDebut: string;
}

export interface RattachementOrganisationSciResult {
  organisationId: string;
  sciId: string;
  role: "proprietaire";
  dateDebut: string;
  dateFin: null;
}

/**
 * Règle de gestion (docs/backlog.md, Module 1) : à la création d'une SCI,
 * l'organisation créatrice est automatiquement rattachée avec le rôle
 * `proprietaire`. Ne persiste rien — retourne la forme de la ligne
 * `organisation_sci` à insérer, à charge de l'appelant (apps/backend) de
 * l'écrire via Drizzle.
 */
export function creerRattachementProprietaire(
  input: RattachementOrganisationSciInput
): RattachementOrganisationSciResult {
  return {
    organisationId: input.organisationId,
    sciId: input.sciId,
    role: "proprietaire",
    dateDebut: input.dateDebut,
    dateFin: null
  };
}
