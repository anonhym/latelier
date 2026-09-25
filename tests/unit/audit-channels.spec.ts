import { describe, it, expect } from 'vitest';
import { auditRecordFor } from '../../electron/ipc/auditChannels';
import { IPC_CHANNELS, type Envelope, type IpcError } from '../../shared/ipc';

const T = { connectionId: 'c1', dbName: 'shop', collection: 'orders' };
const okEnv = (data: unknown): Envelope<unknown> => ({ ok: true, data });
const errEnv = (error: IpcError): Envelope<unknown> => ({ ok: false, error });

describe('auditRecordFor', () => {
  it('returns null for a channel outside the audit table', () => {
    for (const channel of [
      IPC_CHANNELS.docInsert,
      IPC_CHANNELS.docReplace,
      IPC_CHANNELS.docConfirmDeleteMany,
      IPC_CHANNELS.queryFind,
      IPC_CHANNELS.userCreate,
      IPC_CHANNELS.auditList,
      'toString',
      'constructor',
    ]) {
      expect(auditRecordFor(channel, T, okEnv({}))).toBeNull();
    }
  });

  it('builds each audited op from input and result', () => {
    expect(auditRecordFor(IPC_CHANNELS.docInsertMany, { ...T, docsJson: '[{"a":1}]' }, okEnv({ insertedCount: 1, insertedIds: ['x'] })))
      .toEqual({ ...T, op: 'insertMany', summary: { op: 'insertMany', insertedCount: 1 }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.docUpdateOne, { ...T, filterJson: '{"_id":1}', updateJson: '{"$set":{"a":1}}' }, okEnv({ matchedCount: 1, modifiedCount: 0 })))
      .toEqual({ ...T, op: 'updateOne', summary: { op: 'updateOne', filter: '{"_id":1}', matchedCount: 1, modifiedCount: 0 }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.docDeleteOne, { ...T, filterJson: '{"_id":1}' }, okEnv({ deletedCount: 1 })))
      .toEqual({ ...T, op: 'deleteOne', summary: { op: 'deleteOne', filter: '{"_id":1}', deletedCount: 1 }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.docDeleteMany, { ...T, filterJson: '{}', confirmToken: 'tok' }, okEnv({ deletedCount: 9 })))
      .toEqual({ ...T, op: 'deleteMany', summary: { op: 'deleteMany', filter: '{}', deletedCount: 9 }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.collectionRename, { ...T, newName: 'orders2' }, okEnv({ name: 'orders2' })))
      .toEqual({ ...T, op: 'collectionRename', summary: { op: 'collectionRename', fromName: 'orders', toName: 'orders2' }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.collectionDrop, T, okEnv({ dropped: true })))
      .toEqual({ ...T, op: 'collectionDrop', summary: { op: 'collectionDrop' }, outcome: 'ok', errorCode: null });
    expect(auditRecordFor(IPC_CHANNELS.databaseDrop, { connectionId: 'c1', dbName: 'shop' }, okEnv({ dropped: true })))
      .toEqual({ connectionId: 'c1', dbName: 'shop', collection: null, op: 'databaseDrop', summary: { op: 'databaseDrop' }, outcome: 'ok', errorCode: null });
  });

  it('keeps document bodies and the confirm token out of the record', () => {
    const recs = [
      auditRecordFor(IPC_CHANNELS.docInsertMany, { ...T, docsJson: '[{"secret":"BODY"}]' }, okEnv({ insertedCount: 1, insertedIds: ['BODY-ID'] })),
      auditRecordFor(IPC_CHANNELS.docUpdateOne, { ...T, filterJson: '{}', updateJson: '{"$set":{"s":"BODY"}}' }, okEnv({ matchedCount: 1, modifiedCount: 1 })),
      auditRecordFor(IPC_CHANNELS.docDeleteMany, { ...T, filterJson: '{}', confirmToken: 'BODY-TOKEN' }, okEnv({ deletedCount: 1 })),
    ];
    expect(JSON.stringify(recs)).not.toContain('BODY');
  });

  it('ignores a count that is not a number', () => {
    expect(auditRecordFor(IPC_CHANNELS.docDeleteOne, { ...T, filterJson: '{}' }, okEnv({ deletedCount: '1' }))!.summary)
      .toEqual({ op: 'deleteOne', filter: '{}', deletedCount: undefined });
    expect(auditRecordFor(IPC_CHANNELS.docDeleteOne, { ...T, filterJson: '{}' }, okEnv(null))!.summary)
      .toEqual({ op: 'deleteOne', filter: '{}', deletedCount: undefined });
  });

  it('records a failure with the envelope code and no counts', () => {
    const rec = auditRecordFor(
      IPC_CHANNELS.docDeleteOne,
      { ...T, filterJson: '{"_id":1}' },
      errEnv({ code: 'UNAUTHORIZED', message: 'nope', details: { deletedCount: 5, insertedCount: 2 } }),
    );
    expect(rec).toEqual({
      ...T,
      op: 'deleteOne',
      summary: { op: 'deleteOne', filter: '{"_id":1}', deletedCount: undefined },
      outcome: 'error',
      errorCode: 'UNAUTHORIZED',
    });
  });

  it('records an insertMany that stopped part-way as partial, and one that inserted nothing as error', () => {
    const input = { ...T, docsJson: '[]' };
    expect(auditRecordFor(IPC_CHANNELS.docInsertMany, input, errEnv({ code: 'CONFLICT', message: 'dup', details: { insertedCount: 3 } })))
      .toMatchObject({ outcome: 'partial', errorCode: 'CONFLICT', summary: { op: 'insertMany', insertedCount: 3 } });
    expect(auditRecordFor(IPC_CHANNELS.docInsertMany, input, errEnv({ code: 'CONFLICT', message: 'dup', details: { insertedCount: 0 } })))
      .toMatchObject({ outcome: 'error', errorCode: 'CONFLICT', summary: { op: 'insertMany', insertedCount: 0 } });
    expect(auditRecordFor(IPC_CHANNELS.docInsertMany, input, errEnv({ code: 'NETWORK', message: 'down' })))
      .toEqual({ ...T, op: 'insertMany', summary: { op: 'insertMany', insertedCount: undefined }, outcome: 'error', errorCode: 'NETWORK' });
  });
});
