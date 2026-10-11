import { classesLabel, orderClasses } from './school-options.js';

describe('classesLabel', () => {
  it('collapses a contiguous run of grades', () => {
    expect(classesLabel(['8th', '6th', '7th'])).toBe('6th - 8th');
  });

  it('lists 12th Pass and Repeater after the grade range', () => {
    expect(classesLabel(['6th', '7th', '8th', '9th', '10th', '11th', '12th', 'Repeater'])).toBe(
      '6th - 12th, Repeater',
    );
    expect(classesLabel(['11th', '12th', '12th Pass', 'Repeater'])).toBe('11th - 12th, 12th Pass, Repeater');
    expect(classesLabel(['Repeater'])).toBe('Repeater');
  });

  it('lists a few scattered grades and counts many', () => {
    expect(classesLabel(['6th', '8th'])).toBe('6th, 8th');
    expect(classesLabel(['6th', '8th', '10th', '12th'])).toBe('4 classes');
  });
});

describe('orderClasses', () => {
  it('drops unknown values and duplicates', () => {
    expect(orderClasses(['Repeater', '6th', '6th', '5th'])).toEqual(['6th', 'Repeater']);
  });
});
