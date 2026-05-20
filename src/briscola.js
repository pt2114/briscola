export const SUITS = [
  { key: 'hearts', symbol: '♥', label: 'Cups', color: 'red' },
  { key: 'diamonds', symbol: '♦', label: 'Coins', color: 'red' },
  { key: 'clubs', symbol: '♣', label: 'Clubs', color: 'black' },
  { key: 'spades', symbol: '♠', label: 'Swords', color: 'black' },
];

export const RANKS = [
  { rank: 'A', points: 11, strength: 10 },
  { rank: '3', points: 10, strength: 9 },
  { rank: 'K', points: 4, strength: 8 },
  { rank: 'Q', points: 3, strength: 7 },
  { rank: 'J', points: 2, strength: 6 },
  { rank: '7', points: 0, strength: 5 },
  { rank: '6', points: 0, strength: 4 },
  { rank: '5', points: 0, strength: 3 },
  { rank: '4', points: 0, strength: 2 },
  { rank: '2', points: 0, strength: 1 },
];

export function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((r) => ({
    id: `${r.rank}-${suit.key}`,
    suit: suit.key,
    suitSymbol: suit.symbol,
    suitLabel: suit.label,
    color: suit.color,
    rank: r.rank,
    points: r.points,
    strength: r.strength,
  })));
}

export function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function randomIndex(maxExclusive) {
  if (globalThis.crypto?.getRandomValues) {
    const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
    const bucket = new Uint32Array(1);
    do globalThis.crypto.getRandomValues(bucket);
    while (bucket[0] >= limit);
    return bucket[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function newGame(players = ['Pavel', 'Computer']) {
  const deck = shuffle(createDeck());
  const trumpCard = deck[deck.length - 1];
  const hands = [deck.splice(0, 3), deck.splice(0, 3)];
  const startingPlayerIndex = randomIndex(players.length);
  return {
    id: `${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    players,
    deck,
    trumpCard,
    trumpSuit: trumpCard.suit,
    hands,
    table: [],
    scores: [0, 0],
    lead: startingPlayerIndex,
    turn: startingPlayerIndex,
    startingPlayerIndex,
    lastTrick: null,
    winner: null,
    log: [`${players[startingPlayerIndex]} starts this game.`, `La briscola is ${trumpCard.suitSymbol} ${trumpCard.suitLabel}.`],
  };
}

export function beats(challenger, current, leadSuit, trumpSuit) {
  if (!current) return true;
  if (challenger.suit === current.suit) return challenger.strength > current.strength;
  if (challenger.suit === trumpSuit && current.suit !== trumpSuit) return true;
  if (current.suit === trumpSuit && challenger.suit !== trumpSuit) return false;
  if (challenger.suit === leadSuit && current.suit !== leadSuit) return true;
  return false;
}

export function trickWinner(table, trumpSuit) {
  const leadSuit = table[0].card.suit;
  let winning = table[0];
  for (const play of table.slice(1)) {
    if (beats(play.card, winning.card, leadSuit, trumpSuit)) winning = play;
  }
  return winning.playerIndex;
}

export function trickPoints(table) {
  return table.reduce((sum, play) => sum + play.card.points, 0);
}

function drawFor(game, winnerIndex) {
  const loserIndex = 1 - winnerIndex;
  if (game.deck.length > 0) game.hands[winnerIndex].push(game.deck.shift());
  if (game.deck.length > 0) game.hands[loserIndex].push(game.deck.shift());
}

export function playCard(game, playerIndex, cardId) {
  if (game.winner || game.turn !== playerIndex) return game;
  const hand = game.hands[playerIndex];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0) return game;

  const card = hand[idx];
  const next = structuredClone(game);
  next.hands[playerIndex].splice(idx, 1);
  next.table.push({ playerIndex, card });

  if (next.table.length === 1) {
    next.turn = 1 - playerIndex;
    return next;
  }

  const wonBy = trickWinner(next.table, next.trumpSuit);
  const pts = trickPoints(next.table);
  next.pendingTrick = { wonBy, points: pts, cards: next.table };
  next.turn = null;
  return next;
}

export function collectTrick(game) {
  if (!game.pendingTrick) return game;
  const next = structuredClone(game);
  const { wonBy, points } = next.pendingTrick;
  next.scores[wonBy] += points;
  next.lastTrick = next.pendingTrick;
  next.log = [`${next.players[wonBy]} takes ${points} point${points === 1 ? '' : 's'}.`, ...next.log].slice(0, 5);
  next.table = [];
  next.pendingTrick = null;
  next.lead = wonBy;
  next.turn = wonBy;
  drawFor(next, wonBy);

  if (next.hands[0].length === 0 && next.hands[1].length === 0 && next.deck.length === 0) {
    if (next.scores[0] === next.scores[1]) {
      next.winner = 'Tie game — 60 to 60.';
      next.result = { tie: true, scores: [...next.scores] };
    } else {
      const w = next.scores[0] > next.scores[1] ? 0 : 1;
      next.winner = `${next.players[w]} wins ${next.scores[w]}-${next.scores[1 - w]}.`;
      next.result = { winnerIndex: w, loserIndex: 1 - w, scores: [...next.scores] };
    }
  }
  return next;
}

export function chooseBotCard(game, botIndex = 1, difficulty = 'hard') {
  const hand = game.hands[botIndex];
  if (!hand.length) return null;
  const table = game.table;
  const randomCard = hand[Math.floor(Math.random() * hand.length)];
  const cheap = [...hand].sort((a, b) => a.points - b.points || a.strength - b.strength)[0];
  const richest = [...hand].sort((a, b) => b.points - a.points || b.strength - a.strength)[0];

  if (difficulty === 'easy') return randomCard.id;

  if (table.length === 0) {
    if (difficulty === 'medium') return cheap.id;
    const nonTrump = hand.filter((c) => c.suit !== game.trumpSuit);
    const safeLead = (nonTrump.length ? nonTrump : hand).sort((a, b) => a.points - b.points || a.strength - b.strength)[0];
    if (difficulty === 'extra-hard' && game.deck.length <= 8) return richest.id;
    return safeLead.id;
  }

  const opponentCard = table[0].card;
  const winningCards = hand.filter((c) => trickWinner([
    table[0],
    { playerIndex: botIndex, card: c },
  ], game.trumpSuit) === botIndex);
  const losingCards = hand.filter((c) => !winningCards.includes(c));
  const tablePts = opponentCard.points;

  if (difficulty === 'medium') {
    if (tablePts >= 4 && winningCards.length) return winningCards.sort((a, b) => a.points - b.points || a.strength - b.strength)[0].id;
    return cheap.id;
  }

  if (winningCards.length) {
    const cheapestWinner = winningCards.sort((a, b) => a.points - b.points || a.strength - b.strength)[0];
    const bestWinner = winningCards.sort((a, b) => b.points - a.points || a.strength - b.strength)[0];
    if (difficulty === 'extra-hard' && tablePts + bestWinner.points >= 10) return bestWinner.id;
    if (tablePts >= 2 || game.deck.length <= 10) return cheapestWinner.id;
  }

  const discardPool = losingCards.length ? losingCards : hand;
  return discardPool.sort((a, b) => a.points - b.points || a.strength - b.strength)[0].id;
}
