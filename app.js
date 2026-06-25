import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { browserSessionPersistence, getAuth, setPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase, onValue, ref, runTransaction, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const boardEl = document.querySelector("#board");
const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const message = document.querySelector("#message");
const hostControls = document.querySelector("#host-controls");
const kickPlayerButton = document.querySelector("#kick-player");
const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
let uid, roomId, room, unsubscribe;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CHAT_MESSAGES = 40;
const MAX_LOCAL_CHAT_MESSAGES = 250;
const MAX_CHAT_CHARS = 255;
const expiresAt = () => Date.now() + ROOM_TTL_MS;
const isExpired = roomData => roomData?.expiresAt && roomData.expiresAt <= Date.now();
const emptyBoard = () => Array(6).fill(null).map(() => Array(7).fill(null));
const normalizeBoard = board => Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => board?.[r]?.[c] ?? null));
const code = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), n => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
const playerColor = players => players?.p1 === uid ? "p1" : players?.p2 === uid ? "p2" : null;
const playerLabel = color => color === "p1" ? "P1" : "P2";
const isHost = roomData => roomData?.host === uid || (!roomData?.host && roomData?.players?.p1 === uid);
const chatKey = id => `connect-four-chat:${id}`;
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

try {
  if (Object.values(firebaseConfig).includes("REPLACE_ME")) throw new Error("Finish Firebase setup: add the Realtime Database URL to firebase-config.js.");
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app); const db = getDatabase(app);
  await setPersistence(auth, browserSessionPersistence);
  await signInAnonymously(auth); uid = auth.currentUser.uid;

  const openRoom = async (requestedId, create) => {
    message.textContent = "";
    const id = requestedId.toUpperCase(); const roomRef = ref(db, `rooms/${id}`);
    const result = await runTransaction(roomRef, current => {
      if (isExpired(current)) current = null;
      if (!current && create) return { board: emptyBoard(), turn: "p1", status: "waiting", players: { p1: uid }, host: uid, createdAt: Date.now(), expiresAt: expiresAt() };
      if (!current || playerColor(current.players)) return current;
      if (current.kickedP2 === uid) return;
      if (current.players?.p2 || current.status === "finished") return;
      return { ...current, host: current.host || current.players.p1, status: "playing", players: { ...current.players, p2: uid }, expiresAt: expiresAt() };
    });
    if (!result.committed || !result.snapshot.val()) throw new Error("That room is full, expired, or does not exist.");
    roomId = id; history.replaceState(null, "", `?room=${id}`); lobby.classList.add("hidden"); game.classList.remove("hidden");
    unsubscribe?.(); unsubscribe = onValue(roomRef, snapshot => { room = snapshot.val(); if (!room) return leave("Room was disbanded."); if (isExpired(room)) { set(roomRef, null); return leave("Room expired."); } if (!playerColor(room.players)) return leave("You were removed from the room."); render(); });
  };

  const winner = (b, r, c, color) => [[0,1],[1,0],[1,1],[1,-1]].some(([dr,dc]) => [-3,-2,-1,0].some(n => [0,1,2,3].every(i => b[r+(n+i)*dr]?.[c+(n+i)*dc] === color)));
  const move = column => runTransaction(ref(db, `rooms/${roomId}`), current => {
    if (isExpired(current)) return null;
    const color = playerColor(current?.players); if (!color || current.status !== "playing" || current.turn !== color) return;
    current.board = normalizeBoard(current.board);
    const row = [...current.board].map(x => x[column]).lastIndexOf(null); if (row < 0) return;
    current.board[row][column] = color;
    if (winner(current.board, row, column, color)) { current.status = "finished"; current.winner = color; }
    else if (current.board.flat().every(Boolean)) current.status = "finished";
    else current.turn = color === "p1" ? "p2" : "p1";
    current.expiresAt = expiresAt();
    return current;
  });
  function render() {
    const mine = playerColor(room.players); document.querySelector("#room-label").textContent = `ROOM ${roomId}`;
    const currentBoard = normalizeBoard(room.board);
    const host = isHost(room);
    document.querySelector("#p1-player").textContent = `● P1${room.host === room.players?.p1 || !room.host ? " host" : ""}${mine === "p1" ? " (you)" : ""}`;
    document.querySelector("#p2-player").textContent = `● P2${mine === "p2" ? " (you)" : ""}`;
    document.querySelector("#game-status").textContent = room.status === "waiting" ? "Waiting for opponent…" : room.status === "finished" ? (room.winner ? `${playerLabel(room.winner)} wins!` : "It’s a draw!") : room.turn === mine ? "Your turn" : "Opponent’s turn";
    hostControls.classList.toggle("hidden", !host);
    kickPlayerButton.disabled = !room.players?.p2;
    boardEl.replaceChildren(...currentBoard.flatMap((row, r) => row.map((value, c) => { const b = document.createElement("button"); b.className = `cell ${value || ""}`; b.disabled = room.status !== "playing" || room.turn !== mine || value !== null; b.setAttribute("aria-label", `Column ${c + 1}, row ${r + 1}`); b.onclick = () => move(c); return b; })));
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
  const sendChat = text => roomId && runTransaction(ref(db, `rooms/${roomId}`), current => {
    if (!current || isExpired(current)) return current;
    const color = playerColor(current.players); if (!color) return current;
    const cleanText = text.replace(/[^\x20-\x7E]/g, "").trim().slice(0, MAX_CHAT_CHARS); if (!cleanText) return current;
    const chat = Array.isArray(current.chat) ? current.chat : [];
    const message = { id: crypto.randomUUID(), uid, color, text: cleanText, createdAt: Date.now() };
    current.chat = [...chat, message].slice(-MAX_CHAT_MESSAGES);
    current.expiresAt = expiresAt();
    return current;
  });
  const hostTransaction = action => roomId && runTransaction(ref(db, `rooms/${roomId}`), current => {
    if (!current || isExpired(current) || !isHost(current)) return current;
    if (!current.host && current.players?.p1) current.host = current.players.p1;
    return action(current);
  });
  const leave = text => { unsubscribe?.(); history.replaceState(null, "", location.pathname); game.classList.add("hidden"); lobby.classList.remove("hidden"); hostControls.classList.add("hidden"); roomId = null; if (text) message.textContent = text; };
  document.querySelector("#create-room").onclick = () => openRoom(code(), true).catch(e => message.textContent = e.message);
  document.querySelector("#join-form").onsubmit = e => { e.preventDefault(); const c = document.querySelector("#room-code").value.replace(/[^A-Z0-9]/gi, ""); if (c.length !== 6) return message.textContent = "Enter the six-letter room code."; openRoom(c, false).catch(err => message.textContent = err.message); };
  document.querySelector("#leave-room").onclick = leave;
  document.querySelector("#copy-link").onclick = async () => { await navigator.clipboard.writeText(location.href); document.querySelector("#copy-link").textContent = "Invite link copied"; };
  chatForm.onsubmit = e => { e.preventDefault(); const text = chatInput.value; chatInput.value = ""; sendChat(text); };
  document.querySelector("#new-round").onclick = () => hostTransaction(current => ({ ...current, board: emptyBoard(), turn: "p1", status: current.players?.p2 ? "playing" : "waiting", winner: null, expiresAt: expiresAt() }));
  document.querySelector("#kick-player").onclick = () => hostTransaction(current => ({ ...current, board: emptyBoard(), turn: "p1", status: "waiting", winner: null, kickedP2: current.players?.p2 || null, players: { p1: current.players.p1 }, expiresAt: expiresAt() }));
  document.querySelector("#disband-room").onclick = () => { if (roomId && confirm("Disband this room for everyone?")) set(ref(db, `rooms/${roomId}`), null); };
  const requestedRoom = new URLSearchParams(location.search).get("room"); if (requestedRoom) openRoom(requestedRoom, false).catch(e => message.textContent = e.message);
} catch (error) { message.textContent = error.message || "Firebase could not start."; }
