import { describe, it, expect } from 'vitest';
import { evaluate, formatResult, displayResult } from '../src/lib/calc';

describe('calculator', () => {
  it('follows the usual order of operations', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('10-4-3')).toBe(3);
    expect(evaluate('100/10/2')).toBe(5);
  });

  it('accepts × ÷ x and thousands separators', () => {
    expect(evaluate('6 × 7')).toBe(42);
    expect(evaluate('6x7')).toBe(42);
    expect(evaluate('84 ÷ 2')).toBe(42);
    expect(evaluate('1,200 / 4')).toBe(300);
    expect(evaluate('1,200,000 / 1000')).toBe(1200);
  });

  it('handles percent like a normal calculator', () => {
    expect(evaluate('60 * 250%')).toBe(150);
    expect(evaluate('200 + 10%')).toBe(220);
    expect(evaluate('200 - 25%')).toBe(150);
    expect(evaluate('50%')).toBe(0.5);
    expect(evaluate('780 / 250%')).toBe(312);
  });

  it('supports ans, functions and implicit multiplication', () => {
    expect(evaluate('ans * 2', 21)).toBe(42);
    expect(evaluate('sqrt(81)')).toBe(9);
    expect(evaluate('√(16)')).toBe(4);
    expect(evaluate('ceil(7.1)')).toBe(8);
    expect(evaluate('2(3+4)')).toBe(14);
    expect(evaluate('2*(3+4')).toBe(14); // a missing ) at the end is forgiven
  });

  it('gives clear errors', () => {
    expect(() => evaluate('5/0')).toThrow(/divide by zero/);
    expect(() => evaluate('2+')).toThrow(/Incomplete/);
    expect(() => evaluate('2)')).toThrow(/Unmatched/);
    expect(() => evaluate('hello')).toThrow(/Unknown word/);
    expect(() => evaluate('1.2.3')).toThrow(/isn’t a number/);
    expect(() => evaluate('2 3')).toThrow();
    expect(() => evaluate('')).toThrow();
  });

  it('formats results without floating-point noise', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3');
    expect(formatResult(10 / 3)).toBe('3.3333333333');
    expect(formatResult(-0)).toBe('0');
    expect(displayResult(1234567.5)).toBe('1,234,567.5');
    expect(displayResult(-9876)).toBe('-9,876');
  });
});
