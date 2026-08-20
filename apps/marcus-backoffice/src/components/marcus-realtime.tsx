"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Json } from "@/lib/marcus/types";

export type RealtimeStatus = "offline" | "connecting" | "online" | "reconnecting";
export type RealtimeError = { code: string; message: string; retryable?: boolean };
type SubscriptionMessage<T> = { data?: T; error?: RealtimeError; eventAt?: string; type: "snapshot" | "update" | "error" };
type SubscriptionListener = (message: SubscriptionMessage<unknown>) => void;
type Subscription = {
  requestId: string;
  operation: string;
  payload: Json;
  projectId?: string;
  listeners: Set<SubscriptionListener>;
};
type RealtimeContextValue = {
  status: RealtimeStatus;
  lastEventAt?: string;
  reconnect(): void;
  subscribe<T>(operation: string, payload: Json, projectId: string | undefined, listener: (message: SubscriptionMessage<T>) => void): () => void;
};
type RealtimeCallbacks<T> = {
  onData?(data: T): void;
  onError?(error: RealtimeError): void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function browserWebSocketUrl(configured: string): string {
  const url = new URL(configured);
  if (typeof window !== "undefined" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.toString();
}

function subscriptionKey(operation: string, payload: Json, projectId?: string): string {
  return JSON.stringify([operation, projectId ?? null, payload]);
}

export function MarcusRealtimeProvider({ children, url }: { children: React.ReactNode; url: string }) {
  const socketRef = useRef<WebSocket | null>(null);
  const subscriptionsRef = useRef(new Map<string, Subscription>());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionallyClosedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<RealtimeStatus>("offline");
  const [lastEventAt, setLastEventAt] = useState<string>();

  const sendSubscription = useCallback((socket: WebSocket, subscription: Subscription) => {
    socket.send(JSON.stringify({
      type: "subscribe",
      requestId: subscription.requestId,
      operation: subscription.operation,
      payload: subscription.payload,
      ...(subscription.projectId === undefined ? {} : { projectId: subscription.projectId }),
    }));
  }, []);

  const connect = useCallback(() => {
    if (subscriptionsRef.current.size === 0 || socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
    intentionallyClosedRef.current = false;
    setStatus(reconnectAttemptRef.current === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(browserWebSocketUrl(url));
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      reconnectAttemptRef.current = 0;
      setStatus("online");
      for (const subscription of subscriptionsRef.current.values()) sendSubscription(socket, subscription);
      if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
    });
    socket.addEventListener("message", (event) => {
      let message: { type?: string; requestId?: string; data?: unknown; eventAt?: string; error?: RealtimeError };
      try { message = JSON.parse(String(event.data)) as typeof message; }
      catch { return; }
      if (message.type === "pong") return;
      if (message.type === "snapshot" || message.type === "update") {
        const eventAt = message.eventAt ?? new Date().toISOString();
        setLastEventAt(eventAt);
        const subscription = [...subscriptionsRef.current.values()].find((candidate) => candidate.requestId === message.requestId);
        for (const listener of subscription?.listeners ?? []) listener({ type: message.type, data: message.data, eventAt });
        return;
      }
      if (message.type === "error") {
        const subscription = [...subscriptionsRef.current.values()].find((candidate) => candidate.requestId === message.requestId);
        for (const listener of subscription?.listeners ?? []) listener({ type: "error", error: message.error ?? { code: "WS_ERROR", message: "Error de comunicación en tiempo real." } });
      }
    });
    const disconnected = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      if (intentionallyClosedRef.current || subscriptionsRef.current.size === 0) { setStatus("offline"); return; }
      setStatus("reconnecting");
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(30_000, 750 * (2 ** Math.min(attempt, 5))) + Math.round(Math.random() * 300);
      reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
    };
    socket.addEventListener("close", disconnected);
    socket.addEventListener("error", () => socket.close());
  }, [sendSubscription, url]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    intentionallyClosedRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(connect, 0);
  }, [connect]);

  const subscribe = useCallback(<T,>(operation: string, payload: Json, projectId: string | undefined, listener: (message: SubscriptionMessage<T>) => void) => {
    const key = subscriptionKey(operation, payload, projectId);
    let subscription = subscriptionsRef.current.get(key);
    if (subscription === undefined) {
      subscription = { requestId: `rt_${crypto.randomUUID()}`, operation, payload, ...(projectId === undefined ? {} : { projectId }), listeners: new Set() };
      subscriptionsRef.current.set(key, subscription);
      if (socketRef.current?.readyState === WebSocket.OPEN) sendSubscription(socketRef.current, subscription);
    }
    const typedListener = listener as SubscriptionListener;
    subscription.listeners.add(typedListener);
    connect();
    return () => {
      const current = subscriptionsRef.current.get(key);
      current?.listeners.delete(typedListener);
      if (current !== undefined && current.listeners.size === 0) {
        subscriptionsRef.current.delete(key);
        if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "unsubscribe", requestId: current.requestId }));
      }
      if (subscriptionsRef.current.size === 0) {
        intentionallyClosedRef.current = true;
        socketRef.current?.close();
        socketRef.current = null;
        setStatus("offline");
      }
    };
  }, [connect, sendSubscription]);

  useEffect(() => () => {
    intentionallyClosedRef.current = true;
    if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
    if (heartbeatRef.current !== null) clearInterval(heartbeatRef.current);
    socketRef.current?.close();
  }, []);

  const value = useMemo<RealtimeContextValue>(() => ({ status, lastEventAt, reconnect, subscribe }), [lastEventAt, reconnect, status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): Pick<RealtimeContextValue, "status" | "lastEventAt" | "reconnect"> {
  const context = useContext(RealtimeContext);
  if (context === null) throw new Error("useRealtimeStatus must be used inside MarcusRealtimeProvider");
  return context;
}

export function useMarcusRealtime<T>(operation: string, payload: Json, projectId?: string, initialData?: T, enabled = true, callbacks?: RealtimeCallbacks<T>) {
  const context = useContext(RealtimeContext);
  if (context === null) throw new Error("useMarcusRealtime must be used inside MarcusRealtimeProvider");
  const subscribe = context.subscribe;
  const serializedPayload = JSON.stringify(payload);
  const callbacksRef = useRef(callbacks);
  const [data, setData] = useState<T | undefined>(initialData);
  const [error, setError] = useState<RealtimeError>();
  const [eventAt, setEventAt] = useState<string>();
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);
  useEffect(() => {
    if (!enabled) return;
    return subscribe<T>(operation, JSON.parse(serializedPayload) as Json, projectId, (message) => {
      if (message.data !== undefined) {
        setData(message.data);
        callbacksRef.current?.onData?.(message.data);
      }
      setError(message.error);
      if (message.error !== undefined) callbacksRef.current?.onError?.(message.error);
      if (message.eventAt !== undefined) setEventAt(message.eventAt);
    });
  }, [enabled, operation, projectId, serializedPayload, subscribe]);
  return { data, error, eventAt, status: context.status, reconnect: context.reconnect };
}
