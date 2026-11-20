# Kota Hustle — Game Design Spec

> Working title. A browser-based LAN multiplayer **Social RNG Tycoon**.
> Walk around a big 2D modern city inspired by Kota Damansara, hustle from RM 300 to billions,
> gamble for rare cosmetics and items, buy property, run Airbnbs, cook at your own stall,
> build a business empire, and flex on your friends on the same WiFi.
>
> Reference feel: **Habbo Hotel / Gather.town** (social 2D town) + **Sol's RNG / Pet Simulator 99**
> (rarity rolls, luck, collection) + **AdVenture Capitalist** (passive income, managers, prestige)
> + **Cooking Mama / Overcooked** (step-by-step cooking) + **The Sims build mode** (decorating).

---

## 1. Core loops

| Loop | Length | What the player does |
|---|---|---|
| **Micro** | 5–30 s | Roll a crate, cook one dish, finish one delivery job, spin a slot |
| **Mid** | 5–30 min | Save up for an upgrade, a new property, a better crate; redecorate an Airbnb for a higher star rating |
| **Macro** | hours–weeks | Climb the 6 wealth stages, complete the item index, unlock titles, rebirth for permanent multipliers |

Every screen should show the player's **next goal** (e.g. "RM 3,420 / RM 25,000 → Food Truck").

---

## 2. Technical architecture

- **Server (Node + Express + Socket.IO + SQLite)** owns the world state, the economy, RNG and saving.
- **Client (Phaser 3 + Vite)** renders the town, characters, UI and mini-games, and sends intents.
- **Tick rate:** server broadcasts player positions at 15–20 Hz; clients interpolate. Movement is client-predicted, server-validated (max speed, collision with walls).
- **Rooms/scenes:** the outdoor town is one shared scene. **Every enterable building has an interior** (Pokémon style): walk into the door (no button: pushing into a door goes in; a locked door knocks and blocks you), and the town blurs and darkens behind a room view. The room's size follows the building's real footprint: a deep shoplot is a long room, malls and hypermarkets are big halls the camera follows you around. You leave by walking out through the doorway. Other players' badges ("🚪 Ali is inside") show over the doors of the buildings they're in. Shops, machines and counters are used *from inside* (nothing is used through a wall from the street). Homes are locked until they can be bought. Players in the same interior see each other. *(Changed 2026-11-18 at the owner's request; see docs/PROGRESS.md.)*
- **Economy tick:** the server runs a 1-second economy tick for passive income, timers, rent and loans.
- **In-game time:** 1 in-game hour = 1 real minute (1 in-game day = 24 real minutes). Day/night lighting cycle on the client. Some things depend on time (the pasar malam only opens at night, Airbnb check-ins happen at 3 PM, rent is paid daily).
- **Folder layout:**
  ```
  /client   Phaser game, scenes, UI, mini-games, renderer for vector characters
  /server   Express + Socket.IO, systems/, db/, auth/, economy tick, save manager
  /shared   types, zod schemas, constants, /config/*.json balance files
  /scripts  balance-sim.ts, seed-dev.ts, backup.ts
  /docs     GAME_SPEC.md, PROGRESS.md, reference/ (map screenshots)
  ```

---

## 3. Accounts, login and saving

- **Register:** username (3–16 chars, unique), password (min 6), confirm password. Then go to character creation.
- **Login:** username + password → server returns a session token (random 32 bytes) → stored in localStorage → auto-login next time. "Log out" clears it.
- Passwords hashed with **bcrypt** (cost 10). Rate-limit login attempts (5/min per IP).
- **One active session per account.** Logging in on a second device kicks the first (after saving it).
- **Save triggers:**
  1. Autosave every **60 s** for players whose state changed (dirty flag)
  2. Clicking **Log out**
  3. Socket **disconnect** (closing the tab, phone sleeping, WiFi dropping)
  4. Server shutdown (SIGINT/SIGTERM): save everyone, then exit
  5. Immediately after high-value events (Mythic+ roll, property purchase, trade, loan)
- Show a small "Saved ✓" toast on autosave, and "Last saved: 12 s ago" in the settings menu.
- **DB design:** `accounts`, `players` (appearance JSON, position, wallet, stats), `inventory_items`, `properties`, `businesses`, `loans`, `titles`, `upgrades`, `collection_index`, `transactions` (economy log), `announcements`. Use transactions for anything that moves money or items.
- **Backups:** on server start and every 6 h, copy the DB to `/server/backups/` and keep the last 14.

---

## 4. Character creation (cartoon/vector, chibi)

Style: cute, simple, flat-colour cartoon with chibi proportions (big head, small body), soft outlines. **Not realistic.** Draw each part as a layered vector shape so parts can be swapped and recoloured. Show a live preview that can rotate through the 4 walking directions, with a "Randomise" button.

| Category | Options (minimum) |
|---|---|
| Skin tone | 12 presets + colour picker |
| Face shape | Round, Oval, Square, Heart, Long, Diamond |
| Body | Height slider (3 steps), build slider (slim / regular / broad) |
| Eyes | 10 styles + eye colour picker |
| Eyebrows | 6 styles (colour follows hair, can be overridden) |
| Nose | 6 styles |
| Mouth | 8 styles (neutral, smile, grin, smirk, etc.) |
| Extras | Blush, freckles, beauty mark, glasses (5 styles) |
| Hair | 20+ styles (short, long, curly, buzz, bun, ponytail, mullet, afro, side-part, wolf cut, etc.) + hair colour picker + optional highlight colour |
| Headwear | Tudung/hijab (4 styles, any colour), caps, beanie, none |
| Facial hair | 6 styles |
| Tops | T-shirt, polo, hoodie, kemeja, blazer, jersey, baju kurung, baju melayu, tank top — each with colour picker |
| Bottoms | Jeans, shorts, slacks, skirt, sarong, joggers — colour picker |
| Shoes | Sneakers, selipar, boots, loafers, heels — colour picker |

- Appearance is saved as a JSON object of part IDs + colours, and validated on the server against the config.
- Walking animation is procedural: body bob, arm/leg swing, 4 directions, plus an idle breathing animation.
- **Gacha cosmetics layer on top:** hats, auras, trails, pets, name colours, chat bubble skins, emotes, vehicles (see §7).
- Players can change their look later at the **Salon** (hair/face, costs RM) and the **Boutique** (clothes). This is a money sink.
- Above the head: **username**, equipped **title** (coloured by rarity), and a small level badge.

---

## 5. The world map (big, inspired by Kota Damansara)

The map is built at **real scale from OpenStreetMap data: 2 m per tile, 32 px tiles**. v2 covers the Kota Damansara core at **768 × 576 tiles** (≈ 1.5 × 1.15 km, 24,576 × 18,432 px) and will grow outward (forest reserve, Rymba Hills, more of PJU 3) by extending the bounds around a **fixed world origin at Menara Mitraland** — existing coordinates, property ownership and player positions never move. Roads have real lane counts (3.5 m lanes ≈ 1.75 tiles), sidewalks and lane markings, so vehicles fit. Top-down view.
The camera follows the player, with a minimap (toggle M) and a full map screen.

Road shapes, building footprints, parks and water come from **OpenStreetMap** (ODbL, attributed in-game). Google Maps data must not be used (screenshots in `docs/reference/` are for visual reference only). Shop and brand names from OSM are dropped; landmarks get parody names in an overrides file. Store the map as data
(a Tiled JSON map, or a JSON layout of roads, blocks and buildings) so it's easy to edit later.

### Districts
1. **Dataran Sunway** (central hub): a grid of 3-storey shoplot rows around a central park/square, banks, busy F&B streets, a big mall ("Giza-style" parody name, e.g. *Piramid Mall*), a second mall linked to the MRT by a pedestrian bridge, and a medical centre landmark. This is the starter district: jobs board, Kedai Runcit capsule machines, starter stalls.
2. **Surian MRT station**: sits next to Dataran Sunway. Fast-travel hub to the other stations (Kota Damansara MRT, plus fictional stops at the map edges).
3. **The Strand** (~1 km from Dataran Sunway in real life, so place it a short walk away): the Strand Mall, rows of 5-storey garden office blocks with landscaped walkways and water fountains between them, a 40-storey residence tower, an F&B street and a hypermarket (parody name, e.g. *Gergasi Hypermarket*). Mid-game district: shoplot businesses, Airbnb units in the residence tower, the **Casino** (a fictional *Lucky Strand Casino*).
4. **Mitraland / The Cascades**: a mixed development next to the hypermarket, with a retail podium, Cascades residences (premium Airbnb condos) and **Menara Mitraland**, a 30-storey corporate tower and the tallest building in Kota Damansara. In the game it's an end-game purchasable office tower.
5. **Residential areas**: Section-4-style terrace houses, semi-Ds, a bungalow hill (end game), low-cost flats and a mid-range condo cluster.
6. **Green edge**: a community forest park on the map edge (scenic area, events, a fishing/relaxing spot, an optional extra mini-game later).
7. **Roads** named after real ones where it's fun (Persiaran Surian, Jalan PJU 5/1, Persiaran Kenanga), with sidewalks, zebra crossings, lamp posts, trees, parked cars (decor) and ambient NPC pedestrians.

### World interaction
- Buildings have doors (walk into them, right at the door) leading to interiors. Big buildings (malls, the hypermarket, the station) have a door on each side that faces a road.
- Every building can carry a name label; places you can use are labelled in gold with a door icon, plain landmarks in white, areas in italics.
- Big signposts mark the key places (JOBS BOARD, BUY STOCK, PASAR MALAM STALLS…) in the world and on the map; a guide arrow points at where your current goal or quest happens.
- Wandering NPCs chat, and some ask for small errands (go somewhere, come back) for money and XP.
- Purchasable buildings show a **"FOR SALE — RM X"** sign; owned ones show the owner's name.
- NPCs: pedestrians, customers who walk to stalls, Airbnb guests with luggage, debt collectors (see §10).
- Signage uses parody names only (no real brands or logos).

---

## 6. Economy and wealth stages (MYR)

Money is stored in **sen** (integers). The player starts with **RM 300**.
There are 6 wealth stages, each unlocking new systems, districts, crates and titles. Stage = based on **net worth** (cash + asset value − debt).

| Stage | Name | Net worth | Unlocks / main income |
|---|---|---|---|
| 1 | **Budak Baru** | RM 0 – 2K | Odd jobs (food delivery rider, car wash helper, flyer distribution, mamak part-timer), capsule machines |
| 2 | **Hustler** | RM 2K – 50K | Pasar malam stall, burger bakar stall, sublet room, Lucky Bag crates, basic upgrades |
| 3 | **Towkay Kecil** | RM 50K – 1M | Food truck, low-cost flat, SoHo studio (first Airbnb), kedai runcit, car wash, bank loans |
| 4 | **Towkay** | RM 1M – 50M | Condos, terrace/semi-D, Strand shoplots, kopitiam, bubble tea, dobi, mamak 24h, tuition centre, casino high tables |
| 5 | **Tycoon** | RM 50M – 1B | Bungalows, Cascades penthouses, gym chain, supermarket, hotel, whole condo blocks |
| 6 | **Tan Sri** | RM 1B+ | Menara Mitraland office tower, a whole mall, rebirth |

### Example price ladders (tune in config with the simulator)
**Properties:** sublet room RM 8K → low-cost flat RM 60K → SoHo studio RM 280K → 2-bed condo RM 550K → terrace house RM 900K → semi-D RM 2.2M → Strand shoplot RM 3.5M → bungalow RM 8M → Cascades penthouse RM 15M → condo block RM 120M → Menara Mitraland RM 600M → mall RM 2B.

**Businesses:** pasar malam stall RM 300 → burger bakar stall RM 2K → nasi lemak stall RM 1.5K → food truck RM 25K → kedai runcit RM 50K → car wash RM 80K → dobi RM 150K → kopitiam RM 250K → bubble tea RM 400K → tuition centre RM 600K → mamak 24h RM 1.2M → gym RM 2M → supermarket RM 20M → hotel RM 150M.

### Pacing targets (the simulator must check these)
- Payback time for a new asset (before upgrades): early ~5–15 min, mid ~30–90 min, late ~2–6 h of play. Upgrades shorten it.
- An active player should reach Stage 2 in ~20 min, Stage 3 in ~2 h, Stage 4 in ~8 h, Stage 5 in ~25 h, Stage 6 in ~60 h. First rebirth ~70 h.
- **Money sinks** are required to stop runaway inflation: upgrade costs, property maintenance and assessment tax (cukai taksiran), staff wages, loan interest, salon/boutique, crates, casino house edge, marketplace fees (5%), and Airbnb cleaning.

---

## 7. Gambling and gacha (the core — make it feel amazing)

### 7.1 Rarities
| Tier | Colour | Base chance | Shown as |
|---|---|---|---|
| Common | Grey | 55% | 1 in 2 |
| Uncommon | Green | 25% | 1 in 4 |
| Rare | Blue | 12% | 1 in 8 |
| Epic | Purple | 5.5% | 1 in 18 |
| Legendary | Gold | 2% | 1 in 50 |
| Mythic | Red/pink, animated glow | 0.45% | 1 in 222 |
| Divine | White-gold, particles | 0.049% | 1 in 2,041 |
| Secret | Black + rainbow shimmer | 0.001% | 1 in 100,000 |

Odds per crate live in config; better crates shift the weights up and have exclusive item pools.

**Variants** (rolled on top of the item): Normal → **Shiny** (1/20) → **Golden** (1/100) → **Rainbow** (1/1,000). Variants boost an item's sell value and stat bonus. Some Divine/Secret items are **limited** with serial numbers ("#2 of 5 ever rolled on this server").

### 7.2 Luck
- Luck multiplies the weights of **Rare and above**, then the table is renormalised. Show the effective "1 in X" for every tier, live, on the crate screen.
- Luck sources: permanent upgrades, luck potions, equipped items, titles, rebirth bonuses, server events ("Lucky Hour 2×"). All luck multipliers stack multiplicatively (×5 and ×2 potions = ×10; on ×5 base luck = ×50; changed 2026-11-20 at the owner's request; formula in `shared/luck.ts`, unit-tested). Cap at a configurable max (`rarities.json` → `maxLuck`).

### 7.3 Crates and machines (price ladder)
| Crate | Price | Location | Pool highlights |
|---|---|---|---|
| Capsule Machine | RM 20 | Kedai Runcit, Dataran Sunway | Commons, small boosters, cheap furniture |
| Lucky Bag | RM 150 | Pasar malam | Hats, emotes, stall boosters |
| Mall Mystery Box | RM 1,500 | Piramid Mall | Outfits, pets, Airbnb furniture |
| Strand Premium Crate | RM 25K | Strand Mall | Auras, rare furniture sets, business boosters |
| Towkay Crate | RM 500K | Lucky Strand Casino | Vehicles, trails, Legendary furniture |
| Tycoon Vault | RM 10M | Menara Mitraland lobby | Mythic auras, giant pets |
| Tan Sri Diamond Vault | RM 250M | Rooftop of Menara Mitraland | Divine/Secret exclusives |

Each crate has **×1, ×5 and ×10 rolls**, **auto-roll** (an upgrade), and a **pity counter** (e.g. a guaranteed Epic+ every 50 rolls and Legendary+ every 300 in that crate; shown on screen).

### 7.4 Item types
- **Cosmetics:** hats, glasses, outfits, auras (particle effects around the character), trails (footstep effects), pets (follow you, idle animations), name colours/gradients, chat bubble skins, emote packs, vehicles (**driveable**: much faster than walking on roads, slower off-road on grass, blocked by buildings and water; the first one is the delivery-rider motorbike in Phase 2), Airbnb wall/floor themes.
- **Usables (consumables):** Luck Potion (2× luck for 10 min), Mega Luck Potion (5× for 3 min), Income Booster (2× passive income for 30 min), XP Booster, Perfect Cook Token (next 10 dishes auto-Perfect), Cleaner Voucher (instant Airbnb clean), Interest Freeze (loan interest paused for 1 day), Auto-Roll Ticket, Teleport Ticket, Customer Rush (2× stall customers for 5 min).
- **Furniture:** used in Airbnbs, houses and shops. Rarer furniture adds more to the star rating and belongs to themed sets (§9.3). This ties gambling to property income.
- **Business boosters:** permanent upgrades that can only be rolled (e.g. "Golden Wok: +15% food price").

Duplicates can be **kept** (stack), **sold** to the pawn shop (*Kedai Pajak*) for RM, **scrapped** into **Shards** (a currency for a Shard Shop where you pick specific items), or **listed** on the marketplace.

### 7.5 The roll experience (juice matters)
- **CS:GO-style horizontal reel** that spins and slows down on the result; the reel shows neighbouring items. For ×10, use a grid flip-reveal.
- Rarity-based reveal: Common = quick pop; Epic = purple flash; Legendary = gold burst + screen shake; Mythic+ = the screen darkens, a short cinematic, a unique sound and a slow-mo reveal.
- **Server-wide announcement** for Legendary+: a banner for everyone ("🔥 Haidar rolled **[MYTHIC] Naga Aura** (1 in 2,104)!"), plus a chat message. Divine/Secret → a 5-second takeover with fireworks for all players.
- **Item Index / Collection Book:** every item, silhouetted until found, grouped by crate and rarity. Completing a page gives rewards (permanent luck, titles, RM).
- Roll history (last 100) and a personal "best pull" stat.

### 7.6 Casino (Lucky Strand Casino, at The Strand)
A walkable interior with tables and machines. All games are server-resolved with a configurable house edge (2–5%).
- **Slots:** 3-reel → 5-reel machines at different bet tiers, jackpots, themed symbols (durian, teh tarik, ketupat, 7s)
- **Roulette:** European, multiplayer table (everyone bets on the same spin)
- **Blackjack:** vs dealer; split/double; up to 5 players at one table
- **Crash:** a rising multiplier, shared round, cash out before it crashes; shows other players' cash-outs live
- **Wheel of Fortune:** a big shared wheel every 2 minutes
- **High-Low** card game
- **PvP Coinflip:** challenge another player, both stake RM or items, server flips, winner takes all (minus a 2% house fee)
- **Daily free spin** on a reward wheel (outside the casino, for everyone)
- Bet limits scale with wealth stage. Show session stats (won/lost today).

---

## 8. Earning money: active vs passive

Every income source should have an **active mode** (play a mini-game → more money) and a **passive mode** (automate with staff/managers → less money per minute, but it runs while you do other things and, capped, while you're offline).

### 8.1 Starter jobs (Stage 1)
Short mini-games from the **Jobs Board** in Dataran Sunway:
- **Food delivery rider:** pick up at a shop, ride to a marked address on the map against a timer; tips for speed
- **Car wash helper:** scrub-the-dirt swipe mini-game
- **Flyer distribution:** walk to houses and tap mailboxes
- **Mamak part-timer:** take orders and serve the right drinks
Each job has a level; higher levels pay more. Jobs stay useful early and become irrelevant later (that's fine).

### 8.2 Food stalls and restaurants (immersive cooking)
Upgrade path: **Pasar malam stall → Food truck → Kopitiam shoplot → Mall kiosk → Mamak 24h → Restaurant chain.**

**Active mode: step-by-step cooking.** Each recipe is a short sequence of timing/precision steps. Example recipes:
- **Nasi Lemak:** scoop rice (hold to fill the meter, release in the green zone) → pack the order: tap the ingredient boxes the customer asked for (sambal, ikan bilis, kacang, timun, telur rebus) plus any paid **add-ons** they ordered (ayam goreng, paru, sambal kerang, telur mata, rendang). Add-ons have their own stock and price; all right and quick = Perfect. *(Changed 2026-11-18 at the owner's request.)*
- **Roti Canai:** stretch the dough (rhythm taps) → flip it (timing) → fold it → serve with dhal or curry as ordered
- **Teh Tarik:** pour from high to low with a rhythm meter, foam level = quality
- **Satay:** turn skewers when each one changes colour; don't burn them
- **Burger Bakar:** grill the patty, add sauce and egg-wrap, then assemble in order
- **Char Kuey Teow:** a wok-toss heat meter (keep it in the "wok hei" zone)

Unlock more recipes with mastery levels.

**Scoring:** each step is graded Perfect / Great / Good / Miss → the dish quality is **Burnt (0.3×) / OK (0.8×) / Good (1×) / Great (1.3×) / Perfect (1.8×)** of the base price.
**Bonuses:** combo streak (+5% per consecutive Perfect, up to +50%), tips from happy customers, a "rush hour" multiplier at in-game meal times, and special customers (a **food blogger** NPC gives 5× and boosts the stall's reputation for a day).
**Customers** are NPCs that walk up and queue with patience bars and order bubbles. An unserved customer leaves and reputation drops.

**Passive mode:** hire a cook (staff). The stall auto-sells at ~50% of the active "Good" rate, limited by staff speed. Staff need wages per in-game day.

**Upgrades per stall:** recipe mastery (base price), equipment (cook speed, wider timing windows), staff (count, speed, skill), signage/decor (more customers), queue capacity, location (move to a busier spot), menu size, an ingredient supplier contract (lower costs).
**Ingredients:** each dish has an ingredient cost; buy stock in bulk from the hypermarket (cheaper in bulk; perishables expire after a few in-game days).

### 8.3 Long-term rental properties
- Buy a property → choose **Long-term rent**, **Airbnb** or **Live in it** (your home: a spawn point, storage, a showroom for friends).
- Long-term: set the monthly rent (charged per in-game day pro-rata). Tenants (NPC profiles: student, young couple, family, expat) apply; a higher rent than the fair value means fewer applicants and a higher chance of late payment.
- **Tenant happiness** depends on condition, furnishing and rent fairness. Low happiness → they move out (vacancy).
- **Maintenance requests** (leaky pipe, broken aircond): fix them yourself with a quick mini-game, or pay a contractor.
- Upgrades: renovation level (raises fair rent), furnishing package, security, a property manager (auto-handles tenants and maintenance for a % cut).
- Costs: assessment tax and maintenance fees per in-game month.

### 8.4 Airbnb (with manual decorating) — see §9

### 8.5 Retail shop
Kedai runcit → phone accessory shop → sneaker store → electronics → supermarket.
- Buy stock wholesale, **set your own prices** (an NPC demand curve reacts to the price vs market value), arrange the shelves (better placement = more sales), hire cashiers.
- **Active mode:** be the cashier — scan items quickly and give correct change (a fast mini-game) for a bonus.
- **Player-item boutique:** a special shop type where you display gacha items for sale to other players, even while you're offline (consignment).

### 8.6 Other businesses (AdVenture Capitalist style + light interaction)
Car wash, dobi (laundromat), bubble tea, tuition centre, gym, hotel, supermarket, mall.
- Each has a production cycle (e.g. a car wash earns RM X every Y seconds), **levels** (each level raises output; milestones at 10/25/50/100 double the speed or profit), and a **manager** to automate collection.
- Each business has one small optional interaction (car wash: scrub mini-game; bubble tea: shake to order; hotel: assign rooms) for an active bonus.
- **Mall (end game):** you own a mall and other businesses (including other players' shops) pay you rent.

### 8.7 Offline income
- While logged out, passive sources keep earning for up to **8 h** (an upgrade raises it to 24 h) at 50% efficiency (an upgrade raises it to 100%).
- On login: a "Welcome back! While you were away you earned **RM 1.2M**" screen with a breakdown, and a "watch a 10 s Lucky Spin to double it" button (an in-game wheel, not ads).

---

## 9. Airbnb and decorating (immersive)

### 9.1 Flow
Buy a unit → set it as Airbnb → enter the interior → **Decorate mode** → list it → guests book → guests arrive (NPCs walk in with luggage) → they check out and leave a review → clean the unit (or hire a cleaner) → repeat.

### 9.2 Decorate mode (Sims-like build mode)
- A grid-based room editor: place / move / rotate (4 directions) / remove furniture; change wall paint, wallpaper and flooring; furniture snaps to the grid and wall items snap to walls. Undo/redo.
- Furniture comes from the **Furniture Store (IKEA-style parody, e.g. *IKEJA*)**, from gacha crates (rarer and better) and from trades.
- Categories: beds, sofas, tables, chairs, storage, kitchen, bathroom, lighting, appliances (aircond, TV, washing machine, wifi router), decor (plants, paintings, rugs), outdoor/balcony.
- Every furniture item has stats: **comfort**, **style**, **theme tag**, **rarity**, and optionally an amenity flag.

### 9.3 Star rating (0.5 – 5.0 ★) — computed on the server
| Factor | Weight | How |
|---|---|---|
| Essentials | gate | A bed, toilet, shower, basic kitchen, aircond and wifi are required; each one missing caps the rating at 2.5★ |
| Comfort | 25% | Sum of comfort per m² vs the target for the unit size |
| Style & theme cohesion | 20% | Bonus for 3/5/8 pieces of the same theme set (Scandinavian, Japandi, Industrial, Tropical Kampung, Luxury Gold, Gamer Neon, Cyberpunk…) |
| Rarity | 15% | Average furniture rarity (rare gacha furniture really matters) |
| Amenities | 15% | TV, washing machine, coffee machine, gaming console, bathtub, balcony set, smart lock |
| Cleanliness | 15% | Drops after each stay; clean it to restore it |
| Space usage | 10% | Not too empty, not too cramped; blocked walkways are penalised |

**Location multiplier:** units near the MRT, The Strand or Dataran Sunway get more demand.
**Building amenities** (pool, gym in a condo) give a small bonus depending on the property type.

### 9.4 Suggestions panel (always visible in Decorate mode)
Show the current ★ with a breakdown bar per factor, plus the **top 3 suggestions with predicted gains**, e.g.:
- "Add a **wifi router** (missing essential) → +1.0★, +RM 85/night"
- "2 more **Japandi** pieces complete a 5-set bonus → +0.3★"
- "Clean the unit (cleanliness 45%) → +0.4★"
- "The room is cramped: remove 1 item near the door → +0.1★"

### 9.5 Pricing and bookings
- The player sets the nightly price. Each rating has a **fair price range**. Overpricing lowers the booking chance; underpricing books faster but earns less. Show "Recommended: RM 180–220/night".
- Occupancy is simulated per in-game day by rating, price, location, day of week (weekends are busier) and random events (a concert or school holidays → a demand spike).
- **Guest reviews** come from templates based on the factors ("Super cosy and the Japandi vibe is 🔥", "No aircond?! In Malaysia?! 1★").
- Random events: a party guest damages furniture, a guest leaves a tip or an item gift, a VIP guest pays 3× for 5★ units only.
- Upgrades: superhost status (after X 5★ reviews: +10% price), a cleaner team (auto-clean), smart lock (+auto check-in), a co-host manager (auto-pricing for a % cut).
- Other players can **visit and rate** your Airbnb (fun social flex; doesn't affect income, but shows up on a "Best Airbnb" leaderboard).

---

## 10. Loans and debt

### 10.1 Bank (*Bank Kota*, Dataran Sunway)
- **Credit score** 300–850: rises with on-time repayments and net worth, falls with late payments.
- Loan types: personal loan (small, no collateral), business loan (needs an owned business), property loan (up to 90% of a property's value, the property is collateral).
- The interest rate depends on the credit score. Repayment is an automatic per-in-game-day instalment from your wallet.
- Missed payments: a warning, then penalty interest, then **repossession** of the collateral → it's auctioned and the player gets a "Bankrupt" title if their net worth goes negative.
- Max loan scales with level, stage and credit score.

### 10.2 Ah Long (loan shark, in a back alley)
- Instant cash, no checks, a huge interest rate (e.g. 20% per in-game day), short terms.
- Late payment → **debt collector NPCs** follow you around town, your properties earn 50% less until you've paid, and a red "OWES AH LONG" tag appears over your head (comedic, visible to friends).
- A risky shortcut for gamblers. Repaying a big Ah Long loan unlocks the title "Survived Ah Long".

---

## 11. Upgrades (player-wide)

An **upgrade tree** (in a "Hustle Skills" menu) with cost curves `cost = base × growth^level` from config:

| Branch | Examples |
|---|---|
| **Luck** | Base luck +5%/level, variant chance, pity reduction, a better luck potion duration |
| **Rolling** | Roll animation speed, ×5/×10 unlocks, auto-roll, auto-sell Commons, more inventory slots |
| **Fortune** | Global passive income %, offline earnings cap and efficiency |
| **Hustle** | Active earnings % (jobs, cooking, cashier), wider timing windows, combo cap |
| **Property** | Rent %, Airbnb price %, slower cleanliness decay, lower maintenance |
| **Business** | Business output %, cheaper managers, cheaper staff |
| **Banking** | Higher loan limit, lower interest, credit score growth |
| **Movement** | Walk speed, cheaper teleports, unlock a cosmetic vehicle slot |

Plus **per-asset upgrades** (each stall, property and business has its own levels; see §8 and §9).

---

## 12. Levels, XP and titles

- XP from everything: rolls, cooking, jobs, sales, guests, purchases, casino play, quests.
- Level curve from config, e.g. `xp_needed = 100 × level^1.6`. Level 1–100, then "Level 100 ★1, ★2…" after rebirth.
- Levels unlock things (crates, districts, business types, loan sizes) together with wealth stages.
- **Titles** are earned by milestones, shown over the head and coloured by rarity. Equip one at a time. Examples:
  - Common: "Budak Baru", "Rider Tegar", "Part-timer"
  - Rare: "Nasi Lemak Master", "Landlord", "Lucky Fool" (100 rolls without an Epic), "Superhost"
  - Epic: "Towkay", "Casino Regular", "Collector" (50% of the index)
  - Legendary: "Mythic Hunter", "Property Mogul", "Survived Ah Long", "Bankrupt" (yes, it's a legendary achievement)
  - Mythic+: "Tan Sri", "1 in 100,000", "Owner of Menara Mitraland", "Completionist"
  - Some titles give small bonuses (e.g. "Lucky Fool": +2% luck).

---

## 13. Rebirth (prestige)

- Available at Stage 6 (or net worth RM 1B+).
- Resets: cash, properties, businesses, stalls, loans and per-asset upgrades.
- Keeps: cosmetics, furniture inventory, collection index, titles, level, rebirth upgrades.
- Grants **Rebirth Tokens** based on net worth → spend them in a Rebirth Shop on permanent multipliers (luck, income, starting cash, offline cap, exclusive crates).
- Rebirth count is shown as stars next to the name.

---

## 14. Multiplayer and social (2–5 players on LAN)

- See everyone moving in real time with their cosmetics, pets, auras and titles.
- **Chat:** a global chat box + speech bubbles over heads; **emotes** (wave, dance, cry, flex, laugh) with an emote wheel.
- **Trading:** request a trade → both add items/RM → both lock → both confirm → the server swaps atomically. Show item rarity and the estimated value.
- **Marketplace (*Pasar Online*)**: list items at a fixed price or as an auction (in-game hours); a 5% fee is a money sink; price history per item.
- **PvP:** coinflip, shared casino tables, a crash round with everyone.
- **Visit** friends' homes, Airbnbs and shops. Buy food from their stall (they earn, you get a small buff).
- **Gifting:** send RM or items (with a confirm dialog).
- **Leaderboards:** net worth, rarest pull, collection %, Airbnb rating, cooking score, biggest casino win, biggest loss.
- **Global announcements** (rare pulls, someone becoming Tycoon or Tan Sri, a big casino win, someone going bankrupt).
- **Server events** (admin-triggered or random): Lucky Hour (2× luck), Rush Hour (2× customers), Pasar Malam Festival, Durian Season (limited crate).

---

## 15. Engagement systems (the addictive part)

- **Daily login streak** (day 1–7 escalating rewards; day 7 = a free Strand Premium Crate roll)
- **Daily quests** (3/day, e.g. "Cook 10 Perfect dishes", "Roll 20 times", "Earn RM 50K from rent") and **weekly quests**
- **Achievements** with rewards
- **The next-goal tracker** always on the HUD
- **Collection index** completion rewards
- **Limited-time crates** (rotate weekly) with exclusive items
- **Juice everywhere:** floating "+RM 120" numbers, coin sounds, combo counters, satisfying progress bars, confetti on milestones, screen shake on big pulls
- All randomness is fair and odds are always visible (no hidden odds).

---

## 16. UI and HUD

- **Top bar:** wallet (RM, short format; tap for exact), level bar + XP, wealth stage badge, current title, luck multiplier, in-game clock + day/night icon.
- **Right side:** next-goal tracker, active buffs with timers, quest tracker.
- **Bottom:** a phone-style menu button that opens the "**HustlePhone**", a smartphone UI with apps: Inventory, Index, Upgrades, Properties, Businesses, Bank, Market, Quests, Leaderboard, Map, Settings. (Immersive and mobile-friendly.)
- **Mobile:** a virtual joystick at bottom-left, an interact button at bottom-right; big touch targets; prompt to rotate to landscape.
- **Desktop:** WASD/arrows to move, E to interact, Tab for the phone, Enter for chat, M for the map.
- **Settings:** volume, graphics quality (particles on/off for weak phones), notifications toggle, log out.
- **Sound:** generated with WebAudio or small free/CC0 assets: coin clinks, roll ticks, rarity stingers, cooking sizzles, ambient city noise, casino ambience.

---

## 17. Admin and dev tools

- The first registered account is **admin** (or set it in `.env`).
- Admin panel / chat commands: `/give <player> money 1000000`, `/give <player> item <id>`, `/event luckyhour 10`, `/setstage`, `/announce`, `/kick`, `/resetplayer`, `/saveall`, `/reloadconfig`.
- A dev-only debug overlay (FPS, ping, position, tick time).
- `scripts/seed-dev.ts` to create test accounts.
- `scripts/balance-sim.ts`: simulates an "optimal-ish" player for N hours using the real config + formulas and prints the time to each stage, the income per source and the inflation indicators. Use it to tune config against §6's pacing targets.

---

## 18. Security and fairness basics (LAN-level, but no easy cheating)

- Server-authoritative everything (see CLAUDE.md). Validate every message with zod. Reject impossible actions (buying without money, moving through walls, cooking inputs with impossible timing).
- Mini-game anti-cheat: the server sends the mini-game seed and windows, the client sends input timestamps, and the server grades them.
- Rate-limit actions (e.g. max 10 rolls/s, chat spam limit).
- Parameterised SQL only. Escape chat text (no HTML injection).
- Atomic DB transactions for trades, purchases and loans.

---

## 19. Content checklist (minimum for v1.0)

- 6 face shapes, 20+ hairstyles, 9 tops, 6 bottoms, 5 shoes, 4 tudung styles, 12 skin presets
- 150+ gacha items across 7 crates (at least 15 Legendary+, 5 Divine, 2 Secret)
- 80+ furniture items in 6+ theme sets
- 6 cooking recipes, 4 starter jobs, 12 property types, 14 business types, 7 casino games
- 40+ titles, 50+ achievements
- 5+ districts on a 256×192+ tile map

---

## 20. Build phases (build in this order; each must be playable)

Each phase: plan → implement → run → test on 2 browser tabs **and** a phone on the LAN → update `docs/PROGRESS.md` → commit.

### Phase 1 — Foundation
Monorepo setup, server on 0.0.0.0 with LAN URL printing, register/login/session, the vector character creator (§4), the big map with district layout blocked out (simple shapes are fine), movement with collision, camera, minimap, multiplayer presence + interpolation, chat + bubbles, emotes, saving (all 5 triggers), backups.
**Done when:** two devices on WiFi can create accounts, customise characters, see each other walk and chat; refreshing or logging out and in restores position and appearance.

### Phase 2 — Money, jobs and the gacha core
Wallet (sen integers, short format), the Jobs Board with 2 jobs (delivery + car wash), the rarity system, luck math (unit tested), 3 crates (Capsule, Lucky Bag, Mall Mystery Box), the reel animation + rarity reveals, inventory, equipping cosmetics (visible to other players), variants, pity, announcements, the Item Index, Kedai Pajak (sell), shards.
**Done when:** a player can earn RM from jobs, roll crates, see a fair visible-odds reel, equip a hat that the other player sees, and rare pulls broadcast to everyone.

### Phase 3 — Progression
XP and levels, wealth stages, the titles system, the Hustle Skills upgrade tree, usable items (potions/boosters with buff timers), daily login streak, daily quests, the next-goal tracker, the HustlePhone UI, the balance simulator v1.
**Done when:** a new player has a clear path of goals for the first 2 hours and the simulator output roughly matches the pacing targets.

### Phase 4 — Food stalls and cooking
Pasar malam stall → food truck → kopitiam path, 3 recipes first (Nasi Lemak, Teh Tarik, Roti Canai) with step-by-step mini-games and quality scoring, NPC customers with queues and patience, combos/tips/food blogger, passive mode with staff, ingredients/stock, stall upgrades, day/night cycle (pasar malam opens at night).
**Done when:** cooking Perfect clearly earns more than passive mode, and both feel worth doing.

### Phase 5 — Property and Airbnb
Buying property (FOR SALE signs, ownership), long-term rent with tenants/happiness/maintenance, Airbnb with the full decorate mode, the furniture store, the star rating engine (unit tested), the suggestions panel, pricing/occupancy simulation, guests/reviews/cleaning, offline income + the welcome-back screen.
**Done when:** decorating with better/matching furniture visibly raises stars and nightly income, and the suggestions are accurate.

### Phase 6 — Shops, businesses and loans
The retail shop with pricing/shelves/cashier mini-game, the player-item boutique, the remaining businesses with levels/milestones/managers, Bank Kota (credit score, loan types, repayment, repossession), Ah Long + debt collectors, money sinks (tax, wages, maintenance).
**Done when:** players can choose different money-making strategies and loans add real risk/reward.

### Phase 7 — Casino and social economy
The Lucky Strand Casino interior with slots, roulette, blackjack, crash, wheel, high-low; PvP coinflip; trading; the marketplace with fees and auctions; leaderboards; gifting; server events.
**Done when:** 3+ players can sit at the same blackjack table, trade safely, and race on leaderboards.

### Phase 8 — End game and polish
The higher crates (Towkay → Diamond Vault), end-game assets (Cascades penthouse, Menara Mitraland, the mall), rebirth + the Rebirth Shop, the remaining recipes, all content from §19, sound pass, juice pass, mobile performance pass (particles toggle, texture atlases), the admin panel, a full balance pass with the simulator, a final bug sweep.
**Done when:** the full journey from RM 300 to rebirth works and feels good.

---

## 21. Notes
- All money is virtual and has no real-world value. There's no real-money purchase anywhere.
- Real place names are used as inspiration for a private LAN game; brands, malls and shops use parody names.
- Keep the code readable: the owner has JS/TS/Python/SQL experience and wants to learn from and tweak it later. Add short comments on the "why" for the tricky systems (luck math, star rating, the economy tick).
