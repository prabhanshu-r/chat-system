# Orbit Chat

Orbit Chat is a small real-time messaging app with registered accounts, PostgreSQL message history, direct and group conversations, and one-to-one audio/video calls.

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Create a PostgreSQL database named `chat_system` in pgAdmin.
3. Copy `.env.example` to `.env`, then set `DATABASE_URL` to the connection URL for that database and replace `JWT_SECRET` with a private random value of at least 32 characters.
4. Run:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:3001` and create an account. The server creates the tables from `schema.sql` on startup.

Never commit `.env` or paste database passwords into chat. A PostgreSQL server running on `localhost` is available only on your computer.

## Calls

Calls are one-to-one WebRTC calls. The browser asks for microphone access for voice calls and microphone plus camera access for video calls. Use `localhost` for development or HTTPS in production.

The app includes a public STUN server for basic connection discovery. Some networks require a TURN relay. If you configure a TURN provider, set `TURN_SERVERS_JSON` privately on the backend, for example:

```json
[{"urls":"turn:turn.example.net:3478","username":"TEMPORARY_USERNAME","credential":"TEMPORARY_CREDENTIAL"}]
```

Use provider-issued, short-lived TURN credentials. Calls may not connect on restrictive networks until a TURN service is configured. Group calls are not included.

## Deploy

Vercel hosts the static web client. The Express/Socket.IO backend needs a persistent Node process, so `render.yaml` prepares it for Render. The database must also be hosted online; a local pgAdmin connection cannot be reached from Render.

1. Create a hosted PostgreSQL database with a provider such as Neon or Render, and keep its connection URL private.
2. Deploy the backend using `render.yaml`. Set `DATABASE_URL` to the hosted database URL. Render generates `JWT_SECRET` for the service.
3. Import this repository into Vercel. Set `PUBLIC_API_URL` to the backend’s public HTTPS URL, then deploy. The configured build creates the static files in `dist`.
4. Copy the Vercel site’s exact origin (for example, `https://your-app.vercel.app`) into the Render service’s `FRONTEND_ORIGINS` variable and redeploy the backend.
5. For camera/microphone calls on networks that need relaying, set `TURN_SERVERS_JSON` on the backend, then redeploy.

`PUBLIC_API_URL` is a public address, not a secret. Keep `DATABASE_URL`, `JWT_SECRET`, and any TURN credentials in provider environment settings only. The backend currently keeps active call signaling and online presence in one server process; use a shared Socket.IO adapter before scaling it to multiple backend instances.
