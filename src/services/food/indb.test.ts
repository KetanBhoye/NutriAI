import { describe, expect, it } from 'vitest';
import { FALLBACK_SERVING_G, curate, curateRow, nameVariants, servingGrams, type IndbRow } from './indb.js';

/**
 * The fixtures are real rows from the published INDB workbook, values and all.
 * A curation rule tested against invented numbers proves nothing about the data
 * it will actually meet.
 */
function row(over: Partial<IndbRow> & { food_code: string; food_name: string }): IndbRow {
  return {
    energy_kcal: 200,
    carb_g: 30,
    protein_g: 6,
    fat_g: 6,
    servings_unit: 'bowl',
    unit_serving_energy_kcal: 200,
    ...over,
  };
}

/** Chapati/Roti — 202.3 kcal/100g, one chapati is 72.8 kcal. */
const chapati = row({
  food_code: 'ASC002',
  food_name: 'Chapati/Roti',
  energy_kcal: 202.3,
  carb_g: 39.4,
  protein_g: 5.9,
  fat_g: 2.5,
  servings_unit: 'chapati',
  unit_serving_energy_kcal: 72.8,
});

describe('curateRow', () => {
  it('keeps a good row, stored per gram', () => {
    const result = curateRow(chapati);
    expect('food' in result).toBe(true);
    if (!('food' in result)) return;

    expect(result.food.canonical_name).toBe('Chapati/Roti');
    expect(result.food.calories_per_unit).toBeCloseTo(2.023, 3);
    expect(result.food.protein_g_per_unit).toBeCloseTo(0.059, 3);
    expect(result.food.reference_unit).toBe('g');
    // 72.8 kcal at 202.3 kcal/100g is a 36 g chapati.
    expect(result.food.default_quantity).toBe(36);
    expect(result.food.source_ref).toBe('INDB:ASC002');
  });

  describe('rows that must not reach a diary', () => {
    it('rejects a rice dish that is 60% fat — all the frying oil counted in', () => {
      // Paneer pulao, verbatim: energy matches macros to 1%, and is still wrong.
      const pulao = row({
        food_code: 'ASC500',
        food_name: 'Paneer pulao',
        energy_kcal: 581.9,
        carb_g: 8.8,
        protein_g: 2.0,
        fat_g: 59.8,
      });
      const result = curateRow(pulao);

      expect('rejected' in result).toBe(true);
      if ('rejected' in result) expect(result.rejected.reason).toBe('implausible_fat');
    });

    it('rejects the deep-fried cutlet for the same reason', () => {
      const cutlet = row({
        food_code: 'BFP200',
        food_name: 'Flattened rice cutlet (Chirwa cutlet)',
        energy_kcal: 701.7,
        carb_g: 7.4,
        protein_g: 1.8,
        fat_g: 73.9,
      });

      expect('rejected' in curateRow(cutlet)).toBe(true);
    });

    it('rejects energy that does not match the macros', () => {
      const result = curateRow(row({ food_code: 'X1', food_name: 'Wrong', energy_kcal: 500 }));

      expect('rejected' in result).toBe(true);
      if ('rejected' in result) expect(result.rejected.reason).toBe('energy_macro_mismatch');
    });

    it('rejects anything denser than pure fat', () => {
      const result = curateRow(
        row({ food_code: 'X2', food_name: 'Impossible', energy_kcal: 950, fat_g: 105, carb_g: 0, protein_g: 0 })
      );

      expect('rejected' in result).toBe(true);
      if ('rejected' in result) expect(result.rejected.reason).toBe('impossible_energy');
    });

    it('explains itself with the numbers that caused the rejection', () => {
      const result = curateRow(row({ food_code: 'X3', food_name: 'Wrong', energy_kcal: 500 }));

      if ('rejected' in result) expect(result.rejected.detail).toMatch(/kcal/);
    });
  });

  describe('food that really is mostly fat', () => {
    it('keeps ghee, which no plausibility rule should second-guess', () => {
      const ghee = row({
        food_code: 'IFCT1',
        food_name: 'Ghee',
        energy_kcal: 900,
        carb_g: 0,
        protein_g: 0,
        fat_g: 100,
      });

      expect('food' in curateRow(ghee)).toBe(true);
    });

    it('keeps a coconut chutney, which is legitimately fat-heavy', () => {
      const chutney = row({
        food_code: 'ASC300',
        food_name: 'Coconut chutney (Nariyal chutney)',
        energy_kcal: 300,
        carb_g: 8,
        protein_g: 3,
        fat_g: 28,
      });

      expect('food' in curateRow(chutney)).toBe(true);
    });

    it('still keeps a rich korma, below the threshold', () => {
      const korma = row({
        food_code: 'ASC301',
        food_name: 'Mutton korma',
        energy_kcal: 220,
        carb_g: 5,
        protein_g: 14,
        fat_g: 16,
      });

      expect('food' in curateRow(korma)).toBe(true);
    });
  });
});

describe('servingGrams', () => {
  it('derives the portion weight from the serving energy', () => {
    expect(servingGrams(chapati)).toBe(36);
  });

  it('falls back when the serving is really the whole recipe', () => {
    // Tandoori chicken, verbatim: 145.2 kcal/100g, "serving" 2092 kcal = 1441 g.
    const wholeBird = row({
      food_code: 'ASC400',
      food_name: 'Tandoori chicken',
      energy_kcal: 145.2,
      carb_g: 3,
      protein_g: 20,
      fat_g: 6,
      unit_serving_energy_kcal: 2092,
    });

    expect(servingGrams(wholeBird)).toBe(FALLBACK_SERVING_G);
  });

  it('falls back when the serving figure is missing or absurd', () => {
    expect(servingGrams(row({ food_code: 'a', food_name: 'x', unit_serving_energy_kcal: null }))).toBe(
      FALLBACK_SERVING_G
    );
    expect(servingGrams(row({ food_code: 'b', food_name: 'x', unit_serving_energy_kcal: 1 }))).toBe(
      FALLBACK_SERVING_G
    );
  });
});

describe('nameVariants', () => {
  it('splits the local name from the English one', () => {
    expect(nameVariants('Chapati/Roti')).toEqual(['Chapati', 'Roti']);
  });

  it('pulls the local names out of the brackets', () => {
    expect(nameVariants('Semolina porridge (Suji/Rava daliya)')).toEqual([
      'Semolina porridge',
      'Suji',
      'Rava daliya',
    ]);
  });

  it('leaves a plain name alone', () => {
    expect(nameVariants('Poha')).toEqual(['Poha']);
  });
});

describe('curate', () => {
  it('separates the shippable rows from the rejected ones', () => {
    const { foods, rejected } = curate([
      chapati,
      row({ food_code: 'X', food_name: 'Broken', energy_kcal: 900, fat_g: 1, carb_g: 1, protein_g: 1 }),
    ]);

    expect(foods.map((f) => f.canonical_name)).toEqual(['Chapati/Roti']);
    expect(rejected.map((r) => r.food_code)).toEqual(['X']);
  });

  it('keeps the first of two rows that normalise to the same name', () => {
    const { foods, rejected } = curate([
      chapati,
      row({ ...chapati, food_code: 'DUP', food_name: 'Roti/Chapati' }),
    ]);

    expect(foods).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('duplicate_key');
  });

  it('needs no alias when the normaliser already treats the names as one', () => {
    const { foods } = curate([chapati]);

    // food-normalize.ts maps roti -> chapati, so "Chapati/Roti" is a single
    // key and searching either word already finds it.
    expect(foods[0]?.normalized_key).toBe('chapati');
    expect(foods[0]?.aliases).toEqual([]);
  });

  it('records an alias when the other name is a genuinely different word', () => {
    const daliya = row({
      food_code: 'BFP010',
      food_name: 'Semolina porridge (Suji/Rava daliya)',
      energy_kcal: 100.9,
      carb_g: 16,
      protein_g: 3.8,
      fat_g: 2.5,
    });
    const { foods } = curate([daliya]);

    // "suji" is not a synonym of "semolina porridge" anywhere in the app, so
    // without this row a search for it finds nothing.
    expect(foods[0]?.aliases).toContain('suji');
  });
});
