export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }

      const roomId = url.searchParams.get("room");
      const name = url.searchParams.get("name") || "Anonymous";
      if (!roomId) return new Response("Missing room", { status: 400 });

      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      return stub.fetch(`https://room.internal/ws?name=${encodeURIComponent(name)}`, request);
    }

    return new Response(JSON.stringify({ ok: true, message: "AirLink signaling worker" }), {
      headers: { "content-type": "application/json" },
    });
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.peers = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/ws" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("Not found", { status: 404 });
    }

    const peerId = crypto.randomUUID();
    const name = url.searchParams.get("name") || "Anonymous";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.peers.set(peerId, { socket: server, name });

    server.send(JSON.stringify({ type: "welcome", peerId, name }));
    this.broadcast({ type: "peer-joined", peerId, name }, peerId);

    server.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.routeSignal(peerId, name, msg);
      } catch {
        server.send(JSON.stringify({ type: "error", message: "Invalid payload." }));
      }
    });

    const closePeer = () => {
      if (!this.peers.has(peerId)) return;
      this.peers.delete(peerId);
      this.broadcast({ type: "peer-left", peerId }, peerId);
    };

    server.addEventListener("close", closePeer);
    server.addEventListener("error", closePeer);

    return new Response(null, { status: 101, webSocket: client });
  }

  routeSignal(fromPeerId, fromName, msg) {
    if (msg.type !== "signal" || !msg.payload) return;

    const target = msg.payload.target;
    const payload = {
      type: "signal",
      from: fromPeerId,
      name: fromName,
      payload: msg.payload,
    };

    if (!target) {
      this.broadcast(payload, fromPeerId);
      return;
    }

    const targetPeer = this.peers.get(target);
    if (targetPeer) {
      targetPeer.socket.send(JSON.stringify(payload));
    }
  }

  broadcast(message, exceptPeerId = null) {
    const serialized = JSON.stringify(message);
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId === exceptPeerId) continue;
      try {
        peer.socket.send(serialized);
      } catch {
        this.peers.delete(peerId);
      }
    }
  }
}
