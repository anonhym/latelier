import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { ensureSyntaxTree } from '@codemirror/language';

/**
 * A JavaScript EditorState whose `syntaxTree(state)` covers the whole document.
 *
 * `EditorState.create` parses for only about 20ms and stores that tree in the
 * state. `ensureSyntaxTree` finishes the parse but does not publish the result
 * to the state it was given, so on a loaded machine `syntaxTree(state)` can
 * still be the partial tree and a detector walking it finds nothing. An empty
 * transaction moves the finished tree into the state returned here.
 */
export function parsedJsState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [javascript()] });
  if (!ensureSyntaxTree(state, doc.length, 5_000)) {
    throw new Error(`test document did not parse within 5s: ${JSON.stringify(doc)}`);
  }
  return state.update({}).state;
}
