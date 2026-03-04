/**
 * Go Fish Game Engine
 *
 * RULES:
 *  - Standard 52-card deck. 7 cards dealt each (5 cards if 4+ players).
 *  - On your turn: ask any opponent for a specific rank you hold in your hand.
 *  - If opponent has it: they give you ALL cards of that rank. You go again.
 *  - If opponent has none: "Go Fish!" — draw one from deck. If drawn card matches
 *    the rank you asked for, you show it and go again; otherwise turn passes.
 *  - When you complete a set of 4 (a "book"), place it face-up immediately.
 *  - Game ends when deck is empty AND all players have no cards (all in books).
 *  - Winner = most books. Ties share the win.
 */

const SUITS_52 = ['♠', '♥', '♦', '♣'];
const RANKS_52 = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createFullDeck() {
  const deck = [];
  for (const suit of SUITS_52) {
    for (const rank of RANKS_52) {
      deck.push({
        id: `${rank}${suit}`,
        rank, suit,
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
  const handSize = players.length >= 4 ? 5 : 7;

  const gamePlayers = players.map(p => ({
    id: p.id,
    username: p.username,
    hand: deck.splice(0, handSize),
    books: [], // completed sets of 4
    isOut: false,
    place: null,
  }));

  // Check for any immediate books in starting hands
  gamePlayers.forEach(p => _checkBooks(p));

  return {
    players: gamePlayers,
    deck,
    currentIndex: 0,
    phase: 'ask',
    maxRounds: 500,  // safety valve — ends game by book count if exceeded       // 'ask' | 'gofish_draw' | 'finished'
    pendingAsk: null,   // { askerId, targetId, rank } — set when ask is made, waiting for result
    lastAction: null,   // description of last action for display
    goAgain: false,     // current player goes again
    finishOrder: [],
    round: 1,
    log: [],
  };
}

// ─────────────────────────────────────────────────────────
//  ACTIONS
// ─────────────────────────────────────────────────────────

/**
 * Ask an opponent for a rank.
 * askerId must hold at least one card of that rank.
 */
function askForCard(state, askerId, targetId, rank) {
  if (state.phase === 'finished') return { error: 'Game over' };
  if (state.phase !== 'ask') return { error: 'Not your turn to ask' };

  const current = state.players[state.currentIndex];
  if (current.id !== askerId) return { error: 'Not your turn' };

  const asker = state.players.find(p => p.id === askerId);
  const target = state.players.find(p => p.id === targetId);
  if (!asker) return { error: 'Asker not found' };
  if (!target) return { error: 'Target not found' };
  if (askerId === targetId) return { error: 'Cannot ask yourself' };
  if (target.isOut || target.hand.length === 0) return { error: 'That player has no cards' };

  // Must hold the rank you're asking for
  if (!asker.hand.some(c => c.rank === rank)) {
    return { error: `You must hold a ${rank} to ask for one` };
  }

  // Check if target has any of that rank
  const matching = target.hand.filter(c => c.rank === rank);

  if (matching.length > 0) {
    // Transfer all matching cards to asker
    target.hand = target.hand.filter(c => c.rank !== rank);
    asker.hand.push(...matching);
    state.log.push(`${asker.username} asked ${target.username} for ${rank}s — got ${matching.length}!`);

    // Auto-draw for target if they gave away their last card
    while (target.hand.length === 0 && state.deck.length > 0) {
      target.hand.push(state.deck.shift());
      state.log.push(`${target.username} draws to refill`);
      const b = _checkBooks(target);
      if (b) state.log.push(`${target.username} completes a book of ${b}s!`);
    }

    // Check for completed books in asker's hand
    let newBook = _checkBooks(asker);
    while (newBook) {
      state.log.push(`${asker.username} completes a book of ${newBook}s!`);
      newBook = _checkBooks(asker);
    }

    // Auto-draw for asker if hand is now empty but deck has cards
    while (asker.hand.length === 0 && state.deck.length > 0) {
      const drawn = state.deck.shift();
      asker.hand.push(drawn);
      state.log.push(`${asker.username} draws to refill hand`);
      const b = _checkBooks(asker);
      if (b) state.log.push(`${asker.username} completes a book of ${b}s!`);
    }

    // Check if game is over
    if (_checkFinished(state)) return { state, finished: true };

    // Check if asker is now out of cards (deck empty too)
    if (asker.hand.length === 0 && state.deck.length === 0) {
      _markOut(state, asker);
      if (_checkFinished(state)) return { state, finished: true };
      _nextTurn(state);
    } else {
      // Go again
      state.goAgain = true;
      // Stay in ask phase
    }
  } else {
    // Go Fish
    state.log.push(`${asker.username} asked ${target.username} for ${rank}s — Go Fish!`);
    state.pendingAsk = { askerId, rank };
    state.phase = 'gofish_draw';
  }

  state.round++;
  // Safety valve: if round limit exceeded, force end
  if (state.round > state.maxRounds && state.phase !== 'finished') {
    state.log.push('Round limit reached — ending game by book count');
    _endGame(state);
    return { state, finished: true };
  }
  return { state, finished: state.phase === 'finished' };
}

/**
 * Draw a card from the deck (the "Go Fish" draw).
 * Called by the asker after receiving a "Go Fish" response.
 */
function drawCard(state, playerId) {
  if (state.phase !== 'gofish_draw') return { error: 'Not the draw phase' };

  const current = state.players[state.currentIndex];
  if (current.id !== playerId) return { error: 'Not your turn to draw' };

  if (state.deck.length === 0) {
    // No cards to draw — just pass turn
    state.log.push(`${current.username} — deck empty, no card to fish!`);
    state.pendingAsk = null;
    state.phase = 'ask';
    _nextTurn(state);
    state.round++;
    return { state };
  }

  const drawn = state.deck.shift();
  current.hand.push(drawn);
  const askedRank = state.pendingAsk?.rank;

  state.log.push(`${current.username} fishes and draws ${drawn.id}`);

  // Lucky draw — drew the rank you asked for!
  if (drawn.rank === askedRank) {
    state.log.push(`${current.username} drew a ${askedRank} — go again!`);
    let b = _checkBooks(current);
    while (b) { state.log.push(`${current.username} completes a book of ${b}s!`); b = _checkBooks(current); }

    // Auto-draw if hand empty but deck has cards
    while (current.hand.length === 0 && state.deck.length > 0) {
      const d = state.deck.shift(); current.hand.push(d);
      const b2 = _checkBooks(current);
      if (b2) state.log.push(`${current.username} completes a book of ${b2}s!`);
    }

    state.pendingAsk = null;
    state.phase = 'ask';
    state.goAgain = true;

    if (_checkFinished(state)) return { state, finished: true };
  } else {
    // Regular draw — turn passes
    const b = _checkBooks(current);
    if (b) state.log.push(`${current.username} completes a book of ${b}s!`);

    // Auto-draw if hand empty but deck has cards
    while (current.hand.length === 0 && state.deck.length > 0) {
      const d = state.deck.shift(); current.hand.push(d);
      const b2 = _checkBooks(current);
      if (b2) state.log.push(`${current.username} completes a book of ${b2}s!`);
    }

    state.pendingAsk = null;
    state.phase = 'ask';

    if (_checkFinished(state)) return { state, finished: true };
    _nextTurn(state);
  }

  state.round++;
  return { state, finished: state.phase === 'finished' };
}

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────

/** Check for completed books in a player's hand, remove them, return rank if found */
function _checkBooks(player) {
  const counts = {};
  player.hand.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  for (const [rank, count] of Object.entries(counts)) {
    if (count >= 4) {
      const bookCards = player.hand.filter(c => c.rank === rank);
      player.hand = player.hand.filter(c => c.rank !== rank);
      player.books.push({ rank, cards: bookCards });
      return rank;
    }
  }
  return null;
}

function _markOut(state, player) {
  if (!player.isOut && player.hand.length === 0 && state.deck.length === 0) {
    player.isOut = true;
  }
}

/** Returns true if game is over (all books collected, or stalemate) */
function _checkFinished(state) {
  // Standard end: deck empty and all players have empty hands
  if (state.deck.length === 0) {
    const anyCards = state.players.some(p => !p.isOut && p.hand.length > 0);
    if (!anyCards) {
      return _endGame(state);
    }

    // Stalemate detection: deck is empty and no player holds 2+ of any rank
    // (no book can ever complete) — end the game early
    const anyProgress = state.players.some(p => {
      if (p.isOut) return false;
      const counts = {};
      p.hand.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
      // Check if any rank appears in multiple players hands combined
      return Object.values(counts).some(v => v >= 2);
    });

    // Also check cross-player: does anyone hold ≥2 of any rank across all hands?
    const globalCounts = {};
    state.players.forEach(p => {
      if (p.isOut) return;
      p.hand.forEach(c => { globalCounts[c.rank] = (globalCounts[c.rank] || 0) + 1; });
    });
    const canComplete = Object.values(globalCounts).some(v => v >= 4);

    if (!canComplete) {
      // No rank has 4 cards reachable — game cannot progress, end now
      state.log.push('No more books possible — game ends!');
      return _endGame(state);
    }
  }
  return false;
}

function _endGame(state) {
  state.phase = 'finished';
  const ranked = [...state.players].sort((a, b) => {
    const diff = b.books.length - a.books.length;
    return diff !== 0 ? diff : a.username.localeCompare(b.username);
  });
  ranked.forEach((p, i) => {
    p.isOut = true;
    p.place = i + 1;
    if (!state.finishOrder.includes(p.id)) state.finishOrder.push(p.id);
  });
  const winner = ranked[0];
  state.log.push(`Game over! ${winner.username} wins with ${winner.books.length} book${winner.books.length !== 1 ? 's' : ''}!`);
  return true;
}

function _nextTurn(state) {
  // Mark any handless players as out when deck is empty
  if (state.deck.length === 0) {
    state.players.forEach(p => _markOut(state, p));
  }

  const n = state.players.length;
  let next = (state.currentIndex + 1) % n;
  let safety = 0;
  while (safety++ < n) {
    const p = state.players[next];
    if (p.isOut || (state.deck.length === 0 && p.hand.length === 0)) {
      _markOut(state, p);
      next = (next + 1) % n;
      continue;
    }
    break;
  }
  state.currentIndex = next;
  state.goAgain = false;
}

// ─────────────────────────────────────────────────────────
//  VIEW
// ─────────────────────────────────────────────────────────
function getPlayerView(state, playerId) {
  const usernames = {};
  state.players.forEach(p => { usernames[p.id] = p.username; });

  return {
    phase: state.phase,
    round: state.round,
    deckCount: state.deck.length,
    currentIndex: state.currentIndex,
    pendingAsk: state.pendingAsk,
    goAgain: state.goAgain,
    finishOrder: state.finishOrder,
    log: state.log.slice(-10),
    usernames,
    players: state.players.map(p => ({
      id: p.id,
      username: p.username,
      isOut: p.isOut,
      place: p.place,
      handCount: p.hand.length,
      bookCount: p.books.length,
      books: p.books.map(b => b.rank), // ranks of completed books (visible to all)
      hand: p.id === playerId ? p.hand : undefined,
    })),
  };
}

module.exports = { initGame, askForCard, drawCard, getPlayerView };
