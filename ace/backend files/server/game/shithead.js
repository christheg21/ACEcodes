/**
 * Shithead (Shed) Game Engine
 *
 * RULES:
 *  - Standard 52-card deck. 3 face-down cards, 3 face-up cards, 3 hand cards per player.
 *  - Setup phase: each player may swap hand cards with their face-up cards.
 *  - Play phase: clockwise. On your turn, play a card >= pile top, or pick up pile.
 *  - Special cards:
 *      2  — resets pile (any card can be played next), does NOT skip turn
 *      7  — next player must play a 7 or lower
 *      8  — skip (next player's turn is skipped)
 *      10 — burns the pile (remove from game), same player goes again
 *  - Four-of-a-kind on top of the pile also burns the pile
 *  - When hand is empty, play from face-up cards; when those are gone, flip face-down (blind)
 *  - If a face-down card is unplayable, player must pick up the pile
 *  - Last player with cards = the Shithead (loses)
 *  - Winner = first to empty all three layers
 */

const SUITS_52 = ['♠', '♥', '♦', '♣'];
const RANKS_52 = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUES_52 = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

// Special card rules
const SPECIALS = { '2': 'reset', '7': 'low', '8': 'skip', '10': 'burn' };

function createFullDeck() {
  const deck = [];
  for (const suit of SUITS_52) {
    for (const rank of RANKS_52) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit,
        value: RANK_VALUES_52[rank],
        color: (suit === '♥' || suit === '♦') ? 'red' : 'black',
      });
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
function initGame(players) {
  const deck = shuffle(createFullDeck());
  let idx = 0;
  const take = (n) => deck.splice(idx, n); // idx always 0 since we splice

  const gamePlayers = players.map(p => {
    const faceDown = deck.splice(0, 3);
    const faceUp   = deck.splice(0, 3);
    const hand     = deck.splice(0, 3);
    return {
      id: p.id,
      username: p.username,
      hand,
      faceUp,
      faceDown,
      isOut: false,
      place: null,
    };
  });

  return {
    players: gamePlayers,
    deck,       // remaining draw pile (after dealing)
    pile: [],   // discard pile
    burnt: [],  // burnt cards (removed from game)
    currentIndex: 0,  // whose turn it is
    phase: 'setup',   // 'setup' | 'play' | 'finished'
    mustPlayLow: false,  // true after a 7 is played
    skipNext: false,     // true after an 8 is played
    finishOrder: [],
    round: 1,
    log: [],
    readyFlags: {}, // playerId → true once they've confirmed setup
  };
}

// ─────────────────────────────────────────────────────────
//  SETUP PHASE
// ─────────────────────────────────────────────────────────

/** Swap a hand card with a face-up card during setup */
function swapCard(state, playerId, handCardId, faceUpCardId) {
  if (state.phase !== 'setup') return { error: 'Not setup phase' };
  if (state.readyFlags[playerId]) return { error: 'Already confirmed ready' };

  const p = state.players.find(x => x.id === playerId);
  if (!p) return { error: 'Player not found' };

  const hIdx = p.hand.findIndex(c => c.id === handCardId);
  const fIdx = p.faceUp.findIndex(c => c.id === faceUpCardId);
  if (hIdx === -1) return { error: 'Hand card not found' };
  if (fIdx === -1) return { error: 'Face-up card not found' };

  // Swap
  [p.hand[hIdx], p.faceUp[fIdx]] = [p.faceUp[fIdx], p.hand[hIdx]];
  state.log.push(`${p.username} swapped cards`);
  return { state };
}

/** Mark player as ready — when all ready, game begins */
function confirmReady(state, playerId) {
  if (state.phase !== 'setup') return { error: 'Not setup phase' };
  const p = state.players.find(x => x.id === playerId);
  if (!p) return { error: 'Player not found' };

  state.readyFlags[playerId] = true;
  state.log.push(`${p.username} is ready`);

  // Check if all players are ready
  const allReady = state.players.every(p => state.readyFlags[p.id]);
  if (allReady) {
    state.phase = 'play';
    // Player with lowest non-special card in hand goes first
    _determineFirstPlayer(state);
    state.log.push('All players ready — game starts!');
  }
  return { state };
}

function _determineFirstPlayer(state) {
  let best = null, bestVal = Infinity, bestIdx = 0;
  state.players.forEach((p, i) => {
    p.hand.forEach(c => {
      if (c.rank !== '2' && c.value < bestVal) {
        bestVal = c.value; best = c; bestIdx = i;
      }
    });
  });
  state.currentIndex = bestIdx;
}

// ─────────────────────────────────────────────────────────
//  PLAY PHASE
// ─────────────────────────────────────────────────────────

/** Play one or more cards of the same rank from hand/faceUp/faceDown */
function playCards(state, playerId, cardIds) {
  if (state.phase !== 'play') return { error: 'Game not in play phase' };

  const currentPlayer = state.players[state.currentIndex];
  if (currentPlayer.id !== playerId) return { error: 'Not your turn' };

  if (!cardIds || cardIds.length === 0) return { error: 'Must play at least one card' };

  // Determine which layer the player is playing from
  const layer = _getActiveLayer(currentPlayer);
  if (!layer) return { error: 'No cards left to play' };

  // Validate all cards exist and are same rank
  const cards = [];
  for (const id of cardIds) {
    const card = layer.find(c => c.id === id);
    if (!card) return { error: `Card ${id} not in playable layer` };
    cards.push(card);
  }
  if (new Set(cards.map(c => c.rank)).size > 1) return { error: 'All played cards must be same rank' };

  // Face-down: can only play one at a time (blind)
  if (layer === currentPlayer.faceDown && cards.length > 1) {
    return { error: 'Can only play one face-down card at a time' };
  }

  const rank = cards[0].rank;

  // Check if play is valid
  const valid = _canPlay(state, rank);
  if (!valid) {
    // Face-down blind play: invalid = pick up pile + the card
    if (layer === currentPlayer.faceDown) {
      cards.forEach(c => {
        const ci = currentPlayer.faceDown.findIndex(x => x.id === c.id);
        if (ci !== -1) currentPlayer.faceDown.splice(ci, 1);
      });
      currentPlayer.hand.push(...cards, ...state.pile);
      state.pile = [];
      state.mustPlayLow = false;
      state.log.push(`${currentPlayer.username} flipped ${cards[0].id} — unplayable, picked up pile!`);
      _nextTurn(state, false);
      return { state };
    }
    return { error: `Cannot play ${rank} on top of ${_pileTopRank(state)}` };
  }

  // Remove cards from layer
  cards.forEach(c => {
    const ci = layer.findIndex(x => x.id === c.id);
    if (ci !== -1) layer.splice(ci, 1);
  });

  // Add to pile
  state.pile.push(...cards);
  state.log.push(`${currentPlayer.username} plays ${cards.map(c => c.id).join(', ')}`);

  // Draw back up to 3 from deck (hand layer only)
  if (layer === currentPlayer.hand) {
    while (currentPlayer.hand.length < 3 && state.deck.length > 0) {
      currentPlayer.hand.push(state.deck.shift());
    }
  }

  // Check for four-of-a-kind on top of pile → burn
  const topRankCount = state.pile.filter(c => c.rank === rank).length;
  const burned = rank === '10' || topRankCount >= 4;

  if (burned) {
    state.burnt.push(...state.pile);
    state.pile = [];
    state.mustPlayLow = false;
    state.skipNext = false;
    state.log.push(`${currentPlayer.username} burns the pile! 🔥`);
    // Same player goes again — unless they just finished
    _checkFinished(state, currentPlayer);
    if (state.phase === 'finished') return { state, finished: true };
    // If the burning player is now out, advance turn
    if (currentPlayer.isOut) _nextTurn(state, false);
    state.round++;
    return { state, finished: false };
  }

  // Apply special effects
  state.mustPlayLow = (rank === '7');
  state.skipNext    = (rank === '8');

  // Check if this player is done
  _checkFinished(state, currentPlayer);
  if (state.phase === 'finished') return { state, finished: true };

  _nextTurn(state, rank === '8');
  state.round++;
  return { state, finished: state.phase === 'finished' };
}

/** Pick up the entire pile (forfeit turn) */
function pickUpPile(state, playerId) {
  if (state.phase !== 'play') return { error: 'Game not in play phase' };
  const currentPlayer = state.players[state.currentIndex];
  if (currentPlayer.id !== playerId) return { error: 'Not your turn' };
  if (state.pile.length === 0) return { error: 'Pile is empty' };

  currentPlayer.hand.push(...state.pile);
  state.pile = [];
  state.mustPlayLow = false;
  state.log.push(`${currentPlayer.username} picks up the pile`);
  _nextTurn(state, false);
  state.round++;
  return { state };
}

// ─────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────

function _getActiveLayer(player) {
  if (player.hand.length > 0)    return player.hand;
  if (player.faceUp.length > 0)  return player.faceUp;
  if (player.faceDown.length > 0)return player.faceDown;
  return null;
}

function _pileTopRank(state) {
  // Find effective top (skip 8s looking for what matters)
  for (let i = state.pile.length - 1; i >= 0; i--) {
    if (state.pile[i].rank !== '8') return state.pile[i].rank;
  }
  return null;
}

function _canPlay(state, rank) {
  if (rank === '2' || rank === '10') return true; // always playable
  if (rank === '8') return true; // skip is always playable

  const topRank = _pileTopRank(state);
  if (topRank === null) return true; // empty pile, anything goes
  if (topRank === '2') return true;  // pile was reset

  const val = RANK_VALUES_52[rank];
  const topVal = RANK_VALUES_52[topRank];

  if (state.mustPlayLow) {
    // After 7: must play 7 or lower (or a 2/10)
    return val <= 7;
  }
  return val >= topVal;
}

function _nextTurn(state, skip) {
  const n = state.players.length;
  // Count active players first
  const activeCount = state.players.filter(p => !p.isOut).length;
  if (activeCount === 0) return; // game should already be finished
  let next = (state.currentIndex + 1) % n;
  if (skip) next = (next + 1) % n;
  // Skip finished players
  let safety = 0;
  while (state.players[next].isOut && safety++ < n * 2) next = (next + 1) % n;
  state.currentIndex = next;
}

function _checkFinished(state, player) {
  if (player.isOut) return;
  if (player.hand.length === 0 && player.faceUp.length === 0 && player.faceDown.length === 0) {
    player.isOut = true;
    player.place = state.finishOrder.length + 1;
    state.finishOrder.push(player.id);
    state.log.push(`${player.username} finishes in place ${player.place}!`);

    const active = state.players.filter(p => !p.isOut);
    if (active.length <= 1) {
      state.phase = 'finished';
      if (active.length === 1) {
        const sh = active[0];
        sh.isOut = true;
        sh.place = state.players.length;
        state.finishOrder.push(sh.id);
        state.log.push(`${sh.username} is the Shithead! 🤡`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
//  VIEW
// ─────────────────────────────────────────────────────────
function getPlayerView(state, playerId) {
  const usernames = {};
  state.players.forEach(p => { usernames[p.id] = p.username; });

  const pile = state.pile;
  const pileTop = pile.length > 0 ? pile[pile.length - 1] : null;
  const effectiveTop = _pileTopRank(state);

  return {
    phase: state.phase,
    round: state.round,
    deckCount: state.deck.length,
    pile: pile.slice(-4),    // only show top 4 for display
    pileCount: pile.length,
    pileTop,
    effectiveTopRank: effectiveTop,
    mustPlayLow: state.mustPlayLow,
    currentIndex: state.currentIndex,
    finishOrder: state.finishOrder,
    log: state.log.slice(-10),
    usernames,
    readyFlags: state.readyFlags,
    players: state.players.map(p => ({
      id: p.id,
      username: p.username,
      isOut: p.isOut,
      place: p.place,
      handCount: p.hand.length,
      faceUpCount: p.faceUp.length,
      faceDownCount: p.faceDown.length,
      // Own cards
      hand:     p.id === playerId ? p.hand     : undefined,
      faceUp:   p.id === playerId ? p.faceUp   : p.faceUp, // faceUp visible to all
      faceDown: p.id === playerId ? p.faceDown.map(c => ({ id: c.id, hidden: true })) : p.faceDown.map(() => ({ hidden: true })),
    })),
  };
}

module.exports = { initGame, swapCard, confirmReady, playCards, pickUpPile, getPlayerView };
