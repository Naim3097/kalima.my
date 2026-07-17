export function formatRM(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasCents = rounded % 1 !== 0;
  return `RM${rounded.toLocaleString("en-MY", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}
