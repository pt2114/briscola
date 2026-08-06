import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { chooseBotCard, coachFeedback, coachMove, collectTrick, newGame, playCard } from './briscola.js';
import './styles.css';

const SERVER_URL = import.meta.env.VITE_BRISCOLA_SERVER || window.location.origin;

let sharedAudioContext = null;
const mediaAudioCache = new Map();
let activeMediaAudio = null;

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') sharedAudioContext = new AudioCtx();
  if (sharedAudioContext.state === 'suspended') sharedAudioContext.resume?.().catch(() => {});
  return sharedAudioContext;
}

function playMediaAudio(src) {
  if (!src) return;
  if (activeMediaAudio) {
    activeMediaAudio.pause();
    activeMediaAudio.currentTime = 0;
  }
  let audio = mediaAudioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = 'auto';
    mediaAudioCache.set(src, audio);
  }
  activeMediaAudio = audio;
  audio.currentTime = 0;
  audio.volume = 1;
  audio.play().catch(() => {});
}

function playSfx(kind, enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
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

  setTimeout(() => gain.disconnect(), 1200);
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
  const stingerUntil = useRef(0);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

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
    if (title === 'He’s stacked!!!') return '/audio/reactions/stacked.m4a';
    return null;
  }

  const flash = useCallback((title, subtitle = '', flavor = 'neutral', duration = 1000, options = {}) => {
    const now = Date.now();
    if (!options.replace && now < stingerUntil.current) return false;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    stingerUntil.current = now + duration + 120;
    setStinger({ title, subtitle, flavor, image: stingerImage(title) });
    playMediaAudio(stingerAudio(title));
    clearTimer.current = setTimeout(() => {
      setStinger(null);
      stingerUntil.current = 0;
    }, duration);
    return true;
  }, []);

  const bigScoreLine = useCallback((playerName, points) => {
    const isSid = String(playerName || '').toLowerCase().includes('sid');
    const lines = isSid ? SID_CHANTS : PAVEL_CHANTS;
    const line = lines[Math.floor(Math.random() * lines.length)];
    flash(line, `${points} point trick`, isSid ? 'sid' : 'pavel', 1600);
  }, [flash]);

  const playCoinShower = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);
    master.connect(ctx.destination);

    Array.from({ length: 12 }, (_, i) => {
      const t = now + i * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 3 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(980 + (i % 6) * 145, t);
      osc.frequency.exponentialRampToValueAtTime(520 + (i % 5) * 85, t + 0.16);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.075, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.2);
    });

    setTimeout(() => master.disconnect(), 1800);
  }, []);

  const stackedReaction = useCallback(() => {
    if (flash('He’s stacked!!!', '', 'stacked', 1200, { replace: true })) playCoinShower();
  }, [flash, playCoinShower]);

  const watch = useCallback((game) => {
    if (game.id && game.id !== currentGameId.current) {
      currentGameId.current = game.id;
      seen.current.clear();
    }

    for (const play of game.table || []) {
      const key = `ace-${play.card.id}-${play.playerIndex}`;
      if (play.card.id === 'A-spades' && !seen.current.has(key)) {
        seen.current.add(key);
        flash('ACE OF SPADES', '', 'neutral', 1500);
      }
    }

    if (game.pendingTrick?.points > 14) {
      const key = `big-${game.pendingTrick.wonBy}-${game.pendingTrick.points}-${game.pendingTrick.cards.map((p) => p.card.id).join('|')}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        bigScoreLine(game.players[game.pendingTrick.wonBy], game.pendingTrick.points);
      }
    }
  }, [bigScoreLine, flash]);

  return useMemo(() => ({ stinger, watch, stackedReaction }), [stinger, watch, stackedReaction]);
}

function Card({ card, onClick, disabled, showPoints, small, recommended }) {
  if (!card) return <div className="card ghost" />;
  if (card.hidden) return <div className={`card back ${small ? 'small' : ''}`}><span>PS</span></div>;
  return (
    <button className={`card ${card.color} ${small ? 'small' : ''} ${recommended ? 'recommended' : ''}`} onClick={onClick} disabled={disabled}>
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

const VOICE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function VoiceChat({ socket }) {
  const [status, setStatus] = useState('idle');
  const [incoming, setIncoming] = useState(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const localStreamRef = useRef(null);
  const peerRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const incomingOfferRef = useRef(null);
  const pendingIceRef = useRef([]);

  const closeCall = useCallback((stopMic = true) => {
    peerRef.current?.close();
    peerRef.current = null;
    pendingIceRef.current = [];
    incomingOfferRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (stopMic) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setMuted(false);
    }
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs a browser with microphone support.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    return stream;
  }, [muted]);

  const flushPendingIce = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;
    const candidates = pendingIceRef.current.splice(0);
    for (const candidate of candidates) {
      try { await peer.addIceCandidate(candidate); }
      catch { /* Ignore stale candidates after reconnects. */ }
    }
  }, []);

  const ensurePeer = useCallback(async () => {
    if (peerRef.current) return peerRef.current;
    const peer = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });
    peerRef.current = peer;
    const stream = await ensureLocalStream();
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) socket.emit('voiceSignal', { type: 'ice', payload: event.candidate });
    };
    peer.ontrack = (event) => {
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play?.().catch(() => {});
      }
    };
    peer.onconnectionstatechange = () => {
      if (['connected', 'completed'].includes(peer.connectionState)) setStatus('connected');
      if (['failed', 'disconnected'].includes(peer.connectionState)) setStatus('trouble');
      if (peer.connectionState === 'closed') setStatus('idle');
    };
    return peer;
  }, [ensureLocalStream, socket]);

  const answerOffer = useCallback(async (offer) => {
    setError('');
    setStatus('connecting');
    const peer = await ensurePeer();
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingIce();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('voiceSignal', { type: 'answer', payload: answer });
    setIncoming(null);
    setStatus('connected');
  }, [ensurePeer, flushPendingIce, socket]);

  const startCall = useCallback(async () => {
    try {
      setError('');
      setIncoming(null);
      setStatus('connecting');
      closeCall(false);
      const peer = await ensurePeer();
      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      await peer.setLocalDescription(offer);
      socket.emit('voiceSignal', { type: 'offer', payload: offer });
    } catch (err) {
      closeCall(true);
      setStatus('idle');
      setError(err?.message || 'Could not start voice chat.');
    }
  }, [closeCall, ensurePeer, socket]);

  const joinCall = useCallback(async () => {
    try {
      if (!incomingOfferRef.current) return startCall();
      await answerOffer(incomingOfferRef.current);
    } catch (err) {
      closeCall(true);
      setStatus('idle');
      setError(err?.message || 'Could not join voice chat.');
    }
  }, [answerOffer, closeCall, startCall]);

  const endCall = useCallback(() => {
    socket.emit('voiceSignal', { type: 'hangup' });
    closeCall(true);
    setIncoming(null);
    setStatus('idle');
    setError('');
  }, [closeCall, socket]);

  useEffect(() => {
    const onSignal = async ({ type, payload, sender }) => {
      try {
        if (type === 'offer') {
          incomingOfferRef.current = payload;
          setIncoming(sender || 'Other player');
          setStatus((current) => current === 'idle' ? 'ringing' : current);
        }
        if (type === 'answer') {
          const peer = peerRef.current;
          if (peer && !peer.remoteDescription) {
            await peer.setRemoteDescription(new RTCSessionDescription(payload));
            await flushPendingIce();
            setStatus('connected');
          }
        }
        if (type === 'ice') {
          const candidate = new RTCIceCandidate(payload);
          const peer = peerRef.current;
          if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
          else pendingIceRef.current.push(candidate);
        }
        if (type === 'hangup') {
          closeCall(true);
          setIncoming(null);
          setStatus('idle');
        }
      } catch (err) {
        setError(err?.message || 'Voice chat connection problem.');
      }
    };
    socket.on('voiceSignal', onSignal);
    return () => {
      socket.off('voiceSignal', onSignal);
      closeCall(true);
    };
  }, [closeCall, flushPendingIce, socket]);

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
  }

  const label = status === 'connected' ? 'Voice connected' : status === 'connecting' ? 'Connecting…' : status === 'trouble' ? 'Voice trouble' : incoming ? `${incoming} wants to talk` : 'Voice chat';

  return <section className={`voice-chat voice-${status}`}>
    <audio ref={remoteAudioRef} autoPlay playsInline />
    <span className="voice-status"><i />{label}</span>
    {incoming && status !== 'connected' && <button onClick={joinCall}>Join</button>}
    {!incoming && status !== 'connected' && <button onClick={startCall}>Start talking</button>}
    {status === 'connected' && <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>}
    {status !== 'idle' && <button className="voice-end" onClick={endCall}>Hang up</button>}
    {error && <small>{error}</small>}
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

function GameTable({ game, setGame, mode, socket, showPoints, soundEnabled, educationMode = false, myIndex = 0, onNewGame, chatMessages = [], onChatSend }) {
  const specialStinger = useSpecialStinger();
  const localRecord = useLocalHeadToHead(game);
  const record = mode === 'multi' ? (game.record || localRecord) : localRecord;
  const isStingerOpen = Boolean(specialStinger.stinger);
  const isMyTurn = game.turn === myIndex && !game.winner && !game.pendingTrick;
  const canPlay = (playerIndex) => !isStingerOpen && (mode !== 'multi' ? playerIndex === 0 && isMyTurn : playerIndex === myIndex && isMyTurn);
  const [coachNote, setCoachNote] = useState(null);
  const currentCoach = useMemo(() => {
    if (!educationMode || mode !== 'single' || !isMyTurn) return null;
    return coachMove(game, 0);
  }, [educationMode, game, isMyTurn, mode]);

  function play(cardId) {
    if (mode === 'multi') socket.emit('play', { cardId });
    else {
      if (educationMode) setCoachNote(coachFeedback(game, 0, cardId));
      setGame((g) => playCard(g, 0, cardId));
    }
  }

  function stackedReaction() {
    if (mode === 'multi') socket.emit('reaction', { type: 'stacked' });
    else specialStinger.stackedReaction();
  }

  useEffect(() => {
    if (mode !== 'multi' || !socket) return;
    const onReaction = ({ type }) => {
      if (type === 'stacked') specialStinger.stackedReaction();
    };
    socket.on('reaction', onReaction);
    return () => socket.off('reaction', onReaction);
  }, [mode, socket, specialStinger.stackedReaction]);

  useEffect(() => {
    if (mode !== 'single' || isStingerOpen || game.winner || game.turn !== 1 || game.pendingTrick) return;
    const t = setTimeout(() => {
      setCoachNote(null);
      setGame((g) => playCard(g, 1, chooseBotCard(g, 1, 'expert-75')));
    }, 650);
    return () => clearTimeout(t);
  }, [game, mode, setGame, soundEnabled, isStingerOpen]);

  useEffect(() => {
    if (mode !== 'single' || !game.pendingTrick) return;
    const t = setTimeout(() => {
      setGame((g) => collectTrick(g));
    }, 900);
    return () => clearTimeout(t);
  }, [game.pendingTrick, mode, setGame]);

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
  }, [game.table, game.pendingTrick, game.winner, soundEnabled, specialStinger.watch]);

  return <main className="game-shell">
    <ScoreBoard game={game} record={record} />
    <div className="table-actions">
      <button className="stacked-reaction" onClick={stackedReaction}>Stacked</button>
      {onNewGame && <button onClick={onNewGame}>New game</button>}
    </div>
    {mode === 'multi' && <ChatTray messages={chatMessages} onSend={onChatSend} />}
    {mode === 'multi' && socket && <VoiceChat socket={socket} />}
    {educationMode && mode === 'single' && (currentCoach || coachNote) && <aside className={`coach-panel ${coachNote?.tone || 'tip'}`}>
      <strong>{coachNote?.title || currentCoach.label}</strong>
      <span>{coachNote?.text || currentCoach.reason}</span>
    </aside>}
    {specialStinger.stinger?.flavor === 'stacked' && <div className="gold-chaos" aria-hidden="true">{Array.from({ length: 48 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 16) * 0.035}s`, '--drift': `${((i * 53) % 180) - 90}px`, '--spin': `${(i * 47) % 720}deg`, '--scale': `${0.7 + ((i * 11) % 9) / 10}` }} />)}</div>}
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
        <div className="hand">{game.hands[bottomIndex].map((c) => <Card key={c.id} card={c} onClick={() => play(c.id)} disabled={!canPlay(bottomIndex)} showPoints={showPoints} recommended={currentCoach?.cardId === c.id} />)}</div>
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
  const [educationMode, setEducationMode] = useState(() => localStorage.getItem('briscolaEducationMode') === 'true');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [singleGame, setSingleGame] = useState(() => newGame(['Pavel', 'Computer']));
  const [login, setLogin] = useState({ name: 'Pavel', room: 'MILAN' });
  useEffect(() => {
    localStorage.setItem('briscolaEducationMode', String(educationMode));
  }, [educationMode]);
  return <> 
    <div className="app-header"><button onClick={() => setMode('lobby')}>‹ Menu</button><div><strong>Pavel & Sid’s</strong><span>Briscola</span></div><button className="settings-button" onClick={() => setSettingsOpen(true)}>⚙︎</button></div>
    {settingsOpen && <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-sheet" onClick={(e) => e.stopPropagation()}><div className="sheet-grabber" /><h2>Settings</h2><label className="setting-row"><span>Show point values</span><input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /></label><label className="setting-row"><span>Sound effects</span><input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} /></label><label className="setting-row"><span><b>Education Mode</b><small>Coach tips while you play the computer</small></span><input type="checkbox" checked={educationMode} onChange={(e) => setEducationMode(e.target.checked)} /></label><button className="done-button" onClick={() => setSettingsOpen(false)}>Done</button></section></div>}
    {mode === 'lobby' && <Lobby onSingle={(player) => { setSingleGame(player === 'sid' ? newGame(['Sid', 'Pavel Computer']) : newGame(['Pavel', 'Sid Computer'])); setMode('single'); }} onMulti={(name, room) => { setLogin({ name, room }); setMode('multi'); }} />}
    {mode === 'single' && <GameTable game={singleGame} setGame={setSingleGame} mode="single" showPoints={showPoints} soundEnabled={soundEnabled} educationMode={educationMode} onNewGame={() => setSingleGame((game) => newGame(game.players, 1 - game.startingPlayerIndex))} />}
    {mode === 'multi' && <Multiplayer name={login.name} room={login.room} showPoints={showPoints} soundEnabled={soundEnabled} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
