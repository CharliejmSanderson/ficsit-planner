/** The name this browser shows to others when it changes something (kept only in this browser). */
const NAME_KEY = 'ficsit-planner-name';

export function getName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* storage blocked */
  }
}

/** stamp an edited factory or note with when and by whom */
export function stamp<T extends { updatedAt?: number; updatedBy?: string }>(o: T, t: number): T {
  o.updatedAt = t;
  const name = getName();
  if (name) o.updatedBy = name;
  else delete o.updatedBy;
  return o;
}
