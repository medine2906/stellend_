const TR_IBAN_LENGTH = 26;

/**
 * Normalizes a Turkish IBAN to its compact form, or returns null if it is not one.
 * Validates the ISO 13616 mod-97 checksum, which catches the mistyped digit that
 * would otherwise send someone's cash advance to a stranger's account.
 */
export function normalizeIban(input: string): string | null {
  const iban = input.replace(/[\s-]/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(iban) || iban.length !== TR_IBAN_LENGTH) return null;

  // Move the country code and check digits to the end, map letters to numbers, mod 97.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return mod97(digits) === 1 ? iban : null;
}

function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/**
 * Builds a TR IBAN with correct check digits from a 22-digit account part.
 * Used by the sandbox bank, whose accounts have to pass the same validation as real ones.
 */
export function buildTrIban(bban: string): string {
  if (!/^\d{22}$/.test(bban)) throw new Error("A Turkish IBAN's account part is 22 digits");
  // "TR" maps to 29 27, and the check digits are zero while they are being computed.
  const check = String(98 - mod97(`${bban}292700`)).padStart(2, "0");
  return `TR${check}${bban}`;
}

/** Groups a compact IBAN for display: TR00 0000 0000 0000 0000 0000 00. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}
