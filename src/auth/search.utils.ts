export const escapeSearchText = (value: string) =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

export function buildSearchPatterns(search: string) {
  const escape = escapeSearchText;
  return {
    search: `%${escape(search)}%`,
    similarSearch: `%${[...search].map(escape).join('%')}%`,
  };
}
