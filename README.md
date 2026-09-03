# dbdiagram

A small DB schema diagramming tool: write DBML in a Monaco editor, see it rendered
live as a React Flow graph, save diagrams via a Go/SQLite backend.

This was extracted from a personal monorepo where it ran as one app among several
personally-hosted tools. **It is reference code, not a ready-to-run project** — it
hasn't been adapted to run standalone yet (no top-level scripts, no docker-compose,
no combined dev workflow). Treat it as a starting point to wire up on your own setup.

## Layout

- `frontend/` — Vite + React + TypeScript + Tailwind + reactflow + Monaco editor.
  Talks to the backend via relative `/api/diagrams` requests, so in dev you'll want
  a proxy (e.g. Vite's `server.proxy`) or a reverse proxy pointing `/api` at the
  backend port; in production put both behind the same origin (nginx/Caddy) or add
  CORS handling to the backend.
- `backend/` — Go HTTP API (`net/http`, stdlib router) backed by SQLite
  (`mattn/go-sqlite3`). CRUD over a single `diagrams` table. Listens on `$PORT`
  (default `8085`). Creates `diagrams.db` next to the binary on first run.
  `dbdiagram-api.service` is an example systemd unit — the `User`/paths are
  placeholders, fill in your own.

## Known rough edges from the extraction

- No root `package.json`/workspace — `frontend/` was pulled out of an npm
  workspaces monorepo, so run `npm install` / `npm run dev` from inside `frontend/`.
- The frontend previously had a `@mono/ui` shared-component dependency; it wasn't
  actually used by this app's source, so it's been dropped. Everything the UI needs
  lives in `frontend/src`.
- No CORS headers on the backend — fine when served from the same origin, will need
  `Access-Control-Allow-Origin` handling (or a proxy) otherwise.
- No auth on the backend API — anyone who can reach the port can read/write all
  diagrams. Add auth before exposing it beyond localhost.
