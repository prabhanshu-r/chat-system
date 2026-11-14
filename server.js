const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('disconnected:', socket.id);
    });
});

socket.on('send_message', (text) => {
    io.emit('receive_message', text);
});


server.listen(3001, () => {
    console.log('http://localhost:3001');
});