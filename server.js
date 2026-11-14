const crypto = require("node:crypto");
const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const messages = [];
const MESSAGE_LIMIT = 100;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;

app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

io.on("connection", (socket) => {
  socket.emit("chat:history", messages);

  socket.on("chat:send", (payload) => {
    const name =
      typeof payload?.name === "string"
        ? payload.name.trim().slice(0, MAX_NAME_LENGTH)
        : "";
    const text =
      typeof payload?.text === "string"
        ? payload.text.trim().slice(0, MAX_MESSAGE_LENGTH)
        : "";

    if (!name || !text) {
      socket.emit("chat:error", "Enter a name and a message first.");
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      name,
      text,
      createdAt: new Date().toISOString(),
    };

    messages.push(message);
    if (messages.length > MESSAGE_LIMIT) {
      messages.shift();
    }

    io.emit("chat:message", message);
  });
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, () => {
  console.log(`Chat server is listening at http://localhost:${port}`);
});