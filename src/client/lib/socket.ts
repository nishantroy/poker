import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ClientMessage, HandRecordView, HandSummary, LogLine, ServerMessage, SessionResultRow, TableView } from "@shared/protocol";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface TableConn {
  view: TableView | null;
  log: LogLine[];
  chat: ChatMessage[];
  status: ConnStatus;
  error: { code: string; message: string; at: number } | null;
  ended: SessionResultRow[] | null;
  send: (m: ClientMessage) => void;
  /** estimated server clock offset: serverTime - Date.now() */
  offset: number;
  notFound: boolean;
  hands: HandSummary[] | null;
  records: Record<number, HandRecordView>;
}

const MAX_LOG = 300;

export function useTable(code: string): TableConn {
  const [view, setView] = useState<TableView | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<TableConn["error"]>(null);
  const [ended, setEnded] = useState<SessionResultRow[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [hands, setHands] = useState<HandSummary[] | null>(null);
  const [records, setRecords] = useState<Record<number, HandRecordView>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const attempts = useRef(0);
  const closedByUs = useRef(false);
  const timer = useRef<number | null>(null);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  useEffect(() => {
    closedByUs.current = false;
    attempts.current = 0;
    let ping: number | null = null;

    const connect = () => {
      if (closedByUs.current) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/table/${encodeURIComponent(code)}`);
      wsRef.current = ws;
      setStatus(attempts.current === 0 ? "connecting" : "reconnecting");

      ws.onopen = () => {
        attempts.current = 0;
        setStatus("open");
        if (ping) clearInterval(ping);
        ping = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 20_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        let m: ServerMessage;
        try {
          m = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        switch (m.t) {
          case "state":
            setView(m.view);
            setOffset(m.view.serverTime - Date.now());
            break;
          case "log":
            setLog((prev) => {
              const seen = new Set(prev.map((l) => l.id));
              const merged = [...prev, ...m.lines.filter((l) => !seen.has(l.id))].sort((a, b) => a.id - b.id);
              return merged.length > MAX_LOG ? merged.slice(merged.length - MAX_LOG) : merged;
            });
            break;
          case "chat":
            setChat((prev) => {
              const seen = new Set(prev.map((l) => l.id));
              return [...prev, ...m.messages.filter((l) => !seen.has(l.id))].sort((a, b) => a.id - b.id).slice(-150);
            });
            break;
          case "error":
            setError({ code: m.code, message: m.message, at: Date.now() });
            break;
          case "ended":
            setEnded(m.results);
            break;
          case "hands":
            setHands(m.hands);
            break;
          case "hand":
            setRecords((prev) => ({ ...prev, [m.hand.number]: m.hand }));
            break;
          case "pong":
            setOffset(m.serverTime - Date.now());
            break;
        }
      };
      ws.onclose = (ev) => {
        if (ping) clearInterval(ping);
        ping = null;
        if (closedByUs.current) return;
        if (ev.code === 1008 || ev.code === 4404) {
          setNotFound(true);
          setStatus("closed");
          return;
        }
        attempts.current += 1;
        if (attempts.current > 40) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        const delay = Math.min(8000, 400 * 2 ** Math.min(attempts.current, 5)) + Math.random() * 300;
        timer.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    };

    // probe first so a missing table yields a clean 404 rather than a reconnect loop
    fetch(`/api/tables/${encodeURIComponent(code)}`, { credentials: "same-origin" }).then((r) => {
      if (r.status === 404) {
        setNotFound(true);
        setStatus("closed");
      } else connect();
    }).catch(connect);

    const onVisible = () => {
      if (document.visibilityState === "visible" && wsRef.current && wsRef.current.readyState !== WebSocket.OPEN && !closedByUs.current) {
        if (timer.current) clearTimeout(timer.current);
        attempts.current = Math.min(attempts.current, 1);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closedByUs.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      if (ping) clearInterval(ping);
      wsRef.current?.close();
    };
  }, [code]);

  return { view, log, chat, status, error, ended, send, offset, notFound, hands, records };
}
