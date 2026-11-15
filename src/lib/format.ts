import { unitOf } from './gamedata';

export function num(v: number, maxDecimals?: number): string {
  if (!Number.isFinite(v)) return '∞';
  const a = Math.abs(v);
  let d = maxDecimals ?? (a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4);
  if (a > 0 && a < 0.001) d = 5;
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (a >= 10000) return Number(s).toLocaleString('en-US', { maximumFractionDigits: d });
  return s === '-0' ? '0' : s;
}

export const rate = (item: string, v: number) => `${num(v)} ${unitOf(item)}`;
export const pct = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return `${s.includes('.') ? s.replace(/\.?0+$/, '') : s}%`;
};
export const mw = (v: number) => `${num(v, v >= 100 ? 1 : 2)} MW`;
export const signed = (v: number, f: (x: number) => string = (x) => num(x)) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
