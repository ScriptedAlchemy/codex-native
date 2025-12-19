export type SkillDefinition = {
  /**
   * Skill name referenced via `$<name>` (default) or `@<name>` in prompts.
   */
  name: string;
  /**
   * Optional human description (not currently injected automatically).
   */
  description?: string;
  /**
   * The skill body/instructions that will be injected when referenced.
   */
  contents: string;
};

export type SkillRegistry = Map<string, SkillDefinition>;

export type SkillMentionTrigger = "$" | "@";

function normalizeOneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function validateSkillDefinition(skill: SkillDefinition): void {
  if (!skill || typeof skill !== "object") {
    throw new Error("Skill must be an object");
  }

  if (typeof skill.name !== "string") {
    throw new Error("Skill.name must be a string");
  }
  const name = normalizeOneLine(skill.name);
  if (name.length === 0) {
    throw new Error("Skill.name must be non-empty");
  }
  if (name.length > 100) {
    throw new Error("Skill.name must be <= 100 characters");
  }

  if (skill.description !== undefined) {
    if (typeof skill.description !== "string") {
      throw new Error("Skill.description must be a string when provided");
    }
    const description = normalizeOneLine(skill.description);
    if (description.length > 500) {
      throw new Error("Skill.description must be <= 500 characters");
    }
  }

  if (typeof skill.contents !== "string") {
    throw new Error("Skill.contents must be a string");
  }
  if (skill.contents.length === 0) {
    throw new Error("Skill.contents must be non-empty");
  }
}

export function normalizeSkillDefinition(skill: SkillDefinition): SkillDefinition {
  validateSkillDefinition(skill);
  return {
    name: normalizeOneLine(skill.name),
    description: skill.description === undefined ? undefined : normalizeOneLine(skill.description),
    contents: skill.contents,
  };
}

export function findSkillMentions(
  text: string,
  registry: SkillRegistry,
  triggers: ReadonlyArray<SkillMentionTrigger>,
): SkillDefinition[] {
  if (!text || triggers.length === 0 || registry.size === 0) {
    return [];
  }

  const seen = new Set<string>();
  const matches: SkillDefinition[] = [];

  for (const skill of registry.values()) {
    if (seen.has(skill.name)) {
      continue;
    }

    for (const trigger of triggers) {
      const needle = `${trigger}${skill.name}`;
      if (text.includes(needle)) {
        seen.add(skill.name);
        matches.push(skill);
        break;
      }
    }
  }

  return matches;
}
