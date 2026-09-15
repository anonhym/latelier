import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RECIPES } from '../../src/troubleshooting/recipes';

const DOC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'troubleshooting.md');
const DOC = fs.readFileSync(DOC_PATH, 'utf8');

describe('docs/troubleshooting.md alignment with recipe registry', () => {
  it('every recipe has a matching `## <docAnchor>` heading in the doc', () => {
    for (const r of RECIPES) {
      const re = new RegExp(`^## ${r.docAnchor}\\b`, 'm');
      expect(DOC).toMatch(re);
    }
  });

  it('every `## <id>` heading in the doc maps back to a recipe', () => {
    const anchors = [...DOC.matchAll(/^## ([a-z0-9-]+)/gm)].map((m) => m[1]!);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const recipe = RECIPES.find((r) => r.docAnchor === a);
      expect(recipe, `doc has '## ${a}' but no recipe with docAnchor '${a}'`).toBeTruthy();
    }
  });

  it('the doc renders the recipe ids in the same order as the registry', () => {
    const docOrder = [...DOC.matchAll(/^## ([a-z0-9-]+)/gm)].map((m) => m[1]!);
    const recipeOrder = RECIPES.map((r) => r.docAnchor);
    expect(docOrder).toEqual(recipeOrder);
  });
});
