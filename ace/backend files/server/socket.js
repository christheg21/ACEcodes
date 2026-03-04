const { verifyToken, findUserById, createMatch, recordMatchResults } = require('./managers/userManager');
const {
  createRoom, getRoom, listRooms,
  addPlayerToRoom, removePlayerFromRoom,
  addChatMessage, publicRoom,
} = require('./managers/roomManager');
const { initGame: initDurak, attack, defend, takeCards, passTurn, getPlayerView: durakView } = require('./game/durak');
const { initGame: initShithead, swapCard, confirmReady, playCards, pickUpPile, getPlayerView: shitheadView } = require('./game/shithead');
const { initGame: initGoFish, askForCard, drawCard, getPlayerView: gofishView } = require('./game/gofish');

// Helper to get the right initGame and view function per game
function _gameEngine(game) {
  switch(game) {
    case 'durak':    return { init: initDurak,    view: durakView };
    case 'shithead': return { init: initShithead, view: shitheadView };
    case 'gofish':   return { init: initGoFish,   view: gofishView };
    default: return null;
  }
}

// socket.id → { userId, username, roomId }
const socketMeta = new Map();
// roomId → timer handle
const turnTimers = new Map();
const TURN_TIMEOUT_MS = 45000; // 45 seconds

function _startTurnTimer(io, room) {
  _clearTurnTimer(room.id);
  const handle = setTimeout(() => {
    if (!room.gameState || room.status !== 'playing') return;
    const state  = room.gameState;
    const game   = room.gameEngine || room.game;
    let result;

    if (game === 'durak') {
      const { takeCards, passTurn } = require('./game/durak');
      if (state.phase === 'defense') {
        const defender = state.players[state.defenderIndex];
        result = takeCards(state, defender.id);
        _addSystemChat(io, room, `${defender.username} ran out of time — took cards`);
      } else if (state.phase === 'attack' && state.table.length > 0 && state.table.every(s => s.defense)) {
        const attacker = state.players[state.attackerIndex];
        result = passTurn(state, attacker.id);
        _addSystemChat(io, room, `${attacker.username} took too long — ending attack`);
      } else {
        return;
      }

    } else if (game === 'shithead') {
      const { pickUpPile } = require('./game/shithead');
      if (state.phase !== 'play') return;
      const active = state.players[state.currentIndex];
      if (!active) return;
      if (state.pile?.length > 0) {
        result = pickUpPile(state, active.id);
        _addSystemChat(io, room, `${active.username} took too long — picks up pile`);
      } else {
        return; // Empty pile, nothing to auto-do
      }

    } else if (game === 'gofish') {
      const { askForCard, drawCard } = require('./game/gofish');
      const active = state.players[state.currentIndex];
      if (!active) return;
      if (state.phase === 'gofish_draw') {
        result = drawCard(state, active.id);
        _addSystemChat(io, room, `${active.username} took too long — auto-drawing`);
      } else if (state.phase === 'ask' && active.hand?.length > 0) {
        // Auto-ask a random opponent for the first rank in hand
        const rank = active.hand[0].rank;
        const opp  = state.players.find(p => p.id !== active.id && !p.isOut && p.handCount > 0);
        if (!opp) return;
        result = askForCard(state, active.id, opp.id, rank);
        _addSystemChat(io, room, `${active.username} took too long — auto-asking`);
      } else {
        return;
      }
    } else {
      return;
    }

    if (result && !result.error) {
      room.gameState = result.state;
      _broadcastGameState(io, room);
      if (result.finished) {
        room.status = 'finished';
        const finishOrder = result.state.finishOrder;
        const loserId = finishOrder[finishOrder.length - 1];
        io.to(room.id).emit('game:finished', {
          finishOrder,
          durak: loserId,
          durakName: result.state.usernames?.[loserId],
        });
        io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
        _clearTurnTimer(room.id);
      } else {
        _startTurnTimer(io, room);
      }
    }
  }, TURN_TIMEOUT_MS);
  turnTimers.set(room.id, { handle, startedAt: Date.now(), duration: TURN_TIMEOUT_MS });
}


// Cached platform stats — refreshed every 60s and on connect/disconnect
let _cachedStats = { totalPlayers: 0, totalGames: 0, lastFetched: 0 };
const STATS_TTL_MS = 60_000;

async function _broadcastStats(io) {
  const online = io.sockets.sockets.size;
  const now    = Date.now();
  if (now - _cachedStats.lastFetched > STATS_TTL_MS) {
    try {
      const prisma = require('./db');
      const [players, games] = await Promise.all([
        prisma.user.count(),
        prisma.match.count({ where: { finishedAt: { not: null } } }),
      ]);
      _cachedStats = { totalPlayers: players, totalGames: games, lastFetched: now };
    } catch { /* DB unavailable — use cached */ }
  }
  io.emit('server:stats', {
    online,
    totalPlayers: _cachedStats.totalPlayers,
    totalGames:   _cachedStats.totalGames,
  });
}

function _clearTurnTimer(roomId) {
  const t = turnTimers.get(roomId);
  if (t) { clearTimeout(t.handle); turnTimers.delete(roomId); }
}

function registerSocketHandlers(io) {

  // ── Auth middleware ──────────────────────────────────
  io.use(async (socket, next) => {
    const token   = socket.handshake.auth?.token;
    const guestId = socket.handshake.auth?.guestId; // stable guest ID from client localStorage

    if (!token) {
      // Guest: use provided guestId for continuity, or generate new one
      socket.userId   = null;
      socket.guestId  = guestId || `guest_${socket.id.slice(0, 8)}`;
      socket.username = `Guest_${socket.guestId.slice(-6)}`;
      return next();
    }
    const payload = verifyToken(token);
    if (!payload) return next(new Error('Invalid token'));
    const user = await findUserById(payload.id);
    if (!user) return next(new Error('User not found'));
    socket.userId   = user.id;
    socket.guestId  = null;
    socket.username = user.username;
    next();
  });

  io.on('connection', (socket) => {
    console.log(`[+] ${socket.username} (${socket.id})`);
    socketMeta.set(socket.id, { userId: socket.userId, username: socket.username, roomId: null });
    // Broadcast online count
    io.emit('server:stats', { online: io.sockets.sockets.size });

    // ── LOBBY ────────────────────────────────────────────
    socket.on('lobby:join', () => {
      socket.join('lobby');
      socket.emit('lobby:rooms', listRooms());
    });

    // ── ROOM: CREATE ─────────────────────────────────────
    socket.on('room:create', (data, cb) => {
      if (!socket.userId) return cb?.({ error: 'Must be logged in to create a room' });
      const { name, game, maxPlayers, mode, password } = data || {};
      const roomName = (name || `${socket.username}'s Room`).trim();
      if (roomName.length < 2) return cb?.({ error: 'Room name must be at least 2 characters' });
      try {
        const room = createRoom({
          name: roomName.slice(0, 40),
          game: game || 'durak',
          maxPlayers: maxPlayers || 4,
          mode: mode || 'casual',
          password: password || null,
          hostId: socket.userId,
          hostUsername: socket.username,
        });
        addPlayerToRoom(room.id, { id: socket.userId || socket.guestId || socket.id, username: socket.username, socketId: socket.id });
        _socketJoinRoom(socket, room.id);
        io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
        cb?.({ room: publicRoom(room), chat: [] });
      } catch (err) {
        cb?.({ error: err.message });
      }
    });

    // ── ROOM: JOIN ───────────────────────────────────────
    socket.on('room:join', (data, cb) => {
      const { roomId, password } = data || {};
      const room = getRoom(roomId?.toUpperCase());
      if (!room) return cb?.({ error: 'Room not found' });
      if (room.hasPassword && room.password !== password)
        return cb?.({ error: 'Wrong password' });

      const result = addPlayerToRoom(room.id, {
        id: socket.userId || socket.guestId || socket.id,
        username: socket.username,
        socketId: socket.id,
      });
      if (result.error) return cb?.({ error: result.error });

      _socketJoinRoom(socket, room.id);
      io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
      io.to(room.id).emit('room:playerJoined', { username: socket.username, room: publicRoom(room) });
      cb?.({ room: publicRoom(room), chat: room.chat });
    });

    // ── ROOM: LEAVE ──────────────────────────────────────
    socket.on('room:leave', () => _leaveRoom(socket, io));

    // ── ROOM: CHAT ───────────────────────────────────────
    socket.on('room:chat', (data) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return;
      const text = data?.text?.trim();
      if (!text) return;
      const msg = addChatMessage(meta.roomId, {
        senderId: socket.userId || socket.id,
        senderUsername: socket.username,
        text,
      });
      if (msg) io.to(meta.roomId).emit('room:chat', msg);
    });

    // ── GAME: START ──────────────────────────────────────
    socket.on('game:start', async (_, cb) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return cb?.({ error: 'Not in a room' });
      const room = getRoom(meta.roomId);
      if (!room)                          return cb?.({ error: 'Room not found' });
      if (room.hostId !== socket.userId)  return cb?.({ error: 'Only the host can start' });
      if (room.players.length < 2)        return cb?.({ error: 'Need at least 2 players to start' });
      if (room.status === 'playing')      return cb?.({ error: 'Game already in progress' });

      const engine = _gameEngine(room.game);
      if (!engine) return cb?.({ error: `${room.game} is not yet implemented` });

      room.status = 'playing';
      room.gameEngine = room.game; // remember which engine to use

      // Pass full { id, username } objects to initGame
      room.gameState = engine.init(room.players.map(p => ({ id: p.id, username: p.username })));

      // Persist match record to DB
      try {
        room.matchId = await createMatch({
          game: room.game,
          mode: room.mode,
          roomId: room.id,
          roomName: room.name,
        });
      } catch (err) {
        console.error('[game:start] DB createMatch failed:', err.message);
      }

      io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
      _addSystemChat(io, room, 'Game started! Good luck.');
      _broadcastGameState(io, room);
      _startTurnTimer(io, room);
      cb?.({ ok: true });
    });

    // ── GAME: ACTION ─────────────────────────────────────
    socket.on('game:action', async (data, cb) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return cb?.({ error: 'Not in a room' });
      const room = getRoom(meta.roomId);
      if (!room || room.status !== 'playing') return cb?.({ error: 'No active game' });

      const { type, cardId, cardIds, attackCardId, targetId, rank } = data || {};
      const playerId = socket.userId || socket.guestId || socket.id;  // stable across reconnects
      const gs = room.gameState;
      let result;

      const g = room.gameEngine || room.game;
      if (g === 'durak') {
        switch (type) {
          case 'attack':  result = attack(gs, playerId, cardId);               break;
          case 'defend':  result = defend(gs, playerId, attackCardId, cardId); break;
          case 'take':    result = takeCards(gs, playerId);                    break;
          case 'pass':    result = passTurn(gs, playerId);                     break;
          default:        return cb?.({ error: `Unknown action: ${type}` });
        }
      } else if (g === 'shithead') {
        switch (type) {
          case 'swap':    result = swapCard(gs, playerId, cardId, attackCardId); break; // reuse attackCardId as faceUpCardId
          case 'ready':   result = confirmReady(gs, playerId);                   break;
          case 'play':    result = playCards(gs, playerId, cardIds || [cardId]); break;
          case 'pickup':  result = pickUpPile(gs, playerId);                     break;
          default:        return cb?.({ error: `Unknown action: ${type}` });
        }
      } else if (g === 'gofish') {
        switch (type) {
          case 'ask':     result = askForCard(gs, playerId, targetId, rank);     break;
          case 'draw':    result = drawCard(gs, playerId);                        break;
          default:        return cb?.({ error: `Unknown action: ${type}` });
        }
      } else {
        return cb?.({ error: `Unknown game: ${g}` });
      }

      if (result.error) return cb?.({ error: result.error });

      room.gameState = result.state;
      _broadcastGameState(io, room);
      _startTurnTimer(io, room); // reset per-turn timer

      // Broadcast the last log line as a system chat message
      const lastLog = result.state.log[result.state.log.length - 1];
      if (lastLog) {
        const msg = addChatMessage(room.id, { senderId: 'system', senderUsername: 'Game', text: lastLog });
        if (msg) io.to(room.id).emit('room:chat', msg);
      }

      if (result.finished) {
        room.status = 'finished';
        const finishOrder = result.state.finishOrder;
        const durakId     = finishOrder[finishOrder.length - 1];
        const durakName   = room.gameState.usernames?.[durakId] || durakId;

        io.to(room.id).emit('game:finished', { finishOrder, durak: durakId, durakName });
        io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));

        await _recordAndBroadcastResults(io, room, finishOrder);
        _clearTurnTimer(room.id);
      }

      cb?.({ ok: true });
    });

    // ── ROOM: REJOIN (reconnect after drop) ─────────────
    socket.on('room:rejoin', (data, cb) => {
      const { roomId } = data || {};
      const room = getRoom(roomId?.toUpperCase());
      if (!room) return cb?.({ error: 'Room no longer exists' });

      const playerId = socket.userId || socket.guestId || socket.id;

      // Re-associate socket with room
      _socketJoinRoom(socket, room.id);

      // Update socketId in players list so broadcasts reach the new socket
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.socketId = socket.id;
      } else if (!room.spectators?.find(s => s.id === playerId)) {
        // Was a player but got pruned — try to re-add if room not full and not playing
        if (room.status !== 'playing' && room.players.length < room.maxPlayers) {
          addPlayerToRoom(room.id, { id: playerId, username: socket.username, socketId: socket.id });
          io.to(room.id).emit('room:playerJoined', { username: socket.username, room: publicRoom(room) });
        }
      }

      const gameInProgress = room.status === 'playing' && !!room.gameState;
      if (gameInProgress) {
        // Push their current game state immediately
        const engine = _gameEngine(room.gameEngine || room.game);
        const viewFn = engine?.view || durakView;
        socket.emit('game:state', viewFn(room.gameState, playerId));
      }

      io.to(room.id).emit('room:playerRejoined', { username: socket.username });
      cb?.({ room: publicRoom(room), chat: room.chat, gameInProgress });
    });

    // ── ROOM: SPECTATE ───────────────────────────────────
    socket.on('room:spectate', (data, cb) => {
      const { roomId } = data || {};
      const room = getRoom(roomId?.toUpperCase());
      if (!room) return cb?.({ error: 'Room not found' });

      const spectator = {
        id: socket.userId || socket.guestId || socket.id,
        username: socket.username,
        socketId: socket.id,
      };

      if (!room.spectators) room.spectators = [];
      if (!room.spectators.find(s => s.id === spectator.id)) {
        room.spectators.push(spectator);
      }

      _socketJoinRoom(socket, room.id);
      _addSystemChat(io, room, `${socket.username} is spectating`);
      cb?.({ room: publicRoom(room), chat: room.chat });
    });

    // ── ROOM: REQUEST STATE (spectators) ────────────────
    socket.on('room:requestState', (_, cb) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return cb?.({ error: 'Not in a room' });
      const room = getRoom(meta.roomId);
      if (!room || !room.gameState) return cb?.({ error: 'No active game' });

      const engine = _gameEngine(room.gameEngine || room.game);
      const viewFn = engine?.view || durakView;
      // Spectators get a view with __spectator__ id — no private hand info
      cb?.({ state: viewFn(room.gameState, '__spectator__') });
    });

    // ── GAME: REMATCH ─────────────────────────────────────
    socket.on('game:rematch', (_, cb) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return cb?.({ error: 'Not in a room' });
      const room = getRoom(meta.roomId);
      if (!room)                         return cb?.({ error: 'Room not found' });
      if (room.hostId !== socket.userId) return cb?.({ error: 'Only the host can start a rematch' });
      if (room.status === 'playing')     return cb?.({ error: 'Game still in progress' });

      // Reset room state — keep players, wipe game
      room.status     = 'waiting';
      room.gameState  = null;
      room.matchId    = null;
      room.gameEngine = null;
      _clearTurnTimer(room.id);

      io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
      io.to(room.id).emit('game:reset', { room: publicRoom(room) });
      _addSystemChat(io, room, `${socket.username} wants a rematch! Waiting for host to start…`);
      cb?.({ ok: true });
    });

    // ── DISCONNECT ───────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] ${socket.username} (${socket.id})`);
      _leaveRoom(socket, io);
      socketMeta.delete(socket.id);
      // Broadcast updated online count
      _broadcastStats(io);
    });
  });
}

// ── Helpers ──────────────────────────────────────────────


async function _recordAndBroadcastResults(io, room, finishOrder) {
  if (!room.matchId) return;
  try {
    const authPlayers = room.players.filter(p => p.id && p.id.length === 36); // UUID = real user
    const authIds = new Set(authPlayers.map(p => p.id));
    const results = finishOrder
      .filter(uid => authIds.has(uid))
      .map(uid => ({ userId: uid, place: finishOrder.indexOf(uid) + 1 }));
    if (results.length > 0) {
      const eloChanges = await recordMatchResults({
        matchId: room.matchId,
        game: room.game,
        mode: room.mode,
        results,
      });
      io.to(room.id).emit('game:eloUpdate', eloChanges);
    }
  } catch (err) {
    console.error('[recordMatchResults]', err.message);
  }
  room.matchId = null; // prevent double-recording
}

function _socketJoinRoom(socket, roomId) {
  const meta = socketMeta.get(socket.id);
  if (meta) meta.roomId = roomId;
  socket.join(roomId);
  socket.emit('room:joined', { roomId });
}


async function _handleMidGameDisconnect(io, room, playerId, username) {
  if (room.status !== 'playing' || !room.gameState) return;

  const game  = room.gameEngine || room.game;
  const state = room.gameState;

  // Find the player in the game state
  const playerIdx = state.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return; // not an active player (maybe a spectator)

  const activePlayers = state.players.filter(p => !p.isOut);
  if (activePlayers.length <= 2) {
    // Can't continue with < 2 active players — end the game
    state.phase = 'finished';
    // Mark disconnected player as last place
    const player = state.players[playerIdx];
    if (!player.isOut) {
      player.isOut  = true;
      player.place  = state.finishOrder.length + 1;
      state.finishOrder.push(player.id);
    }
    // Award remaining active players their place
    state.players.forEach(p => {
      if (!p.isOut) {
        p.isOut  = true;
        p.place  = 1;
        if (!state.finishOrder.includes(p.id)) state.finishOrder.unshift(p.id);
      }
    });

    room.status = 'finished';
    _clearTurnTimer(room.id);
    const finishOrder = state.finishOrder;
    const loserId     = finishOrder[finishOrder.length - 1];
    _addSystemChat(io, room, `${username} disconnected — game ended`);
    io.to(room.id).emit('game:finished', {
      finishOrder,
      durak: loserId,
      durakName: state.usernames?.[loserId],
    });
    io.to('lobby').emit('lobby:roomUpdated', publicRoom(room));
    await _recordAndBroadcastResults(io, room, finishOrder);
    return;
  }

  // Enough players remain — mark disconnected player as out,
  // skip their turn if it was theirs
  const player = state.players[playerIdx];
  player.isOut = true;
  player.place = state.finishOrder.length + 1;
  state.finishOrder.push(player.id);
  _addSystemChat(io, room, `${username} disconnected`);

  // Advance turn if it was their turn
  if (game === 'durak') {
    const isAttacker = state.attackerIndex === playerIdx;
    const isDefender = state.defenderIndex === playerIdx;
    if (isDefender && state.phase === 'defense') {
      // Disconnected defender — auto-take pile
      const { takeCards } = require('./game/durak');
      const r = takeCards(state, playerId);
      if (!r.error) { room.gameState = r.state; _broadcastGameState(io, room); _startTurnTimer(io, room); return; }
    } else if (isAttacker && state.phase === 'attack' && state.table.length === 0) {
      // Disconnected attacker hasn't played yet — skip their turn via passTurn
      const { passTurn } = require('./game/durak');
      const r = passTurn(state, playerId);
      if (!r.error) { room.gameState = r.state; _broadcastGameState(io, room); _startTurnTimer(io, room); return; }
    }
  } else if (game === 'shithead') {
    if (state.phase === 'play' && state.currentIndex === playerIdx) {
      // Find next non-out player
      const n = state.players.length;
      let next = (playerIdx + 1) % n;
      let safety = 0;
      while (state.players[next].isOut && safety++ < n) next = (next + 1) % n;
      state.currentIndex = next;
    }
  } else if (game === 'gofish') {
    if (state.currentIndex === playerIdx) {
      const n = state.players.length;
      let next = (playerIdx + 1) % n;
      let safety = 0;
      while ((state.players[next].isOut || state.players[next].hand?.length === 0) && safety++ < n)
        next = (next + 1) % n;
      state.currentIndex = next;
    }
  }

  _broadcastGameState(io, room);
  _startTurnTimer(io, room);
}

async function _leaveRoom(socket, io) {
  const meta = socketMeta.get(socket.id);
  if (!meta?.roomId) return;
  const roomId = meta.roomId;
  meta.roomId = null;
  socket.leave(roomId);
  const playerId = socket.userId || socket.guestId || socket.id;
  const room = getRoom(roomId);
  if (room) {
    // Handle mid-game departure before removing from room
    await _handleMidGameDisconnect(io, room, playerId, socket.username);
    room.spectators = (room.spectators || []).filter(s => s.id !== playerId);
  }
  const result = removePlayerFromRoom(roomId, playerId);
  socket.to(roomId).emit('room:playerLeft', { username: socket.username });
  if (result?.deleted) {
    _clearTurnTimer(roomId);
    io.to('lobby').emit('lobby:roomRemoved', { roomId });
  } else if (result?.room) {
    io.to('lobby').emit('lobby:roomUpdated', publicRoom(result.room));
  }
}

function _addSystemChat(io, room, text) {
  const msg = addChatMessage(room.id, { senderId: 'system', senderUsername: 'Game', text });
  if (msg) io.to(room.id).emit('room:chat', msg);
  return msg;
}

function _broadcastGameState(io, room) {
  const engine = _gameEngine(room.gameEngine || room.game);
  const viewFn  = engine?.view || durakView;
  const allSockets = [...io.sockets.sockets.values()];

  // Send personalised state to each player
  room.players.forEach(player => {
    const s = allSockets.find(
      s => s.userId === player.id || (!s.userId && s.guestId === player.id) || (!s.userId && s.id === player.id)
    );
    if (s) s.emit('game:state', viewFn(room.gameState, player.id));
  });

  // Send spectator view (no private hand info) to spectators
  if (room.spectators?.length) {
    const spectatorState = viewFn(room.gameState, '__spectator__');
    room.spectators.forEach(spec => {
      const s = allSockets.find(
        s => s.userId === spec.id || (!s.userId && s.guestId === spec.id) || (!s.userId && s.id === spec.id)
      );
      if (s) s.emit('game:state', spectatorState);
    });
  }
}

module.exports = { registerSocketHandlers };
