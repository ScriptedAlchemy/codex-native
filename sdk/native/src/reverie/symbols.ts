/**
 * Symbol Extraction for Reverie Search
 *
 * Extracts key code symbols from diffs to create more focused search queries.
 * This improves search precision by targeting specific functions, classes, and variables.
 */

/**
 * Extracts key symbols and terms from a diff to make search queries more targeted.
 *
 * Focuses on:
 * - Function and class definitions
 * - Variable declarations (const, let, var)
 * - Exported symbols
 * - Interface and type definitions
 *
 * Avoids:
 * - Language keywords (true, false, null, etc.)
 * - Very short symbols (< 3 chars)
 * - Boilerplate patterns
 *
 * @param diff - Git diff content to extract symbols from
 * @returns Comma-separated string of top 5 symbols, or "code changes" if none found
 *
 * @example
 * ```typescript
 * const diff = `
 * +function processUser(user: User) {
 * +  const userName = user.name;
 * +  return userName;
 * +}
 * `;
 *
 * extractKeySymbols(diff); // "processUser, userName"
 * ```
 */
export function extractKeySymbols(diff: string): string {
  // Extract function/class names, avoiding boilerplate patterns
  const symbols = new Set<string>();

  // Match function/class definitions, variable declarations, exports, interfaces, types
  const functionMatch = diff.match(/(?:function|class|const|let|var|export|interface|type)\s+(\w+)/g);

  if (functionMatch) {
    for (const match of functionMatch) {
      const name = match.split(/\s+/).pop();

      // Filter out keywords and very short symbols
      if (name && name.length > 2 && !name.match(/^(true|false|null|undefined|const|let|var)$/)) {
        symbols.add(name);
      }
    }
  }

  // If no symbols found, return a generic placeholder
  if (symbols.size === 0) {
    return "code changes";
  }

  // Return top 5 symbols as comma-separated string
  return Array.from(symbols).slice(0, 5).join(", ");
}
