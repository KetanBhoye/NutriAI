# Data sources and attribution

NutriAI's food figures come from other people's work. This file records what
came from where, on what terms, and what each source obliges us to do. It is
kept accurate because the obligations are real: two of these licences require
attribution as a condition of use, and one dataset's terms are still unresolved.

Every seeded row carries a `source_ref` (e.g. `INDB:ASC096`) so any number in a
user's diary can be traced back to the row it came from — including if that row
is later corrected or withdrawn.

---

## Indian Nutrient Databank (INDB)

**Used for**: the seeded library of Indian dishes (~815 rows). Not committed to
this repository; built by `scripts/indb-extract.py` + `scripts/indb-curate.ts`
from the published workbook.

**Status: PERMISSION NOT YET CONFIRMED.** The GitHub repository carries no
licence file, which under default copyright means all rights reserved, and its
README states that the underlying ICMR-NIN tables "must be requested from the
original source". Redistributing the data inside a published app is a different
act from analysing it in research. **Do not ship the seed file until written
permission is obtained** from the authors, or until terms are published that
clearly allow it.

> Anuvaad / Jaacks Lab. *Indian Nutrient Databank (INDB), version 2024.11.*
> https://www.anuvaad.org.in/indb/ ·
> https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-

INDB is itself derived from the sources below, which must be credited alongside
it because their values are what INDB's recipe calculations are built on:

> Longvah, T., Ananthan, R., Bhaskarachary, K., & Venkaiah, K. (2017).
> *Indian Food Composition Tables 2017.* National Institute of Nutrition,
> Indian Council of Medical Research, Hyderabad, India.

> Gopalan, C., Rama Sastri, B. V., & Balasubramanian, S. C. (2004).
> *Nutritive Value of Indian Foods* (revised by B. S. Narasinga Rao,
> Y. G. Deosthale & K. C. Pant). National Institute of Nutrition, Indian
> Council of Medical Research, Hyderabad, India.

> Public Health England (2021). *McCance and Widdowson's The Composition of
> Foods Integrated Dataset (CoFID).* Used by INDB for 144 ingredients absent
> from the Indian tables. Open Government Licence v3.0.

> U.S. Department of Agriculture, Agricultural Research Service.
> *FoodData Central.* Used by INDB for 54 further ingredients. Public domain
> (CC0 1.0).

The recipes INDB models come from two published cookery textbooks (Khanna et
al., *The Art & Science of Cooking*, Elite Publishing, 2007; Raina et al.,
*Basic Food Preparation: A Complete Manual*, Orient BlackSwan, 2011) plus 148
documented web recipes. We use the computed nutrient values, not the recipe
texts.

**What we changed**: values are stored per gram rather than per 100 g, portion
weights are derived from INDB's per-serving energy, and ~199 rows are excluded
by the rules in `src/services/food/indb.ts` — mostly deep-fried dishes whose
recipes count all the frying oil into the dish (poori at 95% of energy from
fat), and soups whose stated energy does not match their stated macros. Those
exclusions are ours, not INDB's, and should not be held against the source.

---

## Open Food Facts

**Used for**: barcode lookup (`GET /api/foods/barcode`) and text search
fallback (`GET /api/foods/lookup`), live at request time. No bulk copy is
stored; matched values are cached per user as ordinary library entries.

**Licence: Open Database Licence (ODbL) v1.0** — https://opendatacommons.org/licenses/odbl/1-0/
Product data is ODbL; individual images are CC BY-SA. **ODbL requires
attribution and, for a publicly used derived database, that the derived
database be offered under the same licence.** Caching a user's own looked-up
foods is use, not redistribution, but publishing a bulk export of
Open-Food-Facts-derived rows would trigger the share-alike term.

> Open Food Facts contributors. *Open Food Facts.* https://world.openfoodfacts.org

Requests identify the app in the `User-Agent` header, as Open Food Facts asks.

---

## USDA FoodData Central

**Used for**: text-search fallback when Open Food Facts returns nothing
(`src/services/food-lookup.ts`), if `FDC_API_KEY` is configured.

**Licence**: public domain (CC0 1.0) — no attribution required, credited here
anyway.

> U.S. Department of Agriculture, Agricultural Research Service.
> *FoodData Central.* https://fdc.nal.usda.gov

---

## Not used

Considered and rejected, recorded so the question is not reopened blind:

- **Kaggle "Indian Food Nutrition" (batthulavinay)** — ~250 dishes with no
  stated provenance or method. Superseded by INDB, which documents both.
- **Mendeley "Cleaned Indian Food Dataset" (xsphgmmh7b)** — 6,871 Indian
  recipes with ingredients and instructions, but **no nutrient values**. A food
  name with no macros is a dead end in a diary. Potentially useful later as
  vocabulary for search synonyms and speech-recognition hints, which would be a
  different use with its own attribution.

---

## Where users see this

The app surfaces these credits in **You → Data sources**, which links here. That
is the attribution requirement for ODbL discharged in the place a user can
actually find it, rather than buried in a repository they will never open.

## If you add a source

Add it here first, with its licence and what it obliges. A nutrition figure
whose origin nobody recorded cannot be defended when it turns out to be wrong,
and cannot be removed when a licence changes.
