# Safe Chat

Safe Chat is a real-time messaging app with registered accounts, Supabase-hosted PostgreSQL message history, direct and group conversations, and one-to-one audio/video calls. The Express backend connects to Supabase PostgreSQL using the existing `pg` driver; no Supabase client key is exposed to the browser.

## Run locally

1. Install Node.js 20 or newer and create a Supabase project.
2. In the Supabase Dashboard, open **Connect** and copy the **Session pooler** connection string (port `5432`). Use the session pooler for this long-running Node backend; do not use the browser's `anon` key or `service_role` key as a database URL.
3. Copy `.env.example` to `.env`, replace the `DATABASE_URL` example with the copied connection string, and replace `JWT_SECRET` with a private random value of at least 32 characters. Keep `.env` private; URL-encode special characters in the database password if you need to insert it into the URI.
4. Run:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:3001` and create an account. The server creates the app's tables in Supabase's `public` schema from `schema.sql` on startup.

The app currently manages its own email/password accounts in its `users` table; it does not use Supabase Auth. Passwords are hashed by the backend. Never commit `.env` or paste database passwords into chat.

## Calls

Calls are one-to-one WebRTC calls. The browser asks for microphone access for voice calls and microphone plus camera access for video calls. Use `localhost` for development or HTTPS in production.

The app includes a public STUN server for basic connection discovery. Some networks require a TURN relay. If you configure a TURN provider, set `TURN_SERVERS_JSON` privately on the backend, for example:

```json
[{"urls":"turn:turn.example.net:3478","username":"TEMPORARY_USERNAME","credential":"TEMPORARY_CREDENTIAL"}]
```

Use provider-issued, short-lived TURN credentials. Calls may not connect on restrictive networks until a TURN service is configured. Group calls are not included.

## Deploy

Vercel hosts the static web client. The Express/Socket.IO backend needs a persistent Node process, so `render.yaml` prepares it for Render. Supabase hosts the PostgreSQL database; the backend connects to it directly using the session pooler URI.

1. Create a Supabase project and copy its **Session pooler** connection string from **Connect**.
2. Deploy the backend using `render.yaml`. Set `DATABASE_URL` to the Supabase session pooler URI in Render's private environment settings. Render generates `JWT_SECRET` for the service.
3. Import this repository into Vercel. Set `PUBLIC_API_URL` to the backend’s public HTTPS URL, then deploy. The configured build creates the static files in `dist`.
4. Copy the Vercel site’s exact origin (for example, `https://your-app.vercel.app`) into the Render service’s `FRONTEND_ORIGINS` variable and redeploy the backend.
5. For camera/microphone calls on networks that need relaying, set `TURN_SERVERS_JSON` on the backend, then redeploy.

`PUBLIC_API_URL` is a public address, not a secret. Keep `DATABASE_URL`, `JWT_SECRET`, and any TURN credentials in provider environment settings only. The backend currently keeps active call signaling and online presence in one server process; use a shared Socket.IO adapter before scaling it to multiple backend instances.
