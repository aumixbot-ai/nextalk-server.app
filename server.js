// NexTalk Signaling Server
// Deploy this on Railway, Render, or any Node.js host
// 
// Install dependencies:  npm install express socket.io cors
// Run locally:           node server.js
// Environment variable:  PORT (auto-set by Railway/Render)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('NexTalk signaling server is running ✅'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Waiting queue: { socketId, gender, country, preferGender }
const waitingQueue = [];

// Active sessions: Map<socketId, partnerSocketId>
const sessions = new Map();

function findMatch(user) {
  for (let i = 0; i < waitingQueue.length; i++) {
    const candidate = waitingQueue[i];
    if (candidate.socketId === user.socketId) continue;

    const genderOk =
      (user.preferGender === 'any' || user.preferGender === candidate.gender) &&
      (candidate.preferGender === 'any' || candidate.preferGender === user.gender);

    const countryOk =
      user.country === 'any' || candidate.country === 'any' || user.country === candidate.country;

    if (genderOk && countryOk) {
      waitingQueue.splice(i, 1);
      return candidate;
    }
  }
  return null;
}

function removeFromQueue(socketId) {
  const idx = waitingQueue.findIndex(u => u.socketId === socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // User joins the matchmaking queue
  socket.on('join_queue', (profile) => {
    const user = { socketId: socket.id, ...profile };
    removeFromQueue(socket.id); // ensure no duplicate

    const match = findMatch(user);
    if (match) {
      // Pair them up
      sessions.set(socket.id, match.socketId);
      sessions.set(match.socketId, socket.id);

      // Initiator = the one who was waiting longer (match), caller = new user (socket)
      io.to(socket.id).emit('matched', { partnerId: match.socketId, initiator: true });
      io.to(match.socketId).emit('matched', { partnerId: socket.id, initiator: false });
    } else {
      waitingQueue.push(user);
      socket.emit('waiting');
    }
  });

  // WebRTC signaling relay
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    io.to(to).emit('ice_candidate', { from: socket.id, candidate });
  });

  // Chat message relay
  socket.on('chat_message', ({ to, text }) => {
    io.to(to).emit('chat_message', { text });
  });

  // User wants next stranger
  socket.on('leave_session', () => {
    const partnerId = sessions.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      sessions.delete(partnerId);
    }
    sessions.delete(socket.id);
    removeFromQueue(socket.id);
  });

  // Disconnected
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const partnerId = sessions.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      sessions.delete(partnerId);
    }
    sessions.delete(socket.id);
    removeFromQueue(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`NexTalk server running on port ${PORT}`));