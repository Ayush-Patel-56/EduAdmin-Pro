import { normalizeClass } from './curriculum.service.js';

const offered = ['9th', '10th', '11th', '12th', 'Repeater'];

describe('normalizeClass', () => {
  it('accepts the common ways a class is written', () => {
    expect(normalizeClass('11', offered)).toBe('11th');
    expect(normalizeClass('11th', offered)).toBe('11th');
    expect(normalizeClass('Class 11', offered)).toBe('11th');
    expect(normalizeClass('class 9th', offered)).toBe('9th');
    expect(normalizeClass('repeater', offered)).toBe('Repeater');
  });

  it("rejects classes the school doesn't offer", () => {
    expect(normalizeClass('8', offered)).toBeNull();
    expect(normalizeClass('12th Pass', offered)).toBeNull();
    expect(normalizeClass('eleven', offered)).toBeNull();
  });
});
