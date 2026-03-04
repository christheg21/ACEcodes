const { v4: uuidv4 } = require('uuid');

/**
 * Rooms are ephemeral — they live only while the server is running.
 * Game results are persisted to the database via userManager.recordMatchResults.
 * If you want persistent rooms (e.g. scheduled tournaments), move this to Redis.
 */
const rooms = new Map();

const GAME_CONFIGS = {
  durak:    { minPlayers: 2, maxPlayers: 6, label: 'Durak',    icon: '🃏' },
  shithead: { minPlayers: 2, maxPlayers: 5, label: 'Shithead', icon: '🤡' },
  gofish:   { minPlayers: 2, maxPlayers: 6, label: 'Go Fish',  icon: '🐟' },
};

function createRoom({ name, game, maxPlayers, mode, password, hostId, hostUsername }) {
  const config = GAME_CONFIGS[game];
  if (!config) throw new Error('Unknown game: ' + game);

  const id = uuidv4().slice(0, 8).toUpperCase();
  const room = {
    id,
    name,
    game,
    gameLabel: config.label,
    gameIcon:  config.icon,
    maxPlayers: Math.min(maxPlayers, config.maxPlayers),
    mode,
    hasPassword: !!password,
    password: password || null,
    hostId,
    hostUsername,
    players:    [],   // [{ id, username, socketId }]
    spectators: [],
    status: 'waiting',
    gameState: null,
    matchId: null,    // DB match id, set when game starts
    createdAt: Date.now(),
    chat: [],
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) { return rooms.get(id) || null; }
function deleteRoom(id) { rooms.delete(id); }
function listRooms() { return Array.from(rooms.values()).map(publicRoom); }

function addPlayerToRoom(roomId, player) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.players.length >= room.maxPlayers) return { error: 'Room is full' };
  if (room.status === 'playing') return { error: 'Game already in progress' };
  if (room.players.find(p => p.id === player.id)) return { error: 'Already in room' };
  room.players.push(player);
  return { room };
}

function removePlayerFromRoom(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players    = room.players.filter(p => p.id !== playerId);
  room.spectators = room.spectators.filter(p => p.id !== playerId);

  if (room.players.length === 0 && room.spectators.length === 0) {
    rooms.delete(roomId);
    return { deleted: true };
  }
  if (room.hostId === playerId && room.players.length > 0) {
    room.hostId       = room.players[0].id;
    room.hostUsername = room.players[0].username;
  }
  return { room };
}

function addChatMessage(roomId, { senderId, senderUsername, text }) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const msg = {
    id: uuidv4(),
    senderId,
    senderUsername,
    text: text.slice(0, 200),
    timestamp: Date.now(),
  };
  room.chat.push(msg);
  if (room.chat.length > 100) room.chat.shift();
  return msg;
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    game: room.game,
    gameLabel: room.gameLabel,
    gameIcon:  room.gameIcon,
    maxPlayers: room.maxPlayers,
    mode: room.mode,
    hasPassword: room.hasPassword,
    hostId: room.hostId,
    hostUsername: room.hostUsername,
    playerCount: room.players.length,
    players: room.players.map(p => ({ id: p.id, username: p.username })),
    status: room.status,
    createdAt: room.createdAt,
  };
}

module.exports = {
  createRoom, getRoom, deleteRoom, listRooms,
  addPlayerToRoom, removePlayerFromRoom,
  addChatMessage, publicRoom, GAME_CONFIGS,
};
