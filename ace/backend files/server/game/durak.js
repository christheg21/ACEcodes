/**
 * Durak Game Engine — complete rule implementation
 *
 * RULES:
 *  - 36-card deck (6–A), 6 cards dealt to each player
 *  - Bottom card of deck = trump card; its suit is the trump suit
 *  - Turn structure: one attacker, one defender, others can "pile on" (add cards)
 *  - Attack: play any card if table is empty, or a card matching any rank on the table
 *  - Defend: beat an attack card with a higher card of the same suit, OR any trump
 *  - If defender takes all table cards → attacker stays, defender skips next turn
 *  - If all cards defended + attacker passes → table is discarded, defender becomes attacker
 *  - After each round, all players draw back up to 6 cards (attacker first, defender last)
 *  - When deck is empty, players who empty their hand finish in order (best = 1st)
 *  - Last player holding cards = the Durak (fool) — they lose
 *
 * BUGS FIXED vs previous version:
 *  - phase stays 'defense' after more attacks are added mid-defense (correct)
 *  - passTurn now also works when table is partially defended (pass remaining defense = take)
 *  - endRound correctly skips isOut players when advancing indices
 *  - players can finish (go out) as soon as their hand empties + deck is empty, even mid-round
 *  - getPlayerView includes username map so frontend can show names not just IDs
 */

const { createDeck, shuffle, deal, compareCards } = require('./deck');

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
function initGame(players) {
  // players: [{ id, username }]
  const deck = shuffle(createDeck());
  const trumpCard = deck[deck.length - 1]; // bottom card sets trump
  const trumpSuit = trumpCard.suit;

  const { hands, remaining } = deal(deck.slice(0, deck.length - 1), players.length, 6);
  remaining.push(trumpCard); // put trump back at bottom of draw pile

  // First attacker = player with lowest-value trump card in hand
  let firstAttacker = 0;
  let lowestTrumpVal = Infinity;
  hands.forEach((hand, i) => {
    hand.filter(c => c.suit === trumpSuit).forEach(c => {
      if (c.value < lowestTrumpVal) { lowestTrumpVal = c.value; firstAttacker = i; }
    });
  });

  return {
    players: players.map((p, i) => ({
      id: p.id,
      username: p.username,
      hand: hands[i],
      isOut: false,
      place: null,
    })),
    deck: remaining,
    trumpSuit,
    trumpCard,
    attackerIndex: firstAttacker,
    defenderIndex: nextActive(players.map(() => ({ isOut: false })), firstAttacker),
    // table: array of { attack: Card, defense: Card|null }
    table: [],
    // 'attack'  — attacker (and pile-ons) can play cards
    // 'defense' — defender must respond to at least one undefended card
    // 'finished'
    phase: 'attack',
    finishOrder: [], // player ids in finishing order (1st = best)
    round: 1,
    log: [],
  };
}

// ─────────────────────────────────────────────────────────
//  ACTIONS
// ─────────────────────────────────────────────────────────

/** Attacker (or pile-on player) plays a card onto the table */
function attack(state, attackerId, cardId) {
  if (state.phase === 'finished') return { error: 'Game is over' };

  const attacker = state.players[state.attackerIndex];
  // Allow the attacker OR any non-defender active player to pile on
  const actingPlayer = state.players.find(p => p.id === attackerId && !p.isOut);
  if (!actingPlayer) return { error: 'Player not found or already finished' };

  const defender = state.players[state.defenderIndex];
  if (actingPlayer.id === defender.id) return { error: 'Defender cannot attack' };

  if (state.phase !== 'attack') return { error: 'Not the attack phase — defender must respond first' };

  const cardIdx = actingPlayer.hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return { error: 'Card not in your hand' };
  const card = actingPlayer.hand[cardIdx];

  // Max 6 attack cards total; can't exceed defender's hand size
  if (state.table.length >= 6) return { error: 'Maximum 6 cards on the table at once' };
  const undefended = state.table.filter(s => !s.defense).length;
  if (undefended >= defender.hand.length)
    return { error: `Defender only has ${defender.hand.length} card(s) left` };

  // Must match an existing rank on the table (unless table is empty)
  if (state.table.length > 0) {
    const tableRanks = new Set(state.table.flatMap(s =>
      [s.attack.rank, s.defense?.rank].filter(Boolean)
    ));
    if (!tableRanks.has(card.rank))
      return { error: `Must play a card matching a rank already on the table (${[...tableRanks].join(', ')})` };
  }

  actingPlayer.hand.splice(cardIdx, 1);
  state.table.push({ attack: card, defense: null });
  state.phase = 'defense'; // defender must now respond
  state.log.push(`${actingPlayer.username} attacks with ${card.id}`);

  // Check if attacker just ran out mid-attack (deck empty)
  _checkFinished(state, actingPlayer);

  return { state };
}

/** Defender plays a card to beat one attack card */
function defend(state, defenderId, attackCardId, defenseCardId) {
  if (state.phase === 'finished') return { error: 'Game is over' };
  if (state.phase !== 'defense') return { error: 'Not the defense phase' };

  const defender = state.players[state.defenderIndex];
  if (defender.id !== defenderId) return { error: 'It is not your turn to defend' };

  const slot = state.table.find(s => s.attack.id === attackCardId && !s.defense);
  if (!slot) return { error: 'That attack card is not on the table or is already defended' };

  const defCardIdx = defender.hand.findIndex(c => c.id === defenseCardId);
  if (defCardIdx === -1) return { error: 'Defense card not in your hand' };
  const defCard = defender.hand[defCardIdx];

  const cmp = compareCards(defCard, slot.attack, state.trumpSuit);
  if (cmp <= 0)
    return { error: `${defCard.id} cannot beat ${slot.attack.id}` };

  defender.hand.splice(defCardIdx, 1);
  slot.defense = defCard;
  state.log.push(`${defender.username} defends ${slot.attack.id} with ${defCard.id}`);

  // If all table cards are defended, switch back to attack phase
  // (attacker can add more cards or pass)
  const allDefended = state.table.every(s => s.defense);
  if (allDefended) state.phase = 'attack';

  _checkFinished(state, defender);

  return { state };
}

/** Defender gives up — takes all table cards */
function takeCards(state, defenderId) {
  if (state.phase === 'finished') return { error: 'Game is over' };

  const defender = state.players[state.defenderIndex];
  if (defender.id !== defenderId) return { error: 'Only the defender can take cards' };
  if (state.table.length === 0) return { error: 'Nothing on the table' };

  const allCards = state.table.flatMap(s => [s.attack, s.defense].filter(Boolean));
  defender.hand.push(...allCards);
  state.table = [];
  state.log.push(`${defender.username} takes the cards`);

  return _endRound(state, true /* defenderTookCards */);
}

/** Attacker ends the attack — all defended cards are discarded */
function passTurn(state, attackerId) {
  if (state.phase === 'finished') return { error: 'Game is over' };
  if (state.phase !== 'attack') return { error: 'Cannot pass while defender still needs to respond' };

  const attacker = state.players[state.attackerIndex];
  // Any non-defender player can call pass (including a player who just went out this round)
  const actingPlayer = state.players.find(p => p.id === attackerId);
  if (!actingPlayer) return { error: 'Player not found' };
  if (actingPlayer.id === state.players[state.defenderIndex].id)
    return { error: 'Defender cannot pass' };

  if (state.table.length === 0) return { error: 'Play at least one card before passing' };
  if (state.table.some(s => !s.defense)) return { error: 'All attack cards must be defended before you can pass' };

  state.log.push(`${attacker.username} ends attack — defender wins round`);
  state.table = []; // discard defended cards
  return _endRound(state, false /* defenderTookCards */);
}

// ─────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────

/** Mark a player as finished if their hand is empty and the deck is empty */
function _checkFinished(state, player) {
  if (player.isOut) return;
  if (player.hand.length === 0 && state.deck.length === 0) {
    player.isOut = true;
    player.place = state.finishOrder.length + 1;
    state.finishOrder.push(player.id);
    state.log.push(`${player.username} finishes in place ${player.place}!`);
  }
}

/** Advance to next round after a take or a successful defense */
function _endRound(state, defenderTookCards) {
  // 1. Refill hands to 6: attacker first, clockwise, defender last
  const refillOrder = _clockwiseFrom(state, state.attackerIndex, /* skipDefender */ true);
  refillOrder.push(state.defenderIndex); // defender refills last

  for (const idx of refillOrder) {
    const p = state.players[idx];
    if (p.isOut) continue;
    while (p.hand.length < 6 && state.deck.length > 0) {
      p.hand.push(state.deck.shift());
    }
    _checkFinished(state, p);
  }

  // Also check players NOT in refillOrder who already had 0 cards (e.g. attacker who ran out mid-round)
  state.players.forEach(p => _checkFinished(state, p));

  // 2. Check if only one (or zero) players remain active
  const active = state.players.filter(p => !p.isOut);
  if (active.length <= 1) {
    state.phase = 'finished';
    if (active.length === 1) {
      const durak = active[0];
      durak.isOut = true;
      durak.place = state.players.length;
      state.finishOrder.push(durak.id);
      state.log.push(`${durak.username} is the Durak!`);
    }
    return { state, finished: true };
  }

  // 3. Advance attacker/defender indices
  if (defenderTookCards) {
    // Defender took cards and skips their attack turn
    // Next attacker = player after the defender
    state.attackerIndex = nextActive(state.players, state.defenderIndex);
  } else {
    // Defender successfully defended — defender becomes the new attacker
    state.attackerIndex = state.defenderIndex;
    // But only if they're still active (not isOut after drawing)
    if (state.players[state.attackerIndex].isOut) {
      state.attackerIndex = nextActive(state.players, state.attackerIndex);
    }
  }
  state.defenderIndex = nextActive(state.players, state.attackerIndex);
  
  // Safety: attacker and defender must be different
  if (state.attackerIndex === state.defenderIndex) {
    state.defenderIndex = nextActive(state.players, state.attackerIndex);
  }

  state.phase = 'attack';
  state.round++;
  return { state };
}

/** Returns indices of players clockwise from `fromIndex`, optionally skipping the defender */
function _clockwiseFrom(state, fromIndex, skipDefender) {
  const result = [];
  let i = fromIndex;
  const n = state.players.length;
  for (let step = 0; step < n; step++) {
    if (skipDefender && i === state.defenderIndex) { i = (i + 1) % n; continue; }
    if (!state.players[i].isOut) result.push(i);
    i = (i + 1) % n;
  }
  return result;
}

/** Returns the index of the next non-finished player after `fromIndex` */
function nextActive(players, fromIndex) {
  const n = players.length;
  let i = (fromIndex + 1) % n;
  let safety = 0;
  while (players[i].isOut && safety++ < n) i = (i + 1) % n;
  return i;
}

// ─────────────────────────────────────────────────────────
//  VIEW — hide other players' cards
// ─────────────────────────────────────────────────────────
function getPlayerView(state, playerId) {
  // Build a username lookup so the frontend can show names
  const usernames = {};
  state.players.forEach(p => { usernames[p.id] = p.username; });

  return {
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    deck: state.deck.length,
    table: state.table,
    phase: state.phase,
    round: state.round,
    finishOrder: state.finishOrder,
    attackerIndex: state.attackerIndex,
    defenderIndex: state.defenderIndex,
    log: state.log.slice(-10), // last 10 events only
    usernames, // { playerId: username }
    players: state.players.map(p => ({
      id: p.id,
      username: p.username,
      cardCount: p.hand.length,
      isOut: p.isOut,
      place: p.place,
      // Only reveal your own hand
      hand: p.id === playerId ? p.hand : undefined,
    })),
  };
}

module.exports = { initGame, attack, defend, takeCards, passTurn, getPlayerView, nextActive };
