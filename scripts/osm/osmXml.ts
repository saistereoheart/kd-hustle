// Minimal OpenStreetMap XML (API 0.6) parser: nodes, ways, relations + tags.
// The OSM API emits a very regular format, so a streaming regex parser is enough here.

export interface OsmNode { id: number; lat: number; lon: number; tags: Record<string, string> }
export interface OsmWay { id: number; nodes: number[]; tags: Record<string, string> }
export interface OsmMember { type: 'node' | 'way' | 'relation'; ref: number; role: string }
export interface OsmRelation { id: number; members: OsmMember[]; tags: Record<string, string> }
export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  relations: Map<number, OsmRelation>;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const attrs = (s: string) => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
};

const tagsOf = (body: string | undefined) => {
  const t: Record<string, string> = {};
  if (!body) return t;
  for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[decode(m[1])] = decode(m[2]);
  return t;
};

export function emptyOsm(): OsmData {
  return { nodes: new Map(), ways: new Map(), relations: new Map() };
}

/** Parses one OSM XML document and merges it into `into` (deduplicated by id). */
export function parseOsmXml(xml: string, into: OsmData = emptyOsm()): OsmData {
  const re = /<(node|way|relation)\s([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of xml.matchAll(re)) {
    const kind = m[1];
    const a = attrs(m[2]);
    const body = m[4];
    const id = Number(a.id);
    if (a.visible === 'false') continue;
    if (kind === 'node') {
      into.nodes.set(id, { id, lat: Number(a.lat), lon: Number(a.lon), tags: tagsOf(body) });
    } else if (kind === 'way') {
      const nodes = body ? [...body.matchAll(/<nd ref="(\d+)"/g)].map((x) => Number(x[1])) : [];
      into.ways.set(id, { id, nodes, tags: tagsOf(body) });
    } else {
      const members: OsmMember[] = body
        ? [...body.matchAll(/<member type="(node|way|relation)" ref="(\d+)" role="([^"]*)"/g)].map((x) => ({
            type: x[1] as OsmMember['type'],
            ref: Number(x[2]),
            role: x[3],
          }))
        : [];
      into.relations.set(id, { id, members, tags: tagsOf(body) });
    }
  }
  return into;
}
