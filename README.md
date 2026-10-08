# SeatPlan

A browser-based, top-view seating planner for any seated event: baptisms, weddings, anniversaries, corporate dinners. Draw the room, place tables, and drag guest names onto seats. Print a floor plan for the venue and an alphabetical list for the entrance. Nothing to install, no account.

The app runs entirely in the browser and can be hosted as static files, for example on GitHub Pages. Real-time collaboration through shared links is optional and needs the small sync server in [`server/`](server/).

## Features

**Room and tables**
- Pan and zoom with the mouse wheel, trackpad or pinch.
- Room outline, grid and snap to grid, each of which can be turned off.
- Round, rectangular, long (banquet) and Π-shaped tables. Banquet tables can have seats on one side or both. Π-shaped tables (a head table with two arms) can have seats outside only, or inside the arms and the head table as well.
- Seats are laid out automatically from the table shape and seat count.
- Move, rotate, resize, rename, duplicate and delete tables. New tables are placed where they don't overlap others.
- Labeled objects that have no seats: dance floor, buffet, stage, entrance, bar, DJ.

**Guests**
- Add guests one at a time, or paste a whole list: one name per line, or CSV/TSV with the columns name, group, child and note. English and Greek header rows are recognised.
- Optional group (family), child flag and note (for example "high chair" or "vegetarian").
- Search across names, groups and notes. Filter by All, Unseated or Seated, optionally grouped by family.
- Groups have colours, which also show on the seats.

**Seating**
- Drag a guest from the list onto a seat. On a tablet you can also tap a guest and then tap a seat.
- Drag from seat to seat to move someone. Dropping on a taken seat swaps the two guests.
- Drag a guest back onto the list to unseat them.
- Drag a group onto a table to fill its free seats in one step.
- A guest can only ever have one seat.
- Live counts of seated guests, free seats, and adults and children per table.

**Saving**
- Autosaves in the browser (IndexedDB). A refresh loses nothing, and it works offline.
- Export and import the whole plan as a JSON file.
- Undo and redo.

**Output**
- Floor plan as a PDF download or a printout.
- Alphabetical guest list with table numbers, for the entrance board. It is printed, or saved with the browser's "Save as PDF".
- List per table for the venue staff, also printed.
- Both lists can be downloaded as CSV.

**Language and devices**
- Greek and English interface. Names can be in any script.
- Works on computers and tablets. On phones the plan can be viewed but not edited.

**Live collaboration** (only with a sync server)
- **Share** creates two links: one that can edit and one that can only view. The server enforces view-only.
- Changes appear for everyone within about a second.
- You can see who is online, their cursors, and which table or guest they are dragging.
- Edits made offline are kept and merged when the connection comes back.
- Undo only reverses your own changes.
- If two people put different guests on the same seat at the same moment, the guest with the lower internal ID keeps it, the other returns to Unseated, and both people see a notice.
- **Stop sharing** deletes the plan from the server. Each browser keeps its own copy.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |
| Ctrl+D | Duplicate the selected table or object |
| Delete or Backspace | Delete the selected table or object |
| Esc | Clear the selection |

On macOS, use Cmd instead of Ctrl.

## How it works: local first, sharing opt-in

A plan starts and lives in the visitor's browser. Nothing is sent anywhere until the visitor clicks **Share**, and that button only appears when the site was built with a sync server address.

| Mode | Where the data lives | Server needed |
|---|---|---|
| Solo (default) | Browser only (IndexedDB) | No |
| Shared | Browser and a room on the sync server | Yes |

The plan is a [Yjs](https://yjs.dev) document (a CRDT), so concurrent and offline edits merge without conflicts, and undo can be limited to each user's own changes.

```
Browser                                 Sync server (optional)
┌──────────────────────────┐            ┌─────────────────────────┐
│ React UI + Konva canvas  │            │ WebSocket relay (Yjs)   │
│ Yjs document (plan)      │◄──────────►│ Room store (SQLite)     │
│ IndexedDB (local copy)   │  WSS       │ Token check, expiry job │
└──────────────────────────┘            └─────────────────────────┘
```

- Room IDs and tokens are random and unguessable. The edit token allows writes. The server ignores writes from view-only connections.
- Links have the form `#/r/<roomId>/edit/<token>` or `#/r/<roomId>/view/<token>`. Tokens sit in the URL fragment, which browsers never send to the static host.
- The server stores only SHA-256 hashes of tokens. It keeps the latest version of each room, so a link works even when nobody else is online.
- Presence (cursors and nicknames) is never stored.

## Privacy

- Solo plans never leave the browser.
- Shared plans, including guest names, are stored on the sync server. They are deleted on **Stop sharing**, and automatically 30 days after the last edit.
- A privacy notice is shown before the first share.
- No accounts and no analytics. The only things kept in the browser besides the plan are the chosen language, the nickname and cursor colour used when sharing, and the details of the browser's own shared room.

## Running locally

Requires Node.js 22.13 or newer. The server uses the built-in `node:sqlite`.

```bash
# client
cd client
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright); starts both servers. First run: npx playwright install chromium
npm run build      # static site in client/dist

# sync server (only needed for sharing)
cd server
npm install
npm run dev        # ws://localhost:1234
npm test           # unit and integration tests
npm run build && npm start   # production
```

In development the client always offers sharing and connects to `ws://<page host>:1234`.

## Deploying

### Client on GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the unit tests, builds the client, and publishes it on every push to `main`. It can also be started by hand from the **Actions** tab.

1. Push the repository to GitHub.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The site is published at `https://<user>.github.io/<repo>/`.

Without a sync server the site runs in solo mode. The Share button is hidden, and a shared link opens the visitor's own plan with a notice.

Pages on GitHub's free plan requires a public repository. Guest data is never part of the repository.

### Enabling sharing

GitHub Pages only serves files, so the sync server has to run elsewhere. Any host with Node 22.13+, a persistent disk for the SQLite file, and HTTPS will do.

1. Deploy `server/`, with `CORS_ORIGIN=https://<user>.github.io`.
2. In the repository, add a variable `VITE_SYNC_URL` under **Settings → Secrets and variables → Actions → Variables**. Set it to the server's address, for example `wss://sync.example.com`. It must be `wss://`, because a page served over HTTPS cannot connect to `ws://`.
3. Re-run the workflow.

### Configuration

Client, at build time:

| Variable | Meaning |
|---|---|
| `VITE_SYNC_URL` | WebSocket base URL of the sync server. The HTTP API address is derived from it. If it is unset, production builds have sharing turned off. |

Server, from environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `1234` / `0.0.0.0` | Address to listen on |
| `DB_PATH` | `./data/seatplan.sqlite` | SQLite file |
| `ROOM_TTL_DAYS` | `30` | Rooms are deleted this many days after the last edit |
| `CORS_ORIGIN` | `*` | Allowed client origins, comma-separated |
| `MAX_CLIENTS_PER_ROOM` | `50` | Connections allowed in one room at the same time |
| `MAX_ROOMS_PER_IP_PER_HOUR` | `30` | Limit on new rooms per network per hour |
| `MAX_MESSAGE_BYTES` | `2097152` | Largest WebSocket message accepted |

### Server API

| Endpoint | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Returns `roomId`, `editToken` and `viewToken`. |
| `DELETE /api/rooms/:id` | Stop sharing. Needs the edit token as `Authorization: Bearer <token>`. |
| `GET /api/rooms/:id/links` | Return the view token. Needs the edit token. |
| `GET /api/health` | Health check |
| `ws(s)://host/ws/:roomId?token=…` | Yjs sync and presence |

## Project structure

```
client/
  src/
    app/            # shell, routing, i18n, drag and drop, dialogs
    canvas/         # stage, tables, seats, objects, pan/zoom, inspector panel
    sidebar/        # guest list, groups, search, import
    toolbar/        # add table, undo/redo, share, export, print, settings
    presence/       # online list, cursors, drag highlights
    store/          # Yjs document, typed accessors, edit actions, session
    lib/
      geometry.ts   # seat layout per table shape, hit testing
      seating.ts    # assign, move, swap, fill group, conflict resolution
      sync.ts       # sync server address, room creation, links
      export.ts     # PDF, lists, CSV, JSON
      migrate.ts    # plan file validation and schema migrations
    locales/        # el.json, en.json
    types.ts
  e2e/              # Playwright: solo flow and two-browser sync
server/
  src/
    index.ts        # HTTP API and WebSocket server
    sync.ts         # Yjs sync protocol per room; drops writes from view-only connections
    rooms.ts        # create, load, save, delete (SQLite)
    auth.ts         # tokens and hashes
    expiry.ts       # scheduled cleanup
    config.ts       # environment variables
  test/             # tokens, storage, expiry, live sync
.github/workflows/
  pages.yml         # build and deploy the client to GitHub Pages
```

## Tech stack

| Concern | Choice |
|---|---|
| UI | React, TypeScript, Vite |
| Canvas | Konva (`react-konva`) |
| State and sync | Yjs, `y-indexeddb` in the browser, `y-websocket` client |
| Sync server | Node.js, `ws`, `y-protocols`, built-in `node:sqlite` |
| Export | `jspdf` for the floor plan, browser printing for the lists |
| i18n | `i18next` (Greek and English) |
| Tests | Vitest (seat logic, conflict rules, import, migrations, server); Playwright (end-to-end, including two-browser sync) |

## Data model

The logical shape of a plan, which is also the format of the exported JSON file. In the app it is stored as a Yjs document of maps keyed by ID.

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
  shape: "round" | "rect" | "banquet" | "u";   // "u" is Π-shaped
  x: number;
  y: number;
  rotation: number;                   // degrees
  width: number;                      // diameter for round
  height: number;
  seatCount: number;
  sides?: 1 | 2;                      // banquet: one or both long sides; Π: outside only, or outside and inside
  barWidth?: number;                  // Π only: depth of the head bar and the arms
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

- Seat positions are calculated from the shape and `seatCount`, never stored, so changing the seat count rearranges the seats.
- Assignments are keyed by guest, so a guest can never be in two seats, even when two people move the same guest at the same moment (the last change wins).
- When different guests land on the same seat at the same time, the lower guest ID keeps it. Every client reaches the same result.
- Assignments that point to a deleted table or a removed seat count as unseated.

## Not planned for v1

- Accounts, payments, RSVP collection, invitations.
- True-to-scale architectural floor plans. Sizes are approximate canvas units.
- Automatic seating optimisation.

## Roadmap

- Event presets (a wedding with a head table, a baptism, a conference) as starting layouts.
- "Keep together" and "keep apart" rules, with warnings.
- Suggested seating by group.
- Background image, to trace over a photo of the venue's floor plan.
- End-to-end encryption of shared rooms (the key in the URL fragment, with the server relaying data it cannot read).
- Version history and restore points.
- Place cards and table-number cards for printing.

## Open questions

- Should the shared-room expiry follow the event date instead of a fixed 30 days?
- Who is the data controller for shared rooms, and where should the server be hosted (the EU)?
- Are the default limits right for a public server without accounts (50 people per room, 30 new rooms per network per hour)?

## License

No license has been chosen yet. Until one is added, the code is not licensed for reuse.
