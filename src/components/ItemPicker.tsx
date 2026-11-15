import { useEffect, useMemo, useRef, useState } from 'react';
import { itemName } from '../lib/gamedata';
import { ItemIcon } from './ItemIcon';

export function ItemPicker({
  items,
  value,
  onChange,
  placeholder = 'Search items…',
  autoFocus,
}: {
  items: string[];
  value?: string;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const l = s ? items.filter((i) => itemName(i).toLowerCase().includes(s)) : items;
    return l.slice(0, 80);
  }, [q, items]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (id: string) => {
    onChange(id);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="picker" ref={ref}>
      <div className="picker-input">
        {value && !open && <ItemIcon item={value} size={20} />}
        <input
          value={open ? q : value ? itemName(value) : ''}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              setHi((h) => Math.min(h + 1, list.length - 1));
              e.preventDefault();
            } else if (e.key === 'ArrowUp') {
              setHi((h) => Math.max(h - 1, 0));
              e.preventDefault();
            } else if (e.key === 'Enter' && list[hi]) {
              pick(list[hi]);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      {open && (
        <div className="picker-list">
          {list.map((id, i) => (
            <div
              key={id}
              className={'picker-opt' + (i === hi ? ' hi' : '')}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(id);
              }}
            >
              <ItemIcon item={id} size={22} />
              <span>{itemName(id)}</span>
            </div>
          ))}
          {!list.length && <div className="picker-empty">No match</div>}
        </div>
      )}
    </div>
  );
}
