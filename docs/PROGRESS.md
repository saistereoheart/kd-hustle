# Kota Hustle: Progress

## Status

_Last updated: 2026-11-18 (feedback fixes: lag, stall traffic, bag, stock boxes, Property skills)_

**Phase 1 (Foundation): done.** **Phase 1.5 (real-scale OSM map + character polish): done.**
**Phase 2 (money, jobs and the gacha core): done**, plus three feedback rounds on it (2.1, 2.2, 2.3).
**Phase 3 (progression): done.**
**Phase 4 (food stalls and cooking): done.** The acceptance check passes in `npm run sim:stall` (see below).
**Phase 4.1 (your feedback round: roads, interiors, guidance, start screen, NPCs, night-skip vote): done.**
**Phase 5 (property and Airbnb): first full version done**, see "Phase 5" below for what to check.
**Phase 5.1 (your second feedback round): done**, and **5.2 (touch-ups)**, see below.
**Phase 6 (shops, businesses, loans): done** (6a businesses + shop, 6b loans, 6c the player-item boutique, plus offline
income for stalls). **Phase 7 (casino and social economy): in progress.** 7a (the Lucky Strand Casino + the daily free spin) is done; next
7b (trading, gifting, PvP coinflip, the Pasar Online marketplace, leaderboards, server events).

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean (shared, server, client, scripts) |
| `npm test` (Vitest) | ✅ 218 unit tests |
| `npm run e2e` (Playwright: desktop + phone) | ✅ phases 1–4 pass (run one file at a time on a busy PC: they're slow) |
| `npm run sim:stall` | ✅ Perfect cooking 12.7× passive mode; sloppy cooking still beats passive; passive makes money |
| Real phone on the LAN | ⏳ needs you |

### Notes for you
- **The game you're playing isn't touched while I work.** It runs the built copy (`node server/dist/index.js`, port
  3003). Changes reach it when you run `npm run build`, stop the server (Ctrl+C saves everyone) and `npm start`.
  The browser tests run their own throwaway server on port 3101 with a database under `test-results/`.
- **Commits are local only** (not pushed).
- **No database changes** this round. Customers' add-ons and new stock items are stored in the existing stall JSON.

---

## The shared radio (your request)

### How to test it
- Put music on the server PC, one folder per genre: `server/music/lofi/Artist - Title.mp3` (see README → Music).
  Restart, or type `/music rescan` in chat.
- **Everyone hears the same track at the same moment** (each device plays the file from the shared position and
  re-syncs if it drifts more than 1.5 s). Browsers only allow sound after your first tap or key press.
- **📱 → 📻 Radio** (or tap the 🎵 pill next to the phone): **⏭ Vote to skip**, and a **genre vote**. Both need
  **more than half of the players online** (2 of 2, 2 of 3, 3 of 4…); tap again to take your vote back. A genre win
  switches straight away.
- Per player: mute and music volume (Radio app or ⚙️ Settings).
- Tested with two players: same track within 0.3 s, a 2/2 genre vote switched both, a 2/2 skip moved both on.

## Phase 7a: the Lucky Strand Casino (and solid stalls)

### How to test it
- **Go inside the Lucky Strand Casino** (The Strand). Six stations: 🎰 Slot Machines, 🎡 Roulette, 🃏 Blackjack, 📈 Crash,
  🎯 Wheel of Fortune, 🔼 High-Low. Walk up and press E.
  - **Bet limits by wealth stage**: stage 1 RM 1–50 … stage 6 RM 10,000–10M. Pick a chip; today's session (bet /
    won back) shows under every game.
  - **Slots:** 3 reels (cherry, teh tarik, ketupat, durian, money bag, 7). Three of a kind pays ×5 to ×1,000; two
    cherries pay back 0.7×. Returns 95.6% on average (shown on the machine).
  - **Roulette** (European, one zero), **shared**: everyone bets on the same spin (20 s to bet), bets show with
    names.
  - **Blackjack**: up to **5 players at one table**. Sit, bet, then act in turn (hit, stand, double, split; 20 s per
    turn, then you stand). Blackjack pays 3:2; the dealer stands on 17. Keep your seat between hands.
  - **Crash**, shared: bet in the 8 s before take-off, then cash out before it crashes (or set auto cash-out).
    Everyone's cash-outs show live.
  - **Wheel of Fortune**, shared: a spin every 2 minutes; bet on ×2 … ×48.
  - **High-Low**: guess higher or lower; each right guess multiplies your pot; cash out any time.
  - Every game keeps 2–5% (configurable in `shared/config/casino.json`; the odds are on screen). Big wins (50× or
    RM 100K+) are announced to everyone.
- **📱 → 🎡 Lucky Spin:** a free spin every day, anywhere (RM, shards or a potion; money grows with your stage).
- **Fair play:** results are decided and paid on the server the moment they're known, so leaving can't dodge a
  loss. Winnings for someone who left are paid at their next login. A server restart refunds undecided bets.
- **Stalls and food trucks are solid** (your request): the pasar malam table, the food truck's body and the kopitiam's
  outdoor tables block walking and riding, so people walk around them (you still walk under a canopy). Only taken
  plots; anyone standing where a new stall appears is nudged out.

## Phase 6c: the player-item boutique (Butik)

### How to test it (two players)
- **📱 → 👜 Butik → My Butik** (stage 3, RM 20,000): open it, tap an item from your bag, pick a price (its value,
  1.5×, 2×, 3×, or your own). It goes on display (out of your bag) in one of 8 slots. **Take back** returns it.
- **📱 → 👜 Butik → Browse:** everything other players have on display, rarest first, with what it's worth.
  **Buy** moves it straight into your bag (tier, variant and serial kept).
- The seller gets the price minus a **5% consignment fee**: straight away if they're online (with a toast), or at
  their next login (one line per item sold on the welcome-back screen). Worn items and furniture placed in a home
  can't be listed. Items on display still count towards your net worth.
- Database: migration 12 adds `boutique_listings`.

## Offline income: stalls stay open, real time, a breakdown per source

### How to test it
- **Your stall keeps the state you left it in.** Switched on with at least one cook and some stock: it **stays open**
  on the map while you're away (canopy up, cooks standing there). Switched off: it stays closed.
- **When you log back in**, the time away is worked out from **real time since your last save**, so time the
  server or game was closed counts too (up to 8 h, at the offline rate of 50%):
  - **Stall:** replayed an in-game hour at a time. Customers come at the usual rate for each hour (rushes, quiet
    hours), your cooks serve as many as they can and your stock allows, minus their wages. Stock is used up but
    **doesn't go off while you're away** (fixed 2026-11-19: it used to age over the whole time away, which spoiled
    everything after a few hours). If it sells out, the cooks go home, and the welcome-back line says **SOLD OUT**.
    The Business app shows ❗ whenever nothing on your menu is in stock (no stock = no customers).
  - **Managed businesses** and **homes** (rent, Airbnb, running costs).
- **The welcome-back screen lists every source on its own line:** your stall (dishes sold, wages, anything that
  went off), each managed business (name, level), and each home (rent / Airbnb / costs). Everything counts for the
  Lucky Spin.

## Phase 6b: loans (Bank Kota and the Ah Long)

### How to test it
- **📱 → 🏦 Bank → Bank Kota:**
  - Your **credit score** (300–850; starts at 600, plus a bonus for net worth) sets the interest rate (0.4%–3% a
    day).
  - **Personal loan** (no collateral), **business loan** (pledge a business), **property loan** (pledge a home, up
    to 90% of its value). The limit grows with your wealth stage, level and score; up to 3 bank loans at a time.
  - Each **loan day** an instalment is taken from your wallet. Paying on time raises your score; paying a loan off
    raises it more. You can pay early any time (no more interest on what you pay).
  - **Missed instalments:** a warning, then penalty interest, then after 3 in a row the bank **repossesses** the
    collateral and auctions it at 70% (the rest after the debt comes back to you). A personal loan takes your
    wallet instead. Your score crashes. Pledged homes can't be sold.
- **📱 → 🏦 Bank → Ah Long:** instant cash, no checks, 20% a day, pay back in 3 days.
  - Late: a red **💸 OWES AH LONG** tag over your head and **two debt collectors follow you around** (everyone
    sees them). They take whatever is in your wallet each day, and your homes and businesses earn half until
    you've paid.
- **Debts count against net worth.** Titles: Credit Worthy (pay off 3 bank loans), Survived Ah Long (pay back RM
  10,000+), and a secret one if it all goes wrong.
- **Testing:** `/loanday me 5` runs 5 loan days at once.

## Phase 6a: idle businesses and the retail shop

### How to test it
- **📱 → 🏢 Ventures → Businesses** (from wealth stage 3): Buih Car Wash, Dobi Wangi (stage 3), Boba Bunga, tuition centre
  (stage 4), gym, hotel (stage 5), supermarket and KD Mega Mall (stage 6).
  - **Open it, then buy levels** (+1, +10, or as many as you can afford). Each level adds its revenue per cycle; the
    cost grows 13% a level.
  - **Milestones** at levels 10, 25, 50, 100 and 200 each double the speed.
  - **Without a manager**, a finished cycle waits for you: tap 💰 Collect (or Collect all). The Ventures icon shows 💰
    when something is waiting.
  - **👔 Hire a manager** (4× the opening price) and it pays every cycle by itself, also while you're offline (at the
    offline rate, up to 8 h, on the welcome-back screen and in its Lucky Spin).
  - **🔥 Rush** (Scrub!, Fold fast!, Shake to order!…): tap the big button 12 times in 6 s and the business earns ×3
    for 20 s (3-minute cooldown).
  - 5% business tax on every payout. **Passive Income** (skill and gear) boosts businesses too.
  - Half of what you spent counts towards net worth.
- **📱 → 🏢 Ventures → Shop** (stage 3, RM 30,000): your own kedai runcit.
  - Buy stock wholesale (+10 / +50), and set each price with −/+. Customers buy more below the market price and
    fewer above it; the card says how your price looks (🔥 / 🙂 / 🤨 / 😬) and the profit each.
  - **Hire a cashier** (RM 500 a game day) and it sells by itself while you're online.
  - **🧾 Be the cashier:** tap every item in the basket to scan it, then pick the right change from what the
    customer hands you. Right and within 15 s = +50% on the basket; wrong change costs you the difference.
- Database: migration 11 adds a `player_data` table (businesses + shop now, loans next).

## Phase 5.8: feedback fixes (lag, stall traffic, bag details, stock boxes, Property skills)

### How to test it
- **Less lag when moving.** Walk and ride around town; it should feel smoother, mostly when new streets come into
  view. In a profile of a 15-second walk, busy main-thread time dropped from ~7.5 s to ~2.9 s. What was slow:
  - **NPC name tags were re-rendered every frame.** In Phaser, setting a text's colour redraws and re-uploads it, even
    when it's the same colour. Now they're only redrawn when the errand target changes.
  - **Home signs ("FOR SALE") were re-rendered on every update** (wallet ticks, stall changes…). With the new
    shoplot lofts that was 500+ signs each time. Now only when ownership changes.
  - **Everything on the map was drawn every frame, even far off-screen.** That covered all stalls (their shapes
    re-tessellated each frame), signposts, labels, signs, townsfolk, customers and cooks. Now anything far off-screen
    is hidden (`client/src/world/culler.ts`).
  - **Each new map chunk was read back pixel by pixel** (~40 ms per chunk) for a feature we don't use. Chunks (and
    character sprites) now go straight to the GPU. Chunks are also drawn a bit further ahead and kept longer.
  - Smaller things: skill/gear bonuses are no longer recomputed every frame, and the rainbow name colour steps
    ~8×/s.
- **Stall foot traffic is fairer and busier at meal times** (`stalls.json`):
  - Reputation now swings traffic 0.8×–1.3× (was 0.5×–1.5×, a 3× gap between a struggling stall and a top one).
  - No stall drops below 0.9× its tier's base rate (`minCustomersMult`).
  - In a rush (breakfast, lunch, dinner) every open stall gets at least 2.4× base (`rush.floorMult`), the rush
    multiplier is 2.2× (was 1.8×), and queues hold 2 more (`rush.extraQueue`).
  - Signage, Kaki Promo, Customer Rush and bloggers still add on top.
  - **Reputation recovers with your cooks:** every dish a cook serves adds +0.25 reputation, up to 60 (3★).
    Above that you still need your own Great/Perfect dishes (and bloggers). Before, a stall run by its cooks could
    only lose reputation, so one bad stretch left it at 0★ for good.
  - **Moving up a tier:** for 2 minutes after the move, customers who give up don't cost reputation (your cooks
    need re-hiring and the crowd is bigger).
  - Why Wendygosh's truck was at 0★: they moved up, cooked alone for ~10 minutes with signage 10 and a big queue,
    and lost dozens of customers (−3 each). Their actual sales were higher than nytra's at the time: two fast
    cooks kept the queue empty, so it only *looked* quiet.
- **Bag:** the selected item's details stay pinned at the top while you scroll the items. Picking an item doesn't
  make the grid jump, and ✕ closes the details.
- **Stall stock:** separate small boxes outside the stall window, not a panel inside it.
  - Each box is just the drawn icon and "x 12". Hovering (or tapping) a box stretches it to show the name.
  - On a wide screen they line up down the window's left side; on a phone or narrow window, in a row above it.
  - The last box (＋📦) opens Restock. The stall window is back to normal width.
- **Property skills** (📱 → Skills → 🏠 Property, no longer "coming soon"):
  - **Prime Landlord:** +6% rent per level (max 20).
  - **Kerb Appeal:** fair rent and nightly rate +5% per level (max 10), so you can charge more and tenants and guests
    stay happy.
  - **Five-Star Host:** +6% Airbnb pay per level (max 20).
  - **Spotless:** guests leave 7% less mess per level (max 10).
  - **Passive Income** now also counts for rent and Airbnb, as its description promised.

---

## Phase 5.7: item tiers (D..S), gear buffs, merging, shard rerolls, chef gacha

### How to test it
- **Tiers:**
  - Every item rolled from a crate now has a **tier** (D, C, B, A, S: mostly D, S is about 1 in 200), shown as a
    badge on the card (and in the reveal).
  - Tier multiplies an item's value: ×1, ×1.5, ×2.2, ×3.3, ×5.
  - Variation (shiny ×1.5, golden ×2.5, rainbow ×4 for buffs; its own value multiplier as before) multiplies on
    top. Old items are tier D.
- **Gear buffs:**
  - What you wear boosts a stat: hat → luck, face → XP, back → job pay, aura → passive income, name colour →
    stall prices.
  - Base by rarity: common +1%, uncommon 2%, rare 4%, epic 7%, legendary 12%, mythic 20%, divine 30%, secret 45%,
    then × tier × variation.
  - The bag's item details show "When worn: +X% …". Luck from gear shows in the crate odds as "Your gear".
- **Merge:** in the bag, **⬆️ Merge 5 → Tier C** turns 5 copies of the same item at one tier (not worn) into 1 at
  the next tier. It keeps the best variation among them (one golden input gives a golden result).
- **Shard rerolls:** **🎲 Tier reroll** / **🎲 Variant reroll** cost shards (by rarity) for a chance at better. It
  never makes the item worse.
- **Pawn shop:** sells and scraps per tier, and pays for the tier.
- Database: migration 10 adds the tier column (existing items become tier D).

All tier numbers are in `shared/config/grades.json`.

### Chef gacha
- **📱 → Quick Rolls → Chef Search** (wealth stage 2): 60 💎 a roll, paid in shards (no RM, no phone fee).
- 10 fictional chefs, common to mythic (Mak Senah, Pak Hamid … The Sambal Sultan, Grandmaster Teh), each drawn as
  a portrait.
- Chefs roll a tier and variation like any item. You can merge and reroll them, and they go in the bag's
  **👨‍🍳 Chefs** group.
- **👨‍🍳 Make head chef** puts one in the chef slot: + stall prices AND faster cooks. The base is stronger than
  gear: common 5%, uncommon 8%, rare 12%, epic 18%, legendary 28%, mythic 40%, then × tier × variation.
- The head chef isn't drawn on your character (it's a stall buff).

### Claiming a home
- **Your first home is free:** walk to the door of any unit costing up to RM 100,000 (studio, 2-bed condo or a
  shoplot loft) and press **🎁 Claim free (first home)**. After that you pay the listed price.
- **Up to 3 homes each.** Sell one to claim another. Selling a free home pays nothing back.
- **Plain shoplots are homes now** ("Shoplot loft", RM 40,000, no stage needed). A bigger shoplot holds more
  players: one loft per 70 m² of floor, up to 4 per building. That makes 460 of the 537 shoplots homes (1,206 lofts).
- Shoplots that are shops, have a counter or machine inside, hold a stall, or have a name stay as they are. Malls,
  hypermarkets and other non-homes never become homes.
- Flats and condos keep their fixed unit counts (8 and 12), so several players already share them.
- No database changes: a claim is a normal property record with a bought price of RM 0.

---

## Phase 5.6: queue items (job boards, manifesting, doors, low stock, closing, tarik slider, stall stock)

### How to test it
- **Job boards:** 4 more around town (by Gergasi, The Strand, Mitraland and the pasar malam). **📱 → Jobs**
  takes a delivery from anywhere (the car wash is still done inside Kilat).
- **Manifesting:** RM 0.50 + RM 0.20 per Manifesting level, every second (level 5 = RM 1.50/s = RM 5,400/h),
  plus 12 XP a minute.
- **Doors:** you only go in when you're lined up with the door mark and pushing into it. Doorways inside rooms
  are narrower.
- **Low stock:** a heads-up (with a sound) when a dish or add-on is down to 5. In the stall panel the item pulses
  orange.
- **Closing the stall:** switching it off gives 20 s to serve who's waiting (no new customers); orders being made
  always finish; then the rest go home with no reputation hit.
- **Teh tarik:** the froth step is gone. **Tarik!** (hot drinks only) is a slider: hold it and drag it up and down
  (or W/S, ↑/↓) to keep the kole in the moving green zone.
- **Stock:** moved off the main screen into a column down the side of **your stall's panel** (big food icons,
  "x 12", the name on hover or tap, and + Restock). The cooking screen's stock bar uses the same food icons.

---

## Phase 5.5: teh tarik custom orders

### How to test it
(Teh tarik unlocks at nasi lemak mastery 1. Buy milks in 📱 → Business → Stock or at Gergasi.)
1. **Make the drink:** tap the trays as the ticket says ("TEH TARIK AIS", "TEH O PANAS"...).
   - The cup: hot mug or iced glass.
   - Then the brewed tea.
   - For iced, the ice: 1, 2 or 3 taps = less, regular or more ice.
   - Then the milk the customer ordered, one of the add-on milks: susu pekat (1–3 spoons, each spoon one tap,
     graded exactly), susu cair, fresh milk, oat milk or almond milk.
   - About 1 in 5 customers want teh O (no milk). Milks are cheap stock, and each drink uses 1 stock.
   - The cup fills as you go, with ice cubes or steam.
2. **Tarik! (hot drinks only):** hold to lift the kole, let go to lower it. Keep the stream in the green zone,
   which moves up and down; "▲ higher" / "▼ lower" tells you which way.
3. **Froth it up:** as before, for both.

### What changed
- An order can ask for the same thing more than once (`count`), groups can depend on an earlier pick (`if`),
  and a step can be skipped unless the order has something (`only`): the tarik step is for hot cups only.
- Grading counts taps, so 2 spoons need exactly 2.
- Meter steps can have a moving zone (`wave`); the server grades against where the zone was at each moment.

---

## Phase 5.4: stall levels, open any time, stock icons, start over, phone button + quick rolls

### How to test it
1. **📱 → Business → Upgrades:**
   - **Stall level** (⭐ +12% on every price per level) and **Staff level** (cooks 10% faster, and their sales
     earn +6% per level) are new.
   - Every upgrade is cheaper now (e.g. RM 80–150 for level 1), and each next level costs about 1.35× the last.
2. **Open any time:** switch the stall on at midday. It runs, marked "🌙 quiet hours", with fewer customers
   (45%) outside the busiest hours.
3. **Stock icons:** walk near your stall (or open it).
   - Your stock appears down the right side as big food icons with "x 12" (orange when low, red when out).
   - Hover (or tap) one to see its name. The sign over the stall is gone.
4. **Start over:** while cooking, **↺ Start over** throws the dish away and starts it again, for free (same
   customer, no extra stock, your combo is kept).
5. **Phone:**
   - The big glowing phone at the bottom left, labelled "Phone (P)" (above the joystick on a phone), opens it.
     A red badge counts apps that need you.
   - Inside: **🎰 Quick Rolls** comes first. Roll any crate from anywhere for a 10% phone fee; it's free at the
     machine.
   - The "coming soon" apps and the duplicate Index icon are gone (Index is a tab in the Bag).

---

## Your next list (noted 2026-11-18, not started)
1. **Teh tarik custom orders:**
   - Pick the cup type first (hot or iced).
   - The order includes the ice level (less / regular / more), spoons of condensed milk, and the milk type (an
     add-on with its own stock).
   - Then brewed tea, then condensed or regular milk. Teh O (no milk) is an option.
   - Hot drinks get a **tarik** step: pull the kole up and down, following a moving green indicator, for Perfect.
2. **Stall level** (raises prices); **open the stall manually any time**; **staff level** (tips/bonus % and speed);
   cheaper upgrades, with each step worth buying.
3. **Phone button:** a big highlighted image at the bottom left, labelled "Phone (P)"; simpler icons inside; quick
   rolls inside.
4. **Chef gacha:** roll your chef, with a tier and a variation buff (like shiny items).
5. **Items get tiny buffs by tier**, with a multiplier for their variation.
6. **Stall stock display:** no stock sign over stalls outside the stall view. Instead, big logos down the side of
   the screen showing "x <stock count>" and no label; hovering one stretches it to show the full name.

**Your answers and additions:**
- The condensed-milk spoon count is graded.
- Chef buffs should be noticeable; strong is fine.
- Item buffs can cover every stat; strong is fine. Tiers exaggerate them (common very low, legendary quite high).
- **Shards get real uses:** chef rolls, rerolling an item's variation, and rerolling its tier (a chance).
- **Tiers are a separate measure from rarity.** Every rolled item can have a tier AND a variation, and they
  multiply (e.g. tier S ×5 and diamond ×5 = base ×25).
- **Merge copies of the same item to raise its tier,** one step at a time and not too cheaply (e.g. 5 → 1 of the
  next step). The merged item keeps the best variation among its inputs (one golden input → golden result).
- **Settled:** merging raises the **tier**: 5 of the same item at tier D make 1 at tier C (then C to B, and so
  on). Item, rarity and variation stay the same. Rarity gives the base stat; tier and variation multiply it.
- **Milk stock:** condensed, regular and other milks (almond, oat…) are add-on stock, priced so that 1 stock = 1 drink.
- **Discard:** a free button to throw away the current food or drink and start over.
- **Claim your own house in any suitable building:**
  - 1 free, pay for more, with a total limit per player.
  - Several players can share one building, depending on its size.
  - Only homes and certain shoplots qualify; not the hypermarket, malls and so on.

---

## Phase 5.3: teh tarik & roti canai redrawn, orders in tray order

### How to test it
(Teh tarik unlocks at nasi lemak mastery 1, roti canai at teh tarik mastery 1.)
1. **Teh tarik:** step 1 is now **Make the drink**: tap the trays as ordered: brewed tea (with its teabag),
   then the milk (susu pekat or susu cair), then **panas** (hot) or **ais** (iced). The glass fills as you go
   (steam or ice cubes on top). Then **Tarik!** (two steel mugs, the tea stream stretching between them) and
   **Froth it up** (the froth builds in the glass while you pour).
2. **Roti canai:** stretch the dough on an oiled steel counter (it gets wider and thinner with each slap), flip
   it on the griddle (it browns, then burns), fold the corners (the flaps fold in), then **Serve it with…**: tap
   the curry trays (dhal, kari ayam, kari ikan, sambal), any order; they appear in bowls next to the roti.
3. **Every order** (nasi lemak too) lists its items in the order the trays stand, never shuffled; on the ticket the
   add-ons are set apart by a dashed line under "+ ADD-ONS".

### What changed
- `assemble` steps take optional `groups` (pick this many from each group, in turn): teh tarik is one tea, one
  milk, then hot OR iced. Orders are sorted by tray position.
- Roti canai's "Serve it with…" is an `assemble` step now (1–2 curries, any order) instead of a remember-the-order
  step, since the ticket is sorted.
- New drawings in `foodArt.ts`: brewed tea + teabag, condensed and evaporated milk, hot water, ice, dhal, kari
  ayam, kari ikan; glass mug, steel pulling mugs, oiled counter, dough, roti, griddle, curry bowls.
- Emoji that older Windows can't show were swapped: roti canai 🥞, teh tarik ☕, signage 🏷️.

---

## Phase 5.2: touch-ups (riders, lamps, night overlay, interiors, nasi lemak screen)

### How to test it
1. **Riding:** press **1** for the bicycle and ride in every direction: from the side the hands reach the
   handlebar; from the front and back the hands hold the grips and the bike is drawn over the rider (front wheel,
   basket). Book a **Ronda** ride: you sit **behind** the rider (under them from the side and front, on top only
   from behind), and the rider holds the handlebar too.
2. **Street lamps:** `/time 22` and look along any street: one lamp every ~22 m on alternating sides, on the
   sidewalk, never on the asphalt and never two or three in one spot. Squares (Dataran Sunway Square) get a loose
   grid of lamps.
3. **Night overlay:** at night, ride a vehicle fast: the darkness no longer lags behind, so no bright strip
   at the screen edge.
4. **Interiors:** go into Gergasi through each of its doors: you appear at the side you came in from (north door →
   top of the room, east door → right side...). Small rooms are centred on the screen; big halls follow you but
   stay centred on the axis where they fit. Counters and machines are in the **middle** of the room on a glowing,
   pulsing spot with a bouncing ▼ and a yellow label; you can use them from any side.
5. **Nasi lemak "Pack the order":** bigger screen, nothing scrolls. Food is drawn in steel trays (thick glossy
   sambal, peanuts with skins, ikan bilis, timun slices, egg halves, ayam goreng, paru, sambal kerang, telur mata,
   rendang). Base sides in a row under the plate, add-ons in two columns beside it (on a phone: all trays, 4 per
   row, under the plate). Hover a tray to see its name; the order ticket shows big pictures with names (and
   "+ ADD-ON"); the plate is a banana leaf with a rice mound and the food you add.

### What changed
| Your remark | What I did |
|---|---|
| Hands should reach the handlebar | New riding pose in the character sheet (one frame per view); bikes and the Ronda rider use it. |
| Passenger drawn in front of the Ronda rider | The draw-order code moved the passenger one layer too high; now uses Phaser's `moveBelow`/`moveAbove`. |
| Lamps doubled/tripled, some on the road | Lamps are placed along each street's sidewalk (every 11 tiles, alternating sides), skipping junctions and anything within 0.3 tiles of asphalt, at least 5 tiles apart. 780 lamps, none closer than 4 tiles. |
| Night overlay slower than the background on fast vehicles | The overlay is three screens wide around the view, so camera lag never shows its edge. |
| Interior centred; enter from the door's side; counters in the middle with a strong highlight | `roomSize` now uses the footprint as it sits on the map; `doorSide` puts the doorway in the matching wall, where the door is along it. New `drawHighlight` + pulsing ring + glow + bouncing arrow. Camera bounds centre the room on any axis where it fits. |
| Nasi lemak trays, realistic art, no scrolling, bigger, hover labels, bigger ticket icons with labels | New `client/src/ui/stall/foodArt.ts` (trays, food, plate, rice); the step resizes its canvas to the window. |

---

## Phase 5.1: your second feedback round

### How to test it
1. **Login first:** open the game. The login screen comes first (over the animated dusk scene), then START GAME
   ("👤 you · Not you? Log out"). A device that's still logged in goes straight to START GAME.
2. **Doors:** walk into a door. No button: pushing into it goes in. A locked door (houses, homes others own) knocks,
   blocks you and shakes the screen a little. Inside, walk out through the doorway (▼ EXIT ▼) to leave (Esc works too).
   The touch E button only shows when there's something to press.
3. **Room sizes:** the Gergasi Hypermarket and the malls are big halls (the camera follows you), with rows of
   shelves/kiosks; a shoplot (the pawn shop, Kilat Car Wash) is a long narrow room.
4. **Who's inside:** when another player is in a building, "🚪 Ali is inside" floats over its door (and the minimap
   shows 🚪 by their name).
5. **Night:** `/time 21`. Nights are lighter. Street lamps glow with a warm pool on the ground; stalls have bulb
   strings, a hanging lamp and a warm spill of light; the food truck's hatch and the kopitiam sign glow. In the
   daytime, lamp poles and stall canopies cast shadows.
6. **Skip the night:** 📱 → Clock between 8 PM and 5 AM: the vote button is enabled (it used to stay grey if you'd
   joined in the daytime).
7. **Nasi lemak:** cook one. Scoop the rice (same as before), then **tap the ingredient boxes** on the order ticket
   (sambal, ikan bilis, kacang, timun, telur rebus) plus any **add-ons** the customer ordered (🍗 ayam goreng,
   🥩 paru, 🦪 sambal kerang, 🍳 telur mata, 🥘 rendang), any order. All right and quick = Perfect. The order
   bubbles and the queue show the add-ons. Add-ons have their own stock (📱 → Business → Stock, or Gergasi).
8. **Stock is everywhere:** a big stock bar in the cooking screen and the stall panel (orange when low, red when
   out), the stock list shows counts, and a "📦 🍛 23 🍗4 …" sign floats over your own stall (red when low).
9. **Staff:** hire a cook. They stand at the stall; while cooking someone's order they move, show 🍳 and steam.
   Each sale shows "+RM 21.60 🧑‍🍳" rising over the stall with a soft coin sound (no toast spam).
10. **Ronda:** book rides: the rider follows the roads, keeps left on two-way roads, and goes the right way on
    one-way roads (2+ lanes); single-lane roads are used both ways, down the middle. Fares are a little higher.
11. **Errands:** accept an NPC errand. A green light beam, ring and big 🧺 "ERRAND · PLACE" mark the spot
    (and 🧺 on the minimap); when it's time to hand it back, a yellow 🧺❗ "HAND IT TO …" follows the NPC.
12. **Bag:** items are grouped by what they're for: 👕 Outfit (Head, Face, Back, Aura, Name colour), 🧪 Potions &
    boosters, 💎 Collectibles, 🛋️ Furniture, side by side as columns on a wide screen. The pawn shop and the
    shard shop use the same groups.

### What changed
| Your remark | What I did |
|---|---|
| Login screen before START GAME | Page load → login (skipped if this device's session is still valid: new `POST /api/session`) → START GAME. Log out from the start screen or Settings. |
| Better cast shadows / lighting on stalls and light poles | New `client/src/world/lightLayer.ts`: lamps in view get an additive glow + ground pool at night (pooled sprites, ≤110 lights). Stalls: bulbs, hanging lamp, light spill, canopy/truck shading, daytime canopy shadow. Lamp sprite redrawn (base, lit pole edge, arm, glass) with a long cast shadow. |
| Reduce night darkness | Night tint is config now: `time.json → lighting.nightTint` (#949ed2, was #505c96). Lamp/stall strength there too. |
| Night skip greyed out | The server's `canStart` was only sent when a vote changed, so it went stale. The client now works it out from the live clock (`canStartSkipVote`), and the Clock app refreshes every second. |
| Doors: walk in/out, block + sound if locked | Pushing into a door's front goes in (once per push, 0.9 s retry). Locked: knock sound, toast, small camera shake. Interior "Leave" button removed; walk out through the doorway. |
| Ronda pathing + slight price bump + Malaysian road rules | New road-network router (`server/src/systems/rides/roadGraph.ts`), see Decisions. Fares RM 3 + 1.60/km (min 3.50) → RM 4 + 2.00/km (min 4.50). |
| Interior size matches the building | `roomSize()` measures the footprint along the door you came in by (wall = room width, depth = height), 1.6 m per room tile, 8×6 to 46×32. Big rooms fill with each style's `fill` pieces in aisles. |
| Staff visible when cooking | Cooks stand at the stall (spots per tier); the busy ones animate with 🍳 and steam. Everyone sees them. |
| Stock very visible | Stock bar while cooking + in the stall panel, counts on the add-on boxes, the stock sign over your stall. |
| Nasi lemak rework + add-ons + higher prices | New `assemble` step kind (tap boxes). Add-ons per recipe in `recipes.json` (own stock, price, chance). Prices: nasi lemak RM 15 → 18, teh tarik RM 8 → 10, roti canai RM 12 → 15 (ingredients scaled the same). |
| Lower penalty for staff-served items; income popup | `staff.passiveRate` 0.6 → 0.8. A `staffSale` stall event → "+RM" popup over the stall. |
| Errand pointer / static pointer on the POI | World beacon at the errand place (beam, ring, bouncing 🧺, label), then over the NPC; 🧺 on the minimap. |
| Icon if a player is in a building | "🚪 name is inside" badge over the door; 🚪 before their name on the minimap. |
| Bag/item lists in columns by function | `client/src/ui/itemGroups.ts`, used by the bag, pawn shop (sell/scrap) and shard shop. |
| (found while testing) Ronda passenger frozen when riding north | A crash in the rider drawing ("Supplied index out of bounds" when the bike moved in front of the passenger) stopped the passenger following the ride. Fixed (clamped draw order). |

### Stall sim after the rework (`npm run sim:stall`, 5 nights)
| Mode | RM per real hour |
|---|---|
| Perfect cooking | ~RM 28.8K (57 dishes a night) |
| Sloppy cooking | ~RM 6.1K |
| Passive (hired cook) | ~RM 2.3K |
| Jobs (for comparison) | ~RM 6.7K |

Perfect cooking now earns ~4× jobs (was ~2×): the nasi lemak is quicker to make (2 steps) and dearer, and add-ons
add to the bill. Tell me if stalls feel too strong and I'll trim prices in `recipes.json`.

---

## Phase 5: property and Airbnb

### How to test it
1. Get rich quickly (admin chat): `/give me money 5000000` and `/setstage me 4`.
2. **📱 → Handbook → Homes, rent and Airbnb** explains the loop. The map has two new signposts: **HOMES FOR SALE**
   (Ant Palms condos) and **FURNITURE** (IKEJA, near Surian MRT).
3. Walk to an **Ant Palms** door (yellow 🏷️ FOR SALE sign), press **E**: a list of 12 units (studios, 2- and
   3-bedroom condos) with prices. Buy one. Terraces and semi-Ds around town are for sale too.
4. **IKEJA**: go in, use the counter: beds, bathroom, kitchen, appliances, sofas... each shows its stats
   (essential/amenity, theme, comfort, style, size). Buy the 6 essentials (bed, toilet, shower, kitchenette,
   aircond, wifi router).
5. Back at your condo: **E → 🚪 Go in → 🛠️ Decorate**. Tap a piece, tap the floor to place it (green = OK,
   red = not allowed), **R** rotates, tap a placed piece to pick it up, **Del** puts it back, Undo/Redo, **Save**.
   The panel shows the stars, a bar per factor and the **top 3 suggestions with the predicted gain**
   ("Add a wifi router (missing essential) → +0.8★, +RM 90/night").
6. **📱 → Properties**: choose **Rent out**, **Airbnb**, **Live in it** or Empty. Rent: set the daily rent against the
   fair range, wait for a tenant (happiness, maintenance requests: pay a contractor or fix it yourself inside).
   Airbnb: set the nightly price against the recommended range; guests book (1 in-game day = 24 real minutes),
   check out, pay and leave reviews; clean the unit inside (🧽) or hire a cleaner. 5 five-star reviews = Superhost.
7. **Offline income**: log out, come back later: "Welcome back! While you were away you earned…" (50%, up to 8 h),
   with a 10-second **Lucky Spin** that doubles it.
8. Placed furniture can't be sold at the pawn shop (it says why); selling a home gives 85% back, furniture stays yours.

### What was built
- **Config:** `furniture.json` (42 pieces: stats, themes, essentials, amenities, store prices), `properties.json`
  (unit types, prices, rent/Airbnb rules, review templates, rating weights). 37 new furniture items in `items.json`;
  6 rare themed pieces (Gamer Neon, Cyberpunk, Luxury Gold) added to the Mall Mystery Box.
- **Shared maths** (`shared/src/property/`): the star rating (§9.3: essentials cap, comfort per m², theme sets
  3/5/8, rarity, amenities, cleanliness, space + blocked walkway), layout rules, suggestions (each one is a real
  "what if" re-rating, so the predicted gain is exact), fair night price, booking chance, fair rent, tenant happiness,
  listings (unit ids `<OSM building id>#<n>`, location pricing near the MRT, The Strand and Dataran Sunway).
- **Server** (`server/src/systems/property/`): buy/sell, modes, prices, staff, layouts (only furniture you own and
  haven't placed elsewhere), DIY repairs and cleaning (timed, at the unit), per-hour tenant applications, per-day
  rent/maintenance/costs/bookings/reviews/events, offline catch-up + Lucky Spin. Migration 9 adds `properties`.
  Property counts towards net worth (90% of the price).
- **Client:** FOR SALE / owner signs on home doors, the unit list at the door, the IKEJA store, the home scene with
  Decorate mode (`client/src/world/homeScene.ts`), furniture drawn in code (`client/src/items/furnitureArt.ts`),
  📱 Properties, the welcome-back screen.
- **Tests:** 10 shared tests (rating, suggestions, layouts, pricing, listings), 8 server tests (buying, rent,
  happiness/move-out, layouts, Airbnb income vs decoration, cleaning, offline income + spin).

### Not yet (later in Phase 5 / next round)
- Wall paint / wallpaper / flooring choices, renovation levels, security, smart-lock auto check-in.
- Guests walking in with luggage (NPCs) and the Best Airbnb leaderboard (Phase 7 does leaderboards).
- "Live in it" is a showroom only: no spawn point or storage yet.

---

## Phase 4.1: your feedback round

| Your remark | What I did |
|---|---|
| Grass slows vehicles too much | Grass/park/field 0.4 → 0.7, forest 0.45, construction 0.5 (`terrain.json`). |
| Sidewalks should count as road | Sidewalk vehicle speed 0.6 → 1.0. |
| Widen small roads slightly | `minRoadWidthMeters`: back lanes 3.5 → 5 m, streets 7 → 8 m. |
| Rework roads / straight lines / shortcuts | Measured walking detours from spawn across the whole map (`scripts/_detour` method, now `npm run map-inspect` shows unreachable ground in red): 235 sample spots needed > 1.5× the straight-line distance. Added **4 footbridges over the north-south highway** (to PJU 3 and Ant Palms) and turned the Dataran Sunway multi-storey car park into an open **Dataran Sunway Square**. Now 7 spots, all map-edge or median strips. |
| Moving above elevated roads | Flyovers and the MRT viaduct are drawn on their own layer **above** characters and fade to see-through while you walk under them; motorbikes on a flyover draw on top of it. |
| Parking lines / cars over the line / straight cars on angled lots | Bays are laid out along each car park's own angle (2.5 × 5 m, aisles between double rows); cars are drawn inside a bay, rotated with it. |
| Quest pointers (where/what/how) | 🎯 card now has **📍 Show me: JOBS BOARD · 52 m**; tap it for a guide arrow around your character plus a bouncing pin over the spot. Tapping the card shows **💡 How**. Quests have 📍 buttons. Errands point the arrow too. |
| Rework/simplify the map | Footbridges + the square above; spawn moved into the square next to the Jobs Board. |
| Random hints | A 💡 tip every 3 minutes (shuffled, no repeats), can be turned off in Settings. |
| Big pointers: BUY STOCKS, STALL LOCATIONS, WORK LOCATIONS | Colour-coded signposts in the world (green = work, blue = shops, orange = stalls, purple = crates, grey = coming soon) and on the minimap/full map. |
| Handbook | 📱 → **Handbook**: 7 step-by-step chapters, "Take me to…" buttons, and every tip. Also on the start screen (HINTS). |
| Skip night vote | 📱 → **Clock**: start a vote between 8 PM and 5 AM; a banner lets everyone vote; passes when **more than half** of the players online say yes; jumps to 7 AM. 30 s vote, 2 min cooldown. |
| Gergasi accessible from multiple points | Malls, the hypermarket, station, hospital and casino get a door on every side that faces a road. Gergasi has 4. |
| Interaction distance (Pak Abu from across the road) | Interact range 8 → 3 tiles, and machines are now used **inside** buildings. |
| Interiors like Pokémon | Every shop-type building can be entered: the town blurs and darkens behind a small room. Machines and counters are inside; shopkeepers greet you; other players inside show up. Homes are locked unless you own them. **Spec updated** (§3, §4). |
| Kilat Car Wash by the road | It's now a corner shoplot ("Kilat Car Wash") with a wash bay inside. Capsule Machine, pawn shop, Mystery Box and Gergasi are inside their buildings too. |
| Font colours/size for interactive places | Building names: **gold + 🚪 + bold** for places you can use, white/lighter for landmarks, italic for areas. |
| Wandering NPCs with chat and tasks | 14 townsfolk walk around Dataran Sunway (same positions on every screen). E to chat; some ask for an errand (go somewhere, come back) for money + XP. |
| START GAME screen every refresh; reconnect buffer | Every page load shows the start screen (START GAME / HINTS / SETTINGS) over an animated dusk scene with **your** character leaning on a car. A dropped connection shows "📶 Reconnecting… 20s" while you keep playing; the server keeps you in the world for 20 s; after that, back to the start screen. |
| Lighting and shadows | See "Lighting" in the next section (done after this table was written). |

---

## Phase 4: food stalls and cooking

### How to test it
1. `/setstage me 2` (stalls need the Hustler stage), `/time 18`.
2. 📱 → **Business** → buy a pasar malam stall (PASAR MALAM STALLS on the map). Walk there at night.
3. Customers queue; press **E** at your stall and cook: hold / timing / rhythm / sequence / path mini-games.
4. Buy stock in person inside Gergasi (BUY STOCK), or by phone with a delivery fee.
5. Hire a cook (📱 → Business → Staff) and go do jobs: the stall keeps selling at the passive rate.

### Acceptance check (`npm run sim:stall`, real StallSystem, 4 nights)
| Mode | RM per real hour |
|---|---|
| Perfect cooking | ~RM 12.5K (37 dishes a night) |
| Sloppy cooking (mixed grades) | ~RM 4.8K |
| Hired cook, owner away (passive) | ~RM 880 (on top of whatever you do meanwhile) |
| Jobs (for comparison) | ~RM 6.7K |

Perfect cooking earns **14× passive mode** and about **2× jobs**; passive mode makes money while you do other
things. Tuning from the sim: the hired cook went from 50% price / 18 s per dish to 60% / 14 s (it barely paid).

---

## Phase 3: progression

### How to test it (PC + phone)
0. **Rebuild first** if you use `npm start`: `npm run build` then `npm start` (or just `npm run dev`).
1. **New player:** the top-left pill now has your level, an XP bar, your wealth stage (🛵 Budak Baru) and your luck
   (🍀 ×1.00). Under it, **🎯 Next goal** says what to do next. Tap it once for a hint, again for the whole path.
2. **📱 HustlePhone** (P or Tab, or the 📱 button): a phone with apps. **Daily** → claim day 1. **Quests** → today's 3.
   On your phone it fills the screen.
3. **Do a job:** XP and the goal move. Level-ups show a big "LEVEL 2!" splash with confetti. Reaching RM 2,000 net
   worth makes you a **Hustler**: a bigger splash, and your friend sees "… is now a HUSTLER!" in chat.
4. **Lucky Bag** is locked until you're a Hustler; the **Mall Mystery Box** also needs Level 5. The crate screen
   says why.
5. **📱 → Skills:** branches (Hustle, Luck, Rolling, Fortune, Movement; Property/Business/Banking are greyed for later).
   Buy **Hustle Harder** (+5% job pay per level). Manifesting moved here from the Bag.
6. **Potions:** the Hustle Path gives you a ☕ Kopi Kaw at 5 jobs. 🎒 Bag → tap it → **Use**. A timer chip appears under
   the goal (☕ 1.5× 9:59). A 🧪 Luck Potion doubles your luck; open a crate: the odds table and the reel use it.
   Potion timers pause while you're logged out.
7. **📱 → Titles:** wear one (e.g. "Hustler"). Your friend sees it over your head, in its rarity colour.
8. **📱 → Profile:** level, net worth, the stage ladder, where your luck comes from, active potions, lifetime stats.
9. **Admin shortcuts** (chat): `/give me xp 2000`, `/setlevel me 10`, `/setstage me 3`, `/give me item luck_potion`.
10. **Balance:** `npm run sim` (about 3 s). See below.
11. **Existing players** (from before Phase 3) get XP for what they'd already done (rolls, jobs, manifesting, skill
    levels), and any titles and Hustle Path goals they already qualify for (with the rewards) on first login.

### What was built
- **Configs** (all balance in `shared/config/`): `levels.json` (XP curve `100 × L^1.6`, XP per action, level-up
  rewards), `stages.json` (6 wealth stages), `titles.json` (22 titles), `upgrades.json` (the Hustle Skills tree; it
  replaces `skills.json`, Manifesting kept its level and rates), `quests.json` (7-day login rewards, 12 daily quest
  types with targets/rewards per stage), `goals.json` (the 34-goal Hustle Path). 5 potions in `items.json`.
- **Shared maths** (`shared/src/progression/`): levels, net worth (cash + pawn value of items), stages, skill costs
  and effects, how bonuses stack (multiply within a source, add across sources, like luck), conditions (used by
  titles, goals and quests), login streak and quests. The client uses the same code to draw bars and live odds.
- **Server** (`server/src/systems/progression/`): other systems report what happened (roll, job, sale, manifest,
  equip); that bumps **stats** counters and XP. `check()` then pays every level-up, stage, title and goal reward in
  one transaction and pushes the new state. A quest is "this stat went up by N since the quest was given".
  Migration 7 adds `xp`, `level`, `stage`, `title`, `progress_json` and backfills stats for existing players.
- **Gameplay effects:** luck (Lucky Charm, potions, titles), Shiny Sense (variant chance), Pity Pact (pity comes
  sooner; the crate screen shows the new counts), Hustle Harder + Kopi Kaw (job pay), Elbow Grease (car wash timer),
  Fast Learner + XP Booster (XP), Passive Income + Income Booster (Manifesting), Kaki Lari (walk speed, checked by
  the server too), Fast Hands (reel speed), Auto-Roll (keeps rolling until you stop it).
- **Client:** new HUD pill, goal tracker + chips (daily reward, quests, potion timers), the HustlePhone
  (`client/src/ui/phone/`), titles over heads, level-up/stage-up splashes with confetti and sounds, potion icons,
  Use buttons, potions in the Shard Shop.
- **`npm run sim`** (`scripts/balance-sim.ts`) drives the REAL Economy, Gacha and ProgressionSystem against an
  in-memory DB, with a modelled player (job durations, wash quality, what they buy, 20% of earnings on crates,
  a 4-minute manifest break an hour, 2-hour sessions = 1 day each).

### Simulator results (20 runs × 12 h, `npm run sim`)
| | Median | Target (spec §6) |
|---|---|---|
| Stage 2 Hustler (RM 2K) | **24 min** (14–31) | 20 min ✅ |
| Stage 3 Towkay Kecil (RM 50K) | 7 h 42 | 2 h ⏳ |
| Level at 20 min / 1 h / 2 h / 12 h | 5 / 8 / 11 / 26 | (spec has no target) |
| Hustle Path | 27 of 34 goals in the first 2 h, longest wait **16 min** | "a clear path for the first 2 hours" ✅ |
| Jobs | delivery RM 398/min, car wash RM 323/min (both worth doing) | |
| Sinks | 79% of income goes back (skills 79%, crates 21%) | |

**Stage 3 is slow on purpose for now:** jobs are the only income. The spec puts stalls (Phase 4) and property
(Phase 5) as the main income from Stage 2, so the sim will be re-tuned when they exist. Changes made from the sim:
car wash base pay RM 45 → RM 70 (it paid half a delivery, so nobody would wash cars), and the goal list was
reordered and filled in until there were no long gaps.

## Phase 2.3: third feedback round (highway, smooth map, Ronda rides, hotbar, resizing)

### How to test it
0. **Rebuild first.** You were running the old production build (`npm start` serves `server/dist`), so none of this
   round was in what you played. Stop the server (Ctrl+C), then `npm run build` and `npm start` (or use `npm run dev`).
1. **Highway above The Strand:** ride the 🚲 bicycle (key **1**) or take a Ronda along the DASH north of The Strand.
   It's now drawn on the minimap and full map, vehicles go at road speed on it instead of grass speed, and no trees
   are drawn on it any more. Walking still passes underneath.
2. **Smooth map:** open the full map (**M**) and zoom all the way in. Roads are smooth lines at their real width,
   with sidewalks and centre lines; buildings and parks are their real outlines (no more 2 m blocks).
3. **Ronda rides:** 📱 Phone (**P**) → Ronda → **Where to?**. The map opens
   centred on you. Tap where you want to go: the route (green) and the fare appear. Tap **Book**: a green Ronda kapcai
   with a rider picks you up and drives you there along the roads (you sit on the back and can't steer). Your friend
   sees you riding. **Get off here** stops early (no refund). Fares show the exact sen (RM 3.50, not "RM 3").
4. **Hotbar:** the leftover 🛵 motorbike is gone from slot 2 for everyone (your bicycle and everything else stay).
5. **Resizing:** play in a small window, go fullscreen (the game fills the screen, sharper), then back (normal size,
   you're in the middle).

### What changed
- **Elevated decks** (`shared/src/map/build.ts`): a `deck` mask under every elevated road (the DASH viaduct and its
  ramps, flyovers). Vehicles on a deck get road speed and can cross what's below (river, ground highway); buildings
  still block. Walkers are unaffected. The vehicle speed grid lives in the shared `vehicleSpeedGrid()`, used by the
  client and the ride planner.
- **Vector minimap + full map** (`client/src/ui/mapPaint.ts`): painted from the real geometry instead of the tile grid.
  The minimap uses a pre-painted 2 px/tile image; the full map repaints just the visible part when you zoom or pan
  (cached between frames). Max zoom is now 24 px per tile.
- **Ronda** replaces "order a motorbike" (`server/src/systems/rides/`, `shared/config/rides.json`, `client/src/ui/ronda.ts`):
  - The server plans the route (A* over the vehicle grid, a tile costs 1 / speed², so it sticks to roads) and
    simplifies it into smooth segments. About 20 ms per quote.
  - Fare = RM 3.00 + RM 1.60/km, at least RM 3.50, rounded to 10 sen (about RM 4.10 from Dataran Sunway to Mitraland).
    It's charged on booking, in one transaction, logged as `ride`. A quote lasts 2 minutes and only books if you're
    still within 4 tiles of where you asked.
  - After a 1.8 s pickup, the server moves you along the route at 400 px/s and ignores your own move reports. Your
    client follows the server's positions like it does for other players. Arriving, getting off, or disconnecting
    drops you on the nearest walkable spot.
  - Drawn as a green kapcai with an NPC rider (built with the normal character renderer: green jersey and cap,
    shades). You sit behind them.
- **Hotbar** (migration 6): removes the motorbike left over from the old "order a motorbike" flow from every saved
  hotbar. Nothing else changes. New players start with just the bicycle in slot 1.
- **No trees under decks:** trees are drawn above everything, so ones planted on the grass under the viaduct showed
  on top of the highway. Nothing is planted under a deck now.
- **Window resize / fullscreen** (`client/src/app.ts`, `townScene.ts`): the canvas, camera size, zoom and map
  chunk sharpness are now refitted on every resize and fullscreen change, and the camera recentres on you. Before,
  Phaser skipped the canvas size update when the pixel ratio came out at exactly 1× and only resized the camera in
  some cases, so fullscreen didn't fill and going back left the view zoomed in and off-centre.

## Phase 2.2: second feedback round

| Request | Result |
|---|---|
| Full map closes on click outside; **M** toggles it (minimap toggle moved to **N**) | done |
| Character hidden north of a line across the map | **fixed**: characters drew under the ground when world y < −1000 px (north of Menara Mitraland). Avatars now draw at depth 500 000 + y |
| Slide along angled walls instead of stopping | done + unit-tested; the server path check also accepts straight diagonal slides |
| Manifest 2× base | `baseSenPerSec` 1 → 2 (RM 0.02/s at Lv 1, +RM 0.01/s per level). Stops while riding |
| Sharper map + characters on phones | the game canvas renders at device pixel ratio (up to 3×, capped at ~8.3 MP); map chunks at up to 2.5× |
| Harder car wash, at a car wash | **Kilat Car Wash** (−199, 117.5, ~60 m east of the Jobs Board). 3 stages graded on the server: 🧽 soap (3 stubborn bird-dropping spots need 14 scrubs), 🚿 rinse an 8×3 grid, ✨ polish timed shine marks. 55 s, pays up to RM 58.50 at Lv 1 |
| Everyone starts with a bicycle | 🚲 Basikal (290 px/s, walk grid: sidewalks/paths yes, highways no), hotbar slot 1 |
| Hotbar 1–0 | 10 slots, bottom centre. Vehicles hop on/off; cosmetics wear/take off. Bag → item → "Add to hotbar"; right-click / long-press clears. Saved in `players.hotbar_json` (migration 5). **Number keys use the hotbar; emotes are Q then a number; − is Manifest** |
| Chat middle-left, larger | done (15 px text, 440 px wide on desktop) |
| Delivery motorbike from the phone | replaced by Ronda rides in 2.3 |

## Phase 2.1: feedback fixes (map zoom, collision, Manifest, jobs board)

### How to test it
1. **Zoomable full map:** press **M** or tap the minimap. Use the mouse wheel, double-click, pinch, or the **+ / −**
   buttons; drag to pan; **📍** recentres on you. Street names appear once you zoom in past about 2×.
2. **North half no longer blocked:** walk north from Kota Bazaar towards The Strand. You can now cross where the
   DASH ramps run (see Decisions). If you still hit an invisible wall, tell me roughly where (a screenshot of the full
   map with the 📍 helps). Admins can jump around with `/tp <x> <y>` (tile coordinates).
3. **Smooth angled walls:** walk along a slanted building (e.g. the Strand Mall or the angled Mitraland blocks). You slide
   along the real edge instead of catching on a staircase.
4. **🧘 Manifest emote:** press **−** (the key after 0) or pick 🧘 on the emote wheel. Sit still: you earn
   **RM 0.01 per second** at Lv 1 (a small "+RM" floats up every second; the wallet updates every 10 s). Moving stops it.
5. **Bag → Skills tab:** upgrade Manifesting. Lv 2 costs RM 50 and doubles the rate; each level adds +RM 0.01/s, up to Lv 25.
6. **Jobs Board:** the job cards now show full-width text with the button beside it (or below on phones).

### What changed
- **Full map** (`client/src/ui/minimap.ts`): zoom/pan with wheel, buttons, double-click and pinch. Labels scale with zoom
  (districts → named buildings → streets → interactables).
- **Exact building collision** (`shared/src/map/collision.ts`): buildings block by their real OSM polygon (segment-vs-hitbox
  test through a spatial index), not by 2 m tiles. Water and highways still use tiles. Both server and client use the same
  code, so they agree.
- **Manifest** (`shared/config/skills.json`, `server/src/game/economyHandlers.ts`): server-timed. The server banks sen each
  second while you hold the emote and aren't moving, then pays it out every 10 s, when you stop, and on disconnect. Every
  payout is logged in `transactions` (reason `manifest`). The skill level is saved in `players.skills_json` (migration 4).
- **Jobs Board card layout** fixed (the button no longer squeezes the text into a 5-letter column).
- **Grass blotches** are placed on a world grid, so chunk edges no longer show faint square "boxes".
- **Admin `/tp <x> <y>`** (tile coordinates) for testing.
- **`npm run admin`**: list admins, promote/demote, reset a forgotten password.
- **Remote play:** the server labels ZeroTier/Tailscale addresses `Remote players:`. Setup steps are in the README
  ("Friends on a different WiFi").

---

## Phase 2: money, jobs and the gacha core

### How to test it (PC + phone)
1. `npm run dev`, then open the printed URL on the PC and the phone (see "How to test Phase 1" below for firewall/WiFi).
2. You spawn on the Dataran Sunway sidewalk with **RM 300**, shown under your name (tap it for the exact amount).
   Next to you are the **📋 Jobs Board**, **🎰 Capsule Machine** (Kedai Runcit), **🏪 Kedai Pajak Untung** (pawn shop),
   and across the lane the **🧧 Lucky Bag Stall**. The **🎁 Mall Mystery Box** is at Piramid Mall (south, ~200 m).
   Stand near one and press **E** (or the E button on the phone).
3. **Roll crates:** the panel shows every tier's chance and "1 in X", the pity counters and the item pool
   (silhouettes until found). Try ×1 (the reel) and ×5/×10 (the flip grid). Skip with the button.
4. **🎒 Bag (B):** tap an item and press **Wear** (hats, glasses, auras, wings/capes, name colours). The other device
   should see it on your character. The **Item Index** tab shows your collection; completing a crate's page pays
   50× its price (Capsule: RM 1,000).
5. **Kedai Pajak:** sell items (50% of value), scrap them into 💎 shards, or buy items you've discovered in the Shard Shop.
6. **Jobs Board → Car Wash:** drag over every brown dirt spot before time runs out (mouse or finger).
7. **Jobs Board → Delivery:** you hop on a kapcai. Follow the yellow arrow and marker to the shop (pickup is automatic
   when you arrive), then to the home before the timer runs out for a tip. Roads are fast, grass is slow, highways are
   rideable. Your friend sees you on the bike.
8. **Admin test commands** (the first registered account is admin): in chat type
   `/give me money 100000`, `/give me item halo rainbow`, `/give <name> shards 500`.
   Use these to try the Mall Mystery Box and to see a **Legendary+ announcement** banner (Divine/Secret get a
   fireworks takeover for everyone).
9. Refresh: money, items, what you're wearing and pity counters are all kept (they're saved instantly on the server).

### What was built
- **Wallet** in integer sen, short format on the HUD, floating "+RM" on earnings. Every change is logged in a
  `transactions` table inside one SQLite transaction; the in-memory player rolls back too if anything fails.
- **Rarities + luck** (`shared/src/luck.ts`): 8 tiers at the spec's odds, luck multiplies Rare+ then renormalises,
  sources multiply within a type and add across types, capped at 50×. Variants Shiny 1/20, Golden 1/100,
  Rainbow 1/1000. Limited items get serial numbers ("Durian King Crown #2 of 5"; Tan Sri's Songkok is 1 of 1).
- **3 crates** (`shared/config/crates.json`): Capsule Machine RM 20, Lucky Bag RM 150, Mall Mystery Box RM 1,500;
  ×1/×5/×10; pity (Epic+ every 50, Legendary+ every 300; Mall box 40/250). Rolls use `crypto.randomInt` on the
  server and only work when you're standing at the machine. Every roll is in `roll_log`; Legendary+ also in the server log.
- **48 items** (`shared/config/items.json`), all drawn in code: 17 hats, 5 face items, 6 auras (particle effects),
  6 back items (wings, cape, jetpack, backpack), 3 name colours, plus trinkets, furniture and boosters
  (usable in later phases).
- **The roll experience:** CS:GO reel with near misses and ticks, ×10 flip grid, rarity reveals (pop → purple flash
  → gold burst + screen shake → Mythic+ darkened slow-mo with light rays), WebAudio sounds, server-wide banners,
  and the Divine/Secret fireworks takeover.
- **Equipping** (hat, face, aura, back, name colour) is visible to everyone; Golden/Rainbow/Shiny change the look.
- **Item Index** with page rewards, **Kedai Pajak** (sell/scrap), **Shard Shop**.
- **Jobs:** Delivery Rider (real shop door → real home door, distance-based pay, time tips, the **first driveable
  vehicle**) and Car Wash Helper (server grades your raw strokes). Job levels raise pay by 8%/level.
- **Vehicles:** the server checks bike speed against a separate "drivable" collision grid (highways yes,
  buildings/water no). Flyovers are drivable; the client applies terrain speed (road 1.0×, grass 0.4×…).
- **Admin `/give`** (spec §17) for testing.

---

## Phase 1.5: what changed (and what to check)

### Real-scale map from OpenStreetMap
- The map is now built from **OpenStreetMap** at **2 m per tile**: **768 × 576 tiles ≈ 1.5 × 1.15 km**, covering
  The Strand, Dataran Sunway, Mitraland, Surian MRT / Ayu Mall, PJU 3 / Palm Spring, Taman Kota and Gugusan Dedap.
  The 2× map (512×384) would have cut off Surian MRT, so I went with your 3× size straight away.
- **Real roads:** lane counts from OSM (3.5 m lanes), sidewalks, lane markings (dashed lanes, centre lines), zebra
  crossings, street-name labels, underpasses and the Persiaran Surian bridge over the NKVE, the DASH and the elevated MRT.
- **Real buildings:** 714 OSM footprints (polygons) with roof colours, shadows scaled by height, south-facing facades
  with windows, rooftop AC units and skylights, and doors facing the street.
- **Fixed world origin = Menara Mitraland (tile 0,0).** Growing the map later only extends the bounds. Positions,
  building ids (= OSM ids) and future property ownership never move.
- **Terrain speeds** (`shared/config/terrain.json`) are ready for vehicles: road 1.0×, grass 0.4×, forest 0.25×,
  highway drive-only, buildings and water blocked.
- **Map data licence:** ODbL, with "© OpenStreetMap contributors" shown in-game (bottom-right and on the full map).
- Rendering is chunked (512 px pieces drawn on demand near the camera, old ones freed), so phones only hold what's nearby.

**Check:** walk from Dataran Sunway (spawn) to Menara Mitraland, across the bridge to PJU 3, and down to Surian MRT.
The full map (🗺️) shows the whole area with district names.

### Character polish (chibi, more detailed)
- **Hats are sized to the hair** and the hair under them is flattened: no more spikes, buns or quiffs poking through
  caps, beanies or songkok. Fringe, side hair, tails and braids still show.
- **Hair:** gradient shading, strand lines, shine highlight, and side locks that frame the face and cover the ears
  (this fixes the ear clipping).
- **Face/clothes:** soft shading, chin shadow, ear detail, upper eyelid lines, shading on tops.
- **Tudung side view:** a rounded face opening instead of the boxy look.

**Check:** ⚙️ Settings → Edit character, then try caps/beanie/songkok over spiky, afro, bun and long hair, and rotate the preview.

### Emotes v2 (detailed, spammable, continuous)
- **10 emotes, 4 animation frames each:** 👋 Wave, 💃 Dance ↻, 😂 Laugh, 😭 Cry ↻, 💪 Flex, 👏 Clap, 🎉 Cheer (jump),
  🤲 Salam, 🪑 Sit ↻, 💤 Sleep ↻.
- **Effects:** music notes (dance), falling tears (cry), Zzz (sleep), confetti (cheer), sparkles (flex, salam),
  clap burst, "HA HA", "Hi!". They respect ⚙️ Settings → Particles.
- **Spammable:** no cooldown, just a burst limit of 6 per 2 s (`chat.json → emoteRateLimit`). Spamming restarts the
  animation and fires new effects.
- **Continuous (↻):** dance, cry, sit and sleep loop until you walk, tap the same emote again, or pick another.
  The server remembers them, so players who join later still see you sitting or sleeping.
- **Controls:** keys **1–9, 0** fire emotes directly (no wheel needed). **Q** / 😀 toggles the wheel, which now
  stays open and doesn't block the screen, so you can keep tapping and walking. ✕ closes it.

**Check:** on the phone, open 😀 and tap Clap repeatedly, then Sit. Your friend should see you sitting, still see it
after they refresh, and see you stand up when you walk.

### One-time note
Accounts created before this update had positions on the old map, so they **spawn in Dataran Sunway once** on their
next login (the server logs `Placed <name> at a safe spot (map-version)`). Characters and accounts are kept.

### Map maintenance (optional, only if you want fresh OSM data)
```bash
npm run fetch-osm     # downloads OSM tiles into data-src/ (git-ignored, ~5 MB)
npm run import-map    # regenerates shared/map/kd.osm.json
npm run map-preview   # writes test-results/map-preview.png (the collision grid) to eyeball changes
npm test              # the map validator must stay green
```
Landmark parody names, districts and spawn live in `shared/map/town.overrides.json` (see `shared/map/README.md`).

---

## How to test Phase 1 on your PC and phone

### 1. Start the server

```bash
npm install        # first time only
npm run dev
```

The terminal prints something like:

```
  Kota Hustle server running (development)
  Local:            http://localhost:3003
  Players join at:  http://192.168.0.28:3003   (Ethernet)
  Also try:         http://172.28.x.x:3003     (ZeroTier One ...)
```

> **Port note for this PC:** other programs already use ports 3000–3002, so the server picks the next free port
> (it was **3003** when I tested). Use the port the terminal shows. To pin it, copy `.env.example` to `.env` and set
> `PORT=3010` (any free port).

### 2. Allow it through Windows Firewall (first run only)

Windows will pop up **"Windows Defender Firewall has blocked some features of Node.js"**. Tick **Private networks**,
then click **Allow access**. If you missed it, go to *Windows Security → Firewall & network protection → Allow an app
through firewall → Node.js JavaScript Runtime*, then tick **Private**.

### 3. Play on the PC

1. Open the **Local** URL (e.g. `http://localhost:3003`) in Chrome or Edge.
2. **Register** a username and password, then build a character in the creator. Try every tab, 🎲 Randomise, and
   the ⟲/⟳ rotate buttons. Press **Let's hustle →**.
3. You spawn in **Dataran Sunway Square**. Walk with **WASD / arrow keys**. Buildings, highways and water block you.

### 4. Join from your phone

1. Connect the phone to the **same router** as the PC. The PC is on Ethernet (192.168.0.x), so the phone's WiFi
   must be on that same 192.168.0.x network, not a guest network.
2. On the phone, open the **"Players join at"** URL (e.g. `http://192.168.0.28:3003`). Don't use `localhost` on the phone.
3. Register a **second** account and create a character.

### 5. Things to check (Phase 1 acceptance)

- [ ] Both players see each other and walk smoothly (PC: keyboard. Phone: the joystick, bottom-left).
- [ ] **Chat:** press **Enter** (or tap 💬), type, press Enter. The message shows in the chat log and as a bubble over your head.
- [ ] **Emotes:** press **1–9, 0** (or tap 😀). One-shots can be spammed; ↻ ones (dance, cry, sit, sleep) loop until you walk.
- [ ] **Minimap** (top-right): **M** toggles it. Tap it, or 🗺️, for the full map with district names.
- [ ] Walking into a new district shows a "📍 The Strand" style banner.
- [ ] Stand at a building door: the "E Enter …" prompt appears. Interiors come in later phases.
- [ ] **Refresh** the page: you auto-login at the same spot with the same look.
- [ ] ⚙️ **Settings → Log out**, then log back in: same spot, same look.
- [ ] Log into the **same account on the other device**: the first one shows "You logged in on another device."
- [ ] Walk around, wait about 60 s: a green **"Saved ✓"** chip appears. ⚙️ Settings shows "Last saved: N s ago".
- [ ] Press **Ctrl+C** in the server terminal: it prints `Saved N online player(s)`. Start it again and players come back where they were.
- [ ] `server/backups/` contains `game-YYYYMMDD-HHmmss.db` files (one per start, and every 6 h; newest 14 kept). `npm run backup` makes one on demand.

**Two accounts on one PC:** use a second browser or a private window, or add `?profile=2` to the URL
(e.g. `http://localhost:3003/?profile=2`) so that tab keeps its own login.

**Phone can't connect?** (1) Firewall (step 2). (2) The phone must be on the same network. (3) Some routers have
"AP / client isolation" turned on, which blocks device-to-device traffic. Turn it off or try another WiFi.
(4) Try the other URLs the server printed.

### Production mode

```bash
npm run build
npm start
```

---

## Phase 1: what was built

- **Monorepo** (npm workspaces): `shared/` (types, zod schemas, config, map builder, collision), `server/`, `client/`, `scripts/`.
- **Server**: Express + Socket.IO bound to `0.0.0.0`. Prints LAN URLs (Wi‑Fi/Ethernet first; VPN adapters as "Also try").
  In dev, Vite runs as Express middleware, so dev and prod both use **one port** (phones get hot reload too).
- **Auth** (§3): register/login with bcrypt (cost 10). 32-byte random session token in localStorage, stored server-side
  as SHA-256. Login rate limit 5/min per IP. One active session per account (new login kicks the old device after
  saving it). The first account (or `ADMIN_USERNAME`) is admin.
- **Character creator** (§4): every category at or above the minimum counts. 12 skin tones plus a picker, 6 face shapes,
  3 heights, 3 builds, 10 eyes plus colour, 6 brows, 6 noses, 8 mouths, blush/freckles/beauty mark, 5 glasses,
  23 hairstyles plus colour and highlight, 4 tudung styles, cap/backwards cap/beanie/songkok, 6 facial hair styles,
  9 tops, 6 bottoms and 5 shoes, each with a colour picker. Live preview walks and rotates through 4 directions, plus Randomise.
  The appearance is validated on the server against `shared/config/character.json`.
- **Character art**: drawn in code (Canvas 2D), chibi proportions, baked into a 28-frame spritesheet per look:
  idle/walk × front/back/side, plus 5 emotes.
- **Map** (§5): 256×192 tiles (8,192×6,144 px), authored as data in `shared/map/town.json` and centred on
  **Menara Mitraland**, cross-checked against the reference screenshots. 12 districts: Dataran Sunway, Surian MRT,
  The Strand, Mitraland & The Cascades, Taman Kenanga, Seksyen 6, Community Forest Reserve, Rymba Hills, PJU 3,
  Damansara Timur, Surian Selatan and Utama Greens. ~600 buildings, real road names, E31/AH2 highways with
  underpasses and pedestrian bridges, decor (trees, lamps, benches, cars, fountains, Jobs Board). Unit tests check that
  no building overlaps a road and that every door and district is reachable from spawn.
- **Movement**: WASD/arrows plus a virtual joystick. Client-predicted, axis-separated collision (slides along walls),
  sent at 15 Hz. The server validates speed (token-bucket budget) and walls, and snaps cheaters back. Camera follows
  with smoothing. Zoom adapts to the screen size.
- **Multiplayer**: 15 Hz snapshots, with remote players interpolated about 110 ms in the past. Join/leave/appearance updates.
- **Chat + bubbles + emotes**: global chat (rate limited, length capped, control chars stripped, rendered as text only),
  speech bubbles, an emote wheel with 5 emotes and cooldown.
- **Saving**: all 5 triggers (60 s dirty autosave, logout, disconnect, SIGINT/SIGTERM/SIGHUP/SIGBREAK, immediately after
  character save). Each save runs in one transaction. "Saved ✓" toast. "Last saved" in Settings.
- **Backups**: SQLite online backup at start, every 6 h and via `npm run backup`. Newest 14 kept.
- **Scripts**: `npm run seed` (tester1–4 / test123), `npm run sim` (stub until Phase 3), `npm run e2e`.

## Decisions

Simple options picked where the spec was open, per CLAUDE.md:

**Shared radio**
- **Your own music files, served by the game server** (Spotify can't be shared this way). Track lengths come from
  the first client that loads the file (no extra audio library on the server).
- A genre with one track restarts it on a skip.

**Phase 7a (casino)**
- **One slot machine type** (3 reels, bets scale with your stage) instead of separate 3-reel and 5-reel machines.
- **Shared rounds run all the time** (roulette every ~31 s, crash every ~15–60 s, the wheel every 2 minutes), even
  when nobody is watching; they're cheap.

**Phase 6b (loans)**
- **A loan day is an in-game day of play** (24 real minutes online). Nothing is charged while you're offline, so
  nobody loses their home while they sleep.
- **The bank and the Ah Long are phone apps** (online banking; Ah Long's number). Physical locations can come later.
- **Interest compounds daily on what you owe**; the instalment is set when you borrow so the loan is paid off in
  its term if you never miss.
- **The Ah Long income penalty** applies to homes (rent, Airbnb) and businesses, not food stalls.

**Phase 6a (businesses and the shop)**
- **No map locations yet:** businesses and the shop are run from the phone (📱 → Ventures). Placing them as
  buildings on the map can come with the boutique / mall work.
- **Unmanaged businesses hold one finished cycle** (AdVenture Capitalist style): you collect it and the next one
  starts. Managers pay continuously.
- **The shop sells only while you're online** (with a hired cashier); managed businesses also earn offline.

**Phase 5.8 (feedback fixes)**
- **Fair foot traffic** is a floor, not a cap: struggling and new stalls get lifted (0.9× base always, 2.4× base in
  a rush), while upgrades (signage, Kaki Promo) still pay off above that. The reputation swing is narrower too.
- **Passive Income now boosts rent and Airbnb** (multiplied with the new Property skills). Its description had
  promised this.
- **Off-screen culling** uses a 320 px margin around the view and re-checks every ~96 px of movement (or every
  0.5 s).

**Phase 5.7 (claiming homes)**
- **Claiming works through the existing property system** rather than as a separate one. "Claim" is a purchase at
  RM 0 for your first home, if its price is ≤ `properties.json → claim.firstFreeMaxSen` (RM 100,000). Stage
  requirements still apply: a studio needs stage 2, but a shoplot loft needs nothing, so a new player can claim one
  straight away. The limit is `claim.maxHomes` (3).
- **Free homes count as RM 0 in net worth** (bought price 0), so claiming can't push you up a wealth stage.
- **Building capacity by size only applies to shoplots** (`byKind.shoplot.perM2`). Flats and condos keep fixed unit
  counts so that unit ids people already own never disappear.
- A plain shoplot that used to open a generic walk-in room now opens the home panel instead.

**Phase 5.1**
- **Road rules for Ronda:** roads with 2+ lanes (and highways) mapped one-way are never ridden backwards; on two-way
  roads with room for two lanes the route runs down the middle of the LEFT half; multi-lane one-ways use the left
  lane; single-lane roads are fine both ways, down the middle (against the mapped direction costs 2.5× so it's only
  used when it saves a lot). A one-way road that leads nowhere (cut off by the map edge) can be ridden back out.
  Loose road ends within ~2 tiles of another road are joined. Bigger roads are slightly preferred.
- **When the road route is a silly detour** (one-way loops, roads that only connect outside the map), the ride takes
  the direct route instead: road route ≤ 2.2 × direct + 30 tiles (`rides.json → roadDetourMax`). On random trips
  across the whole map ~65% use the road route (more in town); routes are ~1.3× the direct length on average. The
  direct route now avoids sidewalks/paths/plazas where it can. "Too close to ride" uses the straight-line distance.
- **Doors:** E at a door still works on a keyboard (it does the same as walking in); the touch button is hidden at
  doors. Riding into a door says "hop off first".
- **Interior sizes:** 1.6 m of building per room tile, capped at 46 × 32 tiles; a style's own w × h is the minimum.
  Furniture is laid out in aisles either side of a walkway from the door; fountains only in big rooms.
- **Assemble step grading:** every wanted box and no wrong one = Perfect within `fastMs` (6.5 s, × equipment),
  Great if slower; ≥ 60% right (wrong taps subtract) = Good; else Miss. Customers order each in-stock add-on with
  `addonChance` (40%), up to `maxAddons` (2); add-ons promised to earlier customers in the queue are reserved.
  If an add-on runs out before cooking starts, it's dropped from the order (and the bill).
- **New stalls** start with 10 nasi lemak portions plus 4 ayam goreng and 4 paru, so add-ons show up right away.
- **Night look** is client-only; the server never sees it.
- **Bag groups:** there are no clothes/shoes items yet (outfits come from the character creator), so "Outfit" has
  Head, Face, Back, Aura and Name colour.

**Phase 5**
- **Which homes are for sale:** every condo building (12 units: studio / 2-bedroom / studio / 3-bedroom),
  terrace and semi-D on the map. The OSM data has no flats or bungalows here, so those types exist in config but
  aren't on sale. Unit ids are `<OSM building id>#<n>` (survive map changes, per rule 10).
- **Interiors are 1 m cells** (a studio is 7 × 6 m) so furniture sizes read naturally; they're not tied to the
  outside footprint.
- **Missing essentials** also subtract 0.5★ each (besides the 2.5★ cap), so adding one always shows a gain in the
  suggestions. The comfort target is 0.9 per m² (the six essentials alone shouldn't max comfort).
- **Rent and bookings run per in-game day** (24 real minutes); tenants apply per in-game hour. Running costs (tax +
  maintenance, 0.1% of the price a day) are never allowed to push your wallet below zero.
- **Store furniture isn't a collectible** (no Item Index page) and sells back at 50% like everything else; gacha
  furniture stays collectible.
- **Offline income** covers homes only for now (stalls close when you leave, as before). Lucky Spin always doubles
  it (spec: "watch a 10 s Lucky Spin to double it").
- **IKEJA** is the unnamed mall building `w1509727667` near Surian MRT.

**Phase 4.1 (feedback round)**
- **Interiors are a view, not a teleport:** while you're inside, your position in the town stays at the door (the
  server checks distances from there). Other players see you disappear and see you inside if they go in too.
  Shoplots without a business show an "empty unit" room; homes are locked unless you own them.
- **Outdoor things stay outdoors:** the Jobs Board (a noticeboard in the new square), the pasar malam stalls and the
  Lucky Bag stall.
- **NPC positions are a function of time** (shared route maths), so the server can check you're next to someone
  without streaming 14 NPCs. Errands aren't saved (dropped when you log out); one per NPC per 4 minutes.
- **Reconnect grace = 20 s** (`net.json`): the server saves at once on a drop but keeps you in the world; logging
  out still removes you immediately.
- **Night-skip vote:** "more than half" of players online (2 of 2, 2 of 3, 3 of 4); a lone player skips at once.
  The clock offset isn't saved across server restarts (same as `/time`).
- **Spawn** moved into Dataran Sunway Square (next to the Jobs Board). Spawn isn't a stable id, so that's allowed.

**Phase 4**
- See "Phase 4" above for the sim-driven tuning (hired cook 60% / 14 s).

**Phase 3**
- **Net worth = cash + what your items would fetch at the pawn shop** (50% of value), not the full value: rolling
  crates can't inflate net worth. Debt and property join it in later phases.
- **The wealth stage never goes down** (it's the highest stage reached), so spending never takes away unlocks.
- **Crate gates:** Lucky Bag needs stage 2 (spec: "Lucky Bag crates" unlock at stage 2), Mall Mystery Box needs stage 2
  and Level 5 (the spec doesn't place it; this makes "Reach Level 5" a goal). Existing players are re-checked on login.
- **Daily login day 7 = a free Mall Mystery Box roll** (spec says Strand Premium Crate, which doesn't exist yet).
- **The day resets at local midnight on the server PC** (it's in Malaysia). Login rewards and quests use it.
- **Potion timers pause while you're offline** (saved as time left). Drinking the same potion again adds its time,
  up to 60 minutes (`economy.json: potionMaxStackMin`). Different potions of the same kind multiply (2× and 5× luck = 10×).
- **Potions are consumables:** not in the Item Index, always for sale in the Shard Shop, sellable at the pawn shop
  for their fixed value. They come from rewards (goals, levels, login, quests, stages), not crates.
- **Titles only give a bonus while worn**; nothing is worn until you pick one. "Budak Baru" is everyone's starter title.
- **Quests are per player, picked at random** from those your stage allows, 3 per day. Progress is measured from the
  moment they're handed out, so yesterday's work doesn't count.
- **Hustle Path goals pay automatically** (with a toast); daily quests and the login reward are claimed with a button.
- **Pre-Phase-3 players get XP for their history** (from the roll log, job counts and the economy log), without the RM
  for those levels. Titles and goals they already qualify for pay out normally.
- **Weekly quests, achievements beyond titles, and server events** (Lucky Hour) are left for later phases
  (spec Phase 3 lists daily quests only; events are Phase 7).
- **×5/×10 rolls stay free for everyone** (the spec lists them as Rolling upgrades; taking them away from players who
  already use them felt bad). Rolling has Fast Hands and Auto-Roll instead.
- **Keys:** Tab or P opens the HustlePhone (spec §16). Settings: the ⚙️ button or 📱 → Settings. On narrow touch
  screens the 🗺️ button is hidden (tap the minimap).
- **The Property / Business / Banking skill branches** show as "coming" until those systems exist.

**Phase 2.3**
- **"Grab-like" is called Ronda** (Malay for cruising around): Grab is a real brand and the rules say parody names only.
- **Decks have no ramps:** a vehicle under an elevated road counts as being on it (road speed). Simpler than a second
  height layer, and it matches what you see (the deck is drawn on top).
- **Ronda is passenger-only:** you can't steer. Getting off early gives no refund. You can use Ronda during a
  delivery (it costs a fare but is faster than the bicycle). Not during a car wash.
- **The rider is drawn with a cap, not a helmet** (the character renderer has no helmet yet).
- **Delivery uses the bicycle** now that the rentable motorbike is gone. The motorbike stays in `vehicles.json` for
  when vehicles can be bought (a later phase).

**Phase 2.1**
- **The "invisible box above Kota Bazaar"** was the DASH ramps and links. OSM doesn't tag these ground-level carriageway
  segments as bridges, so they counted as an unwalkable highway band across the north half. They are now listed under
  `elevate` in `shared/map/town.overrides.json`: treated as elevated, they don't block the ground. Extend that list if
  another one turns up.
- **Polygon collision only for buildings.** Highways and water stay tile-based for now (cheap, and they are wide, so the
  2 m steps matter less). Roof-only parts (`building:part=roof`, canopies) never block.
- **Manifest pays 1 sen/s at Lv 1, +1 sen/s per level, max Lv 25 (RM 0.25/s ≈ RM 900/hour).** Upgrade cost =
  RM 50 × 1.6^(level−1), so reaching Lv 25 costs ~RM 6.6M in total. It's a small idle trickle, not a main income. All values are
  in `skills.json`. It stops while you move or ride; AFK-farming is intended and will be tuned by the Phase 3 simulator.
- **Payout every 10 s** (not every second) to keep the DB transaction log small. The client shows a local "+RM" each
  second for feel; only the server's payout counts.
- **Skills tab lives in the Bag** for now; it moves into the HustlePhone's Hustle Skills tree in Phase 3.

**Phase 2**
- **Luck is ×1 for now.** The formula and its tests exist; the sources (upgrades, potions, titles, events, index
  rewards) arrive in Phase 3. **×5/×10 are available to everyone** until the Hustle Skills tree can unlock them.
- **Crate places:** Capsule Machine at Kedai Runcit Pak Abu, Lucky Bag at a pasar malam stall on the grass verge
  next to spawn (the real pasar malam comes with Phase 4), Mall Mystery Box at Piramid Mall.
  You must stand within 8 tiles (16 m) to roll; the server checks.
- **Spawn moved 4 tiles east** so the Jobs Board, Capsule Machine and pawn shop are all within reach.
- **Each item belongs to exactly one crate.** Tiers a crate has no items for show "not in this crate" (0%), so
  the advertised odds are exactly what can drop. Capsule has no Divine/Secret; Lucky Bag has no Secret.
- **Item value = crate price × rarity factor × variant multiplier** (`rarities.json`). The pawn shop pays 50%, so the
  expected pawn value of a roll is below its price (house edge; a unit test checks this for every crate).
- **Item Index page reward = 50× crate price** (luck and title rewards in Phase 3).
- **Shard Shop** sells only items you've discovered, Common to Epic, never limited ones. Limited (serial-numbered)
  items can't be pawned or scrapped (they're trophies; trading comes in Phase 7).
- **Money is saved instantly** in DB transactions (not by the 60 s autosave), so a crash never loses a roll or a sale.
- **The delivery motorbike only exists during a delivery** (owning vehicles comes later). Bike speed 430 px/s
  ≈ 27 m/s on roads. The timer starts at pickup; arriving early gives up to a 60% tip, late pays 70%.
  Destinations are only doors a bike can actually reach.
- **Announcements wait 4.2 s** so the roller's reel finishes before everyone else sees the banner.
- **Trinkets, furniture and boosters** can be collected, sold and scrapped now; they become usable in their phases
  (boosters in Phase 4 stalls, furniture in Phase 5 Airbnbs).
- **Pets, outfits and emote packs** from the spec's crate highlights are deferred (pets need follow AI) and will join
  the pools in later phases without changing the odds format.
- `KH_TEST_ALL_ADMIN=1` makes every account an admin. It's only set by the automated tests, never in normal runs.

**Phase 1.5**
- **3× map size now (768×576 tiles at 2 m)** instead of 2×: at real scale the 2× map couldn't fit Surian MRT and the
  south of Dataran Sunway.
- **Origin = the actual Menara Mitraland building** (OSM way 1030583397, 3.15494 N, 101.597374 E).
- **The Phase 1 hand-drawn map is retired.** Districts are now The Strand, Dataran Sunway, Mitraland, Surian MRT &
  Ayu Mall, Taman Kota, Gugusan Dedap, PJU 3 & Palm Spring. The forest reserve and Rymba Hills come with the next
  map expansion.
- **Parody landmarks on real buildings:** Piramid Mall, Ayu Mall Damansara, The Strand Mall, Lucky Strand Casino,
  Gergasi Hypermarket, Mitraland Podium, Sunrise Medical Centre, Bank Kota, Kedai Runcit Pak Abu, The Cascades,
  Ant Palms A–F, Kota Bazaar.
- **Elevated roads** (DASH, flyovers) don't block the ground. Where a flyover passes over a highway it becomes a
  walkable bridge. Underpasses are kept as ground roads.
- **Walking speed unchanged** (≈ a jog at real scale). Crossing the map on foot takes about 2.5 minutes, which is
  intended, so vehicles matter later.
- **Trees:** OSM has almost no tree data here, so trees are placed by a deterministic pattern in parks, grass and
  forest. Canopies are semi-transparent so players under them stay visible.
- **The spawn fountain is removed for now** (on the real map it landed on a road). It comes back with a proper plaza.
- **The client gets the map as ~225 KB of JSON (~55 KB gzipped)** and builds the grid itself (~100 ms), using the same code as the server.

**Phase 1**

1. **Map follows the real geography in the screenshots.** The Strand sits directly **north** of Dataran Sunway
   (adjacent, not "~1 km away"), and Mitraland sits between Jalan PJU 5/1 and the AH2 highway at the **map centre**.
   Gergasi Hypermarket is in the Mitraland block, which satisfies "Mitraland next to the hypermarket".
2. **Parody names**: Piramid Mall (Giza-style), Ayu Mall Damansara (the mall by Surian MRT), Sunrise Medical Centre,
   Gergasi Hypermarket, Lucky Strand Casino, IKEJA, Empayar Damansara, Ant Palms condos, Utama Greens golf,
   Bank Kota, Kedai Runcit Pak Abu.
3. **Highways are not walkable.** Streets that cross them act as underpasses, and there are pedestrian bridges
   (E31 → forest, AH2 at Menara Mitraland and up north).
4. **Port fallback**: if `PORT` isn't set and 3000 is busy, the server tries 3001, 3002… A port only counts as free if
   0.0.0.0, 127.0.0.1 and ::1 are all free, because another program held 127.0.0.1:3001 on this PC. If `PORT` *is* set,
   it's used exactly or the server exits with a clear message.
5. **Dev server = Express + Vite middleware on one port** (no separate 5173 proxy).
6. **The client sends positions, not raw inputs**: the server validates them with a movement budget
   (walk speed × 1.3, at most 0.6 s banked, +24 px slack) plus an L-shaped wall check. Simpler than input replay and
   tight enough for LAN.
7. **Session tokens are stored hashed (SHA-256).** The newest connection wins: a second tab or device with the same
   account kicks the older one.
8. **Editing your character is free in Phase 1** (Settings → Edit character). It becomes the paid Salon/Boutique
   (money sink) once money exists.
9. **Trees are not solid.** Canopies draw above characters, so you walk "under" them. Decor placement is a
   deterministic hash, so every device shows the same trees.
10. **Only the tables Phase 1 needs** (`accounts`, `sessions`, `players`, `schema_migrations`). Later phases add numbered migrations.
11. **Chat history is in memory** (last 50 messages, sent on join), not persisted.
12. **Keys** (Phase 1): **Tab** opened Settings (since Phase 3 it opens the HustlePhone). **Q** opens the emote wheel and
    **1–5** pick an emote. **E** near a door shows "interiors open in a later phase".
13. **Portrait is fully playable.** "Rotate to landscape" is a dismissable hint.
14. **Level badge showed 1 and titles were empty** until Phase 3. The volume/particles settings are saved but there's no audio yet (Phase 8 sound pass).
15. **Usernames**: 3–16 chars `[A-Za-z0-9_]`, unique case-insensitively.
16. **`?profile=<name>` URL param** keeps a separate login per tab (testing convenience).

## Known issues / limitations

- **Phase 5.2:** the stock bar above the cooking screen still uses emoji; the trays and plate are drawn.

- **Phase 5.1:** lamp shadows near a map chunk's edge are cut off at the edge (chunks are drawn separately).
- **Phase 5.1:** about a third of Ronda trips (mostly at the map's edges, where roads only connect outside the
  map) still use the direct route, which can cross car parks.
- **Phase 5.1:** a big interior (mall, hypermarket) starts you at the door; the counters are at the far back wall,
  so you walk up to them. Tell me if you'd rather the counters were near the door.
- **Phase 5.1:** only the nasi lemak has add-ons so far; teh tarik and roti canai keep their old steps.

- **Phase 5:** furniture art is simple top-down shapes; decorate mode uses taps/clicks (no drag). On a phone, the
  decorate panel covers the lower part of the room; scroll it or tap ✅ Done to see the whole room.
- **Phase 4.1:** NPCs walk through each other and through players (no NPC collision). Their names are always shown.
- **Phase 4.1:** the title-screen character is your last-used look on this device (stored in the browser); a new
  device shows a default hustler until you log in once.
- **Phase 4.1:** the deck (flyover) layer fades as a whole while you're under any part of it.

- **Phase 3:** jobs alone take ~7–8 h to reach Stage 3 (target 2 h). Expected until stalls/property arrive; the sim
  flags it as ⏳ rather than a failure.
- **Phase 3:** the HUD luck readout and crate odds refresh when something changes (and every second for the HUD), so
  an open crate screen can show a potion's luck for up to a moment after it runs out. The server always uses the real value.
- **Phase 3:** the sim models the player's hands (job times, wash quality, choices). Tell me how long jobs really take
  you and I'll tune `HANDS` in `scripts/balance-sim.ts`.
- **Phase 3:** at midnight, quests and the daily reward refresh within a minute for players who are online.

- **Phase 2.3:** simplified Ronda routes can clip the corner of a building by up to ~1.5 m on tight turns (the
  passenger isn't collision-checked). If the pickup point is off-road, the first stretch goes straight to the nearest
  road.
- **Phase 2.3:** the phase 1 e2e test once failed to see player B still sitting after A reloaded, then passed on the
  next two runs. Possibly a timing issue in the test; I'll watch for it.
- **Phase 2.3:** the full map repaints the visible area on every pan/zoom step. Fine on PC; tell me if it stutters on
  your phone when zoomed out a lot.

- **Phase 2:** the economy isn't balanced yet. Phase 3's simulator will tune job pay and prices against the spec's
  pacing (Stage 2 in ~20 min). Right now a car wash pays ~RM 28–36 and a delivery ~RM 50–90.
- **Phase 2:** only the desktop and phone browser tests have exercised the reel and car wash. Please try the
  car wash with a finger on your phone and tell me if the dirt spots feel too small.
- **Phase 2:** a delivery that's in progress is cancelled if you disconnect (you get off the bike, no pay).

- **Phase 1.5:** chunk drawing is spread over frames (8 ms budget per frame), but on slow phones you may see the map
  fill in while walking fast. Tell me if it stutters and I'll move chunk drawing to a background worker.
- **Phase 1.5:** buildings cut off by the map edge have no door, and 7 inside the map have none because their OSM
  footprints overlap.
- **Phase 1.5:** characters are cartoon-sized compared with the real-scale roads (a person is about half a 2-lane road
  wide). This is intentional for the chibi style. Say if you want them smaller.

- **Dev only:** when `tsx watch` restarts the server after a code change on Windows, the process is killed without the
  graceful handler, so up to 60 s of movement can be lost. Ctrl+C and production are fine.
- Graceful shutdown on Ctrl+C is implemented and unit-tested at the `saveAll` level, but sending a real Ctrl+C can't be
  automated here. Please do the Ctrl+C check in the list above.
- Character **side view** is the weakest angle (thin arms; tudung side view looks a bit boxy). Polish later.
- Client bundle is ~1.4 MB (Phaser, ~385 KB gzipped). Fine on LAN; can code-split later.
- No building interiors yet (separate scenes come with shops/Airbnb in later phases). `scene` is already stored per player.
- Headless test browsers run Phaser at a low frame rate, so e2e movement checks use loose thresholds.

## Next: Phase 7 (casino and social economy)

From the spec (§20): Lucky Strand Casino, player-to-player trading, and the rest of the social economy.
