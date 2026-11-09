/** Teaches the agent the Markdown extensions this editor renders. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'quirekit-markdown';
const SKILL_BODY = new URL('../../skills/quirekit-markdown.md', import.meta.url);
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('../../skills/', import.meta.url)) };
const INVOCATION = { modelInvocable: true, userInvocable: true };
/** Same precedence as skills bundled with a DSH plugin. */
const BUNDLED_SKILL_RANK = 600;
const DESCRIPTION = 'Write Markdown documents that use the QuireKit editor features: callouts, collapsible sections, Mermaid, PlantUML and Graphviz diagrams, formulas, highlights, footnotes and task lists. Use when creating or restructuring a Markdown document for the user to read.';

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: SKILL_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY,
};

/** Skill provider registered on the DSH skill service. */
export const markdownSkillProvider = {
  name: SKILL_NAME,
  /** @returns {Promise<object[]>} the skills this plugin offers. */
  list: () => Promise.resolve([CANDIDATE]),
  /** @returns {Promise<object>} the skill with its instructions loaded. */
  async get() {
    const { locator: _locator, rank: _rank, ...definition } = CANDIDATE;
    return { ...definition, content: await readFile(SKILL_BODY, 'utf8') };
  },
};
