import assert from 'node:assert/strict';
import { chooseBotCard, collectTrick, createDeck, newGame, playCard } from '../src/briscola.js';

const starts = [0, 0];
const seenFirstCards = new Set();
for (let i = 0; i < 1000; i += 1) {
  let game = newGame(['Pavel', 'Sid AI']);
  starts[game.startingPlayerIndex] += 1;
  seenFirstCards.add(game.hands[0][0].id);
  while (!game.winner) {
    const player = game.turn;
    const cardId = chooseBotCard(game, player, 'expert-75');
    game = playCard(game, player, cardId);
    if (game.pendingTrick) game = collectTrick(game);
  }
  assert.equal(game.scores[0] + game.scores[1], 120);
  assert.equal(new Set([...game.hands[0], ...game.hands[1], ...game.deck]).size, 0);
}
assert.equal(createDeck().length, 40);
assert.ok(Math.abs(starts[0] - starts[1]) < 100, `starter split too uneven: ${starts}`);
assert.equal(seenFirstCards.size, 40);
console.log(JSON.stringify({ simulatedGames: 1000, starterSplit: starts, firstCardCoverage: seenFirstCards.size }));
