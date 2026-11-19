import React from 'react';
import { Button, Group, List, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import type {
  ConnectionFamily,
  ConnectionSummary,
  FamilyApplyChoice,
  FamilyApplyPlan,
  FamilyApplyResult,
  FamilyApplyTarget,
  FamilyExportItem,
  FamilyReadExportResult,
} from '@shared/types';
import { api, getErrorMessage, isIpcError } from '../../api/atelier';
import { SubmitButton } from '../../components/SubmitButton';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { themeVars } from '../../theme/themeVars';
import { notifyRowSummaryChanged } from '../rowSummary/useRowSummary';
import { ReferenceRulesEditor } from '../references/ReferenceRulesEditor';
import { NEW_FROM_FILE, plural, uniqueFamilyName } from './familyCopy';

type Step = 'open' | 'target' | 'conflicts' | 'summary';
type ReadFile = Extract<FamilyReadExportResult, { token: string }>;

const STEP_TITLES: Record<Step, string> = {
  open: 'Open',
  target: 'Target',
  conflicts: 'Conflicts',
  summary: 'Summary',
};
const STEPS: Step[] = ['open', 'target', 'conflicts', 'summary'];

function itemLabel(item: FamilyExportItem): string {
  const where = `${item.dbName}.${item.collection}`;
  return item.kind === 'rule' ? `${where}.${item.field}` : `${where} (row summary)`;
}

function targetOf(choice: string, newName: string): FamilyApplyTarget {
  return choice === NEW_FROM_FILE ? { newName: newName.trim() } : { familyId: choice };
}

/**
 * Apply a Family Export in four steps: open the file, pick the target Family
 * (or a new one), answer each conflicting setting, read the summary. Nothing
 * is written before the last of the first three steps; applying never deletes.
 */
export function ApplyFamilyExportDialog({ families, connections, initialFamilyId, onClose, onApplied }: {
  families: ConnectionFamily[];
  connections: ConnectionSummary[];
  /** The Family to preselect as the target, when opened from its view. */
  initialFamilyId?: string | null;
  onClose: () => void;
  /** After a write, so the parent can reload its families (a new one may exist). */
  onApplied: (result: FamilyApplyResult) => void;
}) {
  const close = useDialogFocusReturn(onClose);
  const [step, setStep] = React.useState<Step>('open');
  const [file, setFile] = React.useState<ReadFile | null>(null);
  const [choice, setChoice] = React.useState<string>(
    initialFamilyId && families.some((f) => f.id === initialFamilyId) ? initialFamilyId : (families[0]?.id ?? NEW_FROM_FILE),
  );
  const [newName, setNewName] = React.useState('');
  const [plan, setPlan] = React.useState<FamilyApplyPlan | null>(null);
  const [resolutions, setResolutions] = React.useState<Record<string, FamilyApplyChoice>>({});
  // The target the answers were given for: a conflict key names a setting, not a family, so another family's answers are not these.
  const answeredFor = React.useRef<string | null>(null);
  const [result, setResult] = React.useState<FamilyApplyResult | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ connectionId: string; dbName: string; collection: string } | null>(null);

  const target = targetOf(choice, newName);
  const creating = choice === NEW_FROM_FILE;
  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id;

  /**
   * Runs one step's work under the busy flag. A failure shows its message and
   * is handed to `onFail` once the flag is down, so `onFail` can start another step.
   */
  const run = async (work: () => Promise<void>, fallback: string, onFail?: (e: unknown) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let failure: { e: unknown } | null = null;
    try {
      await work();
    } catch (e) {
      setError(getErrorMessage(e, fallback));
      failure = { e };
    } finally {
      setBusy(false);
    }
    if (failure) onFail?.(failure.e);
  };

  const openFile = () =>
    run(async () => {
      const read = await api.families.readExport();
      if (read.cancelled) return;
      setFile(read);
      setNewName(uniqueFamilyName(read.familyName, families.map((f) => f.name)));
      setStep('target');
    }, 'Could not read the file');

  const applyCall = async (send: Record<string, FamilyApplyChoice>) => {
    const done = await api.families.apply({ token: file!.token, target, resolutions: send });
    notifyRowSummaryChanged();
    onApplied(done);
    setResult(done);
    setNotice(null);
    setStep('summary');
  };

  const planCall = async () => {
    const next = await api.families.planApply({ token: file!.token, target });
    setPlan(next);
    // For the same family, an answer to a conflict that has gone away is dropped and the others stand;
    // for another family none stands, as each answer was about the first one's current settings.
    const targetKey = JSON.stringify(target);
    const sameTarget = answeredFor.current === targetKey;
    answeredFor.current = targetKey;
    const keys = new Set(next.conflicts.map((c) => c.key));
    setResolutions((prev) => (sameTarget ? Object.fromEntries(Object.entries(prev).filter(([k]) => keys.has(k))) : {}));
    // With nothing to ask, the conflicts step is skipped and the file is applied.
    if (next.conflicts.length === 0) await applyCall({});
    else setStep('conflicts');
  };

  const failed = (e: unknown) => {
    if (!isIpcError(e)) return;
    // The family is gone: back to picking one. It changed: check it again.
    if (e.code === 'NOT_FOUND') setStep('target');
    if (e.code === 'CONFLICT') {
      setNotice('The family changed while you were choosing. Review the conflicts again.');
      void replan();
    }
  };
  const replan = () => run(planCall, 'Could not check the family', failed);

  const unanswered = plan ? plan.conflicts.filter((c) => resolutions[c.key] === undefined) : [];
  const answerRemaining = (answer: FamilyApplyChoice) =>
    setResolutions((prev) => {
      const next = { ...prev };
      for (const c of plan?.conflicts ?? []) if (next[c.key] === undefined) next[c.key] = answer;
      return next;
    });

  const canPlan = file !== null && (!creating || newName.trim() !== '');
  const stepIndex = STEPS.indexOf(step);

  return (
    <Modal
      opened
      onClose={close}
      title="Apply a family export"
      centered
      size="lg"
      // Mantine closes every open modal on a window-level Escape, so the rules editor stacked on this one would take it down too.
      closeOnEscape={editing === null}
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed" aria-label="Progress">
          Step {stepIndex + 1} of {STEPS.length}: {STEP_TITLES[step]}
        </Text>

        {step === 'open' && (
          <Stack gap="xs">
            <Text size="xs" c="dimmed" lh={1.5}>
              A family export carries shared reference rules and row summaries only. Applying adds to a family
              and never deletes anything from it.
            </Text>
            <Group>
              <SubmitButton size="compact-xs" variant="light" submitting={busy} onClick={() => void openFile()}>
                {error ? 'Choose another file…' : 'Choose a file…'}
              </SubmitButton>
            </Group>
          </Stack>
        )}

        {step === 'target' && file && (
          <Stack gap="xs">
            <Text size="xs">
              <b>{file.familyName}</b>: {plural(file.ruleCount, 'reference rule')} and {plural(file.rowSummaryCount, 'row summary')}.
            </Text>
            <NativeSelect
              label="Apply to"
              size="xs"
              value={choice}
              onChange={(e) => setChoice(e.currentTarget.value)}
              data={[
                ...families.map((f) => ({ value: f.id, label: f.name })),
                { value: NEW_FROM_FILE, label: 'New family from this file' },
              ]}
            />
            {creating && (
              <TextInput
                label="New family name"
                aria-label="New family name"
                size="xs"
                data-autofocus
                value={newName}
                onChange={(e) => setNewName(e.currentTarget.value)}
              />
            )}
            <Group justify="flex-end" gap="xs">
              <SubmitButton size="compact-xs" variant="filled" submitting={busy} disabled={!canPlan} onClick={() => void replan()}>
                Next
              </SubmitButton>
            </Group>
          </Stack>
        )}

        {step === 'conflicts' && plan && (
          <Stack gap="sm">
            {notice && (
              <Text size="xs" role="status">
                {notice}
              </Text>
            )}
            <Text size="xs" c="dimmed" lh={1.5}>
              {plural(plan.added.length, 'setting')} will be added and {plural(plan.unchanged.length, 'setting')} already match.
              These {plural(plan.conflicts.length, 'setting')} differ. Choose what to keep.
            </Text>
            <Group gap="xs">
              <Button size="compact-xs" variant="default" onClick={() => answerRemaining('keep')} disabled={unanswered.length === 0}>
                Keep current for all remaining
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => answerRemaining('take')} disabled={unanswered.length === 0}>
                Take the file&apos;s for all remaining
              </Button>
            </Group>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--atelier-gap-sm)' }} aria-label="Conflicting settings">
              {plan.conflicts.map((c) => (
                <li key={c.key}>
                  <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                    <legend style={{ fontFamily: 'ui-monospace, monospace', fontSize: themeVars.fsSm }}>{itemLabel(c.current)}</legend>
                    {(['keep', 'take'] as const).map((answer) => (
                      <label key={answer} style={{ display: 'block', fontSize: themeVars.fsSm, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={c.key}
                          checked={resolutions[c.key] === answer}
                          onChange={() => setResolutions((prev) => ({ ...prev, [c.key]: answer }))}
                        />{' '}
                        {answer === 'keep' ? 'Keep current' : "Take the file's"}:{' '}
                        <Text span size="xs" ff="monospace">
                          {answer === 'keep' ? c.current.detail : c.incoming.detail}
                        </Text>
                      </label>
                    ))}
                  </fieldset>
                </li>
              ))}
            </ul>
            <Group justify="flex-end" gap="xs">
              <Button size="compact-xs" variant="subtle" onClick={() => setStep('target')}>
                Back
              </Button>
              <SubmitButton
                size="compact-xs"
                variant="filled"
                submitting={busy}
                disabled={unanswered.length > 0}
                onClick={() => void run(() => applyCall(resolutions), 'Could not apply the file', failed)}
              >
                Apply
              </SubmitButton>
            </Group>
          </Stack>
        )}

        {step === 'summary' && result && (
          <Stack gap="sm">
            <Text size="xs" role="status">
              {plural(result.added, 'setting')} added, {result.replaced} replaced, {result.kept} kept, {result.unchanged} unchanged.
            </Text>
            {result.overriddenBy.length > 0 && (
              <div>
                <Text size="xs" c="dimmed" lh={1.5}>
                  These members have their own setting for something just brought in, and theirs still wins. Open a
                  rule in its editor to reset it to shared.
                </Text>
                <List size="xs" withPadding aria-label="Members that override what was applied">
                  {result.overriddenBy.map((o) => (
                    <List.Item key={o.connectionId}>
                      <b>{nameOf(o.connectionId)}</b>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {o.items.map((item) => (
                          <li key={item.key}>
                            <Text span size="xs" ff="monospace">
                              {itemLabel(item)}
                            </Text>{' '}
                            {item.kind === 'rule' && (
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                aria-label={`Open the reference rules of ${nameOf(o.connectionId)} for ${item.dbName}.${item.collection}`}
                                onClick={() => setEditing({ connectionId: o.connectionId, dbName: item.dbName, collection: item.collection })}
                              >
                                Open rules
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </List.Item>
                  ))}
                </List>
              </div>
            )}
            <Group justify="flex-end">
              <Button size="compact-xs" variant="filled" onClick={close}>
                Done
              </Button>
            </Group>
          </Stack>
        )}

        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}
        {step !== 'summary' && (
          <Group justify="flex-end" gap="xs">
            <Button size="compact-xs" variant="subtle" onClick={close}>
              Cancel
            </Button>
          </Group>
        )}
      </Stack>
      {editing && (
        <ReferenceRulesEditor
          connectionId={editing.connectionId}
          dbName={editing.dbName}
          collection={editing.collection}
          onClose={() => setEditing(null)}
          onChanged={() => undefined}
        />
      )}
    </Modal>
  );
}
