-- Migration 007: fold aggregation tabs into collection tabs as a sub-view.
--
-- Each kind='aggregation' row is collapsed into the matching kind='collection'
-- row as its `aggregation` sub-view, with `activeView` set to 'aggregation' so
-- the user lands back where they were. If no matching collection tab exists,
-- the aggregation row is promoted to a kind='collection' row with default
-- Documents state plus the aggregation state nested.
--
-- When multiple aggregation rows exist on the same (connection, db, collection)
-- — possible because `openAggregation` always created a new tab — only the
-- most recent (max opened_at) survives the fold; older duplicates are dropped.

-- Step 1: drop older duplicate aggregation rows so each
-- (connection_id, db_name, collection) has at most one to merge.
DELETE FROM workspace_tabs
WHERE kind = 'aggregation'
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY connection_id, db_name, collection
        ORDER BY opened_at DESC, id ASC
      ) AS rn
      FROM workspace_tabs
      WHERE kind = 'aggregation'
    )
    WHERE rn = 1
  );

-- Step 2: merge each surviving aggregation row into the matching collection row.
UPDATE workspace_tabs AS c
SET state_json = json_set(
  c.state_json,
  '$.activeView', 'aggregation',
  '$.aggregation', (
    SELECT json(a.state_json)
    FROM workspace_tabs a
    WHERE a.kind = 'aggregation'
      AND a.connection_id = c.connection_id
      AND a.db_name = c.db_name
      AND a.collection = c.collection
  )
)
WHERE c.kind = 'collection'
  AND EXISTS (
    SELECT 1 FROM workspace_tabs a2
    WHERE a2.kind = 'aggregation'
      AND a2.connection_id = c.connection_id
      AND a2.db_name = c.db_name
      AND a2.collection = c.collection
  );

-- Step 3: drop merged aggregation rows.
DELETE FROM workspace_tabs
WHERE kind = 'aggregation'
  AND EXISTS (
    SELECT 1 FROM workspace_tabs c2
    WHERE c2.kind = 'collection'
      AND c2.connection_id = workspace_tabs.connection_id
      AND c2.db_name = workspace_tabs.db_name
      AND c2.collection = workspace_tabs.collection
  );

-- Step 4: promote remaining standalone aggregation rows to collection rows.
-- Default Documents state is synthesized so the renderer always has a valid
-- shape; the prior aggregation state is nested under `aggregation` and
-- `activeView` is set so the user opens straight into the Aggregation sub-view.
UPDATE workspace_tabs
SET kind = 'collection',
    state_json = json_object(
      'activeView', 'aggregation',
      'view', 'Tree',
      'builder', json_object(
        'conditions', json('[]'),
        'logic', 'AND',
        'projection', json('[]'),
        'sort', '',
        'limit', ''
      ),
      'queryDirty', json('false'),
      'page', 0,
      'pageSize', 50,
      'activeBuilderTab', 'Builder',
      'aggregation', json(state_json)
    )
WHERE kind = 'aggregation';

UPDATE schema_version SET version = 7;
