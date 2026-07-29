const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase
const GROUPS = 5;
const GROUP_LEN = 4;

/**
 * 20 chars of Crockford base32 = 100 bits of entropy. Codes are shared as
 * links/QR (never typed), and the server rate-limits join attempts, so this
 * is far beyond online-guessable.
 */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(GROUPS * GROUP_LEN);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(''));
  }
  return groups.join('-');
}

/** Lowercase, map easily-confused chars, strip separators/whitespace. */
export function normalizeRoomCode(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
    .replace(/u/g, 'v')
    .replace(/[^0123456789abcdefghjkmnpqrstvwxyz]/g, '');
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += GROUP_LEN) {
    groups.push(cleaned.slice(i, i + GROUP_LEN));
  }
  return groups.join('-');
}

export function isValidRoomCode(code: string): boolean {
  return new RegExp(`^([${ALPHABET}]{${GROUP_LEN}}-){${GROUPS - 1}}[${ALPHABET}]{${GROUP_LEN}}$`).test(code);
}
