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

  if (difficulty === 'extra-hard') {
    const searched = chooseSearchCard(game, botIndex);
    if (searched) return searched;
  }

  if (table.length === 0) {
    if (difficulty === 'medium') return cheap.id;
    const nonTrump = hand.filter((c) => c.suit !== game.trumpSuit);
    const safeLead = (nonTrump.length ? nonTrump : hand).sort((a, b) => a.points - b.points || a.strength - b.strength)[0];
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
    if (tablePts >= 2 || game.deck.length <= 10) return cheapestWinner.id;
  }

  const discardPool = losingCards.length ? losingCards : hand;
  return discardPool.sort((a, b) => a.points - b.points || a.strength - b.strength)[0].id;
}

function chooseSearchCard(game, botIndex) {
  const hand = game.hands[botIndex] || [];
  if (!hand.length) return null;
  const opponentIndex = 1 - botIndex;
  const totalUnplayed = game.deck.length + game.hands[0].length + game.hands[1].length + game.table.length;
  const searchDepth = totalUnplayed <= 10 ? 10 : totalUnplayed <= 16 ? 5 : 2;
  const candidates = rankCandidates(game, botIndex, botIndex);
  let best = candidates[0];
  let bestScore = -Infinity;
  const memo = new Map();

  for (const card of candidates) {
    const next = playCard(game, botIndex, card.id);
    const score = minimax(next, botIndex, opponentIndex, searchDepth - 1, -Infinity, Infinity, memo);
    if (score > bestScore + 0.0001 || (Math.abs(score - bestScore) < 0.0001 && tieBreakCard(card, game) > tieBreakCard(best, game))) {
      best = card;
      bestScore = score;
    }
  }
  return best?.id || null;
}

function minimax(game, botIndex, opponentIndex, depth, alpha, beta, memo) {
  if (game.pendingTrick) return minimax(collectTrick(game), botIndex, opponentIndex, depth, alpha, beta, memo);
  if (game.winner || depth <= 0) return evaluateGame(game, botIndex);

  const key = memoKey(game, botIndex, depth);
  if (memo.has(key)) return memo.get(key);

  const maximizing = game.turn === botIndex;
  const candidates = rankCandidates(game, game.turn, botIndex);
  let value = maximizing ? -Infinity : Infinity;

  for (const card of candidates) {
    const next = playCard(game, game.turn, card.id);
    const score = minimax(next, botIndex, opponentIndex, depth - 1, alpha, beta, memo);
    if (maximizing) {
      value = Math.max(value, score);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, score);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }

  memo.set(key, value);
  return value;
}

function rankCandidates(game, playerIndex, botIndex) {
  return [...(game.hands[playerIndex] || [])].sort((a, b) => heuristicCardScore(b, game, playerIndex, botIndex) - heuristicCardScore(a, game, playerIndex, botIndex));
}

function heuristicCardScore(card, game, playerIndex, botIndex) {
  const opponentIndex = 1 - playerIndex;
  const isBot = playerIndex === botIndex;
  const table = game.table || [];
  const trumpBonus = card.suit === game.trumpSuit ? 1.8 : 0;
  const cardCost = card.points * 1.7 + card.strength * 0.18 + trumpBonus;

  if (!table.length) {
    const opponentHand = game.hands[opponentIndex] || [];
    const canBeBeaten = opponentHand.some((opp) => trickWinner([
      { playerIndex, card },
      { playerIndex: opponentIndex, card: opp },
    ], game.trumpSuit) === opponentIndex);
    const guaranteedWin = opponentHand.length > 0 && !canBeBeaten;
    const late = game.deck.length <= 8;
    let score = guaranteedWin ? 8 + card.points : -cardCost;
    if (late && guaranteedWin) score += card.points * 2;
    if (card.suit === game.trumpSuit && !late) score -= 4;
    return isBot ? score : -score;
  }

  const tableCard = table[0].card;
  const wouldWin = trickWinner([table[0], { playerIndex, card }], game.trumpSuit) === playerIndex;
  const trickValue = tableCard.points + card.points;
  let score = wouldWin ? trickValue * 4 - cardCost : -cardCost;
  if (wouldWin && trickValue >= 10) score += 18;
  if (!wouldWin && card.points > 0) score -= card.points * 4;
  if (wouldWin && game.deck.length <= 8) score += card.points * 2 + card.strength * 0.5;
  return isBot ? score : -score;
}

function evaluateGame(game, botIndex) {
  const opponentIndex = 1 - botIndex;
  const scoreDiff = game.scores[botIndex] - game.scores[opponentIndex];
  const botHand = game.hands[botIndex] || [];
  const oppHand = game.hands[opponentIndex] || [];
  const handDiff = handPower(botHand, game.trumpSuit) - handPower(oppHand, game.trumpSuit);
  const tableSwing = (game.table || []).reduce((sum, play) => sum + (play.playerIndex === botIndex ? play.card.points : -play.card.points), 0);
  const tempo = game.turn === botIndex ? 0.25 : game.turn === opponentIndex ? -0.25 : 0;
  return scoreDiff * 20 + handDiff + tableSwing * 2 + tempo;
}

function handPower(hand, trumpSuit) {
  return hand.reduce((sum, card) => sum + card.points * 2.2 + card.strength * 0.35 + (card.suit === trumpSuit ? 3 + card.strength * 0.4 : 0), 0);
}

function tieBreakCard(card, game) {
  if (!card) return -Infinity;
  return card.points * 10 + card.strength + (card.suit === game.trumpSuit ? 2 : 0);
}

function memoKey(game, botIndex, depth) {
  const handKey = game.hands.map((hand) => hand.map((c) => c.id).join(',')).join('|');
  const tableKey = (game.table || []).map((p) => `${p.playerIndex}:${p.card.id}`).join(',');
  const deckKey = game.deck.map((c) => c.id).join(',');
  return [depth, botIndex, game.turn, game.scores.join('-'), handKey, tableKey, deckKey].join(';');
}
