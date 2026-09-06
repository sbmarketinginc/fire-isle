# Fire Isle

A 3D, touch-first, multiplayer adaptation of the 1986 Milton Bradley board game *Fireball Island*,
playable in a mobile browser (installable as a PWA) or wrapped as a native app with Capacitor.

The island, trails, caves, bridges, smolder pits, fireball trailways, Vul-Kar, the jewel, the Magic
Charm tokens, and the 48-card deck follow the original rulebook; the engine enforces the rules, the
3D board is a replica of the vacuum-formed gameboard, and up to four players can play on one device
(pass-and-play) or online through the included server.

## Run it

```bash
npm install
npm run dev        # client on http://localhost:5173 (use the LAN URL on your phone)
npm run server     # multiplayer server on http://localhost:8787 (WebSocket at /ws)
npm test           # rules-engine tests, including random full games
npm run build      # production build into dist/
npm start          # build, then serve dist/ and the multiplayer server from one process
```

Open the game on your phone using the "Network" URL that Vite prints (same Wi-Fi). "Pass & Play"
needs no server. "Play Online" connects to the server on port 8787 in development, or to the same
host that served the page in production (set `VITE_SERVER_URL=wss://host/ws` at build time to
point elsewhere).

## Mobile packaging

* **PWA**: the app ships a manifest, icons and a service worker; on HTTPS it can be added to the
  home screen and runs full screen.
* **Native (Capacitor)**: `npm run cap:init` once, then `npm run cap:add:ios` / `npm run cap:add:android`,
  and `npm run cap:sync` after every web build. Xcode / Android Studio are needed for the final builds.

## How the rules are implemented

Everything in the rulebook is in `src/engine/`:

* **Board** (`board.ts`): Dead Man's Plateau, Witchlord Trail, Witchlord Step and the Ruin, Thunder
  Alley, Skeleton Head Beach, Low Road, High Road, Grim Gully, Great Sway Bluff (five spaces up
  from the water), the two bridges, Chasm Peak, Viper Pass, Dock Run, the Dock, Fireflash Chute,
  Vul-Kar Point, Blister Run, the six numbered caves (cave 4 is a dead end), dark trail spaces,
  the six smolder pits with their Rock Chip spaces, and the five fireballs with their trailways and
  rollways (Vul-Kar turns to face south, west, east or north-east).
* **Turns** (`game.ts`): roll and move the full count in any direction without revisiting a space,
  bump to the next open space, forced stops on empty bridges, cave entry with the second roll,
  cave declarations, rolling a 1 = roll a fireball (must hit a target if it can, even yourself),
  smolder-pit turn loss and Rock Chip re-entry, water penalty area and the bluff climb, Witchlord
  Step tokens (one per player, trade for a full hand), dark-space card draws with the 4-card limit,
  capture at Vul-Kar Point (full hand, free fireball, 3 turns in a row), stealing by passing the
  owner, jewel drops on Rock Chip spaces / bridges, jewel fitted into the token, first player by
  high roll, win by reaching the Dock with the jewel (no exact count).
* **Cards** (`cards.ts`): FIREBALL!, FAKE JEWEL!, CANCEL (stackable, never on a FIREBALL), MAGIC
  TALISMAN, REROLL, TAKE ANOTHER TURN, TAKE 1 CARD, MOVE AHEAD 4/5/6, MOVE ANY OPPONENT BACK 1/2/3,
  DOUBLE THE NEXT DIE ROLL, each with the rulebook timing (cards may be played during other
  players' turns; response windows let everyone react).

Digital interpretations worth knowing:

* The 1986 rulebook lists the card faces but not how many of each are printed. The deck here is
  48 cards with a reconstructed distribution (`DECK_COMPOSITION` in `cards.ts`); edit it if you
  have an original deck to count.
* "Move any opponent back": the player of the card picks the path, so the victim cannot turn the
  penalty into progress.
* DOUBLE applies to the next movement roll.
* Only the jewel owner may step onto the Dock.
* The capture bonus grants 3 full turns after the capturing turn. DOUBLE does not apply to a cave
  roll. A MOVE BACK penalty never awards a token or steals the jewel on the way. Any-time cards
  cannot interrupt a player who is picking a path or aiming a fireball. A piece fireballed on its
  own turn (into a pit or the water) forfeits the rest of that turn.
* Response windows for a fireball, a steal, a card play or a cave roll wait for everyone to pass,
  and idle players are passed after the same short delay every time, so nobody can tell from the
  timing whether an opponent is holding a TALISMAN, FAKE JEWEL, CANCEL or REROLL.
* Caves may be entered past an opponent standing on the entry space; an occupied cave cannot be
  entered. The Magic Charm token can be traded before rolling or after moving on your turn, and
  not while your hand is already full.
* Fireball rolls are resolved by trailway: every piece on the chosen trailway is hit, matching the
  rulebook's smolder-pit chart (Figure 6). Vul-Kar can face south (down Blister Run), west (over
  the bridge, down Viper Pass and Dock Run), east (up Fireflash Chute) or north-east (to Skeleton
  Head Beach) or south-west (down the painted lava channel to Witchlord Trail); the western Low
  Road stretch from the Grim Gully fork is out of reach, as on Figure 6. Vul-Kar's west roll is
  modelled as continuing along Viper Pass and Dock Run to the Dock; check that against a physical
  board if you have one.
* A piece fireballed during its own turn loses the rest of that turn, stands up on its next turn,
  and rolls out of the pit on the turn after.

## Project layout

```
src/engine/    rules engine (pure, deterministic, seeded RNG) + board data
src/client/    Three.js scene, procedural island terrain/texture, models, UI, sessions
server/        Node + ws multiplayer server (also serves dist/)
tests/         vitest rules tests
public/        PWA manifest, icons, service worker
```
