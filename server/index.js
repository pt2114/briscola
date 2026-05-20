import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomInt, randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recordsFile = process.env.BRISCOLA_RECORDS_FILE || path.resolve(__dirname, '../data/head-to-head-records.json');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const rooms = new Map();
const records = loadRecords();

const SUITS = [
  { key: 'hearts', symbol: '♥', label: 'Cups', color: 'red' },
  { key: 'diamonds', symbol: '♦', label: 'Coins', color: 'red' },
  { key: 'clubs', symbol: '♣', label: 'Clubs', color: 'black' },
  { key: 'spades', symbol: '♠', label: 'Swords', color: 'black' },
];
const RANKS = [
  { rank: 'A', points: 11, strength: 10 }, { rank: '3', points: 10, strength: 9 },
  { rank: 'K', points: 4, strength: 8 }, { rank: 'Q', points: 3, strength: 7 },
  { rank: 'J', points: 2, strength: 6 }, { rank: '7', points: 0, strength: 5 },
  { rank: '6', points: 0, strength: 4 }, { rank: '5', points: 0, strength: 3 },
  { rank: '4', points: 0, strength: 2 }, { rank: '2', points: 0, strength: 1 },
];
function createDeck() { return SUITS.flatMap(s => RANKS.map(r => ({ id: `${r.rank}-${s.key}`, suit: s.key, suitSymbol: s.symbol, suitLabel: s.label, color: s.color, rank: r.rank, points: r.points, strength: r.strength }))); }
function shuffle(deck) { const d = [...deck]; for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; }
function beats(challenger, current, leadSuit, trumpSuit) { if (!current) return true; if (challenger.suit === current.suit) return challenger.strength > current.strength; if (challenger.suit === trumpSuit && current.suit !== trumpSuit) return true; if (current.suit === trumpSuit && challenger.suit !== trumpSuit) return false; if (challenger.suit === leadSuit && current.suit !== leadSuit) return true; return false; }
function trickWinner(table, trumpSuit) { const leadSuit = table[0].card.suit; let winning = table[0]; for (const play of table.slice(1)) if (beats(play.card, winning.card, leadSuit, trumpSuit)) winning = play; return winning.playerIndex; }
function trickPoints(table) { return table.reduce((sum, play) => sum + play.card.points, 0); }
function drawFor(game, winnerIndex) { const loser = 1 - winnerIndex; if (game.deck.length) game.hands[winnerIndex].push(game.deck.shift()); if (game.deck.length) game.hands[loser].push(game.deck.shift()); }
function newGame(players, startingPlayerIndex = randomInt(players.length)) { const deck = shuffle(createDeck()); const trumpCard = deck[deck.length - 1]; const hands = [deck.splice(0, 3), deck.splice(0, 3)]; return { id: `${Date.now()}-${randomUUID()}`, players, deck, trumpCard, trumpSuit: trumpCard.suit, hands, table: [], scores: [0, 0], lead: startingPlayerIndex, turn: startingPlayerIndex, startingPlayerIndex, lastTrick: null, winner: null, log: [`${players[startingPlayerIndex]} starts this game.`, `La briscola is ${trumpCard.suitSymbol} ${trumpCard.suitLabel}.`] }; }
function playCard(game, playerIndex, cardId) { if (game.winner || game.pendingTrick || game.turn !== playerIndex) return game; const idx = game.hands[playerIndex].findIndex(c => c.id === cardId); if (idx < 0) return game; const card = game.hands[playerIndex][idx]; game.hands[playerIndex].splice(idx, 1); game.table.push({ playerIndex, card }); if (game.table.length === 1) { game.turn = 1 - playerIndex; return game; } const wonBy = trickWinner(game.table, game.trumpSuit); const pts = trickPoints(game.table); game.pendingTrick = { wonBy, points: pts, cards: game.table }; game.turn = null; return game; }
function collectTrick(game) { if (!game?.pendingTrick) return game; const { wonBy, points } = game.pendingTrick; game.scores[wonBy] += points; game.lastTrick = game.pendingTrick; game.log = [`${game.players[wonBy]} takes ${points} point${points === 1 ? '' : 's'}.`, ...(game.log || [])].slice(0, 5); game.table = []; game.pendingTrick = null; game.lead = wonBy; game.turn = wonBy; drawFor(game, wonBy); if (!game.hands[0].length && !game.hands[1].length && !game.deck.length) { if (game.scores[0] === game.scores[1]) { game.winner = 'Tie game — 60 to 60.'; game.result = { tie: true, scores: [...game.scores] }; } else { const w = game.scores[0] > game.scores[1] ? 0 : 1; game.winner = `${game.players[w]} wins ${game.scores[w]}-${game.scores[1 - w]}.`; game.result = { winnerIndex: w, loserIndex: 1 - w, scores: [...game.scores] }; } } return game; }
function recordKey(players) { return players.map((p) => String(p || '').trim().toLowerCase()).sort().join('::'); }
function emptyRecord(players) { return { players: [...players], games: 0, ties: 0, wins: Object.fromEntries(players.map((p) => [p, 0])), losses: Object.fromEntries(players.map((p) => [p, 0])) }; }
function loadRecords() { try { const raw = fs.readFileSync(recordsFile, 'utf8'); return new Map(Object.entries(JSON.parse(raw))); } catch { return new Map(); } }
function saveRecords() { try { fs.mkdirSync(path.dirname(recordsFile), { recursive: true }); const tmp = `${recordsFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(records), null, 2)); fs.renameSync(tmp, recordsFile); } catch (error) { console.error('Could not save head-to-head records:', error); } }
function headToHead(players) { return records.get(recordKey(players)) || emptyRecord(players); }
function nextStartingPlayerIndex(players) {
  const key = recordKey(players);
  const record = records.get(key) || emptyRecord(players);
  record.players = [...players];
  const startingPlayerIndex = randomInt(players.length);
  record.lastStartingPlayer = players[startingPlayerIndex];
  records.set(key, record);
  saveRecords();
  return startingPlayerIndex;
}
function createRoomGame(players) { return newGame(players, nextStartingPlayerIndex(players)); }
function recordResult(game) { if (!game?.result || game.recordedResultId === game.id) return; const key = recordKey(game.players); const record = records.get(key) || emptyRecord(game.players); record.players = [...game.players]; record.games += 1; for (const p of game.players) { record.wins[p] ??= 0; record.losses[p] ??= 0; } if (game.result.tie) record.ties += 1; else { const winner = game.players[game.result.winnerIndex]; const loser = game.players[game.result.loserIndex]; record.wins[winner] += 1; record.losses[loser] += 1; } records.set(key, record); saveRecords(); game.recordedResultId = game.id; }
function publicState(room, socketId) { const r = rooms.get(room); if (!r) return null; const idx = r.players.findIndex(p => p.socketId === socketId); const g = r.game; if (!g) return { room, me: idx, players: r.players.map(p => p.name), chat: r.chat || [], waiting: true }; return { ...g, record: headToHead(g.players), room, me: idx, playersOnline: r.players.map(p => p.name), chat: r.chat || [], hands: g.hands.map((hand, i) => i === idx ? hand : hand.map(c => ({ id: c.id, hidden: true }))) }; }
function emitRoom(room) { const r = rooms.get(room); if (!r) return; for (const p of r.players) io.to(p.socketId).emit('state', publicState(room, p.socketId)); }

io.on('connection', (socket) => {
  socket.on('join', ({ room, name }) => {
    room = String(room || 'MILAN').trim().toUpperCase().slice(0, 12); name = String(name || 'Player').trim().slice(0, 20);
    if (!rooms.has(room)) rooms.set(room, { players: [], game: null, chat: [] });
    const r = rooms.get(room);
    const existing = r.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.socketId = socket.id;
    else if (r.players.length < 2) r.players.push({ name, socketId: socket.id });
    else return socket.emit('errorMessage', 'Room is full. Pick another room code.');
    socket.join(room); socket.data.room = room;
    if (r.players.length === 2 && !r.game) r.game = createRoomGame(r.players.map(p => p.name));
    emitRoom(room);
  });
  socket.on('play', ({ cardId }) => {
    const room = socket.data.room; const r = rooms.get(room); if (!r?.game) return;
    const idx = r.players.findIndex(p => p.socketId === socket.id); if (idx < 0) return;
    playCard(r.game, idx, cardId); emitRoom(room);
    if (r.game.pendingTrick) {
      const hasAceOfSpades = r.game.pendingTrick.cards.some((p) => p.card.id === 'A-spades');
      const hasBigScore = r.game.pendingTrick.points > 14;
      const collectDelay = hasBigScore ? 3800 : hasAceOfSpades ? 2200 : 1600;
      setTimeout(() => { collectTrick(r.game); recordResult(r.game); emitRoom(room); }, collectDelay);
    }
  });
  socket.on('chatMessage', ({ text }) => { const room = socket.data.room; const r = rooms.get(room); if (!r) return; const player = r.players.find(p => p.socketId === socket.id); const clean = String(text || '').trim().slice(0, 180); if (!clean) return; r.chat = [...(r.chat || []), { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, sender: player?.name || 'Player', text: clean, ts: Date.now() }].slice(-30); emitRoom(room); });
  socket.on('newGame', () => { const room = socket.data.room; const r = rooms.get(room); if (r?.players.length === 2) { r.game = createRoomGame(r.players.map(p => p.name)); emitRoom(room); } });
  socket.on('disconnect', () => { if (socket.data.room) emitRoom(socket.data.room); });
});

const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  return res.sendFile(path.join(distDir, 'index.html'));
});

const port = process.env.PORT || 4174;
httpServer.listen(port, () => console.log(`Briscola app listening on ${port}`));
