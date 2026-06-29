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

  if (difficulty === 'extra-hard' || difficulty === 'expert-75') {
    const searched = chooseSearchCard(game, botIndex, difficulty);
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

export function coachMove(game, playerIndex = 0) {
  const hand = game.hands[playerIndex] || [];
  if (game.winner || game.pendingTrick || game.turn !== playerIndex || !hand.length) return null;
  const candidates = rankCandidates(game, playerIndex, playerIndex);
  const memo = new Map();
  const depth = game.deck.length <= 8 ? 6 : game.deck.length <= 16 ? 4 : 2;
  const scored = candidates.map((card) => {
    const next = playCard(game, playerIndex, card.id);
    return { card, score: minimax(next, playerIndex, 1 - playerIndex, depth - 1, -Infinity, Infinity, memo) };
  }).sort((a, b) => b.score - a.score || tieBreakCard(b.card, game) - tieBreakCard(a.card, game));

  const best = scored[0];
  if (!best) return null;
  return {
    cardId: best.card.id,
    label: coachLabel(best.card, game, playerIndex),
    reason: coachReason(best.card, game, playerIndex),
    alternatives: scored.slice(1, 3).map(({ card }) => card.id),
  };
}

export function coachFeedback(gameBeforeMove, playerIndex, playedCardId) {
  const advice = coachMove(gameBeforeMove, playerIndex);
  if (!advice) return null;
  const played = (gameBeforeMove.hands[playerIndex] || []).find((card) => card.id === playedCardId);
  const best = (gameBeforeMove.hands[playerIndex] || []).find((card) => card.id === advice.cardId);
  if (!played || !best) return null;
  if (played.id === best.id) {
    return { tone: 'good', title: 'Good Briscola move', text: advice.reason };
  }
  return {
    tone: 'coach',
    title: `Consider ${best.rank} ${best.suitSymbol}`,
    text: `I’d lean ${best.rank} ${best.suitSymbol} here. ${advice.reason}`,
  };
}

function coachLabel(card, game, playerIndex) {
  const table = game.table || [];
  if (!table.length) {
    if (card.suit === game.trumpSuit && game.deck.length > 8) return 'Save trump if you can';
    if (card.points === 0) return 'Safe lead';
    return 'Pressure lead';
  }
  const wouldWin = trickWinner([table[0], { playerIndex, card }], game.trumpSuit) === playerIndex;
  const trickValue = table[0].card.points + card.points;
  if (wouldWin && trickValue >= 10) return 'Take the points';
  if (wouldWin) return 'Cheap winner';
  if (card.points > 0) return 'Risky discard';
  return 'Safe discard';
}

function coachReason(card, game, playerIndex) {
  const table = game.table || [];
  const late = game.deck.length <= 8;
  if (!table.length) {
    if (card.points === 0 && card.suit !== game.trumpSuit) return 'Lead low and non-trump so you keep your scoring cards and briscola for richer tricks.';
    if (late) return 'Late game is about converting strength into points before the hand runs out.';
    if (card.suit === game.trumpSuit) return 'It works, but trump is expensive early; only spend it when the trick is worth it.';
    return 'This balances pressure with not donating your best cards too early.';
  }
  const opponentCard = table[0].card;
  const wouldWin = trickWinner([table[0], { playerIndex, card }], game.trumpSuit) === playerIndex;
  const trickValue = opponentCard.points + card.points;
  if (wouldWin && trickValue >= 10) return `The trick is worth ${trickValue} points, so winning it is worth spending a card.`;
  if (wouldWin) return 'Win with the cheapest card that does the job; save higher cards for bigger swings.';
  if (card.points === 0) return 'You are likely losing this trick, so dump a zero and protect your points.';
  return 'Try not to feed points into a trick you are not taking unless you are setting up a bigger endgame.';
}

function chooseSearchCard(game, botIndex, difficulty = 'extra-hard') {
  const hand = game.hands[botIndex] || [];
  if (!hand.length) return null;
  const opponentIndex = 1 - botIndex;
  const totalUnplayed = game.deck.length + game.hands[0].length + game.hands[1].length + game.table.length;
  const searchDepth = difficulty === 'expert-75'
    ? (totalUnplayed <= 12 ? 8 : totalUnplayed <= 20 ? 4 : 2)
    : (totalUnplayed <= 10 ? 6 : totalUnplayed <= 16 ? 3 : 1);
  const candidates = rankCandidates(game, botIndex, botIndex);
  const memo = new Map();
  const scored = candidates.map((card) => {
    const next = playCard(game, botIndex, card.id);
    return { card, score: minimax(next, botIndex, opponentIndex, searchDepth - 1, -Infinity, Infinity, memo) };
  }).sort((a, b) => b.score - a.score || tieBreakCard(b.card, game) - tieBreakCard(a.card, game));

  const best = scored[0];
  const second = scored[1];
  if (difficulty === 'expert-75') {
    const closeEnough = second && best.score - second.score <= 120;
    const useSecondBest = closeEnough && randomIndex(100) < 20;
    return (useSecondBest ? second.card : best?.card)?.id || null;
  }
  const closeEnough = second && best.score - second.score <= 150;
  const useHumanMove = closeEnough && randomIndex(100) < 60;
  return (useHumanMove ? second.card : best?.card)?.id || null;
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
