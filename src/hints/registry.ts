import type { FeatureHintId } from '@shared/types';

export interface FeatureHintCopy {
  id: FeatureHintId;
  title: string;
  body: string;
  ctaLabel?: string;
}

export const HINT_REGISTRY: Record<FeatureHintId, FeatureHintCopy> = {
  'refs.configure': {
    id: 'refs.configure',
    title: 'Link this field to another doc?',
    body: 'Fields ending in _id or Id can become clickable references. Configure a rule to follow them.',
    ctaLabel: 'Configure references',
  },
  'tabs.pin': {
    id: 'tabs.pin',
    title: 'Pin this tab',
    body: 'Pinned tabs stay at the front of the strip and are easy to find later. Right-click any tab to pin it.',
  },
  'saved.create': {
    id: 'saved.create',
    title: 'Save this query',
    body: 'Run something useful? Save it for one-click reuse from the Saved tab.',
    ctaLabel: 'Save now',
  },
  'palette.discover': {
    id: 'palette.discover',
    title: 'Find any action with ⌘K',
    body: 'Press ⌘K (Ctrl+K on Windows/Linux) to search every action — switch connections, run queries, configure references, and more.',
    ctaLabel: 'Try it',
  },
  'preview.configure': {
    id: 'preview.configure',
    title: 'Show key fields at a glance',
    body: 'Pick a few fields to preview on each collapsed row, so you can scan results without expanding every doc.',
    ctaLabel: 'Pick fields',
  },
};
