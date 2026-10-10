/**
 * Parses a user-entered investment amount ("250000", "250,000.50").
 * Returns null unless it is a finite, positive number.
 */
export function parseInvestmentAmount(value: string | undefined | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
