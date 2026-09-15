import type { SafeStorageLike } from '../../electron/secrets/SecretsVault';

/**
 * Mock safeStorage for tests. Encryption is a simple in-memory map keyed by a
 * UUID written into the returned Buffer. Not secure — for tests only.
 */
export function createSafeStorageMock(initial: {
  available?: boolean;
} = {}): SafeStorageLike & {
  setAvailable: (v: boolean) => void;
  corrupt: (cipher: Buffer) => Buffer;
  reset: () => void;
} {
  const store = new Map<string, string>();
  let available = initial.available ?? true;

  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext: string): Buffer => {
      const id = `sentinel-${crypto.randomUUID()}`;
      store.set(id, plaintext);
      return Buffer.from(id, 'utf8');
    },
    decryptString: (ciphertext: Buffer): string => {
      const id = ciphertext.toString('utf8');
      const v = store.get(id);
      if (v === undefined) throw new Error('decrypt failed: unknown ciphertext');
      return v;
    },
    setAvailable: (v: boolean) => {
      available = v;
    },
    corrupt: (cipher: Buffer) => Buffer.concat([cipher, Buffer.from('xxx')]),
    reset: () => {
      store.clear();
      available = initial.available ?? true;
    },
  };
}
