// 👾 What each Labirin monster looks like (from labyrinth.json: a body shape, a colour, a size). A tiny
// registry with no three.js in it, so the main bundle can fill it at start and the lazy 3D chunk (and the
// pixel/portrait art made from it) can read it.
export interface MonsterLook {
  model: string;
  color: string;
  size: number;
}

const looks = new Map<string, MonsterLook>();

export function setMonsterLooks(list: Array<{ id: string; model?: string; color?: string; size?: number }>) {
  looks.clear();
  for (const m of list) if (m.model) looks.set(m.id, { model: m.model, color: m.color ?? '#ced4da', size: m.size ?? 1 });
}

export function monsterLook(kind: string | undefined): MonsterLook | undefined {
  return kind ? looks.get(kind) : undefined;
}
