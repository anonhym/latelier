# Connection Families share configuration by name, with per-rule Overrides and their own export

Some users keep one Connection per client deployment, all with the same schema. Reference rules are keyed to a single Connection, and the collapsed-row fields in the Tree view had no saved home at all, so every piece of configuration had to be rebuilt by hand on every client's Connection.

**Decision.** A **Connection Family** is an explicit, named set of Connections that share configuration: Reference Rules and Row Summaries, with room for more later.

- **One Family per Connection.** With two, a setting could come from two sources, and "who overrides what" would stop having one answer.
- **Shared configuration attaches by Database and Collection name.** A shared rule for `shop.orders` reaches every member whose server has `shop.orders`, and does nothing on a member that doesn't. Members whose Databases are named differently are not mapped onto each other.
- **Overrides are per rule.** A member's own rule for the same Database, Collection and source field replaces the shared one, or switches it off, on that member only. A member's rule with no shared counterpart is a local rule, not an Override. The UI badges every rule Shared, Overridden here or Local, offers Reset to shared, and the Family's view lists which members override each shared rule.
- **New rules are shared by default** when the Connection belongs to a Family, with "this Connection only" one click away.
- **Leaving a Family, or deleting one, offers to keep the shared configuration as local copies.** Existing Overrides win, and no copy replaces them. Existing per-Connection rules are never lifted into a Family automatically.
- **Row Summary is a saved, per-Collection setting**, separate from the tab's Fields list. With none saved, a collapsed row shows the first visible fields of the Fields list, as before. This brings back a per-Collection persisted setting that migration 011 removed, but only for the collapsed row: it hides no column and changes no projection.
- **A Family's configuration travels in its own Family Export, never in a Connection Export.** The file carries shared configuration only: no Connections, members, Overrides or secrets. It is **Applied** to a target the user picks, either any existing Family or a new one, and the name in the file only suggests a target. Applying merges, asks on each conflicting setting, and never deletes anything. Members' Overrides are left as they are and still win. Connection Export keeps its rule that it carries Connections only.

## Considered Options

- **Share by matching `db.collection` across all Connections, with no Family.** Rejected: unrelated deployments that happen to use a common name (`app.users`) would silently pick up each other's rules. Membership has to be a deliberate act.
- **Map differently named Databases across members.** Deferred, not rejected. It adds a mapping table to every lookup to serve a case nobody has hit yet.
- **Carry the Family inside Connection Export.** Rejected: it would break the guarantee that importing a Connection Export never changes anything that already exists, and it would tie sharing configuration to sharing Connections. A team may want the same rules across deployments without handing each other connection strings.
- **Apply a Family Export only to a Family of the same name.** Rejected: names are local and arbitrary, and the point is to reuse one Family's configuration on any other Family.

## Consequences

- Reference rules need an owner that is either a Connection or a Family. The unique key for a rule, `(owner, source_db, source_collection, source_field)`, is what makes an Override and a shared rule collide by design.
- Rule lookup for a Connection becomes "its local rules, then its Family's shared rules not overridden", and every surface that reads rules (Tree, Table, hover, drawer) goes through that one resolution.
- Deleting a Connection still cascades to its own rules only. Deleting a Family is the only way shared configuration is destroyed, and it falls on the type-to-confirm tier of [ADR 0013](./0013-destructive-friction.md), since it irreversibly destroys local persisted data.
