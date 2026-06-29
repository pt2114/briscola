#!/usr/bin/env node
import { chooseBotCard, collectTrick, newGame, playCard } from '../src/briscola.js';

const games = Number(process.argv[2] || 500);
const challenger = process.argv[3] || 'expert-75';
const baseline = process.argv[4] || 'extra-hard';

function playAiGame(firstDifficulty, secondDifficulty) {
  let game = newGame(['Challenger', 'Baseline']);
  while (!game.result) {
    if (game.pendingTrick) {
      game = collectTrick(game);
      continue;
    }
    const difficulty = game.turn === 0 ? firstDifficulty : secondDifficulty;
    const cardId = chooseBotCard(game, game.turn, difficulty);
    game = playCard(game, game.turn, cardId);
  }
  return game.result;
}

let challengerWins = 0;
let baselineWins = 0;
let ties = 0;
let margin = 0;

for (let i = 0; i < games; i++) {
  const challengerFirst = i % 2 === 0;
  const result = challengerFirst
    ? playAiGame(challenger, baseline)
    : playAiGame(baseline, challenger);

  if (result.tie) {
    ties += 1;
    continue;
  }

  const challengerIndex = challengerFirst ? 0 : 1;
  const challengerScore = result.scores[challengerIndex];
  const baselineScore = result.scores[1 - challengerIndex];
  margin += challengerScore - baselineScore;
  if (result.winnerIndex === challengerIndex) challengerWins += 1;
  else baselineWins += 1;
}

const decisive = challengerWins + baselineWins;
const winRate = decisive ? challengerWins / decisive : 0;
console.log(JSON.stringify({
  games,
  challenger,
  baseline,
  challengerWins,
  baselineWins,
  ties,
  decisiveWinRate: Number((winRate * 100).toFixed(1)),
  averageMargin: Number((margin / games).toFixed(2)),
}, null, 2));
