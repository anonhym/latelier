import React from 'react';
import { StructureView } from './StructureView';
import { useCollectionWorkspace } from './context';
import { useAddToFilter } from './views/useAddToFilter';

type Props = Omit<React.ComponentProps<typeof StructureView>, 'onFilterField'>;

/**
 * `StructureView` inside the collection workspace: wires the schema row menu's
 * "Filter by this field" to the same add-to-filter path the result views use.
 * Kept apart so `StructureView` stays renderable without the provider.
 */
export function StructureViewConnected(props: Props) {
  const { state, actions } = useCollectionWorkspace();
  const addToFilter = useAddToFilter({ state, actions });
  // A null value starts the condition at `field: null`, to be edited in the filter.
  // The builder and filter bar only exist on Documents, so go there first: the
  // result is visible, and the "filter drawer is open" prompt concerns a drawer the user can see.
  const openDocuments = actions.openDocuments;
  const onFilterField = React.useCallback(
    (path: string) => {
      openDocuments?.();
      void addToFilter(path, null);
    },
    [addToFilter, openDocuments],
  );
  return <StructureView {...props} onFilterField={onFilterField} />;
}
