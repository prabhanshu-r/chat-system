# Safe Chat

Safe Chat is a real-time messaging app with email/password and Google sign-in, Supabase-hosted PostgreSQL history, direct and group conversations, and one-to-one audio/video calls. The backend verifies Google sessions with Supabase Auth before issuing Safe Chat's own session token.

## Run locally

1. Install Node.js 22 or newer (required by the Supabase JavaScript SDK) and create a Supabase project.
2. In the Supabase Dashboard, open **Connect** and copy the **Session pooler** connection string (port `5432`). Use the session pooler for this long-running Node backend; do not use the browser's `anon` key or `service_role` key as a database URL.
3. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the copied connection string, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the Supabase project's API settings. The anon/publishable key is public; never use the `service_role` or secret key in the browser. Generate a private JWT secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Put the 64-character output after `JWT_SECRET=` in `.env`. Keep `.env` private; URL-encode special characters in the database password if you need to insert it into the URI.
4. Run:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:3001`. The server creates the app's tables in Supabase's `public` schema from `schema.sql` on startup.

### Enable Google sign-in

1. In Supabase, open **Authentication → Sign In / Providers → Google** and enable Google.
2. Create a Google OAuth web client in Google Cloud. Copy the callback URL shown by Supabase into the Google client's **Authorized redirect URIs**, then enter the Google client ID and secret in Supabase. Keep the Google client secret in Supabase only.
3. In Supabase **Authentication → URL Configuration**, add `http://localhost:3001` to the allowed redirect URLs. Add the deployed Vercel origin here after deployment.
4. Restart the local backend. The login screen's **Continue with Google** button uses Supabase Auth; the backend verifies the returned account and links an existing password account with the same verified email.

Passwords for email/password accounts are hashed by the backend. Never commit `.env` or share database passwords, Google client secrets, or Supabase secret/service-role keys.

## Calls

Calls are one-to-one WebRTC calls. The browser asks for microphone access for voice calls and microphone plus camera access for video calls. Use `localhost` for development or HTTPS in production.

The app includes a public STUN server for basic connection discovery. Some networks require a TURN relay. If you configure a TURN provider, set `TURN_SERVERS_JSON` privately on the backend, for example:

```json
[{"urls":"turn:turn.example.net:3478","username":"TEMPORARY_USERNAME","credential":"TEMPORARY_CREDENTIAL"}]
```

Use provider-issued, short-lived TURN credentials. Calls may not connect on restrictive networks until a TURN service is configured. Group calls are not included.

## Deploy

Vercel hosts the static web client. The Express/Socket.IO backend needs a persistent Node process, so `render.yaml` prepares it for Render. Supabase hosts the PostgreSQL database; the backend connects to it directly using the session pooler URI.

1. Create a Supabase project, enable Google sign-in as described above, and copy its **Session pooler** connection string from **Connect**.
2. Deploy the backend using `render.yaml`. Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` in Render's environment settings. Render generates `JWT_SECRET`.
3. Import this repository into Vercel. Set `PUBLIC_API_URL` to the backend’s public HTTPS URL, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Vercel project's environment variables. The configured build creates the static files in `dist`.
4. Copy the Vercel site's exact origin (for example, `https://your-app.vercel.app`) into Render's `FRONTEND_ORIGINS` and Supabase's allowed redirect URLs, then redeploy the backend and frontend.
5. For camera/microphone calls on networks that need relaying, set `TURN_SERVERS_JSON` on the backend, then redeploy.

`PUBLIC_API_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are public client configuration. Keep `DATABASE_URL`, `JWT_SECRET`, Google OAuth secrets, and any TURN credentials private. The backend currently keeps active call signaling and online presence in one server process; use a shared Socket.IO adapter before scaling it to multiple backend instances.
