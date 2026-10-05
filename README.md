# SeatPlan (working name)

A browser-based, top-view 2D seating planner for any seated event: baptisms, weddings, anniversaries, corporate dinners. Draw the room, drop tables on a canvas, and drag guest names onto seats. Share a link and plan together in real time. No install, no account.

> Status: MVP built (milestones 1–7). The "Later" features are not built yet.

## Problem

Seating for a reception is usually planned on paper: a sketch of the tables and a guest list that gets erased and rewritten every time someone cancels or a family has to move. It is slow, hard to share, and easy to get wrong (a guest seated twice, or not at all).

## Goals

- Any visitor opens the URL and starts planning in under a minute, with no sign-up.
- Lay out tables on a top-view canvas that roughly matches the real room.
- Assign guests to seats by drag and drop, and always see who is still unseated.
- Several people edit the same plan at the same time through a shared link.
- Produce something printable for the venue and for the entrance board.
- Event-agnostic: nothing in the model is specific to one kind of event.

## Non-goals (v1)

- Accounts, payments, RSVP collection, invitations.
- True-to-scale architectural floor plans.
- Automatic seating optimization.

## Key design decision: local-first, collaboration opt-in

A plan starts and lives in the visitor's browser. Nothing is sent to a server until the visitor clicks **Share**. Sharing creates a room on a small sync server and returns two links: one that can edit, one that can only view.

| Mode | Where the data lives | Server needed |
|---|---|---|
| Solo (default) | Browser only (IndexedDB) | No |
| Shared | Browser + sync server room | Yes |

Consequences:

- The state layer is a CRDT (Yjs) from day one. Retrofitting one onto a plain store later means rewriting the store, undo, and persistence.
- Solo mode keeps working offline and keeps guest names off any server.
- Shared mode stores guest names (personal data) on the server, so rooms expire automatically (see Privacy).

## Features

### MVP

**Canvas**
- Pan and zoom (mouse wheel, pinch on touch).
- Optional room outline and grid with snap.
- Fixed non-seat objects: dance floor, buffet, stage, entrance (labeled rectangles).

**Tables**
- Shapes: round, rectangular, long/banquet (seats on one or both sides).
- Set seat count per table; seats are laid out automatically around the shape.
- Move, rotate, rename/number, duplicate, delete.

**Guests**
- Add one by one, or paste/import a list (one name per line, or CSV).
- Optional fields: group/family, child flag, note (e.g. high chair, dietary).
- Sidebar with search and an "Unseated" filter.

**Seating**
- Drag a guest from the sidebar to a seat.
- Drag seat to seat to move; dropping on an occupied seat swaps.
- Drag a group onto a table to fill its free seats in one action.
- A guest can occupy only one seat (enforced).
- Live counters: seated / total, free seats, adults / children per table.

**Persistence**
- Autosave to the browser.
- Export / import the plan as a JSON file.

**Live collaboration**
- **Share** button creates a room and two links: edit and view-only.
- Anyone with the edit link changes the plan; everyone sees changes within about a second.
- Presence: who is online (nickname + color), live cursors, and a highlight on the table or guest someone else is dragging.
- Offline edits are kept locally and merged on reconnect.
- Undo / redo affects only your own changes.
- "Stop sharing" deletes the room from the server; local copies remain.

**Output**
- Print / PDF of the floor plan.
- Alphabetical guest list with table number (for the entrance board).
- Per-table list (for the venue staff).

**Usability**
- Greek and English UI; full Unicode names.
- Usable on a tablet; phone is view-only in v1.

### Later

- Event presets (wedding with head table, baptism, conference) as starting layouts.
- Constraints: "keep together" / "keep apart", with warnings.
- Auto-suggest seating by group.
- Background image (trace over a venue floor plan photo).
- End-to-end encryption of shared rooms (key in the URL fragment, server relays opaque data).
- Version history / restore points.
- Place-card and table-number printing.

## User flow

1. Open the site; a blank room appears with a short hint.
2. Add tables from the toolbar and arrange them.
3. Paste the guest list into the sidebar.
4. Optional: click **Share** and send the edit link to a co-planner.
5. Drag guests (or whole families) to seats until "Unseated" is empty.
6. Export the PDF and the alphabetical list; send the view-only link to the venue.

## Data model

Logical shape of a plan. In the app it is stored as a Yjs document (maps keyed by ID), not as plain arrays.

```ts
type ID = string;

interface Plan {
  id: ID;
  name: string;                       // "Baptism reception"
  date?: string;                      // ISO date
  room: Room;
  tables: Record<ID, Table>;
  fixtures: Record<ID, Fixture>;
  guests: Record<ID, Guest>;
  groups: Record<ID, Group>;
  assignments: Record<ID, SeatRef>;   // guestId -> seat
  version: number;                    // schema version, for migrations
}

interface Room {
  width: number;                      // canvas units
  height: number;
  gridSize: number;
  snap: boolean;
  showGrid: boolean;
  showOutline: boolean;
}

interface Table {
  id: ID;
  label: string;                      // "Table 4"
  shape: "round" | "rect" | "banquet";
  x: number;
  y: number;
  rotation: number;                   // degrees
  width: number;                      // diameter for round
  height: number;
  seatCount: number;
  sides?: 1 | 2;                      // banquet only: seats on one or both long sides
}

interface SeatRef {
  tableId: ID;
  index: number;                      // position around the table
}

interface Guest {
  id: ID;
  name: string;
  groupId?: ID;
  isChild?: boolean;
  note?: string;
}

interface Group {
  id: ID;
  name: string;                       // "Papadopoulos family"
  color: string;
}

interface Fixture {
  id: ID;
  label: string;                      // "Dance floor"
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
```

Design notes:

- Seat positions are derived from shape and `seatCount`, never stored, so changing the seat count re-flows seats.
- Assignments are keyed by guest. A guest therefore can never be in two seats, even when two people move the same guest at the same moment (last write wins).
- Two people can still drop different guests on the same seat concurrently. After every merge a deterministic rule resolves it: the guest with the lower ID keeps the seat, the other returns to "Unseated", and both users see a notice.
- Assignments pointing to a deleted table or a removed seat index are treated as unseated.

## Architecture

```
Browser                                 Sync server
┌──────────────────────────┐            ┌─────────────────────────┐
│ React UI + Konva canvas  │            │ WebSocket relay (Yjs)   │
│ Yjs document (plan)      │◄──────────►│ Room store (SQLite)     │
│ IndexedDB (local copy)   │  WSS       │ Token check, expiry job │
└──────────────────────────┘            └─────────────────────────┘
```

- Room ID and tokens are random, unguessable strings. The edit token allows writes; the view token is read-only, enforced on the server.
- The server keeps the latest document per room so a link works when nobody else is online.
- Presence (cursors, nicknames) uses the Yjs awareness channel and is never persisted.

## Privacy

- Solo plans never leave the browser.
- Shared rooms hold guest names on the server. They are deleted on "Stop sharing" and automatically 30 days after the last edit.
- No analytics on plan content. No accounts, so no email addresses collected.
- A short privacy notice is shown the first time **Share** is clicked.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | React + TypeScript + Vite | Fast setup, static build |
| Canvas | Konva (`react-konva`) | Drag, rotate, hit-testing, and touch out of the box |
| State / sync | Yjs | Conflict-free merging, offline edits, per-user undo (`UndoManager`) |
| Local storage | `y-indexeddb` | Persists the Yjs document in the browser |
| Sync server | Node + a Yjs WebSocket server (`y-websocket` or Hocuspocus) | Relay, persistence, and auth hooks |
| Server storage | SQLite | One binary blob per room is enough |
| Export | Konva `toDataURL` + `jspdf` | Client-side PDF |
| i18n | `i18next` | el / en |
| Tests | Vitest + Playwright | Unit tests for seat logic and conflict rules; two-browser e2e for sync |
| Hosting | Static host for the client; one small VPS or container for the server | Client stays free to host |

## Structure

```
client/
  src/
    app/            # shell, routing, i18n setup
    canvas/         # Stage, Table, Seat, Fixture, grid, pan/zoom
    sidebar/        # guest list, groups, search, import
    toolbar/        # add table, undo/redo, export, share
    presence/       # cursors, online list, drag highlights
    store/          # Yjs document, typed accessors, selectors
    lib/
      geometry.ts   # seat layout per table shape
      seating.ts    # assign, move, swap, fill-group, conflict resolution
      sync.ts       # connect / disconnect, room creation, tokens
      export.ts     # PDF and list generation
      migrate.ts    # schema migrations
    locales/        # el.json, en.json
    types.ts
  e2e/              # Playwright: solo flow and two-browser sync
server/
  src/
    index.ts        # HTTP API + WebSocket server
    sync.ts         # Yjs sync protocol per room; drops writes from view-only connections
    rooms.ts        # create, load, save, delete
    auth.ts         # edit / view token check
    expiry.ts       # scheduled cleanup
    config.ts       # environment variables
  test/             # Vitest: tokens, storage, expiry, live sync
```

## Getting started

Requires Node.js 22.13 or newer (the server uses the built-in `node:sqlite`).

```bash
# client
cd client && npm install
npm run dev       # local dev server on http://localhost:5173
npm run test      # unit tests
npm run test:e2e  # end-to-end tests (starts both servers; first run: npx playwright install chromium)
npm run build     # static output in dist/

# server
cd server && npm install
npm run dev       # sync server on ws://localhost:1234
npm run test      # unit + integration tests
npm run build && npm start   # production
```

Solo mode needs only the client. Sharing needs the sync server.

### Deploy to GitHub Pages

`.github/workflows/pages.yml` tests, builds and publishes the client on every push to `main`.

1. Push the repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The site appears at `https://<user>.github.io/<repo>/`.

GitHub Pages hosts files only, so it cannot run the sync server. Without one, the site works in solo mode, the Share button is hidden, and shared links open the visitor's own plan with a notice. To turn sharing on:

1. Run the server on any host with Node 22.13+, a persistent disk and HTTPS, with `CORS_ORIGIN=https://<user>.github.io`.
2. Add the repository variable `VITE_SYNC_URL` (**Settings → Secrets and variables → Actions → Variables**) set to its `wss://` address. It must be `wss://`: an `https://` page cannot connect to `ws://`.
3. Re-run the workflow.

### Configuration

Client (build time): `VITE_SYNC_URL`, the WebSocket base URL of the sync server. Production builds without it have sharing turned off; the dev server defaults to `ws://<page host>:1234`. Use `wss://` in production; the HTTP API is derived from it.

Server (environment):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `1234` / `0.0.0.0` | Listen address |
| `DB_PATH` | `./data/seatplan.sqlite` | SQLite file |
| `ROOM_TTL_DAYS` | `30` | Delete rooms this long after the last edit |
| `CORS_ORIGIN` | `*` | Allowed client origins, comma-separated |
| `MAX_CLIENTS_PER_ROOM` | `50` | Simultaneous connections per room |
| `MAX_ROOMS_PER_IP_PER_HOUR` | `30` | Rate limit on room creation |
| `MAX_MESSAGE_BYTES` | `2097152` | Largest accepted WebSocket message |

Server API: `POST /api/rooms` creates a room; `DELETE /api/rooms/:id` (edit token as `Authorization: Bearer`) stops sharing; `GET /api/rooms/:id/links` (edit token) returns the view token; `GET /api/health`. Sync runs over `ws(s)://host/ws/:roomId?token=…`. The server stores only SHA-256 hashes of tokens; the view token is derived from the edit token.

Links have the form `#/r/<roomId>/edit/<token>` or `#/r/<roomId>/view/<token>`. Tokens are in the URL fragment, so the static host never receives them.

## Milestones

| # | Deliverable | Done when |
|---|---|---|
| 1 | Canvas with pan/zoom; add, move, rotate tables | A room with 10 tables can be laid out |
| 2 | Guest list, drag to seat, swap, unseated filter | Every guest can be seated without a duplicate |
| 3 | Yjs store, local persistence, JSON export/import, undo/redo | A refresh loses nothing |
| 4 | PDF floor plan + alphabetical list | The printout is usable at the venue |
| 5 | el/en, tablet polish | Solo mode is usable for a real event |
| 6 | Sync server, Share button, edit link | Two browsers edit one plan and converge |
| 7 | View-only link, presence, conflict notices, room expiry | Shared mode is safe to give to strangers |

Milestones 1-5 are a complete product on their own. 6-7 add the server.

## Open questions

- Is to-scale layout needed (real meters, minimum spacing between tables), or is an approximate sketch enough?
- Room limits: maximum guests, tables, and simultaneous editors per room, and rate limiting against abuse of a public, account-free server.
- Is 30 days the right expiry, or should it be tied to the event date?
- Who is the data controller for shared rooms, and where is the server hosted (EU)?

## License

TBD.
