require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const http = require("node:http");
const { Server } = require("socket.io");
const { initializeDatabase, pool } = require("./db");
const { isUuid, normalizeEmail, validateRegistration } = require("./validators");

const port = Number(process.env.PORT) || 3001;
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 characters.");
}

const publicApiUrl = (process.env.PUBLIC_API_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const apiOrigin = new URL(publicApiUrl).origin;
const allowedOrigins = (process.env.FRONTEND_ORIGINS || `http://localhost:${port}`)
  .split(",")
  .map((origin) => new URL(origin.trim()).origin);

const app = express();
app.set("trust proxy", 1);
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

const onlineUsers = new Map();
const activeCalls = new Map();
const socketClientPath = path.join(
  __dirname,
  "node_modules",
  "socket.io",
  "client-dist",
  "socket.io.min.js",
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", apiOrigin, ...allowedOrigins, "ws:", "wss:"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "20kb" }));

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function requireAuth(request, response, next) {
  const authorization = request.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    response.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  try {
    const claims = jwt.verify(token, jwtSecret, { issuer: "orbit-chat" });
    if (typeof claims.sub !== "string" || !isUuid(claims.sub)) {
      response.status(401).json({ error: "Your session is invalid. Please sign in again." });
      return;
    }
    request.userId = claims.sub;
    next();
  } catch {
    response.status(401).json({ error: "Your session expired. Please sign in again." });
  }
}

function issueToken(userId) {
  return jwt.sign({ sub: userId }, jwtSecret, {
    expiresIn: "12h",
    issuer: "orbit-chat",
  });
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

function sendSocketResult(callback, result) {
  if (typeof callback === "function") callback(result);
}

function sendSocketError(callback, message) {
  sendSocketResult(callback, { ok: false, error: message });
}

async function isConversationMember(conversationId, userId) {
  const result = await pool.query(
    "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    [conversationId, userId],
  );
  return result.rowCount > 0;
}

app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get("/styles.css", (request, response) => {
  response.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/client.js", (request, response) => {
  response.sendFile(path.join(__dirname, "client.js"));
});

app.get("/calls.js", (request, response) => {
  response.sendFile(path.join(__dirname, "calls.js"));
});

app.get("/socket.io-client.js", (request, response) => {
  response.sendFile(socketClientPath);
});

app.get("/config.js", (request, response) => {
  response.type("application/javascript").send(
    `window.CHAT_CONFIG = ${JSON.stringify({ apiUrl: publicApiUrl })};`,
  );
});

app.get(
  "/api/health",
  asyncRoute(async (request, response) => {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  }),
);

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.post(
  "/api/auth/register",
  authRateLimit,
  asyncRoute(async (request, response) => {
    const account = validateRegistration(request.body);
    if (!account.ok) {
      response.status(400).json({ error: account.error });
      return;
    }

    const passwordHash = await bcrypt.hash(account.password, 12);
    const userId = crypto.randomUUID();
    try {
      const result = await pool.query(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email`,
        [userId, account.name, account.email, passwordHash],
      );
      const user = publicUser(result.rows[0]);
      response.status(201).json({ token: issueToken(user.id), user });
    } catch (error) {
      if (error.code === "23505") {
        response.status(409).json({ error: "An account with that email already exists." });
        return;
      }
      throw error;
    }
  }),
);

app.post(
  "/api/auth/login",
  authRateLimit,
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!email || !password || email.length > 254 || Buffer.byteLength(password, "utf8") > 72) {
      response.status(400).json({ error: "Enter your email and password." });
      return;
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email],
    );
    const userRow = result.rows[0];
    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash))) {
      response.status(401).json({ error: "Email or password is incorrect." });
      return;
    }

    const user = publicUser(userRow);
    response.json({ token: issueToken(user.id), user });
  }),
);

app.get(
  "/api/me",
  requireAuth,
  asyncRoute(async (request, response) => {
    const result = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [
      request.userId,
    ]);
    if (result.rowCount === 0) {
      response.status(401).json({ error: "This account no longer exists." });
      return;
    }
    response.json({ user: publicUser(result.rows[0]) });
  }),
);

app.get(
  "/api/users",
  requireAuth,
  asyncRoute(async (request, response) => {
    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim().replace(/[\\%_]/g, "")
        : "";
    if (search.length < 2) {
      response.json({ users: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id, name, email
       FROM users
       WHERE id <> $1 AND (name ILIKE $2 OR email ILIKE $2)
       ORDER BY name
       LIMIT 30`,
      [request.userId, `%${search}%`],
    );
    response.json({
      users: result.rows.map((row) => ({
        ...publicUser(row),
        online: onlineUsers.has(row.id),
      })),
    });
  }),
);

app.get(
  "/api/conversations",
  requireAuth,
  asyncRoute(async (request, response) => {
    const result = await pool.query(
      `SELECT
         c.id,
         c.is_group AS "isGroup",
         COALESCE(c.title, other_user.name) AS name,
         CASE WHEN c.is_group THEN NULL ELSE other_user.id END AS "otherUserId",
         COALESCE(latest.body, '') AS preview,
         COALESCE(latest.created_at, c.created_at) AS "lastAt",
         (SELECT COUNT(*)::int FROM conversation_members cm
          WHERE cm.conversation_id = c.id) AS "memberCount"
       FROM conversation_members mine
       JOIN conversations c ON c.id = mine.conversation_id
       LEFT JOIN conversation_members other_member
         ON c.is_group = FALSE
         AND other_member.conversation_id = c.id
         AND other_member.user_id <> mine.user_id
       LEFT JOIN users other_user ON other_user.id = other_member.user_id
       LEFT JOIN LATERAL (
         SELECT body, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE mine.user_id = $1
       ORDER BY COALESCE(latest.created_at, c.created_at) DESC`,
      [request.userId],
    );

    response.json({
      conversations: result.rows.map((conversation) => ({
        ...conversation,
        type: conversation.isGroup ? "group" : "direct",
        presence:
          conversation.otherUserId && onlineUsers.has(conversation.otherUserId)
            ? "Online"
            : conversation.isGroup
              ? `${conversation.memberCount} members`
              : "Offline",
      })),
    });
  }),
);

app.get(
  "/api/conversations/:conversationId/messages",
  requireAuth,
  asyncRoute(async (request, response) => {
    const { conversationId } = request.params;
    if (!isUuid(conversationId)) {
      response.status(400).json({ error: "Conversation ID is invalid." });
      return;
    }
    if (!(await isConversationMember(conversationId, request.userId))) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM (
         SELECT m.id, m.conversation_id AS "conversationId",
                m.sender_id AS "senderId", u.name AS "senderName",
                m.body AS text, m.created_at AS "createdAt"
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 200
       ) recent
       ORDER BY "createdAt" ASC`,
      [conversationId],
    );
    response.json({ messages: result.rows });
  }),
);

app.post(
  "/api/conversations/direct",
  requireAuth,
  asyncRoute(async (request, response) => {
    const otherUserId =
      typeof request.body?.userId === "string" ? request.body.userId.toLowerCase() : "";
    if (!isUuid(otherUserId) || otherUserId === request.userId) {
      response.status(400).json({ error: "Choose another registered user." });
      return;
    }
    const otherUser = await pool.query("SELECT 1 FROM users WHERE id = $1", [otherUserId]);
    if (otherUser.rowCount === 0) {
      response.status(404).json({ error: "That account could not be found." });
      return;
    }

    const directKey = [request.userId, otherUserId].sort().join(":");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO conversations (id, is_group, title, direct_key)
         VALUES ($1, FALSE, NULL, $2)
         ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [crypto.randomUUID(), directKey],
      );
      let conversationId = inserted.rows[0]?.id;
      if (!conversationId) {
        const existing = await client.query(
          "SELECT id FROM conversations WHERE direct_key = $1",
          [directKey],
        );
        conversationId = existing.rows[0].id;
      }
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3)
         ON CONFLICT DO NOTHING`,
        [conversationId, request.userId, otherUserId],
      );
      await client.query("COMMIT");
      response.status(201).json({ conversationId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/conversations/group",
  requireAuth,
  asyncRoute(async (request, response) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const requestedIds = request.body?.userIds;
    if (
      title.length < 2 ||
      title.length > 80 ||
      !Array.isArray(requestedIds) ||
      requestedIds.length < 1 ||
      requestedIds.length > 29 ||
      requestedIds.some((userId) => !isUuid(userId))
    ) {
      response.status(400).json({ error: "Enter a group name and choose 1–29 people." });
      return;
    }

    const userIds = [...new Set(requestedIds.map((userId) => userId.toLowerCase()))].filter(
      (userId) => userId !== request.userId,
    );
    if (userIds.length === 0) {
      response.status(400).json({ error: "Choose at least one other person." });
      return;
    }
    const users = await pool.query("SELECT id FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    if (users.rowCount !== userIds.length) {
      response.status(400).json({ error: "One or more selected accounts no longer exist." });
      return;
    }

    const client = await pool.connect();
    const conversationId = crypto.randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO conversations (id, is_group, title) VALUES ($1, TRUE, $2)",
        [conversationId, title],
      );
      const members = [request.userId, ...userIds];
      for (const userId of members) {
        await client.query(
          "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)",
          [conversationId, userId],
        );
      }
      await client.query("COMMIT");
      response.status(201).json({ conversationId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get(
  "/api/rtc-config",
  requireAuth,
  (request, response, next) => {
    try {
      const configuredServers = process.env.TURN_SERVERS_JSON
        ? JSON.parse(process.env.TURN_SERVERS_JSON)
        : [];
      if (!Array.isArray(configuredServers)) {
        throw new Error("TURN_SERVERS_JSON must contain a JSON array.");
      }
      response.json({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, ...configuredServers],
      });
    } catch (error) {
      next(error);
    }
  },
);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") {
      next(new Error("Please sign in to connect."));
      return;
    }
    const claims = jwt.verify(token, jwtSecret, { issuer: "orbit-chat" });
    if (typeof claims.sub !== "string" || !isUuid(claims.sub)) {
      next(new Error("Your session is invalid. Please sign in again."));
      return;
    }
    const result = await pool.query("SELECT id, name FROM users WHERE id = $1", [claims.sub]);
    if (result.rowCount === 0) {
      next(new Error("This account no longer exists."));
      return;
    }
    socket.data.user = publicUser(result.rows[0]);
    next();
  } catch (error) {
    if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
      console.error("Socket authentication failed:", error);
    }
    next(new Error("Please sign in again to connect."));
  }
});

function endCall(callId, reason) {
  const call = activeCalls.get(callId);
  if (!call) return;
  clearTimeout(call.timeout);
  activeCalls.delete(callId);
  const event = { callId, reason };
  io.to(`user:${call.callerId}`).emit("call:ended", event);
  io.to(`user:${call.calleeId}`).emit("call:ended", event);
}

io.on("connection", (socket) => {
  const user = socket.data.user;
  const currentCount = onlineUsers.get(user.id) || 0;
  onlineUsers.set(user.id, currentCount + 1);
  socket.join(`user:${user.id}`);
  socket.emit("presence:snapshot", [...onlineUsers.keys()]);
  if (currentCount === 0) {
    io.emit("presence:update", { userId: user.id, online: true });
  }

  socket.on("join_chat", async (conversationId, callback) => {
    try {
      if (!isUuid(conversationId) || !(await isConversationMember(conversationId, user.id))) {
        sendSocketError(callback, "Conversation not found.");
        return;
      }

      const previousConversationId = socket.data.activeConversationId;
      if (previousConversationId) {
        await socket.leave(`conversation:${previousConversationId}`);
      }
      await socket.join(`conversation:${conversationId}`);
      socket.data.activeConversationId = conversationId;

      const history = await pool.query(
        `SELECT * FROM (
           SELECT m.id, m.conversation_id AS "conversationId",
                  m.sender_id AS "senderId", u.name AS "senderName",
                  m.body AS text, m.created_at AS "createdAt"
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = $1
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 200
         ) recent
         ORDER BY "createdAt" ASC`,
        [conversationId],
      );
      sendSocketResult(callback, { ok: true, messages: history.rows });
    } catch (error) {
      console.error("Could not load conversation:", error);
      sendSocketError(callback, "Could not load this conversation.");
    }
  });

  socket.on("send_message", async (payload, callback) => {
    try {
      const conversationId = payload?.conversationId;
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (
        !isUuid(conversationId) ||
        conversationId !== socket.data.activeConversationId ||
        text.length === 0 ||
        text.length > 1000
      ) {
        sendSocketError(callback, "Enter a message of 1–1000 characters.");
        return;
      }

      const result = await pool.query(
        `INSERT INTO messages (id, conversation_id, sender_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, conversation_id AS "conversationId",
                   sender_id AS "senderId", body AS text, created_at AS "createdAt"`,
        [crypto.randomUUID(), conversationId, user.id, text],
      );
      const message = { ...result.rows[0], senderName: user.name };
      io.to(`conversation:${conversationId}`).emit("receive_message", message);
      sendSocketResult(callback, { ok: true, messageId: message.id });
    } catch (error) {
      console.error("Could not save chat message:", error);
      sendSocketError(callback, "The message could not be saved.");
    }
  });

  socket.on("call:invite", async (payload, callback) => {
    try {
      const conversationId = payload?.conversationId;
      if (!isUuid(conversationId)) {
        sendSocketError(callback, "Choose a direct conversation before calling.");
        return;
      }

      const conversation = await pool.query(
        "SELECT is_group FROM conversations WHERE id = $1",
        [conversationId],
      );
      if (conversation.rowCount === 0 || conversation.rows[0].is_group) {
        sendSocketError(callback, "Calls are available in one-to-one conversations only.");
        return;
      }
      const members = await pool.query(
        "SELECT user_id FROM conversation_members WHERE conversation_id = $1",
        [conversationId],
      );
      if (members.rowCount !== 2 || !members.rows.some((row) => row.user_id === user.id)) {
        sendSocketError(callback, "You cannot call from this conversation.");
        return;
      }

      const calleeId = members.rows.find((row) => row.user_id !== user.id)?.user_id;
      if (!calleeId || !onlineUsers.has(calleeId)) {
        sendSocketError(callback, "This person is offline right now.");
        return;
      }
      const userAlreadyInCall = [...activeCalls.values()].some(
        (call) => call.callerId === user.id || call.calleeId === user.id,
      );
      const calleeAlreadyInCall = [...activeCalls.values()].some(
        (call) => call.callerId === calleeId || call.calleeId === calleeId,
      );
      if (userAlreadyInCall || calleeAlreadyInCall) {
        sendSocketError(callback, "One of you is already in a call.");
        return;
      }

      const callId = crypto.randomUUID();
      const call = {
        callId,
        conversationId,
        callerId: user.id,
        calleeId,
        video: payload.video === true,
        timeout: null,
      };
      call.timeout = setTimeout(() => endCall(callId, "missed"), 45_000);
      activeCalls.set(callId, call);
      io.to(`user:${calleeId}`).emit("call:incoming", {
        callId,
        conversationId,
        video: call.video,
        caller: user,
      });
      sendSocketResult(callback, { ok: true, callId });
    } catch (error) {
      console.error("Could not start call:", error);
      sendSocketError(callback, "The call could not be started.");
    }
  });

  socket.on("call:accept", (callId, callback) => {
    const call = activeCalls.get(callId);
    if (!call || call.calleeId !== user.id || call.timeout === null) {
      sendSocketError(callback, "This call is no longer available.");
      return;
    }
    clearTimeout(call.timeout);
    call.timeout = null;
    io.to(`user:${call.callerId}`).emit("call:accepted", { callId });
    sendSocketResult(callback, { ok: true });
  });

  socket.on("call:reject", (callId, callback) => {
    const call = activeCalls.get(callId);
    if (!call || call.calleeId !== user.id) {
      sendSocketError(callback, "This call is no longer available.");
      return;
    }
    endCall(callId, "declined");
    sendSocketResult(callback, { ok: true });
  });

  socket.on("call:signal", (payload, callback) => {
    const call = activeCalls.get(payload?.callId);
    if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
      sendSocketError(callback, "Call signaling is not authorized.");
      return;
    }
    if (!payload.data || typeof payload.data !== "object") {
      sendSocketError(callback, "Call signaling data is invalid.");
      return;
    }
    const dataSize = Buffer.byteLength(JSON.stringify(payload.data), "utf8");
    if (dataSize > 64_000) {
      sendSocketError(callback, "Call signaling data is too large.");
      return;
    }

    const otherUserId = call.callerId === user.id ? call.calleeId : call.callerId;
    io.to(`user:${otherUserId}`).emit("call:signal", {
      callId: call.callId,
      data: payload.data,
    });
    sendSocketResult(callback, { ok: true });
  });

  socket.on("call:end", (callId, callback) => {
    const call = activeCalls.get(callId);
    if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
      sendSocketError(callback, "This call is no longer available.");
      return;
    }
    endCall(callId, "ended");
    sendSocketResult(callback, { ok: true });
  });

  socket.on("disconnect", () => {
    const remaining = (onlineUsers.get(user.id) || 1) - 1;
    if (remaining > 0) {
      onlineUsers.set(user.id, remaining);
      return;
    }

    onlineUsers.delete(user.id);
    io.emit("presence:update", { userId: user.id, online: false });
    for (const call of activeCalls.values()) {
      if (call.callerId === user.id || call.calleeId === user.id) {
        endCall(call.callId, "disconnected");
      }
    }
  });
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  console.error("Request failed:", error);
  const status =
    Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  response
    .status(status)
    .json({ error: status < 500 ? error.message : "Something went wrong. Please try again." });
});

async function startServer() {
  await initializeDatabase();
  httpServer.listen(port, () => {
    console.log(`Chat server is listening at http://localhost:${port}`);
  });
}

startServer().catch(async (error) => {
  console.error("Could not start the chat server:", error);
  await pool.end();
  process.exitCode = 1;
});

process.on("SIGTERM", () => {
  io.close(() => pool.end());
});
