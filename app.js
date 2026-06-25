import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { browserSessionPersistence, getAuth, setPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase, onValue, ref, runTransaction, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const boardEl = document.querySelector("#board");
const lobby = document.querySelector("#lobby");
const game = document.querySelector("#game");
const message = document.querySelector("#message");
let uid, roomId, room, unsubscribe;
const emptyBoard = () => Array(6).fill(null).map(() => Array(7).fill(null));
const normalizeBoard = board => Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => board?.[r]?.[c] ?? null));
const code = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), n => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
const playerColor = players => players?.red === uid ? "red" : players?.yellow === uid ? "yellow" : null;

try {
  if (Object.values(firebaseConfig).includes("REPLACE_ME")) throw new Error("Finish Firebase setup: add the Realtime Database URL to firebase-config.js.");
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app); const db = getDatabase(app);
  await setPersistence(auth, browserSessionPersistence);
  await signInAnonymously(auth); uid = auth.currentUser.uid;

  const openRoom = async (requestedId, create) => {
    const id = requestedId.toUpperCase(); const roomRef = ref(db, `rooms/${id}`);
    const result = await runTransaction(roomRef, current => {
      if (!current && create) return { board: emptyBoard(), turn: "red", status: "waiting", players: { red: uid }, createdAt: Date.now() };
      if (!current || playerColor(current.players)) return current;
      if (current.players?.yellow || current.status === "finished") return;
      return { ...current, status: "playing", players: { ...current.players, yellow: uid } };
    });
    if (!result.committed) throw new Error("That room is full or does not exist.");
    roomId = id; history.replaceState(null, "", `?room=${id}`); lobby.classList.add("hidden"); game.classList.remove("hidden");
    unsubscribe?.(); unsubscribe = onValue(roomRef, snapshot => { room = snapshot.val(); if (!room) return leave(); render(); });
  };

  const winner = (b, r, c, color) => [[0,1],[1,0],[1,1],[1,-1]].some(([dr,dc]) => [-3,-2,-1,0].some(n => [0,1,2,3].every(i => b[r+(n+i)*dr]?.[c+(n+i)*dc] === color)));
  const move = column => runTransaction(ref(db, `rooms/${roomId}`), current => {
    const color = playerColor(current?.players); if (!color || current.status !== "playing" || current.turn !== color) return;
    current.board = normalizeBoard(current.board);
    const row = [...current.board].map(x => x[column]).lastIndexOf(null); if (row < 0) return;
    current.board[row][column] = color;
    if (winner(current.board, row, column, color)) { current.status = "finished"; current.winner = color; }
    else if (current.board.flat().every(Boolean)) current.status = "finished";
    else current.turn = color === "red" ? "yellow" : "red";
    return current;
  });
  function render() {
    const mine = playerColor(room.players); document.querySelector("#room-label").textContent = `ROOM ${roomId}`;
    const currentBoard = normalizeBoard(room.board);
    document.querySelector("#red-player").textContent = `● Red${mine === "red" ? " (you)" : ""}`;
    document.querySelector("#yellow-player").textContent = `● Yellow${mine === "yellow" ? " (you)" : ""}`;
    document.querySelector("#game-status").textContent = room.status === "waiting" ? "Waiting for opponent…" : room.status === "finished" ? (room.winner ? `${room.winner[0].toUpperCase()+room.winner.slice(1)} wins!` : "It’s a draw!") : room.turn === mine ? "Your turn" : "Opponent’s turn";
    boardEl.replaceChildren(...currentBoard.flatMap((row, r) => row.map((value, c) => { const b = document.createElement("button"); b.className = `cell ${value || ""}`; b.disabled = room.status !== "playing" || room.turn !== mine || value !== null; b.setAttribute("aria-label", `Column ${c + 1}, row ${r + 1}`); b.onclick = () => move(c); return b; })));
  }
  const leave = () => { unsubscribe?.(); history.replaceState(null, "", location.pathname); game.classList.add("hidden"); lobby.classList.remove("hidden"); roomId = null; };
  document.querySelector("#create-room").onclick = () => openRoom(code(), true).catch(e => message.textContent = e.message);
  document.querySelector("#join-form").onsubmit = e => { e.preventDefault(); const c = document.querySelector("#room-code").value.replace(/[^A-Z0-9]/gi, ""); if (c.length !== 6) return message.textContent = "Enter the six-letter room code."; openRoom(c, false).catch(err => message.textContent = err.message); };
  document.querySelector("#leave-room").onclick = leave;
  document.querySelector("#copy-link").onclick = async () => { await navigator.clipboard.writeText(location.href); document.querySelector("#copy-link").textContent = "Invite link copied"; };
  document.querySelector("#new-round").onclick = () => roomId && set(ref(db, `rooms/${roomId}`), { ...room, board: emptyBoard(), turn: "red", status: "playing", winner: null });
  const requestedRoom = new URLSearchParams(location.search).get("room"); if (requestedRoom) openRoom(requestedRoom, false).catch(e => message.textContent = e.message);
} catch (error) { message.textContent = error.message || "Firebase could not start."; }
