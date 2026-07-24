const MAX_SEEN_IDS = 2000;

function toWsUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    return url.toString();
  } catch {
    return raw;
  }
}

function isExpired(event) {
  if (!event?.detected_at || !event?.ttl_seconds) return false;
  const detected = new Date(event.detected_at).getTime();
  if (!Number.isFinite(detected)) return false;
  return Date.now() - detected > Number(event.ttl_seconds) * 1000;
}

export function connectTriggerBus({ wsUrl, accessToken, onStatus, onTrigger }) {
  const seenIds = new Set();
  const seenOrder = [];
  let closedByClient = false;
  let reconnectTimer = null;
  let socket = null;

  const setStatus = (status) => {
    if (typeof onStatus === "function") onStatus(status);
  };

  const markSeen = (key) => {
    if (!key || seenIds.has(key)) return;
    seenIds.add(key);
    seenOrder.push(key);
    if (seenOrder.length > MAX_SEEN_IDS) {
      const oldest = seenOrder.shift();
      if (oldest) seenIds.delete(oldest);
    }
  };

  const connect = () => {
    const target = toWsUrl(wsUrl);
    if (!target || !accessToken) {
      setStatus("disabled");
      return;
    }

    const sep = target.includes("?") ? "&" : "?";
    const fullUrl = `${target}${sep}token=${encodeURIComponent(accessToken)}`;

    setStatus("connecting");
    socket = new WebSocket(fullUrl);

    socket.onopen = () => {
      setStatus("connected");
    };

    socket.onmessage = async (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }

      const event = payload?.event || payload;
      if (!event || typeof event !== "object") return;
      if (payload?.type && payload.type !== "trigger") return;

      const dedupeKey = event.trigger_id || event.event_id;
      if (!dedupeKey) return;
      if (seenIds.has(dedupeKey)) return;
      if (isExpired(event)) return;

      markSeen(dedupeKey);

      const ack = (status, detail = null) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || !event.event_id) return;
        socket.send(JSON.stringify({
          type: "ack",
          event_id: event.event_id,
          trigger_id: event.trigger_id || null,
          status,
          detail,
          ts: new Date().toISOString(),
        }));
      };

      try {
        await onTrigger?.(event, ack);
      } catch (error) {
        ack("error", error?.message || "Trigger handling failed");
      }
    };

    socket.onerror = () => {
      setStatus("error");
    };

    socket.onclose = () => {
      socket = null;
      if (closedByClient) return;
      setStatus("reconnecting");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };
  };

  connect();

  return () => {
    closedByClient = true;
    clearTimeout(reconnectTimer);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "Client shutdown");
    }
    socket = null;
    setStatus("disconnected");
  };
}
