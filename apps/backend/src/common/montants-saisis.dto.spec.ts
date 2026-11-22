import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateAppartementDto } from "../appartements/dto/create-appartement.dto";
import { UpdateAppartementDto } from "../appartements/dto/update-appartement.dto";
import { CreateBailDto } from "../baux/dto/create-bail.dto";
import { UpdateBailDto } from "../baux/dto/update-bail.dto";
import { CreateBienDto } from "../bien/dto/create-bien.dto";
import { UpdateBienDto } from "../bien/dto/update-bien.dto";
import { CreateCandidatDto } from "../candidats/dto/create-candidat.dto";
import { UpdateCandidatDto } from "../candidats/dto/update-candidat.dto";
import { CreateDepenseDto } from "../depenses/dto/create-depense.dto";
import { SaisieManuelleAnnexe1Dto } from "../fiscalite/dto/saisie-manuelle-annexe1.dto";
import { CreatePaiementDto } from "../paiements/dto/create-paiement.dto";
import { UpdatePaiementDto } from "../paiements/dto/update-paiement.dto";
import { CreateRemboursementDto } from "../remboursements/dto/create-remboursement.dto";
import { CreateSinistreDto } from "../sinistres/dto/create-sinistre.dto";
import { UpdateSinistreDto } from "../sinistres/dto/update-sinistre.dto";
import { AppliquerRevisionDto } from "../taches/dto/appliquer-revision.dto";
import { CreateVersementDto } from "../versements/dto/create-versement.dto";

// Bornes des montants saisis (petites suites, décision 3 de Jimmy du
// 2026-11-22). Chaque champ de montant de chaque DTO, création ET
// modification, avec sa règle et le libellé que le message d'erreur doit
// nommer. Seule la propriété testée est regardée (les autres champs
// obligatoires du DTO peuvent manquer ici sans fausser le test).
type Regle = "strictement_positif" | "positif_ou_nul";

interface CasMontant {
  dto: new () => object;
  champ: string;
  regle: Regle;
  libelle: string;
}

const CAS: CasMontant[] = [
  // > 0
  { dto: CreateVersementDto, champ: "montant", regle: "strictement_positif", libelle: "montant du versement" },
  { dto: CreatePaiementDto, champ: "montant", regle: "strictement_positif", libelle: "montant de l'échéance" },
  { dto: UpdatePaiementDto, champ: "montant", regle: "strictement_positif", libelle: "montant de l'échéance" },
  { dto: CreateRemboursementDto, champ: "montantOrigine", regle: "strictement_positif", libelle: "montant reçu à l'origine" },
  { dto: CreateBailDto, champ: "loyerMensuel", regle: "strictement_positif", libelle: "loyer mensuel" },
  { dto: UpdateBailDto, champ: "loyerMensuel", regle: "strictement_positif", libelle: "loyer mensuel" },
  { dto: AppliquerRevisionDto, champ: "nouveauLoyerValide", regle: "strictement_positif", libelle: "nouveau loyer" },
  { dto: CreateDepenseDto, champ: "montant", regle: "strictement_positif", libelle: "montant de la dépense" },
  // >= 0
  { dto: CreateRemboursementDto, champ: "montantRembourse", regle: "positif_ou_nul", libelle: "montant remboursé" },
  { dto: CreateBailDto, champ: "provisionsCharges", regle: "positif_ou_nul", libelle: "provisions pour charges" },
  { dto: UpdateBailDto, champ: "provisionsCharges", regle: "positif_ou_nul", libelle: "provisions pour charges" },
  { dto: CreateBailDto, champ: "depotGarantie", regle: "positif_ou_nul", libelle: "dépôt de garantie" },
  { dto: UpdateBailDto, champ: "depotGarantie", regle: "positif_ou_nul", libelle: "dépôt de garantie" },
  { dto: UpdateBailDto, champ: "honorairesBailleur", regle: "positif_ou_nul", libelle: "honoraires à la charge du bailleur" },
  { dto: UpdateBailDto, champ: "honorairesLocataire", regle: "positif_ou_nul", libelle: "honoraires à la charge du locataire" },
  { dto: CreateAppartementDto, champ: "loyerReference", regle: "positif_ou_nul", libelle: "loyer de référence" },
  { dto: UpdateAppartementDto, champ: "loyerReference", regle: "positif_ou_nul", libelle: "loyer de référence" },
  { dto: CreateAppartementDto, champ: "depensesEnergieMin", regle: "positif_ou_nul", libelle: "dépenses d'énergie (minimum)" },
  { dto: UpdateAppartementDto, champ: "depensesEnergieMin", regle: "positif_ou_nul", libelle: "dépenses d'énergie (minimum)" },
  { dto: CreateAppartementDto, champ: "depensesEnergieMax", regle: "positif_ou_nul", libelle: "dépenses d'énergie (maximum)" },
  { dto: UpdateAppartementDto, champ: "depensesEnergieMax", regle: "positif_ou_nul", libelle: "dépenses d'énergie (maximum)" },
  { dto: CreateBienDto, champ: "valeurAcquisition", regle: "positif_ou_nul", libelle: "valeur d'acquisition" },
  { dto: UpdateBienDto, champ: "valeurAcquisition", regle: "positif_ou_nul", libelle: "valeur d'acquisition" },
  { dto: CreateBienDto, champ: "chargesCoproAnnuelles", regle: "positif_ou_nul", libelle: "charges de copropriété annuelles" },
  { dto: UpdateBienDto, champ: "chargesCoproAnnuelles", regle: "positif_ou_nul", libelle: "charges de copropriété annuelles" },
  { dto: CreateSinistreDto, champ: "montantReclame", regle: "positif_ou_nul", libelle: "montant réclamé" },
  { dto: UpdateSinistreDto, champ: "montantReclame", regle: "positif_ou_nul", libelle: "montant réclamé" },
  { dto: CreateSinistreDto, champ: "montantIndemnise", regle: "positif_ou_nul", libelle: "montant indemnisé" },
  { dto: UpdateSinistreDto, champ: "montantIndemnise", regle: "positif_ou_nul", libelle: "montant indemnisé" },
  { dto: CreateSinistreDto, champ: "franchise", regle: "positif_ou_nul", libelle: "franchise" },
  { dto: UpdateSinistreDto, champ: "franchise", regle: "positif_ou_nul", libelle: "franchise" },
  { dto: CreateCandidatDto, champ: "revenuMensuelNet", regle: "positif_ou_nul", libelle: "revenu mensuel net" },
  { dto: UpdateCandidatDto, champ: "revenuMensuelNet", regle: "positif_ou_nul", libelle: "revenu mensuel net" },
  { dto: CreateCandidatDto, champ: "loyerVise", regle: "positif_ou_nul", libelle: "loyer visé" },
  { dto: UpdateCandidatDto, champ: "loyerVise", regle: "positif_ou_nul", libelle: "loyer visé" },
  { dto: CreateCandidatDto, champ: "garantRevenuMensuelNet", regle: "positif_ou_nul", libelle: "revenu mensuel net du garant" },
  { dto: UpdateCandidatDto, champ: "garantRevenuMensuelNet", regle: "positif_ou_nul", libelle: "revenu mensuel net du garant" },
  ...(["ligne2", "ligne3", "ligne4", "ligne10", "ligne11", "ligne14", "ligne15", "ligne19", "ligne20", "ligne22"] as const).map(
    (champ): CasMontant => ({
      dto: SaisieManuelleAnnexe1Dto,
      champ,
      regle: "positif_ou_nul",
      libelle: `ligne ${champ.slice("ligne".length)} de l'annexe 1`
    })
  ),
  { dto: SaisieManuelleAnnexe1Dto, champ: "ligne9Bis", regle: "positif_ou_nul", libelle: "ligne 9 bis de l'annexe 1" }
];

async function messagesDuChamp(dto: new () => object, champ: string, valeur: unknown): Promise<string[]> {
  const erreurs = await validate(plainToInstance(dto, { [champ]: valeur }));
  const erreur = erreurs.find((e) => e.property === champ);
  return Object.values(erreur?.constraints ?? {});
}

describe("Bornes des montants saisis — chaque champ de chaque DTO", () => {
  for (const cas of CAS) {
    const nom = `${cas.dto.name}.${cas.champ} (${cas.regle === "strictement_positif" ? "> 0" : ">= 0"})`;

    describe(nom, () => {
      it("accepte un montant positif, virgule ou point", async () => {
        expect(await messagesDuChamp(cas.dto, cas.champ, "12.50")).toEqual([]);
        expect(await messagesDuChamp(cas.dto, cas.champ, "1 250,50")).toEqual([]);
      });

      it.each(["-5", "-0.01"])("refuse « %s », message qui nomme le champ", async (valeur) => {
        const messages = await messagesDuChamp(cas.dto, cas.champ, valeur);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain(`« ${cas.libelle} »`);
        expect(messages[0]).toContain("négatif");
      });

      if (cas.regle === "strictement_positif") {
        it.each(["0", "0.00"])("refuse « %s »", async (valeur) => {
          const messages = await messagesDuChamp(cas.dto, cas.champ, valeur);
          expect(messages).toHaveLength(1);
          expect(messages[0]).toContain(`« ${cas.libelle} »`);
          expect(messages[0]).toContain("supérieur à 0");
        });
      } else {
        it.each(["0", "0.00"])("accepte « %s »", async (valeur) => {
          expect(await messagesDuChamp(cas.dto, cas.champ, valeur)).toEqual([]);
        });
      }

      it.each(["1.234", "+5", "1e3", "abc"])("refuse le format « %s »", async (valeur) => {
        const messages = await messagesDuChamp(cas.dto, cas.champ, valeur);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain(`« ${cas.libelle} »`);
      });

      it("refuse un montant au-delà du plafond de la colonne", async () => {
        const trop = cas.champ === "valeurAcquisition" ? "10000000000" : "100000000";
        const messages = await messagesDuChamp(cas.dto, cas.champ, trop);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("dépasser");
      });
    });
  }
});

// Même pipe que main.ts : 400 et message lisible ; un PATCH qui ne touche
// pas au montant reste accepté (une fiche ancienne reste modifiable).
describe("ValidationPipe (comme main.ts)", () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  async function transformer(dto: new () => object, corps: Record<string, unknown>): Promise<unknown> {
    return pipe.transform(corps, { type: "body", metatype: dto });
  }

  it("PATCH /paiements/:id avec montant 0 : 400, message en français qui nomme le champ", async () => {
    const promesse = transformer(UpdatePaiementDto, { montant: "0" });
    await expect(promesse).rejects.toBeInstanceOf(BadRequestException);
    const reponse = (await promesse.catch((e: BadRequestException) => e.getResponse())) as { message: string[] };
    expect(reponse.message).toEqual(["Montant invalide pour « montant de l'échéance » : il doit être supérieur à 0 €."]);
  });

  it("PATCH sans montant : accepté (paiement, bail, appartement, bien, sinistre, candidat)", async () => {
    await expect(transformer(UpdatePaiementDto, { dateEcheance: "2026-12-05" })).resolves.toBeDefined();
    await expect(transformer(UpdateBailDto, { jourEcheance: 5 })).resolves.toBeDefined();
    await expect(transformer(UpdateAppartementDto, { numero: "12" })).resolves.toBeDefined();
    await expect(transformer(UpdateBienDto, { ville: "Brive" })).resolves.toBeDefined();
    await expect(transformer(UpdateSinistreDto, { description: "Dégât des eaux" })).resolves.toBeDefined();
    await expect(transformer(UpdateCandidatDto, { nom: "Martin" })).resolves.toBeDefined();
  });

  it("un champ facultatif remis à vide (null) reste accepté", async () => {
    await expect(transformer(UpdateAppartementDto, { loyerReference: null })).resolves.toBeDefined();
  });

  it("le montant validé est normalisé (virgule → point, espaces retirés)", async () => {
    const dto = (await transformer(UpdatePaiementDto, { montant: " 1 250,50 " })) as { montant: string };
    expect(dto.montant).toBe("1250.50");
  });
});
