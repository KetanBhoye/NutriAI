import { FoodEntry, AddEntryParams, UpdateEntryParams, ListEntriesParams } from '../types/index.js';

export class FoodEntryRepository {
  constructor(private db: any) {}

  async create(entryData: AddEntryParams, userId: string): Promise<string> {
    const entryId = crypto.randomUUID();
    const entryDate = entryData.entry_date || new Date().toISOString().split('T')[0];

    await this.db.prepare(
      `
      INSERT INTO food_entries (id, user_id, food_name, calories, protein_g, carbs_g, fat_g, meal_type, entry_date, food_id, quantity, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        entryId,
        userId,
        entryData.food_name,
        entryData.calories,
        entryData.protein_g || null,
        entryData.carbs_g || null,
        entryData.fat_g || null,
        entryData.meal_type || null,
        entryDate,
        entryData.food_id || null,
        entryData.quantity ?? null,
        entryData.unit || null
      )
      .run();

    return entryId;
  }

  async findByUserAndDate(userId: string, params: ListEntriesParams = {}): Promise<FoodEntry[]> {
    const { date, limit = 10, offset = 0 } = params;

    const result = await this.db.prepare(
      `
      SELECT * FROM food_entries
      WHERE user_id = ? AND entry_date = COALESCE(?, CURRENT_DATE)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `
    )
      .bind(userId, date || null, limit, offset)
      .all();

    return result.results;
  }

  async update(entryId: string, userId: string, updateData: Omit<UpdateEntryParams, 'entry_id'>): Promise<boolean> {
    const updates: string[] = [];
    const values: any[] = [];

    if (updateData.food_name !== undefined) {
      updates.push('food_name = ?');
      values.push(updateData.food_name);
    }
    if (updateData.calories !== undefined) {
      updates.push('calories = ?');
      values.push(updateData.calories);
    }
    if (updateData.protein_g !== undefined) {
      updates.push('protein_g = ?');
      values.push(updateData.protein_g);
    }
    if (updateData.carbs_g !== undefined) {
      updates.push('carbs_g = ?');
      values.push(updateData.carbs_g);
    }
    if (updateData.fat_g !== undefined) {
      updates.push('fat_g = ?');
      values.push(updateData.fat_g);
    }
    if (updateData.meal_type !== undefined) {
      updates.push('meal_type = ?');
      values.push(updateData.meal_type);
    }
    // Re-portioning an entry rewrites its macros; the weight has to move with
    // them, or reopening the entry shows the old portion against new macros.
    if (updateData.quantity !== undefined) {
      updates.push('quantity = ?');
      values.push(updateData.quantity);
    }
    if (updateData.unit !== undefined) {
      updates.push('unit = ?');
      values.push(updateData.unit);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(entryId, userId);

    const result = await this.db.prepare(
      `
      UPDATE food_entries 
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
      `
    )
      .bind(...values)
      .run();

    return result.meta.changes > 0;
  }

  /**
   * Per-day totals for the last `days` days, oldest first. Days with no
   * entries are omitted rather than returned as zeros — the caller needs to
   * tell "ate nothing logged" apart from "didn't log", and the history has
   * real gaps (travel) that must not read as zero-calorie days.
   */
  async getDailyTotals(
    userId: string,
    days = 30
  ): Promise<
    Array<{
      entry_date: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      entry_count: number;
    }>
  > {
    const result = await this.db
      .prepare(
        `
        SELECT
          entry_date,
          SUM(calories) AS calories,
          COALESCE(SUM(protein_g), 0) AS protein_g,
          COALESCE(SUM(carbs_g), 0) AS carbs_g,
          COALESCE(SUM(fat_g), 0) AS fat_g,
          COUNT(*) AS entry_count
        FROM food_entries
        WHERE user_id = ? AND entry_date >= date('now', ?)
        GROUP BY entry_date
        ORDER BY entry_date ASC
        `
      )
      .bind(userId, `-${days} days`)
      .all();

    return result.results;
  }

  async delete(entryId: string, userId: string): Promise<boolean> {
    const result = await this.db.prepare(
      `DELETE FROM food_entries WHERE id = ? AND user_id = ?`
    )
      .bind(entryId, userId)
      .run();

    return result.meta.changes > 0;
  }
}
