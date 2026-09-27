// Small helpers for showing people: avatar initials when there's no image.

const SEPARATORS = /[\s._-]+/;

/** Up to two initials from a name or email ("Ada Lovelace" → "AL"). */
export const initialsOf = (name: string): string => {
  const local = name.includes("@") ? (name.split("@")[0] ?? name) : name;
  const letters = local
    .split(SEPARATORS)
    .filter((part) => part.length > 0)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
  return letters.slice(0, 2) || "?";
};
