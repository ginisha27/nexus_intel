import { io as socketIo } from "socket.io-client";

// Event type metadata used by the Live Intelligence Feed panel.
export const EVENT_META: Record<string,{label:string;icon:string;color:string}> = {
  event_detected:  { label:"Event Detected",   icon:"◉", color:"#06b6d4" },
  correlation:     { label:"Entity Correlated", icon:"◈", color:"#6366f1" },
  risk_updated:    { label:"Risk Updated",      icon:"▲", color:"#f59e0b" },
  alert_generated: { label:"Alert Generated",   icon:"⚠", color:"#dc2626" },
  wallet_updated:  { label:"Wallet Updated",    icon:"◆", color:"#22d3ee" },
};

// Shared socket singleton (created once, reused across mounts).
let _socket: ReturnType<typeof socketIo> | null = null;
export function getSocket() {

  if (!_socket) {
    _socket = socketIo("http://localhost:4000", { transports: ["websocket","polling"] });
  }
  return _socket;

}
