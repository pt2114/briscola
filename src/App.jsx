import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { chooseBotCard, collectTrick, newGame, playCard } from './briscola.js';
import './styles.css';

const SERVER_URL = import.meta.env.VITE_BRISCOLA_SERVER || window.location.origin;

function playSfx(kind, enabled = true) {
  if (!enabled) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);

  if (kind === 'card') {
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 700;
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    noise.buffer = buffer;
    noise.connect(filter).connect(gain);
    noise.start(now);
    noise.stop(now + 0.09);
  }

  if (kind === 'take') {
    [392, 523.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + i * 0.055);
      osc.stop(now + 0.22 + i * 0.04);
    });
    gain.gain.exponentialRampToValueAtTime(0.095, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  }

  if (kind === 'win') {
    [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + i * 0.08);
      osc.stop(now + 0.55);
    });
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  }

  setTimeout(() => ctx.close?.(), 900);
}

const PAVEL_CHANTS = [
  'Pablo El Diablo!',
  'Pavel superstar!',
  'Pavel rock and roll!',
  'Pavel the navel takes the table!',
];

const SID_CHANTS = [
  'Italian Stallion!',
  'Djemba Djemba!',
  "In the land of Uncle Sid’s!",
  'Mr. Freeze!',
  'Casanova',
  'Sid has a big cock!',
];

function displayName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('sid')) return { main: name, alias: Math.random() > 0.5 ? 'Italian Stallion' : 'Djemba Djembs' };
  if (n.includes('pavel') || n.includes('pablo')) return { main: name, alias: Math.random() > 0.5 ? 'Pablo El Diablo' : 'Pavel the Navel' };
  if (n.includes('computer')) return { main: name, alias: 'NonnaBot 3000' };
  return { main: name, alias: 'Briscola bandit' };
}

function recordKey(players) {
  return players.map((p) => String(p || '').trim().toLowerCase()).sort().join('::');
}

function emptyRecord(players) {
  return {
    players: [...players],
    games: 0,
    ties: 0,
    wins: Object.fromEntries(players.map((p) => [p, 0])),
    losses: Object.fromEntries(players.map((p) => [p, 0])),
  };
}

function useLocalHeadToHead(game) {
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem('briscolaHeadToHeadRecords') || '{}'); }
    catch { return {}; }
  });
  const seenResults = useRef(new Set());
  const key = recordKey(game.players);

  useEffect(() => {
    if (!game.result || seenResults.current.has(game.id)) return;
    seenResults.current.add(game.id);
    setRecords((current) => {
      const next = { ...current };
      const record = next[key] || emptyRecord(game.players);
      record.players = [...game.players];
      record.games += 1;
      for (const player of game.players) {
        record.wins[player] ??= 0;
        record.losses[player] ??= 0;
      }
      if (game.result.tie) record.ties += 1;
      else {
        const winner = game.players[game.result.winnerIndex];
        const loser = game.players[game.result.loserIndex];
        record.wins[winner] += 1;
        record.losses[loser] += 1;
      }
      next[key] = record;
      localStorage.setItem('briscolaHeadToHeadRecords', JSON.stringify(next));
      return next;
    });
  }, [game.id, game.result, game.players, key]);

  return records[key] || emptyRecord(game.players);
}

function PlayerBadge({ name, turn }) {
  const label = useMemo(() => displayName(name), [name]);
  return <div className="nameplate"><span>{label.main}</span><strong>{label.alias}</strong>{turn && <em>to play</em>}</div>;
}

function useSpecialStinger() {
  const [stinger, setStinger] = useState(null);
  const seen = useRef(new Set());
  const currentGameId = useRef(null);
  const clearTimer = useRef(null);

  function stingerImage(title) {
    if (title === 'ACE OF SPADES') return '/ace-of-spades-pavel.jpg';
    if (title === 'Pablo El Diablo!') return '/pablo-el-diablo.jpg';
    if (title === 'Italian Stallion!') return '/italian-stallion.jpg';
    if (title === 'Djemba Djemba!') return '/djemba-djemba.jpg';
    if (title === "In the land of Uncle Sid’s!") return '/uncle-sids.jpg';
    if (title === 'Mr. Freeze!') return '/mr-freeze.jpg';
    return null;
  }

  function stingerAudio(title) {
    if (title === 'ACE OF SPADES') return '/audio/ace-of-spades-chant.m4a';
    if (title === 'Pablo El Diablo!') return '/audio/catchphrases/pablo-el-diablo.m4a';
    if (title === 'Pavel superstar!') return '/audio/catchphrases/pavel-superstar.m4a';
    if (title === 'Pavel rock and roll!') return '/audio/catchphrases/pavel-rock-and-roll.m4a';
    if (title === 'Pavel the navel takes the table!') return '/audio/catchphrases/pavel-navel-table.m4a';
    if (title === 'Italian Stallion!') return '/audio/catchphrases/italian-stallion.m4a';
    if (title === 'Djemba Djemba!') return '/audio/catchphrases/djemba-djemba.m4a';
    if (title === "In the land of Uncle Sid’s!") return '/audio/catchphrases/uncle-sids.m4a';
    if (title === 'Mr. Freeze!') return '/audio/catchphrases/mr-freeze.m4a';
    if (title === 'Casanova') return '/audio/catchphrases/casanova.m4a';
    if (title === 'Sid has a big cock!') return '/audio/catchphrases/big-cock-alert.m4a';
    return null;
  }

  function flash(title, subtitle = '', flavor = 'neutral', duration = 1000) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setStinger({ title, subtitle, flavor, image: stingerImage(title) });
    const audioSrc = stingerAudio(title);
    if (audioSrc) {
      const audio = new Audio(audioSrc);
      audio.volume = 1;
      audio.play().catch(() => {});
    }
    clearTimer.current = setTimeout(() => setStinger(null), duration);
  }

  function bigScoreLine(playerName, points) {
    const isSid = String(playerName || '').toLowerCase().includes('sid');
    const lines = isSid ? SID_CHANTS : PAVEL_CHANTS;
    const line = lines[Math.floor(Math.random() * lines.length)];
    flash(line, `${points} point trick`, isSid ? 'sid' : 'pavel', 3600);
  }

  function stackedReaction() {
    flash('He’s stacked!!!', '', 'stacked', 1800);
  }

  function watch(game) {
    if (game.id && game.id !== currentGameId.current) {
      currentGameId.current = game.id;
      seen.current.clear();
    }

    for (const play of game.table || []) {
      const key = `ace-${play.card.id}-${play.playerIndex}`;
      if (play.card.id === 'A-spades' && !seen.current.has(key)) {
        seen.current.add(key);
        flash('ACE OF SPADES', '', 'neutral', 2000);
      }
    }

    if (game.pendingTrick?.points > 14) {
      const key = `big-${game.pendingTrick.wonBy}-${game.pendingTrick.points}-${game.pendingTrick.cards.map((p) => p.card.id).join('|')}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        bigScoreLine(game.players[game.pendingTrick.wonBy], game.pendingTrick.points);
      }
    }
  }

  return { stinger, watch, stackedReaction };
}

function Card({ card, onClick, disabled, showPoints, small }) {
  if (!card) return <div className="card ghost" />;
  if (card.hidden) return <div className={`card back ${small ? 'small' : ''}`}><span>PS</span></div>;
  return (
    <button className={`card ${card.color} ${small ? 'small' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="corner">{card.rank}<br />{card.suitSymbol}</span>
      <span className="pip">{card.suitSymbol}</span>
      <span className="label">{card.suitLabel}</span>
      {showPoints && <span className="points">{card.points} pt</span>}
    </button>
  );
}

function ChatTray({ messages = [], onSend }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const latest = messages[messages.length - 1];

  function send(e) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onSend?.(clean);
    setText('');
  }

  return <section className={`chat-tray ${open ? 'open' : ''}`}>
    <button className="chat-toggle" onClick={() => setOpen((value) => !value)}>{open ? 'Hide chat' : `Chat${messages.length ? ` · ${messages.length}` : ''}`}</button>
    {!open && latest && <div className="chat-peek"><b>{latest.sender}:</b> {latest.text}</div>}
    {open && <div className="chat-panel">
      <div className="chat-messages">
        {messages.length ? messages.slice(-8).map((m) => <p key={m.id}><b>{m.sender}</b><span>{m.text}</span></p>) : <em>No messages yet. Talk your trash.</em>}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" maxLength={180} />
        <button type="submit">Send</button>
      </form>
    </div>}
  </section>;
}

function ScoreBoard({ game, record }) {
  const recordText = record ? `${game.players[0]} ${record.wins?.[game.players[0]] || 0}-${record.losses?.[game.players[0]] || 0} · ${game.players[1]} ${record.wins?.[game.players[1]] || 0}-${record.losses?.[game.players[1]] || 0}${record.ties ? ` · ${record.ties} ties` : ''}` : '';
  return <aside className="scoreboard bliss-hud">
    <div className="hud-title">Pavel & Sid’s Briscola</div>
    <div className="score-row"><span>{game.players[0]}</span><b>{game.scores[0]}</b></div>
    <div className="score-row"><span>{game.players[1]}</span><b>{game.scores[1]}</b></div>
    <div className="record-row">All-time: {recordText}</div>
    {game.lastTrick && <div className="last">Last: {game.players[game.lastTrick.wonBy]} +{game.lastTrick.points}</div>}
  </aside>;
}

function GameTable({ game, setGame, mode, socket, showPoints, soundEnabled, difficulty, myIndex = 0, onNewGame, chatMessages = [], onChatSend }) {
  const specialStinger = useSpecialStinger();
  const localRecord = useLocalHeadToHead(game);
  const record = mode === 'multi' ? (game.record || localRecord) : localRecord;
  const isStingerOpen = Boolean(specialStinger.stinger);
  const isMyTurn = game.turn === myIndex && !game.winner && !game.pendingTrick;
  const canPlay = (playerIndex) => !isStingerOpen && (mode !== 'multi' ? playerIndex === 0 && isMyTurn : playerIndex === myIndex && isMyTurn);

  function play(cardId) {
    playSfx('card', soundEnabled);
    if (mode === 'multi') socket.emit('play', { cardId });
    else setGame((g) => playCard(g, 0, cardId));
  }

  useEffect(() => {
    if (mode !== 'single' || isStingerOpen || game.winner || game.turn !== 1 || game.pendingTrick) return;
    const t = setTimeout(() => {
      playSfx('card', soundEnabled);
      setGame((g) => playCard(g, 1, chooseBotCard(g, 1, difficulty)));
    }, 900);
    return () => clearTimeout(t);
  }, [game, mode, setGame, soundEnabled, difficulty, isStingerOpen]);

  useEffect(() => {
    if (mode !== 'single' || isStingerOpen || !game.pendingTrick) return;
    const t = setTimeout(() => {
      playSfx('take', soundEnabled);
      setGame((g) => collectTrick(g));
    }, 1600);
    return () => clearTimeout(t);
  }, [game.pendingTrick, mode, setGame, soundEnabled, isStingerOpen]);

  const topIndex = mode === 'multi' ? 1 - myIndex : 1;
  const bottomIndex = myIndex;

  const prevTableCount = useRef(game.table?.length || 0);
  const prevPending = useRef(Boolean(game.pendingTrick));
  const prevWinner = useRef(game.winner);

  useEffect(() => {
    specialStinger.watch(game);
    if ((game.table?.length || 0) > prevTableCount.current) playSfx('card', soundEnabled);
    if (game.pendingTrick && !prevPending.current) setTimeout(() => playSfx('take', soundEnabled), 900);
    if (game.winner && game.winner !== prevWinner.current) playSfx('win', soundEnabled);
    prevTableCount.current = game.table?.length || 0;
    prevPending.current = Boolean(game.pendingTrick);
    prevWinner.current = game.winner;
  }, [game.table, game.pendingTrick, game.winner, game.lastTrick, soundEnabled]);

  return <main className="game-shell">
    <ScoreBoard game={game} record={record} />
    <div className="table-actions">
      <button className="stacked-reaction" onClick={specialStinger.stackedReaction}>Stacked</button>
      {mode === 'multi' && <ChatTray messages={chatMessages} onSend={onChatSend} />}
      {onNewGame && <button onClick={onNewGame}>New game</button>}
    </div>
    {specialStinger.stinger?.flavor === 'stacked' && <div className="gold-chaos" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${(i % 9) * 0.06}s`, transform: `rotate(${i * 17}deg)` }} />)}</div>}
    {specialStinger.stinger && <div className={`ace-stinger ${specialStinger.stinger.flavor} ${specialStinger.stinger.image ? 'photo-stinger' : ''}`}>{specialStinger.stinger.image && <img src={specialStinger.stinger.image} alt={specialStinger.stinger.title} />}<b>{specialStinger.stinger.title}</b>{specialStinger.stinger.subtitle && <span>{specialStinger.stinger.subtitle}</span>}</div>}
    <section className="felt bliss-table">
      <div className="player top">
        <PlayerBadge name={game.players[topIndex]} turn={game.turn === topIndex} />
        <div className="hand">{game.hands[topIndex].map((c) => <Card key={c.id} card={c.hidden ? c : { ...c, hidden: mode === 'single' }} showPoints={showPoints} disabled small />)}</div>
      </div>

      <div className="table-zone">
        <div className="stock-area">
          <div className="stock-stack"><Card card={{ hidden: true }} small /><span>{game.deck.length}</span></div>
          <div className="trump-card"><small>Briscola</small><Card card={game.trumpCard} showPoints={showPoints} small /></div>
        </div>
        {game.winner ? <div className="winner"><span>Partita finita</span><b>{game.winner}</b></div> : <>
          <div className="turn-banner">{game.pendingTrick ? `${game.players[game.pendingTrick.wonBy]} takes ${game.pendingTrick.points}` : `${game.players[game.turn]} plays ${game.table.length ? 'second' : 'first'}`}</div>
          <div className={`played-cards ${game.pendingTrick && !isStingerOpen ? 'collecting' : ''} ${game.pendingTrick?.wonBy === topIndex ? 'collect-top' : ''} ${game.pendingTrick?.wonBy === bottomIndex ? 'collect-bottom' : ''}`}>
            {game.table.map((p, i) => (
              <div
                className={`played ${p.playerIndex === bottomIndex ? 'from-bottom' : 'from-top'} ${i === 1 ? 'second-card' : 'first-card'}`}
                key={`${p.playerIndex}-${p.card.id}`}
              >
                <small>{game.players[p.playerIndex]}</small>
                <Card card={p.card} showPoints={showPoints} />
              </div>
            ))}
          </div>
        </>}
      </div>

      <div className="player bottom">
        <PlayerBadge name={game.players[bottomIndex]} turn={game.turn === bottomIndex} />
        <div className="hand">{game.hands[bottomIndex].map((c) => <Card key={c.id} card={c} onClick={() => play(c.id)} disabled={!canPlay(bottomIndex)} showPoints={showPoints} />)}</div>
      </div>
    </section>
  </main>;
}

function Lobby({ onSingle, onMulti }) {
  const [name, setName] = useState('Pavel');
  const [room, setRoom] = useState('MILAN');
  return <div className="lobby">
    <div className="poster">
      <div className="crest">♣</div>
      <p className="eyebrow">Casa di carte</p>
      <h1>Pavel & Sid’s Briscola</h1>
      <p>Two-player Briscola with American cards, Italian soul, and just enough drama for a Sunday table.</p>
      <div className="lobby-actions single-actions">
        <button onClick={() => onSingle('pavel')}>Play as Pavel against Sid AI</button>
        <button onClick={() => onSingle('sid')}>Play as Sid against Pavel AI</button>
      </div>
      <div className="login-card">
        <h2>Multiplayer login</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pavel or Sid" />
        <input value={room} onChange={(e) => setRoom(e.target.value.toUpperCase())} placeholder="Room code" />
        <button onClick={() => onMulti(name, room)}>Join Room</button>
        <small>Open a second browser/device, login as the other player, same room code.</small>
      </div>
    </div>
  </div>;
}

function Multiplayer({ name, room, showPoints, soundEnabled }) {
  const socket = useMemo(() => io(SERVER_URL, { transports: ['websocket', 'polling'] }), []);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    socket.emit('join', { name, room });
    socket.on('state', setState);
    socket.on('errorMessage', setError);
    return () => socket.disconnect();
  }, [socket, name, room]);
  if (error) return <div className="center-card">{error}</div>;
  if (!state || state.waiting) return <div className="center-card"><h2>Waiting in room {room.toUpperCase()}</h2><p>Have the other player join as Pavel or Sid.</p></div>;
  return <GameTable game={state} mode="multi" socket={socket} showPoints={showPoints} soundEnabled={soundEnabled} myIndex={state.me} onNewGame={() => socket.emit('newGame')} chatMessages={state.chat || []} onChatSend={(text) => socket.emit('chatMessage', { text })} />;
}

function App() {
  const [mode, setMode] = useState('lobby');
  const [showPoints, setShowPoints] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [difficulty, setDifficulty] = useState('hard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [singleGame, setSingleGame] = useState(() => newGame(['Pavel', 'Computer']));
  const [login, setLogin] = useState({ name: 'Pavel', room: 'MILAN' });
  return <>
    <div className="app-header"><button onClick={() => setMode('lobby')}>‹ Menu</button><div><strong>Pavel & Sid’s</strong><span>Briscola</span></div><button className="settings-button" onClick={() => setSettingsOpen(true)}>⚙︎</button></div>
    {settingsOpen && <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-sheet" onClick={(e) => e.stopPropagation()}><div className="sheet-grabber" /><h2>Settings</h2><label className="setting-row"><span>Show point values</span><input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /></label><label className="setting-row"><span>Sound effects</span><input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} /></label><div className="setting-block"><span>Computer difficulty</span><div className="difficulty-grid">{[['easy','Easy'],['medium','Medium'],['hard','Hard'],['extra-hard','Extra Hard']].map(([value,label]) => <button key={value} className={difficulty === value ? 'selected' : ''} onClick={() => setDifficulty(value)}>{label}</button>)}</div></div><button className="done-button" onClick={() => setSettingsOpen(false)}>Done</button></section></div>}
    {mode === 'lobby' && <Lobby onSingle={(player) => { setSingleGame(player === 'sid' ? newGame(['Sid', 'Pavel Computer']) : newGame(['Pavel', 'Sid Computer'])); setMode('single'); }} onMulti={(name, room) => { setLogin({ name, room }); setMode('multi'); }} />}
    {mode === 'single' && <GameTable game={singleGame} setGame={setSingleGame} mode="single" showPoints={showPoints} soundEnabled={soundEnabled} difficulty={difficulty} onNewGame={() => setSingleGame((game) => newGame(game.players))} />}
    {mode === 'multi' && <Multiplayer name={login.name} room={login.room} showPoints={showPoints} soundEnabled={soundEnabled} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
