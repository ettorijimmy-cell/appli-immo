// Contrat commun à toutes les étapes du parcours : le conteneur
// (EtatDesLieuxStepper) appelle submit() au tap sur "Suivant" et
// n'avance QUE si la promesse se résout — résilience réseau actée :
// soumission indépendante à chaque "Suivant", jamais d'avancée
// silencieuse sur un état non confirmé enregistré.
export interface EtapeHandle {
  submit: () => Promise<void>;
}
