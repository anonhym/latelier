import React from 'react';
import { Button, Group, Tooltip } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { api } from '../../api/atelier';
import { PreviewPicker } from './PreviewPicker';

interface CollectionHeaderProps {
  connectionId: string;
  dbName: string;
  collection: string;
  onInsert: () => void;
  onOpenReferences: () => void;
  referenceRuleCount: number;
  previewKnownFields: string[];
  previewFields: string[] | null;
  onPreviewFieldsChange: (fields: string[]) => void;
}

/**
 * Top breadcrumb header. The Tree|JSON|Table view switch moved down to
 * `<ResultBar/>` alongside the pagination so the top row stays a clean
 * breadcrumb-plus-stats line.
 */
export function CollectionHeader({
  connectionId,
  dbName,
  collection,
  onInsert,
  onOpenReferences,
  referenceRuleCount,
  previewKnownFields,
  previewFields,
  onPreviewFieldsChange,
}: CollectionHeaderProps) {
  const T = themeVars;
  const cacheKey = `${connectionId}|${dbName}|${collection}`;
  const [stats, setStats] = React.useState<{
    key: string;
    docCount: number;
    indexCount: number;
  } | null>(null);
  const current = stats && stats.key === cacheKey ? stats : null;
  const docCount = current?.docCount ?? null;
  const indexCount = current?.indexCount ?? null;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.meta.listCollections({ connectionId, dbName });
        if (cancelled) return;
        const info = rows.find((r) => r.name === collection);
        if (info) {
          setStats({
            key: cacheKey,
            docCount: info.documentCount,
            indexCount: info.indexCount,
          });
        }
      } catch {
        // Best-effort: leave the stats as null and the header just shows the
        // breadcrumb. A noisy fallback would be worse than a silent one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, dbName, collection, cacheKey]);

  return (
    <Group
      gap={10}
      wrap="nowrap"
      style={{
        padding: '0 14px',
        height: 42,
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      {/* Breadcrumb + stats */}
      <Group gap={8} align="baseline" wrap="nowrap" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 11, color: T.textMuted }}>{dbName} /</span>
        <Tooltip label={collection} withArrow disabled={collection.length < 24}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: T.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {collection}
          </span>
        </Tooltip>
        {(docCount !== null || indexCount !== null) && (
          <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 4 }}>
            {docCount !== null && (
              <>
                <strong style={{ fontWeight: 500, color: T.text }}>
                  {docCount.toLocaleString()}
                </strong>
                {' docs in collection'}
              </>
            )}
            {docCount !== null && indexCount !== null && ' · '}
            {indexCount !== null && (
              <>
                <strong style={{ fontWeight: 500, color: T.text }}>{indexCount}</strong>
                {' indexes'}
              </>
            )}
          </span>
        )}
      </Group>

      <span style={{ flex: 1 }} />

      {/* Preview-fields picker — collection-level setting, lives in the header
          alongside the other per-collection controls (view, refs, insert). */}
      <PreviewPicker
        knownFields={previewKnownFields}
        currentFields={previewFields ?? []}
        onChange={onPreviewFieldsChange}
      />

      {/* References — secondary action; collapses to icon + count */}
      <Tooltip label={`Manage reference rules for this collection (${referenceRuleCount})`} withArrow>
        <Button
          data-hint-anchor="refs.configure"
          variant="default"
          size="compact-xs"
          onClick={onOpenReferences}
        >
          References ({referenceRuleCount})
        </Button>
      </Tooltip>

      {/* Insert — primary action. The visible label is "+ Insert" (icon +
          text "Insert") but we set an aria-label so existing e2e selectors
          looking for `/Insert document/` keep matching the toolbar button
          rather than the drawer's primary action. */}
      <Tooltip label="Insert a new document into this collection" withArrow>
        <Button
          variant="filled"
          size="compact-xs"
          leftSection={I.plus}
          onClick={onInsert}
          aria-label="Insert document"
        >
          Insert
        </Button>
      </Tooltip>
    </Group>
  );
}
