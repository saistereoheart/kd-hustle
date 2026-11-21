# Changelog

## 1.14.0 (2026-11-21): 🗝️ Labirin Purba, part 4 (parties)
- **👥 Parties of up to 4.** Invite anyone online from 👥 in the labyrinth's top bar or from the 📱 Labirin
  app. They get a Join / No thanks prompt wherever they are.
- **Fight together.** Party members in the same room fight the monsters there together, and the group is
  bigger for more players. Walk into a room where your party is already fighting and you join in.
- **Find each other.** Party members are dots on the minimap and the floor map (red while they're
  fighting). The party panel says where everyone is.
- The leader (👑) can remove members, and anyone can leave. Parties end when the server restarts.

## 1.13.0 (2026-11-21): 🗝️ Labirin Purba, part 3 (gear and potions)
- **🛒 Tok Peraih**, the merchant, stands in the entrance hall and in every 🔥 rest chamber. Walk up to him
  and press E.
- **⚔️ Gear** for four slots: 🗡️ Keris (ATK), 🛡️ Perisai (DEF + a chance to block half a hit), 🥋 Baju
  Zirah (HP + DEF) and 📿 Tangkal (SPD + crit).
  - Six tiers: Kayu, Besi, Gangsa, Perak, Emas, Mistik (30 up to 8,000 Syiling each).
  - Deeper tiers go on sale as you reach deeper floors. A full Mistik set is about ×4.7 your weakened
    stats.
  - Gear is yours for good. A better piece is worn the moment you buy it; change what you wear from
    🎒 Bag, or from the 📱 Labirin app in town.
- **🧪 Potions**, up to 9 of each: Jamu Kecil / Sederhana / Besar (heal), Air Penawar (revive a friend),
  Asap Lari (a sure getaway), Sambal Semangat (+30% ATK for the fight) and Tali Pulang (back to town from
  anywhere, coins banked).
- **🧪 Items works in battles now.** A potion takes your turn and acts before anyone attacks. Heals and
  Tali Pulang also work out of a fight, from 🎒 Bag.
- Carried Syiling are spent first, then banked ones.
- New gear that adds max HP adds that much HP at once.
- The labyrinth's top bar no longer covers windows on phones.
- Report #12 (a list jumping back to the top while you scroll): windows and the phone now keep their own
  scroll position when they refresh.

## 1.12.0 (2026-11-21): merge all, scrap all, the Item Index's best, wheels and fixes
- **⚒️ Merge all** (🎒 Bag → Items, or the forge). Merges every full set of copies, tier by tier, up to
  the tier you pick. Filter by rarity and kind, and tick items in or out one by one; unticked items
  stay excluded next time. The variants are spread over the results so they're kept.
- **♻️ Scrap all** (Kedai Pajak Untung → Scrap). The same filters, plus a tier cap and "keep Shiny /
  Golden / Rainbow". It starts careful: Common to Rare, Tier D only, no potions, chefs or Teman. Tap
  twice to confirm.
- **You always keep your last copy.** Scrapping stops at one copy of each item: "You can't scrap your
  last copy of …". "All" becomes "All but 1".
- **📖 Item Index: your best ever.** Each item you've found shows the highest tier you've had of it (badge
  and glow, stronger for higher tiers) and its best variant (the art). This counts even if you've since
  sold, merged or scrapped it. Earlier history is filled in from what you hold at your next login.
- **🎡 Welcome-back wheel.** It's a real wheel now: a pointer and slices from ×1.25 to ×10, about ×2 on
  average (`economy.json` → `offline.spin`). The server picks the slice and the wheel lands on it. The
  middle shows what you can claim, then the new total.
- **🎡 Lucky Spin:** the prize labels sit inside their slices, and the red dot goes the moment you spin.
- **🗝️ Labirin:** while you're down there, the town no longer reacts to you. You were still walking around
  town unseen, so stalls, NPCs, doors and crates opened. Your town spot is kept and you come back to it.
- **Footbridges over highways** no longer block traffic. You drive under them, and you still walk
  across them on foot.

## 1.11.0 (2026-11-21): 🗝️ Labirin Purba, part 2 (fights)
- **Monsters jump out** when you walk into some rooms. It's a Pokémon-style battle: monsters at the top,
  you at the bottom, a message box, and ⚔️ Attack / 💥 Skill (uses focus) / 🛡️ Guard / 🏃 Run. Tap a
  monster to aim at it. You have 20 s a round, then you just attack.
- **Weakened state:** HP 100 · ATK 10 · DEF 4 down there, whatever your town gear. 16 monsters over
  the 8 floors, harder each floor. Without gear you can handle floors 1–2.
- **HP carries over** between fights. It slowly comes back while you walk, and a 🔥 campfire fills it.
- **Win:** Syiling Purba (carried), and that room stays quiet for 20 minutes. **Fall:** you lose half
  your carried Syiling and wake at your rest chamber, healed. **Run:** back to the room you came from.
- **Teman don't fight here.** Your lead Teman gives a tiny boost to ATK, DEF and HP: +1% (common) up to
  +8% (a maxed one). The 📱 Labirin app shows yours.

## 1.10.0 (2026-11-21): 🗝️ Labirin Purba, part 1 (explore)
- **A new walkable dungeon.** Open 📱 → 🗝️ Labirin. It's 8 floors and 1,120 rooms. Each floor's layout is
  fixed and the same for everyone.
- **One room at a time.** You only see the room you're in. Walk through a door and you come in by the
  opposite door of the next room. Pillars and rubble change from room to room.
- **What's down there:**
  - 📦 loot boxes (they refill daily);
  - 🗝️ keys that open 🔒 treasure rooms elsewhere on the same floor;
  - one 🔥 **rest chamber** per floor, your save point, deliberately far off the main path;
  - 🕳️ stairs down in each floor's deepest room.
- **Syiling Purba**, the labyrinth's own currency. Coins you find are *carried* until you rest at a campfire
  or leave. Leave from the entrance hall or a rest chamber.
- **Map.** A minimap of the rooms you've explored, and **M** (or a tap) for the whole floor with fog of war.
- **Others in the same room** walk about with you.
- Coming in parts 2–5: fights, the merchant and gear, parties, bosses. See `docs/LABYRINTH.md`.

## 1.9.7 (2026-11-21)
- **🏪 Shoplot doors give you a choice.** At a shoplot with a business and lofts, walking in asks: go in the shop
  ("🍔 Go in your Burger Bakar" / "☕ Visit Ali's kopitiam") or the lofts ("🏷️ Lofts upstairs · 2 for sale" /
  "🪜 Up to your loft"). The prompt shows both: "🍔 Your Burger Bakar Abang Jo · 🏷️ 2 lofts for sale".
  Without lofts it goes straight in.
- **⭐ Shop stars now go up when you decorate.** "✅ Done" used to stop decorating *without saving*, so your
  shop kept being rated as an empty room (0.5★, −16% customers). Now:
  - the button says **💾 Save & done** and saves first;
  - **Leave** saves too (if it can't, it says why and asks);
  - the star bar names what's missing ("needs toilet"). Missing must-haves cap the stars.
- **A kopitiam no longer needs a kitchen piece.** Its counter already has the stoves. Its must-haves are
  aircond, wifi and a toilet, like any shop.
- **Shops face the door you came in by.** A shoplot whose door is on its top side has its door in the top wall
  inside. You walk in at the top, and the counter, cashier and cooks are along the bottom. The rating's
  walkway check uses that door too.
- **No more cooks standing outside kopitiams.** They're inside at the stoves.

## 1.9.6 (2026-11-21)
- **🏪 A shoplot you run is your shop's door, not a home for sale.** Walking into your kopitiam (or anyone's
  kopitiam or Venture) used to open the lofts upstairs with "🎁 Claim free (first home)". It now goes straight
  into the shop. The door prompt names the business ("🍔 Your Burger Bakar Abang Jo · go in"), and adds
  "🪜 your loft upstairs" if you own one there.
- Venture shops have **🪜 Stairs to the lofts** inside, like the kopitiam, so loft owners can still get home.
- **No more 🏷️ FOR SALE tags over shoplots** (459 of them). Free lofts show only in the door prompt when you
  walk up. Your own loft keeps its 🏠 YOUR HOME sign; condos, terraces and semi-Ds keep theirs.

## 1.9.5 (2026-11-21)
- **Other players move smoother and look more up to date.** Their positions are now placed at the moment the
  server took them, not when they reached your device, so WiFi hiccups no longer make them stutter. How far in
  the past they're drawn now adapts to your connection: about 90 ms on good WiFi (it was always 160 ms), up to
  300 ms on a jittery link (ZeroTier, a busy network). F3 shows it ("others shown N ms behind").
- **Updates really go out 15 times a second on Windows.** Windows timers tick every ~15.6 ms, so the server was
  sending 12.8 a second. They're now aimed at exact deadlines.
- Admins: `/announce` and the other server-wide admin commands work again. Since Phase 8b they split the text
  on the letter "s" instead of on spaces.
- A test server started with its own `KH_DATA_DIR` now keeps its backups inside that folder. Before, its
  backups landed in `server/backups/` and rotated your real ones away.

## 1.9.4 (2026-11-21)
- **🎤 Two idol Teman in the Telur Teman egg** (original characters, not real people):
  - **Arnab Bintang** (Legendary): a bunny idol in a sparkly stage jacket and headset mic, with twinkling stage
    sparkles. It hops beside you in town like the unicorn. Fast and fragile: HP 62 · ATK 18 · DEF 11 · SPD 19.
    Move *Lompat Pentas*, ultimate *Encore Bintang*.
  - **Rubah Superstar** (Mythic): a fox idol with a pink bow, a star hairclip and a pink mic, with music notes
    floating up. HP 68 · ATK 20 · DEF 13 · SPD 18. Move *Kenyit Mata*, ultimate *Konsert Bulan Purnama*.

## 1.9.3 (2026-11-20)
- **🚲🛵 The basikal, the kapcai and the Ronda are 3D now**, like the showroom bikes. They have every
  direction including the 45° views, and their 3D icons appear in the hotbar and the Ronda app.
  - Basikal: a 26" city bike with see-through spoked wheels, a wicker front basket and a teal frame.
  - Kapcai: a 110 cc underbone with a leg shield, step-through frame, pinstriped side covers, rear rack and
    chrome exhaust.
  - Ronda: the green kapcai with a top box. Its rider and you sit on the real seats.
- **Riding away from the camera (going up):** you used to sit in front of the whole bike. Now the bike's tail
  covers your lower half and your back shows above it, the same 50/50 as riding towards the camera. (The cut
  under the chest was worked out before you were moved onto the seat.)
- Admins: `npm run admin -- feedback-done <id>` marks a 🐞 report done (`undo` reopens it). Report #2 ("casino
  rigged", fixed in 1.0) is now closed.

## 1.9.2 (2026-11-20)
- **🐉 Mythic Teman stand out:** mythic stat multiplier ×1.85 → **×2.5** (divine ×3, secret ×3.5, so they stay
  above it). The Mahkota is mythic too, so its boost rises with it: Tier S with every variant gives +165%.
- **Gua Gelap, teams of 3 maxed Teman** (simulated, median floor reached):
  - Basic Mahkota: epic 54 · legendary 55 · **mythic 67** (was 61).
  - Maxed Mahkota: epic 67 · legendary 69 · **mythic 60+, the bottom every time** (it would go ~90 if the cave
    went on).

## 1.9.1 (2026-11-20)
- **⚔️ Gua Gelap has a bottom: floor 60** (a final boss). Clear it and the run is done: cash out and keep
  everything. Before, the cave never ended.
- **🐾 Teman buffed a little** (1.8.4 cut too much), tuned so a full run is reachable:
  - Level growth +9% a level (was +8%); each stat upgrade +6% (was +5%).
  - Every Teman gear piece ×1.25 (Mahkota +15% each stat, was +12%).
  - Tier: C ×1.13, B ×1.28, A ×1.48, S ×1.75. Variant: Shiny ×1.2, Golden ×1.35, Rainbow ×1.55.
  - Mahkota at Tier S with every variant: **+122%** (was +82%). The strongest possible Teman: ~17.5k HP.
- **Simulated full runs** (real battle maths, Auto's choices):
  - 3 maxed mythic Teman + a maxed Mahkota: reach the bottom every time. So does a single maxed mythic.
  - With a basic Mahkota: about floor 59. Maxed legendaries: about 58.

## 1.9.0 (2026-11-20)
- **🏪 Walking into a shop shows the shop floor itself**, as its owner furnished it. This applies to everyone
  (owner and visitors) at Ventures' shoplots and kopitiams; there's no separate "furnish" room any more. The
  owner decorates right there (🛠️ Decorate).
- **A simple setup by default:**
  - A counter along the back, with the cashier sitting at the register.
  - Cooks at the stoves (kopitiam: steam and sizzle) or a shop hand at the shelves (Ventures).
  - A few starter tables and chairs, until you put in tables of your own.
- **Customers** come in, order at the counter, sit at a free table and eat / drink (the dish on the table, a
  bite now and then), then leave. They come more often the more stars the shop has.
- At the counter (E / tap):
  - Kopitiam: cook in your kitchen, or order at someone else's.
  - Your Venture: run it from the phone.
  - The till and the stairs to any lofts are there too.
- Other players inside are shown standing in the shop.

## 1.8.4 (2026-11-20)
- **🐾 Teman balance.** 1.8.3 gave Teman the player-gear tier / variant multipliers (Tier S ×5; Shiny ×1.5,
  Golden ×2.5, Rainbow ×4). Stacked, a maxed Teman was ×75 in body and its Mahkota gave +1665%, so HP reached
  ~1.2M. Teman now have their own gentler multipliers (still all multiplying):
  - Tier: D ×1 · C ×1.12 · B ×1.25 · A ×1.42 · S ×1.65.
  - Variant: Shiny ×1.15 · Golden ×1.3 · Rainbow ×1.5 (all three ×2.24).
  - Tier S with every variant: ×3.7 (was ×75). Mahkota at Tier S with every variant: +82% (was +1665%).
  - The strongest possible Teman: ~10k HP (was ~1.2M). Tunable in `pets.json` (`tierMult` / `variantMult`).

## 1.8.3 (2026-11-20)
- **🐾 Teman stats multiply, like luck.** Every factor now multiplies in full:
  - **The Teman:** species base × rarity × level × upgrades × **tier** × **variant**. Tier and variant were
    softened before (a Tier S Teman got ×2.2, not ×5). Now Tier S = ×5, Shiny ×1.5, Golden ×2.5, Rainbow ×4,
    the same as on your own gear.
  - **Teman gear:** its boost = base × rarity × tier × variant. A +10% collar at ×2 tier and ×2 variant gives
    **+40%**. Before, the gear's variant didn't count, and its rarity and tier were softened.
  - The gear's card now shows the boost it really gives (with its tier and variant), not the base one.

## 1.8.2 (2026-11-20)
- **🍀 Luck cap raised to ×1000** (was ×50). Luck lifts Rare and above together, so even huge luck only crowds
  out Common / Uncommon; it can't make a Mythic likelier than a Rare.
- **Smoother on slow devices:**
  - The signposts were vector shapes re-drawn every frame; they're baked into pictures once.
  - The place pointers made the browser lay out the page again for every pointer, 10× a second; now once.
  - New map chunks go on screen one per frame (several at once was a hitch).
  - At most ~60 frames a second: 120/144 Hz screens no longer make weak graphics draw twice as much.
  - Simulated slow device (CPU 6× slower): 15–19 → 29 FPS, longest task 96–178 → 65 ms.

## 1.8.1 (2026-11-20)
- **🍀 Luck multiplies across everything:** every luck source (Lucky Charm, potions, title, gear, rebirth,
  events) now multiplies. A ×5 and a ×2 potion give ×10, and on top of ×5 from your other luck that's ×50
  (it used to add across kinds: 5 + 9 = ×14). Still capped at `rarities.json` → `maxLuck` (×50).

## 1.8.0 (2026-11-20)
- **🚶 Walk-in customers (stage 3):**
  - **Kopitiam:** no more queue standing on the pavement. Each customer walks in at the door (and walks out
    again once served or tired of waiting); their orders are in the kopitiam's window as before.
  - **Ventures:** people walk in and out of the shoplots near you now and then.
  - **Inside shops** (the kopitiam, shops with a keeper, and your own Venture's shop floor): customers come in,
    go to the counter or look around, say something ("Teh tarik satu!", "Ada stok lagi?"), and leave.

## 1.7.0 (2026-11-20)
- **🏪 Furnish your shops, like an Airbnb (stage 2):** every Venture's shoplot and your kopitiam now have a shop
  floor you furnish with your furniture (the same decorator as homes).
  - Walk into your Venture's shoplot to go straight in. In your kopitiam, use the new 🛠️ Furnish the dining
    room station.
  - It's rated like an Airbnb (comfort, style sets, rarity, amenities, space, cleanliness). A shop's must-haves
    are aircond, wifi and a toilet (a kopitiam also needs a kitchen); each one missing costs stars.
  - **Stars bring business:** a Venture earns, and a kopitiam gets customers, × (0.8 + 0.08 × stars). An empty
    shop is −16%, about 2.5★ breaks even, 5★ is +20% (`properties.json` → `shop`).
  - Customers make it dirty (🧽 Clean it, or 🧹 hire a cleaner for RM 40 a day), and every 12 or so leave a
    review (shop reviews: tables and toilets, not beds).
  - 📱 Ventures shows each shop's stars, cleanliness and what it's missing. Shops don't count toward your 3 homes
    and can't be sold or rented out.
- **Fixed: murtabak's "Fill it" didn't show the order.** The counter was drawn over the whole screen, hiding
  the ticket with the fillings the customer wants.

## 1.6.1 (2026-11-20)
- **Inside buildings is fast again:** the town used to keep drawing behind every room, through a full-screen
  blur filter (about three-quarters of each frame on weak graphics). The town now isn't drawn while you're
  inside, and the room, counters and furniture are drawn once into pictures instead of being re-drawn every
  frame. In the test browser: inside a building 6 FPS → 30 FPS.
- **F3 says more:** the Graphics mode (Auto adjusts the resolution; Sharpest doesn't), and whether a pause in
  updates happened at the server or on the way (WiFi / this device). The server also prints a warning in its
  window if it ever stalls.

## 1.6.0 (2026-11-20)
- **🏪 Ventures take real shoplots:** opening a business now takes the free shoplot nearest to you, like buying
  a home. It's yours alone: your gold sign over its door and its map pin, and everyone else sees
  "<your name>'s <business>" there. One business per shoplot: a Venture or a kopitiam (the kopitiam spot picker
  skips Ventures' shoplots and vice versa).
- **🚚 Move a Venture** from the phone (📱 Ventures → 🚚 Move): the closest free shoplots to you, for RM 500
  (`businesses.json` → `moveFeeSen`). Levels, managers and earnings stay. 📍 Show points you to it.
- Ventures you already own get a free shoplot on your next login (nearest the town square). A business lost to
  a rebirth or the bank frees its shoplot.
- Coming next: shop interiors you furnish, ratings and reviews, and customers walking in.

## 1.5.0 (2026-11-20)
- **🐾 Your Teman walks with you:** the first Teman in your team follows you around town, a step behind and to
  the side, for everyone to see. It waits while you're on a vehicle (or riding along) and comes back when you
  get off.
- **🦄 Unikorn Pelangi:** a new Mythic Teman in the Telur Teman egg: a white chibi unicorn with a rainbow mane and
  tail and a golden horn. It hops as it follows you.
- **Teman look rounder:** every Teman now has a dark outline, light from the top-left, a soft shaded underside
  and a rim light, like the characters (in town, the Teman window, the bag and the dungeon).

## 1.4.0 (2026-11-20)
- **🍜 Four premium dishes** for the stall, each pricier with a better margin (ingredients ~19–20% of the price,
  vs 25% before), unlocked by mastering the dishes before them:
  | Dish | Price | Ingredients | Unlocks after |
  |---|---|---|---|
  | Char Kuey Teow | RM 26 | RM 5.20 | Mee Goreng mastery 2 |
  | Nasi Goreng Seafood | RM 29 | RM 5.80 | Nasi Goreng mastery 2 |
  | Nasi Kandar | RM 36 | RM 7.20 | Murtabak mastery 1 |
  | Nasi Briyani Kambing | RM 48 | RM 9.00 | Nasi Kandar mastery 1 |
  They reuse the wok, rice and plating minigames, with new add-ons (tiger prawns, crab, ayam madu, kambing)
  and new ingredients drawn (kerang, ketam, papadom, acar, bendi).

## 1.3.4 (2026-11-20)
- **Riders sit IN the bike seen from the front or back:** the bike is drawn behind the rider and its lower part
  again in front, so the head and chest show over the bike and the legs are hidden behind it.
- **Fixed:** cars and bikes were drawn 1.6× bigger than their layout (the sharper textures weren't scaled back),
  so riders sat in the wrong place on the bike. They keep the size you've been seeing; riders now line up.

## 1.3.3 (2026-11-20)
- **Big rolls go off when they're revealed:** your own banner / fireworks for a Legendary+ pull now fire the
  moment the reel lands on it (or its card flips in a ×5 / ×10), instead of on a fixed timer. In a ×5 / ×10, a big
  card also flashes and bursts the moment it turns over. Everyone else still sees it a few seconds after.
- **No wall of banners:** a new roll from the same person replaces their banner, at most 3 show at once, and a
  new full-screen celebration replaces the one already on screen instead of piling up.
- **Merging is same-tier only:** 5 copies at one tier → 1 at the next (e.g. 5 × D → 1 C). The merge window only
  offers copies at the first item's tier; the bag's Merge button counts copies at that tier. Top-tier items
  can't be merged.

## 1.3.2 (2026-11-20)
Stutter on slow devices (CPU, not graphics):
- **Cars and bikes are built and drawn in a background worker.** The first time a car (or a new paint job)
  came into view, its 3D model was built and drawn on the main thread: about 0.5 s of work, several seconds on a
  slow phone. Now it fills in a moment later without freezing anything. Sizes, seats and wheels come from the
  vehicle's dimensions, so nothing waits for the model.
- **The lofi music is prepared in small slices** instead of in one long go at the start of a session.
- **F3 verdict:** a device that's slow to draw also reads the network late; that's no longer blamed on the WiFi.

On a simulated slow device (CPU 6× slower), the worst frame went from 4.75 s to 0.13–0.18 s.

## 1.3.1 (2026-11-20)
- **Passengers ride with the driver:** they're drawn exactly on the driver's car or bike on every screen (they
  used to trail a little behind), and they hear the engine of the vehicle they're in.
- **Faces over cars:** a small round face badge shows who's inside a car (the driver in the middle, passengers
  beside). Never your own on your screen. Passengers' name tags are tucked away inside a car.
- **F3 / Settings → Show FPS & ping** now says whether it's the device or the WiFi: frame rate and the worst
  frame, resolution, ping, how often updates arrive and the longest gap, snap-backs, and a verdict.
- **Smoother on WiFi:** other players are shown 160 ms behind (was 110) so a late packet doesn't make them
  stutter, and a WiFi hiccup of up to a second no longer snaps you back.

## 1.3.0 (2026-11-20)
For devices without a dedicated graphics card (aiming for a steady 30+ FPS):
- **Auto graphics adjusts itself:** with ⚙️ Settings → Graphics on **Auto**, the game watches its frame rate and
  lowers the render resolution step by step while it's below 40 FPS (100% → 85% → 72% → 62% → 55%), and goes
  back up when there's room. On the lowest step it also uses lite effects (a third of the night lamps, no
  smoke puffs). Each device remembers its level. Settings shows the current FPS and resolution.
- **No multisampling:** the WebGL canvas no longer uses MSAA (costly on integrated graphics; everything is
  drawn as textures anyway). Auto also caps the canvas at about 1440p (Sharpest keeps 4K).
- **Less overdraw:** tree canopies and elevated roads are only drawn where they have something in them (they
  used to blend a whole chunk of empty pixels each frame).
- **No stutter when new parts of town appear:** map chunks are painted in a background worker (OffscreenCanvas),
  so driving into new areas or teleporting doesn't stall the game.
- The graphics watchdog reads pixels far less often (each read made the GPU stop and catch up).

In the test browser with software rendering (a much weaker "GPU" than any laptop), a 1080p window went from
8 FPS to 18 FPS at full resolution, and Auto settles at 50 FPS by day and about 36 FPS at night.

## 1.2.0 (2026-11-20)
- **🔊 Other riders' engines:** you hear their real engine: their revs, gear changes, throttle and rev limiter
  are sent with their position, so it's no longer guessed from how they move (no more random revs).
  Up close they're as loud as your own engine with that exhaust, and they carry 2.5× further than before
  (a straight pipe the furthest).
- **🕹️ Neutral:** in manual, shift down from 1st to **N**. The throttle then revs the engine on the spot (up to
  the limiter) and the vehicle just rolls. Shift up into 1st to go (refused if you're too fast for first).
- **💨 Launches:** pulling away from a stop spins the tyres for a moment (longer if you revved it in neutral
  first): a cloud of smoke off the rear wheels (bigger for cars) and black tyre marks on the road that fade
  after about 4 s. Others' launches show too.
- **Rolling:** let go of the keys at speed and the vehicle rolls on, slowing gently (about 3.5 s from top
  speed), so the revs fall slowly with it. Push the opposite way to brake hard.
- Feel numbers are in `garage.json` → `driving` (coast, brake, tyre-mark time, hearing range, full-volume
  distance).

## 1.1.0 (2026-11-20)
- **🚗 Real 3D cars and bikes:** every showroom vehicle is a 3D model built from the real vehicle's size
  (length, width, height, wheelbase, wheel size, rake, seat height), lit like real paint, glass and chrome,
  with a cartoon outline. All views come from the same model, so bikes now have a proper 45° view too.
  Cars are at the map's real scale (a Saga is about 2 tiles long).
- **🅿️ Put it down, get in, get out:** a vehicle's hotbar key puts it down in front of you. Walk up and press
  E to drive it. E again parks it where you stopped and you get out. Press the key from far away to bring it
  over. **Put away** (X, or the button on the prompt) when you're done; it also goes away when you log out.
- **🧑‍🤝‍🧑 Give people a lift:** other players get in with E as passengers. A bike carries 2, a car 4 (the
  basikal just you). Passengers ride on the back of a bike (inside a car you can't see them) and are carried
  along until they press E to get out.
- **Icons:** cars and bikes in the hotbar and the phone's Rides list are cartoon pictures of the new models,
  in your paint job.
- **Acceleration from real 0–100 km/h times**, scaled the same way as the tuned S7O (×1.77): Sega 23 s,
  Bezzo 25.5 s, Mivy 18 s; Road Kingo 16 s next to the other bikes.

## 1.0.1 (2026-11-20)
- **Speed:** cars and bikes are about 12% faster at the top.
- **Torque:** strongest in first gear and fading gear by gear. The low gears fly by and the high gears take
  longer. 0-to-top: cars 12.6–15.3 s, bikes 10.3–14.3 s.
- **Settings → 🏁 Rev limiter bounce:** turn it off for a flat high note at the top of each gear.
- **8 directions:** cars and bikes show a 45° view when heading diagonally, for other players' rides too.

## 1.0.0 (2026-11-20)

The first complete version: every phase of the spec (`docs/GAME_SPEC.md` §20) is built and the §19 content list
is met. The full round-by-round log is in `docs/PROGRESS.md`.

### New in the final round
- **🏅 Trophies:** 74 achievements in 9 groups, each paying RM, XP, shards or a potion the moment it's done.
  They stay through a rebirth.
- **📅 Weekly quests:** 3 bigger quests a week, new every Monday, next to the 3 daily ones.
- **🚗 Driving:**
  - a real gearbox: each gear has its own top speed, pull follows a torque curve and the gear, plus air drag;
  - automatic or manual (R up, F down, G toggles), with over-revving downshifts refused;
  - revs that climb smoothly, coasting when you let go;
  - a big dashboard (rev counter, shift lights, km/h, gear) and tyre smoke on hard launches.
- **🔊 Engine sound:**
  - per-cylinder pressure pulses and a ringing pipe;
  - an inline-4 howl, shift cuts with a clunk, and the rev-limiter chop;
  - nearby riders heard from their real speed, panned left/right, as far as their exhaust carries.
- **🚘 Cars:**
  - bigger, and drawn ¾ from above in every direction;
  - about 8% faster at the top, with less torque;
  - at least 2 s in every gear (0-to-top 13.5–19.5 s).
- **🏍️ Bikes:**
  - about 8% faster at the top, with less torque;
  - at least 2 s in every gear (0-to-top 14.8–16.5 s).
- **⚔️ Gua Gelap:**
  - HP carries over between floors;
  - rest rooms (heal, buff, or sacrifice HP for money);
  - Auto keeps going deeper until the whole team faints;
  - an angled 3D cave view and animated ultimates.
- **🐾 Teman gear:** "Wearing: …" on each Teman's page, a 🎽 mark on the list, and a "Put it on a Teman" picker
  from the bag.
- **Sorting:** the bag, Teman, chefs & cashiers, pet gear and the pawn shop all list the rarest first (then tier,
  then variant).
- **🏙️ Ambience:**
  - traffic, birds and crickets in town;
  - a crowd and slot jingles in the casino;
  - a sizzling pan while you cook.
  Settings → Ambient sounds.
- **Fixes:** after a rebirth, open quests counted from the old stat totals.
- The server prints its version on startup.
