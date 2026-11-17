# Credits and licences

## Art, fonts and sound
- **All art is generated in code** (Canvas 2D / Phaser Graphics): characters, tiles, buildings, decor and UI icons.
  There are no image, sprite, font or sound files in the repo.
- Text uses the device's **system fonts**. Emoji come from the device's own emoji font.
- No audio yet. When it's added it will be generated with WebAudio or be CC0.

## Libraries (runtime)
| Package | Licence |
|---|---|
| [Phaser 3](https://phaser.io) | MIT |
| [Socket.IO](https://socket.io) (server + client) | MIT |
| [Express](https://expressjs.com) | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | MIT |
| [zod](https://zod.dev) | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | BSD-2-Clause |

## Libraries (development only)
| Package | Licence |
|---|---|
| Vite | MIT |
| TypeScript | Apache-2.0 |
| tsx | MIT |
| tsup | MIT |
| Vitest | MIT |
| Playwright | Apache-2.0 |
| cross-env | MIT |

## Map data
- Map geometry (roads, lanes, footpaths, building footprints, parks, water, rail) comes from
  **OpenStreetMap**, © OpenStreetMap contributors, available under the
  **Open Database License (ODbL) 1.0**: https://www.openstreetmap.org/copyright
- The generated map file (`shared/map/kd.osm.json`) and our overrides (`shared/map/town.overrides.json`) are
  distributed under the ODbL. The attribution is shown in-game (HUD and full map).
- No Google Maps data is used.

## Places and names
Real place and road names (Kota Damansara, Dataran Sunway, Persiaran Surian…) are used for inspiration only.
Every shop, mall, bank and brand in the game is a fictional parody. `docs/reference/` map screenshots are **not**
committed (Google Maps imagery can't be redistributed).
