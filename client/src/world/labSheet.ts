// 🗝️ Labirin Purba's tileset: the pieces of client/public/lab/tileset.png (x, y, w, h in the sheet's
// pixels). The sheet was made by the game's owner (ChatGPT, for this non-commercial game); its magenta
// background was keyed out to transparency. Every room is built from these pieces (see labRoomArt.ts).
import type Phaser from 'phaser';

export const LAB_SHEET = 'lab_sheet';
export const LAB_SHEET_URL = 'lab/tileset.png';

export const LAB_FRAMES = {
  altar: [856, 1024, 80, 80],
  arch_big: [360, 996, 166, 238],
  arch_door_blue: [634, 20, 158, 204],
  arch_door_purple: [806, 24, 130, 196],
  banner: [1158, 268, 80, 142],
  banner_pole: [500, 844, 74, 142],
  bar_counter: [1030, 422, 210, 174],
  barrel: [858, 642, 72, 96],
  bench_long: [16, 676, 162, 64],
  bench_short: [302, 676, 110, 60],
  boulders: [1118, 1126, 114, 104],
  cabinet: [958, 638, 74, 126],
  campfire: [620, 852, 114, 144],
  chest_red: [1024, 1098, 58, 72],
  chest_red_small: [1042, 1194, 54, 36],
  chest_small: [958, 1194, 62, 38],
  chest_wood: [806, 762, 90, 78],
  crate_b: [696, 762, 62, 70],
  crate_barrel: [856, 1126, 80, 106],
  crate_big: [706, 634, 128, 106],
  crate_c: [946, 1094, 60, 84],
  crate_small_a: [444, 674, 54, 60],
  crate_small_b: [1176, 948, 52, 52],
  fence: [546, 1128, 100, 104],
  floor_dark_a: [174, 26, 122, 124],
  floor_moss: [330, 182, 120, 120],
  floor_puddle_orange: [330, 26, 122, 124],
  floor_puddle_purple: [484, 26, 124, 122],
  floor_warm_a: [18, 26, 122, 124],
  floor_warm_b: [20, 184, 120, 120],
  floor_warm_c: [174, 182, 122, 122],
  lamp_post: [310, 766, 56, 208],
  lamp_tall: [206, 746, 68, 232],
  lantern_base: [24, 864, 62, 114],
  lantern_gallows: [402, 762, 88, 212],
  lantern_hanging: [858, 860, 62, 110],
  lantern_small: [138, 862, 38, 114],
  portal: [18, 1000, 230, 234],
  portal_shrine: [264, 1142, 68, 88],
  pot: [958, 1016, 42, 48],
  rock_alcove: [262, 1034, 82, 94],
  rock_cluster_a: [12, 332, 136, 142],
  rock_cluster_b: [166, 330, 140, 144],
  rock_cluster_c: [200, 496, 106, 142],
  rock_cluster_d: [326, 498, 92, 140],
  rock_pillar_a: [336, 336, 62, 136],
  rock_pillar_b: [430, 334, 70, 138],
  rock_pillar_c: [544, 342, 58, 130],
  rock_pillar_tall: [452, 502, 70, 138],
  rock_post: [1176, 1022, 50, 82],
  rock_small: [552, 522, 58, 94],
  rock_wide: [12, 494, 164, 144],
  rubble_a: [680, 1026, 72, 94],
  rubble_b: [774, 1036, 58, 76],
  rubble_wall_a: [538, 1014, 124, 94],
  rubble_wall_b: [668, 1140, 168, 90],
  sign_board: [960, 878, 102, 110],
  sign_small: [1058, 794, 48, 66],
  signpost: [1078, 948, 76, 136],
  stall_small: [1120, 794, 114, 124],
  stall_striped: [1062, 638, 170, 138],
  stool: [218, 676, 46, 58],
  stool_mini: [1026, 1028, 34, 38],
  stool_tiny: [932, 832, 24, 28],
  table_long: [16, 762, 150, 68],
  table_mug: [534, 760, 124, 68],
  table_round: [566, 650, 116, 88],
  table_small: [980, 796, 50, 66],
  tavern: [632, 270, 386, 330],
  torch_pole: [770, 862, 46, 150],
  wall_lantern: [1042, 270, 80, 138],
  wall_lantern_banner: [1104, 26, 134, 194],
  wall_lantern_wide: [956, 26, 130, 194],
} as const;

export type LabFrame = keyof typeof LAB_FRAMES;

/** Adds every piece as a named frame of the sheet (once it's loaded). */
export function addLabFrames(scene: Phaser.Scene): boolean {
  if (!scene.textures.exists(LAB_SHEET)) return false;
  const t = scene.textures.get(LAB_SHEET);
  for (const [name, [x, y, w, h]] of Object.entries(LAB_FRAMES)) if (!t.has(name)) t.add(name, 0, x, y, w, h);
  return true;
}
