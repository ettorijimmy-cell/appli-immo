import { createDbClient, DEFAULT_DEV_DATABASE_URL, elementsInventaireMeuble } from "db";

// Catalogue extrait tel quel du modèle Word réel du propriétaire
// (tmp/Modèle état des lieux.docx, bloc {#meublé}), dans l'ordre
// d'apparition — MEUBLES, ÉLECTRO-MÉNAGER, puis ÉQUIPEMENT 1/ÉQUIPEMENT 2
// (mise en page en deux colonnes, aucune signification métier, fusionnées
// ici dans la catégorie unique "vaisselle_linge").
type Categorie = "meuble" | "electromenager" | "vaisselle_linge";

const CATALOGUE: { code: string; libelle: string; categorie: Categorie }[] = [
  // Meubles
  { code: "chaises_sejour", libelle: "Chaises (séjour)", categorie: "meuble" },
  { code: "chaises_chambres", libelle: "Chaises (chambres)", categorie: "meuble" },
  { code: "chaises_cuisine", libelle: "Chaises (cuisine)", categorie: "meuble" },
  { code: "chaises_autres", libelle: "Chaises (autres)", categorie: "meuble" },
  { code: "tabourets", libelle: "Tabourets", categorie: "meuble" },
  { code: "canapes", libelle: "Canapés", categorie: "meuble" },
  { code: "fauteuils", libelle: "Fauteuils", categorie: "meuble" },
  { code: "tables_sejour", libelle: "Tables (séjour)", categorie: "meuble" },
  { code: "tables_chambres", libelle: "Tables (chambres)", categorie: "meuble" },
  { code: "tables_cuisine", libelle: "Tables (cuisine)", categorie: "meuble" },
  { code: "tables_de_nuit", libelle: "Tables de nuit", categorie: "meuble" },
  { code: "tables_autres", libelle: "Tables (autres)", categorie: "meuble" },
  { code: "bureaux", libelle: "Bureaux", categorie: "meuble" },
  { code: "commodes", libelle: "Commodes", categorie: "meuble" },
  { code: "armoires", libelle: "Armoires", categorie: "meuble" },
  { code: "buffets", libelle: "Buffets", categorie: "meuble" },
  { code: "lits_simples", libelle: "Lits simples", categorie: "meuble" },
  { code: "lits_doubles", libelle: "Lits doubles", categorie: "meuble" },
  { code: "placards", libelle: "Placards", categorie: "meuble" },
  { code: "lustres_plafonniers", libelle: "Lustres / plafonniers", categorie: "meuble" },
  { code: "lampes_appliques", libelle: "Lampes / appliques", categorie: "meuble" },
  // Électroménager
  { code: "refrigerateur", libelle: "Réfrigérateur", categorie: "electromenager" },
  { code: "lave_linge", libelle: "Lave-linge", categorie: "electromenager" },
  { code: "congelateur", libelle: "Congélateur", categorie: "electromenager" },
  { code: "seche_linge", libelle: "Sèche-linge", categorie: "electromenager" },
  { code: "cuisiniere", libelle: "Cuisinière", categorie: "electromenager" },
  { code: "videoprojecteur", libelle: "Vidéoprojecteur", categorie: "electromenager" },
  { code: "four", libelle: "Four", categorie: "electromenager" },
  { code: "television", libelle: "Télévision", categorie: "electromenager" },
  { code: "four_micro_ondes", libelle: "Four micro-ondes", categorie: "electromenager" },
  { code: "lecteur_dvd", libelle: "Lecteur DVD", categorie: "electromenager" },
  { code: "grille_pain", libelle: "Grille-pain", categorie: "electromenager" },
  { code: "chaine_hifi", libelle: "Chaine Hi-fi", categorie: "electromenager" },
  { code: "bouilloire", libelle: "Bouilloire", categorie: "electromenager" },
  { code: "fer_a_repasser", libelle: "Fer à repasser", categorie: "electromenager" },
  { code: "cafetiere", libelle: "Cafetière", categorie: "electromenager" },
  { code: "aspirateur", libelle: "Aspirateur", categorie: "electromenager" },
  { code: "lave_vaisselle", libelle: "Lave-vaisselle", categorie: "electromenager" },
  // Vaisselle / linge (colonnes "ÉQUIPEMENT 1" / "ÉQUIPEMENT 2" du modèle)
  { code: "grandes_assiettes", libelle: "Grandes assiettes", categorie: "vaisselle_linge" },
  { code: "pelles", libelle: "Pelles", categorie: "vaisselle_linge" },
  { code: "assiettes_a_dessert", libelle: "Assiettes à dessert", categorie: "vaisselle_linge" },
  { code: "seaux", libelle: "Seaux", categorie: "vaisselle_linge" },
  { code: "assiettes_creuses", libelle: "Assiettes creuses", categorie: "vaisselle_linge" },
  { code: "torchons", libelle: "Torchons", categorie: "vaisselle_linge" },
  { code: "autres_assiettes", libelle: "Autres assiettes", categorie: "vaisselle_linge" },
  { code: "matelas", libelle: "Matelas", categorie: "vaisselle_linge" },
  { code: "fourchettes", libelle: "Fourchettes", categorie: "vaisselle_linge" },
  { code: "traversins", libelle: "Traversins", categorie: "vaisselle_linge" },
  { code: "petites_cuilleres", libelle: "Petites cuillères", categorie: "vaisselle_linge" },
  { code: "taies_de_traversin", libelle: "Taies de traversin", categorie: "vaisselle_linge" },
  { code: "grandes_cuilleres", libelle: "Grandes cuillères", categorie: "vaisselle_linge" },
  { code: "oreillers", libelle: "Oreillers", categorie: "vaisselle_linge" },
  { code: "couteaux_de_table", libelle: "Couteaux de table", categorie: "vaisselle_linge" },
  { code: "taies_doreiller", libelle: "Taies d'oreiller", categorie: "vaisselle_linge" },
  { code: "couteaux_de_cuisine", libelle: "Couteaux de cuisine", categorie: "vaisselle_linge" },
  { code: "draps_du_dessous", libelle: "Draps du dessous", categorie: "vaisselle_linge" },
  { code: "couteaux_a_pain", libelle: "Couteaux à pain", categorie: "vaisselle_linge" },
  { code: "draps", libelle: "Draps", categorie: "vaisselle_linge" },
  { code: "verres_a_pied", libelle: "Verres à pied", categorie: "vaisselle_linge" },
  { code: "couettes", libelle: "Couettes", categorie: "vaisselle_linge" },
  { code: "autres_verres", libelle: "Autres verres", categorie: "vaisselle_linge" },
  { code: "housses_de_couette", libelle: "Housses de couette", categorie: "vaisselle_linge" },
  { code: "bols", libelle: "Bols", categorie: "vaisselle_linge" },
  { code: "couvertures", libelle: "Couvertures", categorie: "vaisselle_linge" },
  { code: "tasses", libelle: "Tasses", categorie: "vaisselle_linge" },
  { code: "alaises", libelle: "Alaises", categorie: "vaisselle_linge" },
  { code: "soucoupes", libelle: "Soucoupes", categorie: "vaisselle_linge" },
  { code: "couvre_lits", libelle: "Couvre-lits", categorie: "vaisselle_linge" },
  { code: "couverts_de_service", libelle: "Couverts de service", categorie: "vaisselle_linge" },
  { code: "peignoirs_de_bain", libelle: "Peignoirs de bain", categorie: "vaisselle_linge" },
  { code: "tire_bouchon", libelle: "Tire-bouchon", categorie: "vaisselle_linge" },
  { code: "serviettes_de_bain", libelle: "Serviettes de bain", categorie: "vaisselle_linge" },
  { code: "decapsuleur", libelle: "Décapsuleur", categorie: "vaisselle_linge" },
  { code: "serviettes_de_toilette", libelle: "Serviettes de toilette", categorie: "vaisselle_linge" },
  { code: "carafes", libelle: "Carafes", categorie: "vaisselle_linge" },
  { code: "gants_de_toilette", libelle: "Gants de toilette", categorie: "vaisselle_linge" },
  { code: "planches_a_decouper", libelle: "Planches à découper", categorie: "vaisselle_linge" },
  { code: "nappes", libelle: "Nappes", categorie: "vaisselle_linge" },
  { code: "plats", libelle: "Plats", categorie: "vaisselle_linge" },
  { code: "serviettes_de_table", libelle: "Serviettes de table", categorie: "vaisselle_linge" },
  { code: "saladiers", libelle: "Saladiers", categorie: "vaisselle_linge" },
  { code: "coussins", libelle: "Coussins", categorie: "vaisselle_linge" },
  { code: "passoires", libelle: "Passoires", categorie: "vaisselle_linge" },
  { code: "poeles", libelle: "Poêles", categorie: "vaisselle_linge" },
  { code: "casseroles", libelle: "Casseroles", categorie: "vaisselle_linge" },
  { code: "egouttoir", libelle: "Egouttoir", categorie: "vaisselle_linge" },
  { code: "ouvre_boites", libelle: "Ouvre-boîtes", categorie: "vaisselle_linge" },
  { code: "balais_balayettes", libelle: "Balais / balayettes", categorie: "vaisselle_linge" }
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const ordreParCategorie: Record<Categorie, number> = { meuble: 0, electromenager: 0, vaisselle_linge: 0 };
    for (const item of CATALOGUE) {
      ordreParCategorie[item.categorie] += 1;
      const ordreAffichage = ordreParCategorie[item.categorie];
      await db
        .insert(elementsInventaireMeuble)
        .values({ code: item.code, libelle: item.libelle, categorie: item.categorie, ordreAffichage })
        .onConflictDoUpdate({
          target: elementsInventaireMeuble.code,
          set: { libelle: item.libelle, categorie: item.categorie, ordreAffichage, updatedAt: new Date() }
        });
    }
    console.log(`Catalogue inventaire meublé : ${CATALOGUE.length} éléments seedés.`);
  } finally {
    await db.$client.end();
  }
}

void main();
