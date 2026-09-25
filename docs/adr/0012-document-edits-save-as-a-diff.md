# An edit saves as a diff, never a replace

The Document Editor holds one draft of the document, shown through a Fields view and a JSON view. Saving compares the draft to the document as it was loaded, and sends `$set` for changed or added fields and `$unset` for removed ones. It never sends a `replaceOne`, even from the JSON view.

The old edit drawer made the user choose up front: Replace (whole document, which silently overwrites fields someone else changed since load) or Update (a hand-typed `$set` into an empty buffer, empty so it couldn't do the same). A diff removes the choice and keeps the safety. Only the fields the user actually touched are written, whichever view they touched them in.

## Considered Options

- **Track dirty fields as the user edits them**, and send those. Rejected because the JSON view has no per-field edits. Every keystroke reparses the whole document, so the only way to learn what changed there is to compare it with the original, which is the diff. It also treats a value typed back to its original as a change, which writes it and adds it to the conflict guard for nothing. The diff gives the same answer in both views. It costs almost nothing on one document, and the Fields view's edited markers come from it too.

## Consequences

- A change inside a nested object is sent as its dotted path (`address.city`), so it doesn't overwrite a sibling field changed by someone else.
- An array is sent whole. Index-based array diffs misfire when the server copy has shifted.
- Reordering keys alone is not expressible, and saves nothing. `_id` never changes; it is immutable in MongoDB anyway.
- The save is a compare-and-set on the fields it touches. The filter carries each changed field's value as loaded (`$exists: false` for an added field). If nothing matches, someone else changed one of those fields, and the user chooses between reloading (their edits merged onto the fresh copy) and overwriting. A change to a field they didn't touch never blocks the save.
- Creating a document is not an edit: the Document Editor saves a new document whole, with `insertOne`.
