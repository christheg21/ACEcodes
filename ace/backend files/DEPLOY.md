# ACE — Deployment Guide

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — set DATABASE_URL and a strong JWT_SECRET

# 3. Run database migrations
npx prisma migrate deploy

# 4. Start server
npm start
# → http://localhost:4000
```

## Deploy to Railway (recommended, free tier available)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init          # name your project
railway add           # add PostgreSQL database
railway up            # deploy

# Railway sets DATABASE_URL automatically.
# Set JWT_SECRET in Railway dashboard → Variables:
#   JWT_SECRET = (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

## Deploy to Render (free tier available)

1. Push code to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your repo
4. Build command: `npm install && npx prisma generate`
5. Start command: `npx prisma migrate deploy && npm start`
6. Add environment variables:
   - `DATABASE_URL` — from a Render PostgreSQL database
   - `JWT_SECRET` — any long random string
   - `NODE_ENV=production`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWT tokens (min 32 chars) |
| `PORT` | optional | Server port (default: 4000) |
| `NODE_ENV` | optional | `production` or `development` |

## Generate a secure JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Database Schema

Run once on a fresh database:
```bash
npx prisma migrate deploy
```

This creates: `users`, `game_stats`, `matches`, `match_players` tables.
