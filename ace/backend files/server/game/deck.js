const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_VALUES = { '6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
const DURAK_RANKS = ['6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of DURAK_RANKS) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit,
        value: RANK_VALUES[rank],
        color: (suit === '♥' || suit === '♦') ? 'red' : 'black',
      });
    }
  }
  return deck; // 36 cards
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function deal(deck, numPlayers, cardsEach) {
  const hands = Array.from({ length: numPlayers }, () => []);
  const remaining = [...deck];
  for (let i = 0; i < cardsEach; i++) {
    for (let p = 0; p < numPlayers; p++) {
      if (remaining.length > 0) hands[p].push(remaining.shift());
    }
  }
  return { hands, remaining };
}

/**
 * Returns positive if `a` beats `b`, negative if `b` beats `a`, 0 if neither beats the other.
 */
function compareCards(a, b, trumpSuit) {
  const aTrump = a.suit === trumpSuit;
  const bTrump = b.suit === trumpSuit;
  if (aTrump && !bTrump) return 1;   // a wins: trump beats non-trump
  if (!aTrump && bTrump) return -1;  // b wins: trump beats non-trump
  if (a.suit === b.suit) return a.value - b.value; // same suit: higher wins
  return 0; // different non-trump suits: neither beats the other
}

module.exports = { createDeck, shuffle, deal, compareCards };
