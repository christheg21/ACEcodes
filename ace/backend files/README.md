# 🂡 ACE — Online Card Games Backend

Node.js + Express + Socket.io + PostgreSQL backend for the ACE card games platform.

---

## Stack

| Layer      | Tech                          |
|------------|-------------------------------|
| Server     | Node.js + Express             |
| Realtime   | Socket.io (WebSockets)        |
| Auth       | JWT + bcryptjs                |
| Database   | PostgreSQL + Prisma ORM       |
| Game logic | Custom per-game engines       |

---

## Project Structure

```
ace/
├── prisma/
│   ├── schema.prisma             ← Database schema (User, Match, GameStat…)
│   └── migrations/001_init/     ← SQL migration
├── server/
│   ├── index.js                  ← Express + Socket.io entry point
│   ├── db.js                     ← Prisma client singleton
│   ├── socket.js                 ← All real-time event handlers
│   ├── routes/
│   │   ├── auth.js               ← register, login, /me, /history
│   │   └── lobby.js              ← rooms CRUD + leaderboard
│   ├── managers/
│   │   ├── userManager.js        ← DB-backed user/stats/ELO logic
│   │   └── roomManager.js        ← In-memory room store
│   ├── game/
│   │   ├── deck.js               ← Deck utilities
│   │   └── durak.js              ← Durak engine
│   └── middleware/
│       └── auth.js               ← JWT requireAuth middleware
├── public/
│   └── index.html                ← Frontend (served by Express)
├── .env.example
└── package.json
```

---

## Quick Start

### 1. Install PostgreSQL
```bash
# macOS
brew install postgresql@15 && brew services start postgresql@15

# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
```

### 2. Create the database
```bash
psql -U postgres -c "CREATE DATABASE ace;"
```

### 3. Clone & install
```bash
npm install
```

### 4. Configure environment
```bash
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET
```

### 5. Run migrations (creates all tables)
```bash
npm run db:migrate
# When prompted for a migration name, type: init
```

### 6. Start the server
```bash
npm run dev        # development (auto-restart)
npm start          # production
```

Server runs at **http://localhost:4000**

---

## Database Schema

```
users
  id, username, username_lower, password_hash
  games_played, wins, losses, elo
  → gameStats[], matchHistory[]

game_stats                          ← per-game ELO/W-L for each user
  userId, game, games_played, wins, losses, elo

matches                             ← one row per completed game
  id, game, mode, room_id, started_at, finished_at

match_players                       ← one row per player per match
  matchId, userId, place, elo_before, elo_after, elo_change
```

---

## REST API

### Auth
| Method | Endpoint              | Body / Query              | Auth? |
|--------|-----------------------|---------------------------|-------|
| POST   | /api/auth/register    | `{ username, password }`  | No    |
| POST   | /api/auth/login       | `{ username, password }`  | No    |
| GET    | /api/auth/me          | —                         | Yes   |
| GET    | /api/auth/history     | `?limit=20&offset=0`      | Yes   |

### Lobby
| Method | Endpoint                    | Description                     | Auth? |
|--------|-----------------------------|---------------------------------|-------|
| GET    | /api/lobby/rooms            | List rooms (`?game=&status=`)   | No    |
| GET    | /api/lobby/rooms/:id        | Single room                     | No    |
| POST   | /api/lobby/rooms            | Create room                     | Yes   |
| GET    | /api/lobby/games            | Available game configs          | No    |
| GET    | /api/lobby/leaderboard      | Top players (`?game=&limit=20`) | No    |

---

## Socket Events

### Client → Server
| Event          | Payload                                          |
|----------------|--------------------------------------------------|
| `lobby:join`   | —                                                |
| `room:create`  | `{ name, game, maxPlayers, mode, password? }`    |
| `room:join`    | `{ roomId, password? }`                          |
| `room:leave`   | —                                                |
| `room:chat`    | `{ text }`                                       |
| `game:start`   | —                                                |
| `game:action`  | `{ type, card, attackCard? }`                    |

### Server → Client
| Event               | Payload                              |
|---------------------|--------------------------------------|
| `lobby:rooms`       | `Room[]`                             |
| `lobby:roomUpdated` | `Room`                               |
| `lobby:roomRemoved` | `{ roomId }`                         |
| `room:joined`       | `{ roomId }`                         |
| `room:playerJoined` | `{ username }`                       |
| `room:playerLeft`   | `{ username }`                       |
| `room:chat`         | `{ senderUsername, text, … }`        |
| `game:state`        | Personalised game state              |
| `game:finished`     | `{ finishOrder, durak }`             |
| `game:eloUpdate`    | `{ [userId]: eloChange }`            |
| `error`             | `{ error }`                          |

---

## ELO Rating System

- Starting ELO: **1200**
- Only **ranked** games affect ELO
- Uses pairwise multi-player ELO — each player is compared against every other player individually, then changes are averaged
- K-factor: **32**
- Changes are broadcast to all players in the room via `game:eloUpdate` immediately after the game ends

---

## Deploying to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

railway login
railway init
railway add postgresql   # provisions a free Postgres DB
railway up               # deploy

# Set env vars in Railway dashboard:
#   JWT_SECRET=<your-secret>
#   NODE_ENV=production
# DATABASE_URL is set automatically by Railway
```

---

## Next Steps

1. **Shithead + Go Fish engines** — add to `server/game/`, wire in `socket.js`
2. **Turn timers** — server-side 30s countdown, auto-act on timeout
3. **Reconnection** — let disconnected players rejoin mid-game
4. **Spectator mode** — read-only game state for non-players
