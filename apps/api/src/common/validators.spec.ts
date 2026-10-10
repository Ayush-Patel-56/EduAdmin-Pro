import { isValidGstin, normalizeIndianMobile } from './validators.js';

describe('isValidGstin', () => {
  it.each(['29AAAAP0267H1ZK', '27AAPFU0939F1ZV', '29AAGCB7383J1Z4'])(
    'accepts valid GSTIN %s',
    (gstin) => expect(isValidGstin(gstin)).toBe(true),
  );

  it('rejects a wrong check digit', () => {
    expect(isValidGstin('29AAAAP0267H1ZA')).toBe(false);
    expect(isValidGstin('07AAAAA1111A1Z1')).toBe(false);
  });

  it('rejects bad format and state codes', () => {
    expect(isValidGstin('29AAAAP0267H1Z')).toBe(false); // too short
    expect(isValidGstin('29aaaap0267h1zk')).toBe(false); // lower case (normalise first)
    expect(isValidGstin('00AAAAP0267H1ZK')).toBe(false); // state 00
    expect(isValidGstin('29AAAAP0267H1YK')).toBe(false); // 14th char must be Z
  });
});

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['09876543210', '9876543210'],
    ['919876543210', '9876543210'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', '98765432101', 'abcdefghij'])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});
