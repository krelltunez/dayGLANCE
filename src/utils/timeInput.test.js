import { describe, expect, it } from 'vitest';
import { minuteAtPoint, parseTimeInput } from './timeInput.js';

// #2249: any time, typed into the clock picker.
describe('parseTimeInput', () => {
  it.each([
    ['16:53', '16:53'], ['4:53 pm', '16:53'], ['4:53PM', '16:53'], ['4:53p', '16:53'], ['4.53 p.m.', '16:53'],
    ['4h53 pm', '16:53'], ['453p', '16:53'], ['1653', '16:53'], ['4 pm', '16:00'], ['12:05 am', '00:05'],
    ['12:05 pm', '12:05'], ['0:30', '00:30'], ['23:59', '23:59'], [' 7:05 AM ', '07:05'],
  ])('%s → %s', (text, time) => {
    expect(parseTimeInput(text)).toBe(time);
  });

  it('without a day period: 13 and up is 24-hour; up to 12 takes the picker\'s AM/PM on a 12-hour clock', () => {
    expect(parseTimeInput('4:53', { defaultPm: true })).toBe('16:53');
    expect(parseTimeInput('4:53', { defaultPm: false })).toBe('04:53');
    expect(parseTimeInput('12:10', { defaultPm: false })).toBe('00:10');
    expect(parseTimeInput('12:10', { defaultPm: true })).toBe('12:10');
    expect(parseTimeInput('4:53', { use24HourClock: true, defaultPm: true })).toBe('04:53');
  });

  it('the language\'s own day periods', () => {
    expect(parseTimeInput('下午4:53', { dayPeriods: { am: '上午', pm: '下午' } })).toBe('16:53');
    expect(parseTimeInput('9:15 vorm.', { dayPeriods: { am: 'vorm.', pm: 'nachm.' } })).toBe('09:15');
  });

  it.each(['', 'soon', '25:00', '4:60', '13 pm', '0 am', '4:5', '12345', 'pm'])('%s is not a time', (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });
});

describe('minuteAtPoint', () => {
  it('reads the minute from where the face is pressed, 0 at the top, clockwise', () => {
    expect(minuteAtPoint(0, -100)).toBe(0);
    expect(minuteAtPoint(100, 0)).toBe(15);
    expect(minuteAtPoint(0, 100)).toBe(30);
    expect(minuteAtPoint(-100, 0)).toBe(45);
    const at = (minute) => [Math.sin(minute * Math.PI / 30) * 90, -Math.cos(minute * Math.PI / 30) * 90];
    expect(minuteAtPoint(...at(53))).toBe(53);
    expect(minuteAtPoint(...at(59.6))).toBe(0);
  });
});
