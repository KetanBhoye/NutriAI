import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteD1Database } from '../db/sqlite-adapter.js';
import { FoodLibraryRepository } from './food-library.repository.js';

/**
 * These run against a real in-memory SQLite rather than a mock: the ranking
 * lives entirely in SQL (EXP/julianday decay), so a mocked db would verify
 * nothing about the behaviour that matters.
 */
let raw: Database.Database;
let repo: FoodLibraryRepository;

function daysAgo(n: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().split('T')[0]!;
}

let foodSeq = 0;
function addFood(name: string, caloriesPerUnit = 100, unit = 'serving'): string {
  foodSeq += 1;
  const id = `food-${foodSeq}`;
  raw
    .prepare(
      `INSERT INTO foods (id, user_id, canonical_name, normalized_key, reference_unit,
        reference_quantity, calories_per_unit, default_quantity, source)
       VALUES (?, 'admin', ?, ?, ?, 1, ?, 1, 'history')`
    )
    .run(id, name, name.toLowerCase(), unit, caloriesPerUnit);
  return id;
}

let entrySeq = 0;
function addEntry(foodId: string, meal: string, date: string): void {
  entrySeq += 1;
  raw
    .prepare(
      `INSERT INTO food_entries (id, user_id, food_name, calories, meal_type, entry_date, food_id)
       VALUES (?, 'admin', 'x', 100, ?, ?, ?)`
    )
    .run(`entry-${entrySeq}`, meal, date, foodId);
}

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE foods (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL, reference_unit TEXT NOT NULL,
      reference_quantity REAL NOT NULL DEFAULT 1, calories_per_unit REAL NOT NULL,
      protein_g_per_unit REAL, carbs_g_per_unit REAL, fat_g_per_unit REAL,
      default_quantity REAL NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'history'
    );
    CREATE TABLE food_aliases (
      id TEXT PRIMARY KEY, food_id TEXT NOT NULL, user_id TEXT NOT NULL,
      alias_key TEXT NOT NULL, original_name TEXT NOT NULL
    );
    CREATE TABLE food_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, food_name TEXT NOT NULL,
      calories INTEGER NOT NULL, protein_g REAL, carbs_g REAL, fat_g REAL,
      meal_type TEXT, entry_date DATE NOT NULL, food_id TEXT, quantity REAL, unit TEXT
    );
  `);
  repo = new FoodLibraryRepository(new SqliteD1Database(raw));
  foodSeq = 0;
  entrySeq = 0;
});

describe('suggestForMeal', () => {
  it('ranks a recent habit above an equally frequent old one', () => {
    const recent = addFood('Recent Muesli');
    const old = addFood('Old Muesli');
    for (let i = 0; i < 5; i += 1) {
      addEntry(recent, 'breakfast', daysAgo(i + 1));
      addEntry(old, 'breakfast', daysAgo(i + 70));
    }

    return repo.suggestForMeal('admin', 'breakfast').then((results) => {
      expect(results[0]!.canonical_name).toBe('Recent Muesli');
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });
  });

  it('does not let a single recent food outrank an established staple', () => {
    const staple = addFood('Avvatar Whey');
    for (let i = 0; i < 20; i += 1) addEntry(staple, 'snack', daysAgo(i + 2));

    const oneOff = addFood('Random Fruit Plate');
    addEntry(oneOff, 'snack', daysAgo(0));

    return repo.suggestForMeal('admin', 'snack').then((results) => {
      expect(results[0]!.canonical_name).toBe('Avvatar Whey');
    });
  });

  it('offers every food the user has logged, whatever meal it was at', () => {
    // This used to filter by meal, which hid food: someone whose lunch was
    // once poha saw an empty lunch sheet. Everything is offered now.
    const breakfastFood = addFood('Muesli');
    const dinnerFood = addFood('Rice');
    addEntry(breakfastFood, 'breakfast', daysAgo(1));
    addEntry(dinnerFood, 'dinner', daysAgo(1));

    return repo.suggestForMeal('admin', 'dinner').then((results) => {
      expect(results.map((r) => r.canonical_name).sort()).toEqual(['Muesli', 'Rice']);
    });
  });

  it('still leads with the food usually eaten at that meal', () => {
    const breakfastFood = addFood('Muesli');
    const dinnerFood = addFood('Rice');
    addEntry(breakfastFood, 'breakfast', daysAgo(1));
    addEntry(dinnerFood, 'dinner', daysAgo(1));

    return repo.suggestForMeal('admin', 'breakfast').then((results) => {
      expect(results[0]!.canonical_name).toBe('Muesli');
    });
  });

  it('lets a real habit outrank the meal preference', () => {
    // A staple eaten every night belongs above a one-off breakfast item, even
    // in the breakfast list — the meal tilts the order, it does not decide it.
    const oneOff = addFood('Cornflakes');
    const staple = addFood('Dal');
    addEntry(oneOff, 'breakfast', daysAgo(2));
    for (let i = 1; i <= 10; i += 1) addEntry(staple, 'dinner', daysAgo(i));

    return repo.suggestForMeal('admin', 'breakfast').then((results) => {
      expect(results[0]!.canonical_name).toBe('Dal');
    });
  });

  it('does not leak another user\'s history', () => {
    const food = addFood('Mine');
    addEntry(food, 'lunch', daysAgo(1));
    raw
      .prepare(
        `INSERT INTO food_entries (id, user_id, food_name, calories, meal_type, entry_date, food_id)
         VALUES ('other-1', 'someone-else', 'x', 100, 'lunch', ?, ?)`
      )
      .run(daysAgo(1), food);

    return repo.suggestForMeal('admin', 'lunch').then((results) => {
      expect(results[0]!.times_logged).toBe(1);
    });
  });

  it('returns an empty list for a slot with no history', () => {
    return repo.suggestForMeal('admin', 'dinner').then((results) => {
      expect(results).toEqual([]);
    });
  });

  it('respects the limit', () => {
    for (let i = 0; i < 12; i += 1) {
      const food = addFood(`Food ${i}`);
      addEntry(food, 'lunch', daysAgo(i + 1));
    }

    return repo.suggestForMeal('admin', 'lunch', 5).then((results) => {
      expect(results).toHaveLength(5);
    });
  });
});

describe('findByName', () => {
  it('matches on the normalised key regardless of casing and quantity', async () => {
    raw
      .prepare(
        `INSERT INTO foods (id, user_id, canonical_name, normalized_key, reference_unit,
          reference_quantity, calories_per_unit, default_quantity, source)
         VALUES ('f1', 'admin', 'Cooked White Rice (150g)', 'cooked rice white', 'g', 1, 1.3, 150, 'history')`
      )
      .run();

    const found = await repo.findByName('admin', 'white rice cooked (200g)');
    expect(found?.id).toBe('f1');
  });

  it('falls back to an alias', async () => {
    raw
      .prepare(
        `INSERT INTO foods (id, user_id, canonical_name, normalized_key, reference_unit,
          reference_quantity, calories_per_unit, default_quantity, source)
         VALUES ('f1', 'admin', 'Avvatar Whey', 'avvatar whey', 'scoop', 1, 130, 1, 'history')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO food_aliases (id, food_id, user_id, alias_key, original_name)
         VALUES ('a1', 'f1', 'admin', 'avvatar protein whey', 'Avvatar Whey Protein')`
      )
      .run();

    const found = await repo.findByName('admin', 'Avvatar Whey Protein (1 scoop)');
    expect(found?.id).toBe('f1');
  });

  it('returns null for an unknown food, signalling external lookup', async () => {
    expect(await repo.findByName('admin', 'Something Never Eaten')).toBeNull();
  });
});

describe('upsert', () => {
  it('returns the existing id instead of duplicating a food', async () => {
    const first = await repo.upsert('admin', {
      canonical_name: 'Greek Yogurt',
      reference_unit: 'g',
      calories_per_unit: 0.59,
      protein_g_per_unit: 0.1,
      carbs_g_per_unit: 0.036,
      fat_g_per_unit: 0.004,
      default_quantity: 100,
      source: 'openfoodfacts',
    });

    const second = await repo.upsert('admin', {
      canonical_name: 'greek yogurt',
      reference_unit: 'g',
      calories_per_unit: 0.59,
      protein_g_per_unit: 0.1,
      carbs_g_per_unit: 0.036,
      fat_g_per_unit: 0.004,
      default_quantity: 100,
      source: 'manual',
    });

    expect(second).toBe(first);
    expect((raw.prepare('SELECT COUNT(*) n FROM foods').get() as { n: number }).n).toBe(1);
  });
});

describe('entry linking (regression)', () => {
  it('findByName resolves a free-text name so MCP entries still feed suggestions', async () => {
    raw
      .prepare(
        `INSERT INTO foods (id, user_id, canonical_name, normalized_key, reference_unit,
          reference_quantity, calories_per_unit, default_quantity, source)
         VALUES ('f1', 'admin', 'Cooked White Rice (150g)', 'cooked rice white', 'g', 1, 1.3, 150, 'history')`
      )
      .run();

    // The shape a conversational client would send.
    const found = await repo.findByName('admin', 'Cooked White Rice (200g)');
    expect(found?.id).toBe('f1');
  });

  it('an entry linked to a food is picked up by suggestions immediately', async () => {
    const food = addFood('Avvatar Whey', 130, 'scoop');
    addEntry(food, 'snack', daysAgo(0));

    const results = await repo.suggestForMeal('admin', 'snack');
    expect(results).toHaveLength(1);
    expect(results[0]!.times_logged).toBe(1);
  });
});
