/**
 * Utility functions for safe number handling and formatting
 * Prevents crashes from Prisma Decimal types and improper type conversions
 */

/**
 * Safely converts a value to a number with fallback
 * Handles Prisma Decimal, strings, numbers, null, undefined
 */
export function toNumberSafe(value: any, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  
  // Handle string
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }
  
  // Handle number
  if (typeof value === "number") {
    return isNaN(value) ? fallback : value;
  }
  
  // Handle objects with toNumber method (like Prisma Decimal)
  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  
  // Handle Prisma Decimal-like objects without importing
  if (value && value.constructor && value.constructor.name === "Decimal") {
    return value.toNumber();
  }
  
  return fallback;
}

/**
 * Format a value as CHF currency
 * Example: 1234.56 => "CHF 1'234.56"
 */
export function formatMoneyCHF(value: any): string {
  const num = toNumberSafe(value, 0);
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a value as a percentage
 * Example: 0.2596 => "25.96%" or 25.96 => "25.96%"
 */
export function formatPercent(value: any, decimals: number = 2): string {
  const num = toNumberSafe(value, 0);
  // If value is between 0-1, treat as decimal (multiply by 100)
  // If value is > 1, treat as already percentage
  const percentage = num < 1 && num > 0 ? num * 100 : num;
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Safely format a number to fixed decimal places
 */
export function toFixedSafe(value: any, decimals: number = 2): string {
  const num = toNumberSafe(value, 0);
  return num.toFixed(decimals);
}

/**
 * Convert Prisma Decimal fields in an object to numbers
 * Useful for API responses to ensure frontend doesn't get Decimal objects
 */
export function decimalsToNumbers<T extends Record<string, any>>(
  obj: T,
  fields?: string[]
): T {
  if (!obj) return obj;
  
  const result = { ...obj } as Record<string, any>;
  const keysToConvert = fields || Object.keys(result);
  
  for (const key of keysToConvert) {
    if (key in result) {
      result[key] = toNumberSafe(result[key], result[key]);
    }
  }
  
  return result;
}

/**
 * Calculate percentage safely
 */
export function calculatePercent(part: any, whole: any): number {
  const partNum = toNumberSafe(part, 0);
  const wholeNum = toNumberSafe(whole, 0);
  
  if (wholeNum === 0) return 0;
  return (partNum / wholeNum) * 100;
}

