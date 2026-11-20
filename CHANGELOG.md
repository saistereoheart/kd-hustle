# Changelog

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
