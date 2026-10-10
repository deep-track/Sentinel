/** Up to two uppercase initials from a name ("Acme Holdings Ltd" -> "AH"). */
export function getInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}
