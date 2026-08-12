const CONTROL_CHARACTERS = /\p{Cc}/u;
const BIDI_CONTROL_CHARACTERS = /\p{Bidi_Control}/u;
const DEFAULT_IGNORABLE_CHARACTER = /\p{Default_Ignorable_Code_Point}/u;

const identitySafeDefaultIgnorable = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
};

const hasUnsafeIdentityCharacter = (value: string): boolean => (
  CONTROL_CHARACTERS.test(value)
  || BIDI_CONTROL_CHARACTERS.test(value)
  || [...value].some((character) => (
    DEFAULT_IGNORABLE_CHARACTER.test(character) && !identitySafeDefaultIgnorable(character)
  ))
);

const hasUnsafePublicCharacter = (value: string): boolean => (
  CONTROL_CHARACTERS.test(value)
  || BIDI_CONTROL_CHARACTERS.test(value)
  || DEFAULT_IGNORABLE_CHARACTER.test(value)
);

/**
 * Canonicalizes an untrusted display label without granting it any authority.
 * Callers must continue to authorize with a verified subject or owner id.
 */
export function canonicalDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (hasUnsafeIdentityCharacter(value)) return null;
  const normalized = value.normalize("NFKC");
  if (hasUnsafeIdentityCharacter(normalized)) return null;
  const canonical = normalized.replace(/\p{Z}+/gu, " ").trim();
  return canonical.length >= 1 && canonical.length <= 100 ? canonical : null;
}

/** Strict public-profile boundary: public labels cannot contain invisible formatting. */
export function canonicalPublicDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || hasUnsafePublicCharacter(value)) return null;
  const canonical = canonicalDisplayName(value);
  return canonical && !hasUnsafePublicCharacter(canonical) ? canonical : null;
}

/**
 * Produces a safe public label for an authenticated user without making their
 * editable OAuth metadata an authorization signal. A deterministic fallback
 * keeps publication available when the private profile label uses emoji or
 * unsafe formatting that cannot be emitted publicly.
 */
export function publicPublisherName(value: unknown, userId: string): string {
  const canonical = canonicalPublicDisplayName(value);
  if (canonical) return canonical;
  const suffix = userId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
  return `Member ${suffix || "TRADER"}`;
}
