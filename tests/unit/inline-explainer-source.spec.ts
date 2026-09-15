import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TLS_INLINE_EXPLAINER,
  DIRECT_CONNECTION_INLINE_EXPLAINER,
} from '../../src/troubleshooting/recipes';

// X09/#197: the explainers moved with the form body from NewConnection.tsx
// (page host) into ConnectionForm.tsx (host-agnostic form) — the source of
// truth assertion below follows the import to wherever the form actually
// lives, not the page that hosts it.
const CONNECTION_FORM = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'features', 'connections', 'ConnectionForm.tsx'),
  'utf8',
);

describe('inline explainer source-of-truth', () => {
  it('ConnectionForm imports the TLS explainer from recipes.ts', () => {
    expect(CONNECTION_FORM).toMatch(/TLS_INLINE_EXPLAINER/);
    // The literal string lives in recipes.ts only, never duplicated in the form.
    expect(CONNECTION_FORM).not.toMatch(
      /Atlas and most managed MongoDB clusters require TLS/,
    );
    // Sanity: the constant itself contains the canonical sentence.
    expect(TLS_INLINE_EXPLAINER).toMatch(
      /Atlas and most managed MongoDB clusters require TLS/,
    );
  });

  it('ConnectionForm imports the Direct-connection explainer from recipes.ts', () => {
    expect(CONNECTION_FORM).toMatch(/DIRECT_CONNECTION_INLINE_EXPLAINER/);
    expect(CONNECTION_FORM).not.toMatch(/Bypass replica-set discovery\./);
    expect(DIRECT_CONNECTION_INLINE_EXPLAINER).toMatch(
      /Bypass replica-set discovery\./,
    );
  });
});
