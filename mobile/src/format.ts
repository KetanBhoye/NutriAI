/** Small display-formatting helpers shared across screens. */

/** "breakfast" → "Breakfast". For meal names, which the API returns lowercase. */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
