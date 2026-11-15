import icons from '../data/icons.json';
import { BUILDINGS, ITEMS } from '../lib/gamedata';

const ICONS = icons as Record<string, string>;

export function ItemIcon({ item, size = 22, title }: { item: string; size?: number; title?: string }) {
  const it = ITEMS[item];
  const key = it?.icon ?? BUILDINGS[item]?.icon;
  const src = key ? ICONS[key] : undefined;
  if (item === 'Power') {
    return (
      <span className="icon power-icon" style={{ width: size, height: size, fontSize: size * 0.7 }} title={title ?? 'Power'}>
        ⚡
      </span>
    );
  }
  if (!src) return <span className="icon icon-missing" style={{ width: size, height: size }} title={title ?? it?.name} />;
  return <img className="icon" src={src} width={size} height={size} alt="" title={title ?? it?.name ?? BUILDINGS[item]?.name} draggable={false} />;
}

export function BuildingIcon({ building, size = 22 }: { building: string; size?: number }) {
  const b = BUILDINGS[building];
  const src = b ? ICONS[b.icon] : undefined;
  if (!src) return null;
  return <img className="icon" src={src} width={size} height={size} alt="" title={b.name} draggable={false} />;
}
