/** Escapes LIKE's wildcards (and its escape character), so the text matches literally (Prisma's `contains` is a LIKE). */
export function likeEscape(text: string) {
  return text.replace(/[\\%_]/g, '\\$&');
}
