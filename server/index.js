const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for simplicity in development
    methods: ['GET', 'POST']
  }
});

// Store connections
// Key: generated ID, Value: socket.id
const clients = new Map();

// Helper to generate a 6-digit ID
function generateID() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let clientId = generateID();
  // Ensure uniqueness
  while (clients.has(clientId)) {
    clientId = generateID();
  }

  clients.set(clientId, socket.id);

  // Send the assigned ID to the client
  socket.emit('assigned-id', clientId);
  console.log(`Assigned ID ${clientId} to socket ${socket.id}`);

  // Handle a connection request from a controller to a host
  socket.on('request-connection', ({ targetId }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      // Forward the request to the host
      io.to(targetSocketId).emit('incoming-connection', {
        callerId: clientId
      });
      console.log(`${clientId} requesting connection to ${targetId}`);
    } else {
      socket.emit('connection-error', { message: 'ID not found or offline.' });
    }
  });

  socket.on('reject-connection', ({ targetId }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('connection-rejected');
      console.log(`${clientId} rejected connection from ${targetId}`);
    }
  });

  socket.on('stop-sharing', ({ targetId }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('sharing-stopped');
      console.log(`${clientId} stopped sharing with ${targetId}`);
    }
  });

  // WebRTC Signaling: Offer
  socket.on('offer', ({ targetId, offer }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('offer', {
        callerId: clientId,
        offer
      });
    }
  });

  // WebRTC Signaling: Answer
  socket.on('answer', ({ targetId, answer }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('answer', {
        callerId: clientId,
        answer
      });
    }
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    const targetSocketId = clients.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', {
        callerId: clientId,
        candidate
      });
    }
  });

  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    clients.delete(clientId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
