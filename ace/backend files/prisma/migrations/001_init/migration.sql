-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "username_lower" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1200,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1200,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "room_id" TEXT,
    "room_name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_sec" INTEGER,
    "rounds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "elo_change" INTEGER NOT NULL DEFAULT 0,
    "elo_before" INTEGER NOT NULL,
    "elo_after" INTEGER NOT NULL,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_username_lower_key" ON "users"("username_lower");
CREATE UNIQUE INDEX "game_stats_user_id_game_key" ON "game_stats"("user_id", "game");
CREATE UNIQUE INDEX "match_players_match_id_user_id_key" ON "match_players"("match_id", "user_id");

-- AddForeignKey
ALTER TABLE "game_stats" ADD CONSTRAINT "game_stats_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey"
    FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
