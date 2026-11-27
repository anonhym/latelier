import { describe, it, expect } from 'vitest';
import { cleanFolder, displayFolder, MAX_FOLDER_CHARS } from '../../electron/agent/folderDisplay';

describe('cleanFolder', () => {
  it('leaves an ordinary path alone', () => {
    expect(cleanFolder('/Users/ann/Projects/shop-api')).toBe('/Users/ann/Projects/shop-api');
  });

  it('strips C0, DEL and C1 control characters', () => {
    expect(cleanFolder('/a\u0000b\u0007c\nd\re\tf\u001bg\u007fh\u0085i\u009fj')).toBe('/abcdefghij');
  });

  it('strips bidi controls, zero-width and other format characters', () => {
    // Overrides, embeddings, isolates and marks: each could reorder the label around it.
    expect(cleanFolder('/a\u202eb\u202dc\u202ad\u202ce\u2066f\u2067g\u2068h\u2069i\u200ej\u200fk\u061cl')).toBe('/abcdefghijkl');
    // Zero-width space, joiners, word joiner, BOM, soft hyphen.
    expect(cleanFolder('/a\u200bb\u200cc\u200dd\u2060e\ufefff\u00adg')).toBe('/abcdefg');
  });

  it('strips the line and paragraph separators', () => {
    expect(cleanFolder('/a\u2028b\u2029c')).toBe('/abc');
  });

  it('keeps ordinary spaces and non-ASCII text, which a folder name may hold', () => {
    expect(cleanFolder('/My Projects/café 東京 😀/\u00a0x')).toBe('/My Projects/café 東京 😀/\u00a0x');
  });

  it('cuts to 1,024 characters', () => {
    expect(MAX_FOLDER_CHARS).toBe(1024);
    expect(cleanFolder('x'.repeat(1024))).toBe('x'.repeat(1024));
    expect(cleanFolder('x'.repeat(1025))).toBe('x'.repeat(1024));
  });

  it('cuts after stripping, so stripped characters do not use up the length', () => {
    expect(cleanFolder(`${'\u0001'.repeat(50)}${'y'.repeat(1024)}`)).toBe('y'.repeat(1024));
    expect(cleanFolder(`${'\u202e'.repeat(50)}${'y'.repeat(1024)}`)).toBe('y'.repeat(1024));
  });

  it('never splits a surrogate pair at the cut', () => {
    // 1,023 ASCII characters, then an emoji whose high surrogate would be character 1,024.
    const cut = cleanFolder(`${'x'.repeat(1023)}😀tail`);
    expect(cut).toBe('x'.repeat(1023));
    // When the pair fits whole it is kept.
    expect(cleanFolder(`${'x'.repeat(1022)}😀tail`)).toBe(`${'x'.repeat(1022)}😀`);
    // A low surrogate in the last slot ends a whole pair: nothing to drop.
    expect(cleanFolder(`${'x'.repeat(1022)}😀`)).toHaveLength(1024);
  });

  it('keeps a character just outside the high-surrogate range at the cut', () => {
    // U+D7FF and U+E000 are ordinary characters on either side of the surrogate block.
    expect(cleanFolder(`${'x'.repeat(1023)}\ud7ffz`)).toBe(`${'x'.repeat(1023)}\ud7ff`);
    expect(cleanFolder(`${'x'.repeat(1023)}\ue000z`)).toBe(`${'x'.repeat(1023)}\ue000`);
    // A lone low surrogate is not the start of a pair.
    expect(cleanFolder(`${'x'.repeat(1023)}\udc00z`)).toBe(`${'x'.repeat(1023)}\udc00`);
    // The edges of the high-surrogate block are both cut.
    expect(cleanFolder(`${'x'.repeat(1023)}\ud800\udc00`)).toBe('x'.repeat(1023));
    expect(cleanFolder(`${'x'.repeat(1023)}\udbff\udfff`)).toBe('x'.repeat(1023));
  });
});

describe('displayFolder', () => {
  it('replaces the home directory with ~ on macOS and Linux', () => {
    expect(displayFolder('/Users/ann/Projects/shop', '/Users/ann', 'darwin')).toBe('~/Projects/shop');
    expect(displayFolder('/home/ann/src', '/home/ann', 'linux')).toBe('~/src');
  });

  it('shows the home directory itself as ~', () => {
    expect(displayFolder('/Users/ann', '/Users/ann', 'darwin')).toBe('~');
    expect(displayFolder('/Users/ann/', '/Users/ann', 'darwin')).toBe('~/');
  });

  it('takes a home with a trailing separator', () => {
    expect(displayFolder('/Users/ann/x', '/Users/ann/', 'darwin')).toBe('~/x');
    expect(displayFolder('/Users/ann', '/Users/ann//', 'darwin')).toBe('~');
  });

  it('matches only a whole path segment', () => {
    expect(displayFolder('/Users/anna/x', '/Users/ann', 'darwin')).toBe('/Users/anna/x');
    expect(displayFolder('/home/useroops', '/home/user', 'linux')).toBe('/home/useroops');
  });

  it('shows a folder outside home as it is', () => {
    expect(displayFolder('/', '/Users/ann', 'darwin')).toBe('/');
    expect(displayFolder('/opt/claude', '/Users/ann', 'darwin')).toBe('/opt/claude');
    expect(displayFolder('/Users', '/Users/ann', 'darwin')).toBe('/Users');
  });

  it('compares case-sensitively on Unix', () => {
    expect(displayFolder('/users/ann/x', '/Users/ann', 'darwin')).toBe('/users/ann/x');
    expect(displayFolder('/Users/ANN/x', '/Users/ann', 'linux')).toBe('/Users/ANN/x');
  });

  it('on Windows, ignores case and takes either separator', () => {
    expect(displayFolder('C:\\Users\\Ann\\Projects\\shop', 'C:\\Users\\Ann', 'win32')).toBe('~\\Projects\\shop');
    expect(displayFolder('c:\\users\\ann\\src', 'C:\\Users\\Ann', 'win32')).toBe('~\\src');
    expect(displayFolder('C:\\Users\\Ann/src', 'C:\\Users\\Ann', 'win32')).toBe('~/src');
    expect(displayFolder('C:\\Users\\Ann', 'C:\\Users\\Ann\\', 'win32')).toBe('~');
    expect(displayFolder('C:\\Users\\Anna\\src', 'C:\\Users\\Ann', 'win32')).toBe('C:\\Users\\Anna\\src');
    expect(displayFolder('D:\\work', 'C:\\Users\\Ann', 'win32')).toBe('D:\\work');
    expect(displayFolder('C:\\Users\\Bob\\x', 'C:\\Users\\Ann', 'win32')).toBe('C:\\Users\\Bob\\x');
  });

  it('does not treat a backslash as a separator off Windows', () => {
    expect(displayFolder('/Users/ann\\x', '/Users/ann', 'darwin')).toBe('/Users/ann\\x');
    expect(displayFolder('/Users/ann/x', '/Users/ann\\', 'linux')).toBe('/Users/ann/x');
  });

  it('never replaces anything when home is unknown or the root', () => {
    expect(displayFolder('/Users/ann', '', 'darwin')).toBe('/Users/ann');
    expect(displayFolder('/Users/ann', '/', 'darwin')).toBe('/Users/ann');
    expect(displayFolder('/', '/', 'darwin')).toBe('/');
    expect(displayFolder('C:\\x', '\\', 'win32')).toBe('C:\\x');
  });
});
