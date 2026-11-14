import { describe, expect, it } from 'vitest';
import { connectionNameFromUri, redactUriSecrets } from '../../src/features/connections/welcomeName';

describe('connectionNameFromUri', () => {
  it('names the Connection after its host', () => {
    expect(connectionNameFromUri('localhost', [])).toBe('localhost');
    expect(connectionNameFromUri('cluster0.example.net', ['localhost'])).toBe('cluster0.example.net');
  });

  it('appends 2, then 3, while the name is taken', () => {
    expect(connectionNameFromUri('localhost', ['localhost'])).toBe('localhost 2');
    expect(connectionNameFromUri('localhost', ['localhost', 'localhost 2'])).toBe('localhost 3');
    // A gap is filled rather than skipped.
    expect(connectionNameFromUri('localhost', ['localhost', 'localhost 3'])).toBe('localhost 2');
  });

  it('matches names exactly, as the unique index does', () => {
    expect(connectionNameFromUri('localhost', ['Localhost', 'localhost '])).toBe('localhost');
  });

  it('keeps the name within the 64 characters a Connection name may have', () => {
    const host = `${'a'.repeat(70)}.example.net`;
    expect(connectionNameFromUri(host, [])).toBe('a'.repeat(64));
    expect(connectionNameFromUri(host, ['a'.repeat(64)])).toBe(`${'a'.repeat(62)} 2`);
    const taken = ['a'.repeat(64), ...Array.from({ length: 8 }, (_, i) => `${'a'.repeat(62)} ${i + 2}`)];
    expect(connectionNameFromUri(host, taken)).toBe(`${'a'.repeat(61)} 10`);
  });
});

describe('redactUriSecrets', () => {
  const uri = 'mongodb://ana:s3cr%40t@db.example.net:27017/app';

  it('leaves a message that holds nothing secret alone', () => {
    expect(redactUriSecrets('Could not reach the server.', uri, 's3cr@t')).toBe('Could not reach the server.');
    expect(redactUriSecrets('ana failed', 'mongodb://localhost:27017')).toBe('ana failed');
  });

  it('removes the whole URI as one piece', () => {
    expect(redactUriSecrets(`cannot parse ${uri}`, `  ${uri}  `)).toBe('cannot parse •••');
  });

  it('removes the userinfo, the typed password and the decoded password', () => {
    expect(redactUriSecrets('bad auth ana:s3cr%40t', uri)).toBe('bad auth •••');
    expect(redactUriSecrets('bad password s3cr%40t, twice s3cr%40t', uri)).toBe('bad password •••, twice •••');
    expect(redactUriSecrets('bad password s3cr@t', uri, 's3cr@t')).toBe('bad password •••');
    expect(redactUriSecrets('bad password s3cr@t', uri)).toBe('bad password s3cr@t');
  });

  it('reads the userinfo up to the last @ of the authority, in any scheme case', () => {
    expect(redactUriSecrets('p@ss', 'MongoDB+SRV://ana:p@ss@cluster.example.net/?x=a@b')).toBe('•••');
    expect(redactUriSecrets('a@b', 'mongodb://localhost/db?x=a@b')).toBe('a@b');
    expect(redactUriSecrets('a@b', 'mongodb://localhost?x=a@b')).toBe('a@b');
    expect(redactUriSecrets('a@b', 'mongodb://localhost#a@b')).toBe('a@b');
  });

  it('takes a typed password whole when it holds a colon', () => {
    expect(redactUriSecrets('bad password p:w', 'mongodb://ana:p:w@db')).toBe('bad password •••');
  });

  it('treats a userinfo with no colon as a username only', () => {
    expect(redactUriSecrets('user ana, host db', 'mongodb://ana@db')).toBe('user •••, host db');
  });

  it('finds no userinfo in text that is not a URI', () => {
    expect(redactUriSecrets('ana:pw', 'see mongodb://ana:pw@db')).toBe('ana:pw');
    expect(redactUriSecrets('ana:pw', '//ana:pw@db')).toBe('ana:pw');
  });
});
