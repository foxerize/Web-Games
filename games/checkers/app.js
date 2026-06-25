import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { browserSessionPersistence, getAuth, setPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase, onValue, ref, runTransaction, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "../../firebase-config.js";

const ROOM_PATH = "checkersRooms";
const boardEl = document.querySelector("#board");
const playArea = document.querySelector(".play-area");
const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const message = document.querySelector("#message");
const hostControls = document.querySelector("#host-controls");
const kickPlayerButton = document.querySelector("#kick-player");
const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
let uid, roomId, room, unsubscribe, selected;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CHAT_MESSAGES = 40;
const MAX_LOCAL_CHAT_MESSAGES = 250;
const MAX_CHAT_CHARS = 255;
const expiresAt = () => Date.now() + ROOM_TTL_MS;
const isExpired = roomData => roomData?.expiresAt && roomData.expiresAt <= Date.now();
const code = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), n => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
const playerColor = players => players?.p1 === uid ? "p1" : players?.p2 === uid ? "p2" : null;
const playerLabel = color => color === "p1" ? "P1" : "P2";
const isHost = roomData => roomData?.host === uid || (!roomData?.host && roomData?.players?.p1 === uid);
const chatKey = id => `checkers-chat:${id}`;
const chatId = item => item.id || `${item.createdAt || 0}:${item.uid || ""}:${item.text || ""}`;
const readLocalChat = id => {
  try { return JSON.parse(localStorage.getItem(chatKey(id))) || []; }
  catch { return []; }
};
const writeLocalChat = (id, messages) => localStorage.setItem(chatKey(id), JSON.stringify(messages.slice(-MAX_LOCAL_CHAT_MESSAGES)));
const mergeChat = (localMessages, remoteMessages) => {
  const merged = new Map();
  [...localMessages, ...remoteMessages].forEach(item => merged.set(chatId(item), item));
  return [...merged.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-MAX_LOCAL_CHAT_MESSAGES);
};
let db;
const roomRef = id => ref(db, `${ROOM_PATH}/${id}`);
const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

const emptyBoard = () => {
  const board = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) board[r][c] = { player: "p2", king: false };
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) board[r][c] = { player: "p1", king: false };
  return board;
};
const normalizeBoard = board => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
  const piece = board?.[r]?.[c];
  return piece?.player ? { player: piece.player, king: !!piece.king } : null;
}));
const countPieces = (board, player) => board.flat().filter(piece => piece?.player === player).length;
const legalMovesFor = (board, from) => {
  const piece = board[from.r]?.[from.c];
  if (!piece) return [];
  const dirs = piece.king ? [[1,1],[1,-1],[-1,1],[-1,-1]] : piece.player === "p1" ? [[-1,1],[-1,-1]] : [[1,1],[1,-1]];
  return dirs.flatMap(([dr, dc]) => {
    const moves = [];
    const step = { r: from.r + dr, c: from.c + dc };
    const jump = { r: from.r + dr * 2, c: from.c + dc * 2 };
    if (inBounds(step.r, step.c) && board[step.r][step.c] === null) moves.push({ ...step, capture: false });
    if (inBounds(jump.r, jump.c) && board[jump.r][jump.c] === null && board[step.r]?.[step.c]?.player && board[step.r][step.c].player !== piece.player) moves.push({ ...jump, capture: true });
    return moves;
  });
};
const isLegalMove = (board, from, to, player) => board[from.r]?.[from.c]?.player === player && legalMovesFor(board, from).some(move => move.r === to.r && move.c === to.c);
const hasMove = (board, player) => {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (piece?.player !== player) continue;
    if (legalMovesFor(board, { r, c }).length) return true;
  }
  return false;
};

try {
  if (Object.values(firebaseConfig).includes("REPLACE_ME")) throw new Error("Finish Firebase setup: add the Realtime Database URL to firebase-config.js.");
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app); db = getDatabase(app);
  await setPersistence(auth, browserSessionPersistence);
  await signInAnonymously(auth); uid = auth.currentUser.uid;

  const openRoom = async (requestedId, create) => {
    message.textContent = ""; selected = null;
    const id = requestedId.toUpperCase(); const currentRoomRef = roomRef(id);
    const result = await runTransaction(currentRoomRef, current => {
      if (isExpired(current)) current = null;
      if (!current && create) return { board: emptyBoard(), turn: "p1", status: "waiting", players: { p1: uid }, host: uid, createdAt: Date.now(), expiresAt: expiresAt() };
      if (!current || playerColor(current.players)) return current;
      if (current.kickedP2 === uid) return;
      if (current.players?.p2 || current.status === "finished") return;
      return { ...current, host: current.host || current.players.p1, status: "playing", players: { ...current.players, p2: uid }, expiresAt: expiresAt() };
    });
    if (!result.committed || !result.snapshot.val()) throw new Error("That room is full, expired, or does not exist.");
    roomId = id; history.replaceState(null, "", `?room=${id}`); lobby.classList.add("hidden"); game.classList.remove("hidden");
    unsubscribe?.(); unsubscribe = onValue(currentRoomRef, snapshot => { room = snapshot.val(); if (!room) return leave("Room was disbanded."); if (isExpired(room)) { set(currentRoomRef, null); return leave("Room expired."); } if (!playerColor(room.players)) return leave("You were removed from the room."); render(); });
  };

  const tryMove = (from, to) => runTransaction(roomRef(roomId), current => {
    if (isExpired(current)) return null;
    const color = playerColor(current?.players); if (!color || current.status !== "playing" || current.turn !== color) return current;
    current.board = normalizeBoard(current.board);
    const piece = current.board[from.r]?.[from.c];
    if (!isLegalMove(current.board, from, to, color)) return current;
    const dr = to.r - from.r, dc = to.c - from.c;
    if (Math.abs(dr) === 2) {
      const mid = current.board[from.r + dr / 2]?.[from.c + dc / 2];
      current.board[from.r + dr / 2][from.c + dc / 2] = null;
    }
    current.board[from.r][from.c] = null;
    if ((color === "p1" && to.r === 0) || (color === "p2" && to.r === 7)) piece.king = true;
    current.board[to.r][to.c] = piece;
    const next = color === "p1" ? "p2" : "p1";
    if (!countPieces(current.board, next) || !hasMove(current.board, next)) { current.status = "finished"; current.winner = color; }
    else current.turn = next;
    current.expiresAt = expiresAt();
    return current;
  });

  function render() {
    const mine = playerColor(room.players); document.querySelector("#room-label").textContent = `ROOM ${roomId}`;
    const board = normalizeBoard(room.board);
    const host = isHost(room);
    const previews = new Set(selected ? legalMovesFor(board, selected).map(move => `${move.r},${move.c}`) : []);
    const p1Label = document.querySelector("#p1-player");
    const p2Label = document.querySelector("#p2-player");
    const status = document.querySelector("#game-status");
    p1Label.textContent = `● P1${room.host === room.players?.p1 || !room.host ? " host" : ""}${mine === "p1" ? " (you)" : ""}`;
    p2Label.textContent = `● P2${mine === "p2" ? " (you)" : ""}`;
    p1Label.classList.toggle("active-player", room.turn === "p1" && room.status === "playing");
    p2Label.classList.toggle("active-player", room.turn === "p2" && room.status === "playing");
    playArea.classList.remove("p1-turn", "p2-turn", "my-turn", "game-over", "winner-p1", "winner-p2");
    if (room.status === "playing") playArea.classList.add(`${room.turn}-turn`);
    if (room.status === "playing" && room.turn === mine) playArea.classList.add("my-turn");
    if (room.status === "finished") playArea.classList.add("game-over", room.winner ? `winner-${room.winner}` : "");
    status.textContent = room.status === "waiting" ? "Waiting for opponent" : room.status === "finished" ? `${playerLabel(room.winner)} wins` : room.turn === mine ? "Your turn" : `${playerLabel(room.turn)} turn`;
    hostControls.classList.toggle("hidden", !host);
    kickPlayerButton.disabled = !room.players?.p2;
    boardEl.replaceChildren(...board.flatMap((row, r) => row.map((piece, c) => {
      const square = document.createElement("button");
      square.className = `checkers-square ${(r + c) % 2 ? "dark-square" : "light-square"} ${selected?.r === r && selected?.c === c ? "selected" : ""} ${previews.has(`${r},${c}`) ? "move-preview" : ""}`;
      square.setAttribute("aria-label", `Column ${c + 1}, row ${r + 1}`);
      if (piece) {
        const checker = document.createElement("span");
        checker.className = `checker-piece ${piece.player} ${piece.king ? "king" : ""}`;
        checker.textContent = piece.king ? "K" : "";
        square.append(checker);
      }
      square.onclick = () => {
        if (room.status !== "playing" || room.turn !== mine) return;
        if (piece?.player === mine) { selected = { r, c }; render(); return; }
        if (selected) { const from = selected; selected = null; tryMove(from, { r, c }); }
      };
      return square;
    })));
    renderChat(mine);
  }
  function renderChat(mine) {
    const remoteMessages = Array.isArray(room.chat) ? room.chat : [];
    const messages = mergeChat(readLocalChat(roomId), remoteMessages);
    writeLocalChat(roomId, messages);
    chatMessages.replaceChildren(...messages.map(item => {
      const row = document.createElement("p");
      row.className = `chat-message ${item.uid === uid ? "mine" : "theirs"} ${item.color || ""}`;
      const text = document.createElement("span");
      text.textContent = item.text;
      row.append(text);
      return row;
    }));
    chatInput.disabled = !mine;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  const sendChat = text => roomId && runTransaction(roomRef(roomId), current => {
    if (!current || isExpired(current)) return current;
    const color = playerColor(current.players); if (!color) return current;
    const cleanText = text.replace(/[^\x20-\x7E]/g, "").trim().slice(0, MAX_CHAT_CHARS); if (!cleanText) return current;
    const chat = Array.isArray(current.chat) ? current.chat : [];
    const message = { id: crypto.randomUUID(), uid, color, text: cleanText, createdAt: Date.now() };
    current.chat = [...chat, message].slice(-MAX_CHAT_MESSAGES);
    current.expiresAt = expiresAt();
    return current;
  });
  const hostTransaction = action => roomId && runTransaction(roomRef(roomId), current => {
    if (!current || isExpired(current) || !isHost(current)) return current;
    if (!current.host && current.players?.p1) current.host = current.players.p1;
    return action(current);
  });
  const leave = text => { unsubscribe?.(); history.replaceState(null, "", location.pathname); game.classList.add("hidden"); lobby.classList.remove("hidden"); hostControls.classList.add("hidden"); roomId = null; selected = null; if (text) message.textContent = text; };
  document.querySelector("#create-room").onclick = () => openRoom(code(), true).catch(e => message.textContent = e.message);
  document.querySelector("#join-form").onsubmit = e => { e.preventDefault(); const c = document.querySelector("#room-code").value.replace(/[^A-Z0-9]/gi, ""); if (c.length !== 6) return message.textContent = "Enter the six-letter room code."; openRoom(c, false).catch(err => message.textContent = err.message); };
  document.querySelector("#leave-room").onclick = leave;
  document.querySelector("#room-label").onclick = async () => { await navigator.clipboard.writeText(location.href); document.querySelector("#room-label").textContent = `ROOM ${roomId} · COPIED`; setTimeout(() => document.querySelector("#room-label").textContent = `ROOM ${roomId}`, 1400); };
  chatForm.onsubmit = e => { e.preventDefault(); const text = chatInput.value; chatInput.value = ""; sendChat(text); };
  document.querySelector("#new-round").onclick = () => hostTransaction(current => ({ ...current, board: emptyBoard(), turn: "p1", status: current.players?.p2 ? "playing" : "waiting", winner: null, expiresAt: expiresAt() }));
  document.querySelector("#kick-player").onclick = () => hostTransaction(current => ({ ...current, board: emptyBoard(), turn: "p1", status: "waiting", winner: null, kickedP2: current.players?.p2 || null, players: { p1: current.players.p1 }, expiresAt: expiresAt() }));
  document.querySelector("#disband-room").onclick = () => { if (roomId && confirm("Disband this room for everyone?")) set(roomRef(roomId), null); };
  const requestedRoom = new URLSearchParams(location.search).get("room"); if (requestedRoom) openRoom(requestedRoom, false).catch(e => message.textContent = e.message);
} catch (error) { message.textContent = error.message || "Firebase could not start."; }
