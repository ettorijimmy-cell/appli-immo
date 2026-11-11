# Acte de cautionnement : questions à faire valider par l'ADIL

À faire valider **avant le premier acte réel**. L'acte est généré par
Briky pour une caution personne physique (chantier garants, commits
`954532f` à `c7df5ff`, 2026-11-11). Modèle :
`apps/backend/src/acte-cautionnement-docx/assets/modele-acte-cautionnement.docx`.
Les passages cités sont le texte du modèle ; les valeurs entre accolades
sont remplies à la génération.

Textes lus sur Légifrance le 2026-11-08 : loi n° 89-462 du 6 juillet 1989,
art. 22-1 et 8-1, VI ; Code civil, art. 2297 et 2302. Voir la synthèse dans
`docs/backlog.md`, entrée « Acte de cautionnement ».

1. **Durée déterminée : fin du bail initial plus deux renouvellements.**
   Passage (art. 6) : « Le présent engagement est consenti pour une durée
   déterminée, prenant effet à compter de la signature du présent acte et
   expirant le {dateExpiration}. »
   La date est calculée depuis la date d'effet et la durée du bail, dernier
   jour inclus : bail de 3 ans → 9 ans, bail de 1 an → 3 ans ; bail meublé
   étudiant (9 mois, non reconduit) → fin du bail initial. Cette durée
   est-elle acceptable ?

2. **Plafond de 36 mois de loyer, charges comprises.**
   Passage (art. 5) : « Le présent cautionnement est consenti dans la
   limite d'un montant maximal de : {plafondChiffres} € ({plafondLettres}).
   Ce montant comprend le principal ainsi que les accessoires de la dette,
   notamment les intérêts et frais entrant légalement dans le champ du
   cautionnement. »
   Plafond = 36 × (loyer hors charges + provisions sur charges) au jour de
   la génération, en chiffres et en lettres. Ce montant est-il proportionné ?
   Faut-il le relier à la durée de l'article 6 ?

3. **Mise en page de la mention manuscrite (Code civil, art. 2297).**
   Passage (art. 8) : « La Caution recopie elle-même, en entier, dans le
   cadre ci-dessous, le modèle de mention ci-dessus. », puis « Modèle à
   recopier : » (mention pré-remplie avec le nom du locataire et le plafond
   en chiffres et en lettres), puis le titre « Mention à écrire en entier
   de la main de la Caution » et un cadre vide.
   Un modèle pré-rempli au-dessus d'un cadre vide est-il conforme à l'art.
   2297 ? Le texte du modèle (« En me portant caution solidaire de …, je
   m'engage à payer au Bailleur… ») contient-il tout ce que l'article exige,
   dont la renonciation aux bénéfices de discussion et de division ?

4. **Colocation : identification du colocataire garanti (art. 8-1, VI).**
   Passage (art. 1, seulement en colocation) : « Conformément à l'article
   8-1, VI de la loi n° 89-462 du 6 juillet 1989, le colocataire dont
   l'extinction de la solidarité met fin à l'engagement de la Caution est :
   {colocataireGaranti}. »
   Cette phrase suffit-elle à identifier le colocataire garanti au sens de
   l'article ?

5. **Fin de l'engagement avant son terme.**
   Passage (art. 6) : « La Caution reconnaît avoir été informée que,
   lorsqu'un cautionnement est conclu pour une durée déterminée, elle ne
   peut pas y mettre fin unilatéralement avant son terme, sous réserve des
   dispositions légales applicables. »
   Cette phrase est-elle exacte et utile ? Faut-il la garder ?

6. **Mention avant la signature de la caution.**
   Passage (bloc des signatures) : « Signature précédée de la mention « Lu
   et approuvé, bon pour caution solidaire ». »
   Cette mention est-elle utile en plus de la mention de l'art. 8, ou
   peut-elle prêter à confusion ?

7. **Preuve de la remise d'un exemplaire du bail (art. 22-1).**
   Passage (art. 7) : « La Caution reconnaît avoir reçu un exemplaire du
   présent acte ainsi qu'un exemplaire du contrat de location auquel il se
   rapporte. »
   S'y ajoute la déclaration datée dans Briky (date et mode de remise : en
   main propre, lettre recommandée, courrier simple, e-mail ; corrections
   conservées en historique). Ces deux éléments suffisent-ils comme preuve
   de la remise ? Un mode est-il à privilégier ?

8. **Information annuelle de la caution (Code civil, art. 2302).**
   Aucune information annuelle n'est faite aujourd'hui (décision de
   Jimmy) ; l'acte n'en parle pas (l'art. 7 d'origine sur les obligations
   d'information a été retiré).
   Une SCI familiale bailleresse est-elle un « créancier professionnel »
   au sens de l'art. 2302 ? Si oui, quelle information faut-il donner, et
   quand ?

9. **Visale : aucune mention dans le bail.**
   Pour une garantie Visale, rien n'est imprimé dans le bail ; la section
   « GARANTS SOLIDAIRES » affiche « Néant » s'il n'y a aucune caution
   personne physique. Aucun acte de cautionnement n'est généré pour Visale.
   Est-ce correct ? À vérifier aussi dans le contrat Visale au premier cas
   réel.

10. **Identité exigée de la caution.**
    Passage (en-tête « LA CAUTION ») : « Nom et prénom : {cautionNom} »,
    « Date et lieu de naissance : {cautionNaissance} », « Adresse :
    {cautionAdresse} ».
    Briky exige la date et le lieu de naissance et la nationalité d'une
    caution personne physique avant de générer le bail et l'acte ; la
    nationalité n'est pas imprimée (l'art. 22-1 interdit de refuser une
    caution en raison de sa nationalité). Cette pratique est-elle
    acceptable ? Faut-il cesser de demander la nationalité ?
