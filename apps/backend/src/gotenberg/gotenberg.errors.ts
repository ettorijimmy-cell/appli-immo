// Erreurs plates (pas des exceptions NestJS) : ce client est appelé aussi
// bien depuis une requête HTTP que depuis un job planifié (@nestjs/
// schedule, chantier PDF à venir) — hors contexte HTTP, une exception
// NestJS n'a pas de sens. L'appelant traduit en exception HTTP si besoin.
//
// Deux catégories distinguées par le futur mécanisme de relance (job +
// lecture GET + bouton, chantier PDF étape 4) :
// - GotenbergIndisponibleError : situation transitoire, qui peut se
//   résoudre d'elle-même — Gotenberg non configuré, réseau, délai dépassé
//   (conteneur qui se réveille), ou réponse 502/503/504 (proxy en amont,
//   conteneur en train de démarrer). La relance réessaiera plus tard.
// - GotenbergConversionError : échec qui rejouera IDENTIQUEMENT à chaque
//   tentative (autre code HTTP non-2xx, réponse invalide) — jamais
//   relancé en boucle par le mécanisme automatique, qui ne ferait que
//   répéter le même échec indéfiniment.
//
// Aucun message ne doit jamais contenir un identifiant Basic Auth ni un
// en-tête Authorization — voir GotenbergService et son test dédié.

export class GotenbergIndisponibleError extends Error {
  constructor(
    message = "Gotenberg indisponible (non configuré, réseau, délai dépassé, ou erreur serveur transitoire) : à relancer plus tard.",
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "GotenbergIndisponibleError";
  }
}

export class GotenbergConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GotenbergConversionError";
  }
}
