# Map data

| File | What | Licence |
|---|---|---|
| `kd.osm.json` | **Generated** by `npm run import-map` from OpenStreetMap: roads, lanes, footpaths, building footprints, parks, water, rail. Shop/brand/business names are removed. Don't hand-edit; re-run the importer. | **ODbL 1.0**. Map data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright) |
| `town.overrides.json` | Our additions: fixed world origin (Menara Mitraland), map bounds, spawn, districts, parody names for landmarks, extra paths/areas, gameplay decor. | ODbL 1.0 (it's applied on top of the OSM data) |

The rest of the repository (code) is MIT; see `/LICENSE`.

## Updating the map
```bash
npm run fetch-osm     # downloads OSM tiles for osmFetchBbox into data-src/osm/ (git-ignored)
npm run import-map    # regenerates kd.osm.json
npm test              # map validator: reachability, doors, landmarks, no brand names
```

## Coordinates
- 1 tile = 2 m, 32 px. Coordinates are in tiles relative to the fixed origin (Menara Mitraland, tile 0,0).
- `bounds` = `[minX, minY, width, height]`. To grow the map, enlarge `bounds` (and `osmFetchBbox`), re-fetch and
  re-import. Existing coordinates, player positions and building ids stay the same.
- Building ids are OSM ids (`w123` = way, `r456` = relation), so ownership survives re-imports.
