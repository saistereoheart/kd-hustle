// Walk-reachability: which tiles a player on foot (or bicycle, same grid) can get to from the
// spawn point. Used by tests (every door and spot must be reachable) and the map preview tool.
import { gridIndexAt, type BuiltMap } from './build';

export function reachableFromSpawn(map: Pick<BuiltMap, 'width' | 'height' | 'solid' | 'spawnPx' | 'tileSize' | 'originTx' | 'originTy'>): Uint8Array {
  const W = map.width;
  const seen = new Uint8Array(W * map.height);
  const start = gridIndexAt(map as BuiltMap, map.spawnPx.x, map.spawnPx.y);
  if (start < 0) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0 && !seen[i - 1] && !map.solid[i - 1]) (seen[i - 1] = 1), stack.push(i - 1);
    if (x < W - 1 && !seen[i + 1] && !map.solid[i + 1]) (seen[i + 1] = 1), stack.push(i + 1);
    if (y > 0 && !seen[i - W] && !map.solid[i - W]) (seen[i - W] = 1), stack.push(i - W);
    if (y < map.height - 1 && !seen[i + W] && !map.solid[i + W]) (seen[i + W] = 1), stack.push(i + W);
  }
  return seen;
}
