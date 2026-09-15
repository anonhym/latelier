import { Badge, Button, Checkbox, Popover, Stack } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';

interface PreviewPickerProps {
  knownFields: string[];
  currentFields: string[];
  onChange: (fields: string[]) => void;
}

export function PreviewPicker({
  knownFields,
  currentFields,
  onChange,
}: PreviewPickerProps) {
  const T = themeVars;

  const handleToggle = (field: string) => {
    const newFields = currentFields.includes(field)
      ? currentFields.filter((f) => f !== field)
      : [...currentFields, field];
    onChange(newFields);
  };

  return (
    <Popover position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <Button
          data-hint-anchor="preview.configure"
          variant="default"
          size="compact-xs"
          rightSection={
            currentFields.length > 0 ? (
              <Badge size="xs" variant="light" color="violet">
                {currentFields.length}
              </Badge>
            ) : undefined
          }
        >
          Preview fields
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {knownFields.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 12, color: T.textMuted }}>
            No fields available
          </div>
        ) : (
          <Stack gap={4} style={{ maxHeight: 260, overflowY: 'auto', minWidth: 160 }}>
            {knownFields.map((field) => (
              <Checkbox
                key={field}
                size="xs"
                label={field}
                checked={currentFields.includes(field)}
                onChange={() => handleToggle(field)}
              />
            ))}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
