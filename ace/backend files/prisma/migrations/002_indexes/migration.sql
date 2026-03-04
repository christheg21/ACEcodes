-- Performance indexes for match history and leaderboard queries

-- match_players.user_id: used by getMatchHistory (WHERE user_id = ?)
CREATE INDEX IF NOT EXISTS "match_players_user_id_idx" ON "match_players"("user_id");

-- matches.finished_at: used by getMatchHistory ORDER BY match.finished_at DESC
CREATE INDEX IF NOT EXISTS "matches_finished_at_idx" ON "matches"("finished_at" DESC);

-- game_stats.elo: used by getLeaderboard ORDER BY elo DESC
CREATE INDEX IF NOT EXISTS "game_stats_elo_idx" ON "game_stats"("elo" DESC);

-- users.elo: used by overall leaderboard ORDER BY elo DESC
CREATE INDEX IF NOT EXISTS "users_elo_idx" ON "users"("elo" DESC);
