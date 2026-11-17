import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { evaluate, formatResult, displayResult, CalcError } from '../lib/calc';

interface Entry {
  expr: string;
  result: number;
}

const HISTORY_KEY = 'ficsit-planner-calc';
const WIDTH = 272;
const OPERATORS = new Set(['+', '-', '*', '/', '^', '%', 'x', '×', '÷']);

function loadHistory(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => typeof e?.expr === 'string' && typeof e?.result === 'number').slice(-30) : [];
  } catch {
    return [];
  }
}
function saveHistory(h: Entry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-30)));
  } catch {
    /* storage blocked: history just won't survive a reload */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Buttons: [label shown, text inserted or action] */
const KEYS: [string, string][] = [
  ['C', 'clear'], ['⌫', 'back'], ['(', '('], [')', ')'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '÷'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '×'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'],
  ['0', '0'], ['.', '.'], ['%', '%'], ['+', '+'],
  ['ans', 'ans'], ['xʸ', '^'], ['√', '√('], ['=', 'equals'],
];

export function Calculator() {
  const open = useStore((s) => s.ui.calcOpen ?? false);
  const pos = useStore((s) => s.ui.calcAt);
  const setUI = useStore((s) => s.setUI);

  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<Entry[]>(loadHistory);
  const [error, setError] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [drag, setDrag] = useState<{ left: number; bottom: number } | null>(null);
  const [, setViewport] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  /** where to put the cursor after the next render */
  const caret = useRef<number | null>(null);
  const ans = history.length ? history[history.length - 1].result : 0;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useLayoutEffect(() => {
    const el = input.current;
    const c = caret.current;
    if (!el || c === null) return;
    caret.current = null;
    el.focus();
    el.setSelectionRange(c, c);
  });
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [history.length, open]);

  // live answer while typing (only when the expression is complete)
  const preview = useMemo(() => {
    if (!expr.trim() || justEvaluated) return null;
    try {
      const v = evaluate(expr, ans);
      return formatResult(v) === expr.replace(/,/g, '').trim() ? null : v;
    } catch {
      return null;
    }
  }, [expr, ans, justEvaluated]);

  if (!open) return null;

  // pinned by its bottom edge, so the keys stay put while the history above them grows
  const height = box.current?.offsetHeight ?? 440;
  const p = drag ?? pos ?? { left: window.innerWidth - WIDTH - 16, bottom: 16 };
  const left = clamp(p.left, 8, Math.max(8, window.innerWidth - WIDTH - 8));
  const bottom = clamp(p.bottom, 8, Math.max(8, window.innerHeight - height - 8));

  const change = (text: string) => {
    setExpr(text);
    setError(null);
    setJustEvaluated(false);
  };

  /** insert text at the cursor (replacing any selection) */
  const insert = (text: string) => {
    const el = input.current;
    if (justEvaluated && !OPERATORS.has(text)) {
      // starting a new sum after "=": a number replaces the old answer
      change(text);
      caret.current = text.length;
      return;
    }
    const start = justEvaluated ? expr.length : (el?.selectionStart ?? expr.length);
    const end = justEvaluated ? expr.length : (el?.selectionEnd ?? expr.length);
    const next = expr.slice(0, start) + text + expr.slice(end);
    change(next);
    caret.current = start + text.length;
  };

  const equals = () => {
    if (!expr.trim()) return;
    try {
      const v = evaluate(expr, ans);
      const h = [...history, { expr: expr.trim(), result: v }].slice(-30);
      setHistory(h);
      saveHistory(h);
      const text = formatResult(v);
      setExpr(text);
      setError(null);
      setJustEvaluated(true);
      caret.current = text.length;
    } catch (e) {
      setError(e instanceof CalcError ? e.message : 'Couldn’t work that out');
    }
  };

  const press = (action: string) => {
    if (action === 'clear') {
      change('');
      caret.current = 0;
    } else if (action === 'back') {
      const el = input.current;
      const s = el?.selectionStart ?? expr.length;
      const e = el?.selectionEnd ?? expr.length;
      if (justEvaluated || s !== e) {
        const next = justEvaluated ? '' : expr.slice(0, s) + expr.slice(e);
        change(next);
        caret.current = justEvaluated ? 0 : s;
      } else if (s > 0) {
        change(expr.slice(0, s - 1) + expr.slice(s));
        caret.current = s - 1;
      }
    } else if (action === 'equals') equals();
    else insert(action);
  };

  /** typing straight after "=": an operator keeps going from the answer ("= 150" then "*2"), anything else starts a new sum */
  const onType = (next: string) => {
    if (next.endsWith('=') && next.slice(0, -1) === expr) return equals();
    if (justEvaluated && next.length > expr.length && next.startsWith(expr)) {
      const typed = next.slice(expr.length);
      if (!OPERATORS.has(typed[0]) && typed[0] !== ' ') {
        change(typed);
        caret.current = typed.length;
        return;
      }
    }
    change(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === '=') {
      e.preventDefault();
      equals();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (expr) change('');
      else setUI({ calcOpen: false });
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let last = { left, bottom };
    const move = (ev: PointerEvent) => {
      last = { left: left + ev.clientX - x0, bottom: bottom - (ev.clientY - y0) };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      setUI({
        calcAt: {
          left: clamp(last.left, 8, window.innerWidth - WIDTH - 8),
          bottom: clamp(last.bottom, 8, Math.max(8, window.innerHeight - height - 8)),
        },
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pickEntry = (en: Entry) => {
    const text = formatResult(en.result);
    if (!expr || justEvaluated) {
      change(text);
      caret.current = text.length;
    } else insert(text);
  };

  return (
    <div className="calc" ref={box} style={{ left, bottom, width: WIDTH }} role="dialog" aria-label="Calculator">
      <div className="calc-head" onPointerDown={startDrag} title="Drag to move">
        <span>🧮 Calculator</span>
        <button className="tab-x" onClick={() => setUI({ calcOpen: false })} title="Close (Esc)" aria-label="Close calculator">
          ×
        </button>
      </div>
      <div className="calc-tape" ref={tape}>
        {history.length ? (
          history.map((en, i) => (
            <button key={i} className="calc-entry" onClick={() => pickEntry(en)} title="Use this answer">
              <span className="calc-entry-expr">{en.expr} =</span>
              <span className="calc-entry-result">{displayResult(en.result)}</span>
            </button>
          ))
        ) : (
          <div className="muted small calc-hint">
            Type a sum and press Enter. Try <code>780 / 250%</code> or <code>ceil(480 / 7.5)</code>.
          </div>
        )}
      </div>
      {history.length > 0 && (
        <div className="calc-tape-actions">
          <button
            className="link small"
            onClick={() => {
              setHistory([]);
              saveHistory([]);
            }}
          >
            Clear history
          </button>
        </div>
      )}
      <input
        ref={input}
        className={'calc-input' + (error ? ' bad' : justEvaluated ? ' answer' : '')}
        value={expr}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="0"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label="Sum"
      />
      <div className={'calc-preview small' + (error ? ' bad-text' : ' muted')}>{error ?? (preview !== null ? '= ' + displayResult(preview) : ' ')}</div>
      <div className="calc-keys">
        {KEYS.map(([label, action]) => (
          <button
            key={label}
            className={
              'calc-key' +
              (action === 'equals' ? ' eq' : /^[\d.]$/.test(action) ? ' digit' : action === 'clear' || action === 'back' ? ' fn' : ' op')
            }
            onMouseDown={(e) => e.preventDefault() /* keep the cursor in the input */}
            onClick={() => press(action)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
