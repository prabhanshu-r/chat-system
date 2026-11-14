const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const chats = new Map([
  [
    "sarah",
    [
      ["sarah-connor", "Sarah Connor", "Hey Alex, did you get a chance to look at the new dashboard?", 22],
      ["demo-user", "Alex Morgan", "Yes, I reviewed it this morning. The new flow feels much clearer.", 18],
      ["sarah-connor", "Sarah Connor", "Amazing! I’ll share the prototype with the team after lunch.", 12],
      ["demo-user", "Alex Morgan", "The colors are working well too. I left a few notes on the mobile view.", 8],
      ["sarah-connor", "Sarah Connor", "Could you check the mobile spacing too when you have a minute?", 4],
    ],
  ],
  [
    "design-team",
    [
      ["maya-chen", "Maya Chen", "Morning everyone! I added the latest concepts to the board.", 36],
      ["demo-user", "Alex Morgan", "The new direction is looking really good.", 24],
      ["maya-chen", "Maya Chen", "The new concepts are ready to review", 8],
    ],
  ],
  [
    "katia",
    [
      ["katia-mavin", "Katia Mavin", "I pushed the responsive layout changes.", 45],
      ["katia-mavin", "Katia Mavin", "The new chat layout is looking great!", 10],
    ],
  ],
  [
    "rona",
    [
      ["demo-user", "Alex Morgan", "Thanks for sharing the research summary.", 52],
      ["rona-klein", "Rona Klein", "I added the interview notes to the folder.", 16],
    ],
  ],
  [
    "leo",
    [
      ["leo-park", "Leo Park", "I finished the endpoint notes for the team.", 74],
      ["leo-park", "Leo Park", "Can we sync on the API tomorrow?", 25],
    ],
  ],
]);

function makeMessage(chatId, [senderId, senderName, text, minutesAgo]) {
  return {
    id: crypto.randomUUID(),
    chatId,
    senderId,
    senderName,
    text,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

for (const [chatId, seed] of chats) {
  chats.set(chatId, seed.map((message) => makeMessage(chatId, message)));
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

io.on("connection", (socket) => {
  socket.on("join_chat", async (chatId) => {
    if (typeof chatId !== "string" || !chats.has(chatId)) {
      socket.emit("chat_error", "That conversation is not available.");
      return;
    }

    const previousChatId = socket.data.activeChatId;
    if (previousChatId) {
      await socket.leave(previousChatId);
    }

    await socket.join(chatId);
    socket.data.activeChatId = chatId;
    socket.emit("chat_history", { chatId, messages: chats.get(chatId) });
  });

  socket.on("send_message", (payload) => {
    if (!payload || typeof payload !== "object") {
      socket.emit("chat_error", "The message could not be sent.");
      return;
    }

    const { chatId, senderId, senderName } = payload;
    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 1000) : "";

    if (
      typeof chatId !== "string" ||
      chatId !== socket.data.activeChatId ||
      !chats.has(chatId) ||
      typeof senderId !== "string" ||
      senderId.length === 0 ||
      senderId.length > 100 ||
      typeof senderName !== "string" ||
      senderName.trim().length === 0 ||
      !text
    ) {
      socket.emit("chat_error", "Enter a name and a message before sending.");
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      chatId,
      senderId,
      senderName: senderName.trim().slice(0, 24),
      text,
      createdAt: new Date().toISOString(),
    };

    const history = chats.get(chatId);
    history.push(message);
    if (history.length > 200) history.shift();

    io.to(chatId).emit("receive_message", message);
  });
});

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, () => {
  console.log(`Chat server is listening at http://localhost:${port}`);
});