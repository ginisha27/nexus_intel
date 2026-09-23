import type { Server } from "socket.io";

// Holds the Socket.IO server instance so any route can emit live events
// (e.g. the "Live Intelligence Feed" panel, risk-score updates) without
// passing `io` through every function signature.
let ioInstance: Server | null = null;

export function setIo(io: Server) {
  ioInstance = io;
}

export function getIo(): Server {
  if (!ioInstance) throw new Error("Socket.IO not initialized yet");
  return ioInstance;
}
