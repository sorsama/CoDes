# CoDes signaling relay

This optional, self-hostable WebSocket service brokers encrypted WebRTC negotiation messages. It cannot decrypt terminal data or signaling payloads. Rooms expire after 15 minutes by default and are never persisted.

```sh
docker build -t codes-signaling .
docker run --rm -p 8787:8787 codes-signaling
```

Set `ROOM_TTL_MS` to change invitation lifetime. Put the service behind TLS and connect the desktop application to `wss://your-host/signal` outside local development.
