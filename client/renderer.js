const serverUrl = 'http://localhost:3000'; // Change if running on a different machine
const socket = io(serverUrl);

let myId = null;
let targetId = null;
let peerConnection = null;
let dataChannel = null;
let localStream = null;

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// UI Elements
const myIdEl = document.getElementById('my-id');
const targetIdInput = document.getElementById('target-id');
const connectBtn = document.getElementById('connect-btn');
const statusMsg = document.getElementById('status-msg');
const setupContainer = document.getElementById('setup-container');
const remoteContainer = document.getElementById('remote-container');
const remoteVideo = document.getElementById('remote-video');
const disconnectBtn = document.getElementById('disconnect-btn');
const connectedIdEl = document.getElementById('connected-id');

// Modal Elements
const incomingModal = document.getElementById('incoming-modal');
const callerIdSpan = document.getElementById('caller-id-span');
const acceptBtn = document.getElementById('accept-btn');
const rejectBtn = document.getElementById('reject-btn');
const stopSharingBtn = document.getElementById('stop-sharing-btn');

let pendingCallerId = null;
let activeCallerId = null;

// Setup Socket.IO Event Listeners
socket.on('connect', () => {
  statusMsg.textContent = 'Connected to signaling server.';
});

socket.on('assigned-id', (id) => {
  myId = id;
  myIdEl.textContent = id;
});

socket.on('connection-error', (data) => {
  statusMsg.textContent = data.message;
  statusMsg.style.color = 'red';
});

socket.on('connection-rejected', () => {
  statusMsg.textContent = 'Connection request was rejected.';
  statusMsg.style.color = 'red';
});

socket.on('incoming-connection', async ({ callerId }) => {
  // Show the accept/reject modal
  pendingCallerId = callerId;
  callerIdSpan.textContent = callerId;
  incomingModal.classList.remove('hidden');
});

acceptBtn.addEventListener('click', async () => {
  incomingModal.classList.add('hidden');
  const callerId = pendingCallerId;
  if (!callerId) return;

  activeCallerId = callerId;
  console.log(`Accepted connection from ${callerId}`);
  statusMsg.textContent = `Sharing screen with ${callerId}...`;
  stopSharingBtn.classList.remove('hidden');

  try {
    const sources = await window.electronAPI.getScreenSources();
    const screenSource = sources[0];

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    });

    createPeerConnection(callerId, true); // true = we are the host

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

  } catch (err) {
    console.error('Error capturing screen:', err);
    statusMsg.textContent = 'Error capturing screen.';
    statusMsg.style.color = 'red';
  }
});

rejectBtn.addEventListener('click', () => {
  incomingModal.classList.add('hidden');
  if (pendingCallerId) {
    socket.emit('reject-connection', { targetId: pendingCallerId });
    pendingCallerId = null;
  }
});

socket.on('offer', async ({ callerId, offer }) => {
  console.log('Received offer', offer);
  if (!peerConnection) {
    createPeerConnection(callerId, false); // false = we are the controller
  }
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit('answer', { targetId: callerId, answer });
});

socket.on('answer', async ({ callerId, answer }) => {
  console.log('Received answer', answer);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', ({ callerId, candidate }) => {
  if (peerConnection) {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on('sharing-stopped', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  activeCallerId = null;
  targetId = null;

  remoteVideo.srcObject = null;
  setupContainer.classList.remove('hidden');
  remoteContainer.classList.add('hidden');
  stopSharingBtn.classList.add('hidden');

  statusMsg.textContent = 'Connection was closed.';
  statusMsg.style.color = 'black';
});

// Create WebRTC Peer Connection
function createPeerConnection(peerId, isHost) {
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { targetId: peerId, candidate: event.candidate });
    }
  };

  if (isHost) {
    // We are the host, we send video and receive data
    dataChannel = peerConnection.createDataChannel('control');
    setupHostDataChannel(dataChannel);

    peerConnection.onnegotiationneeded = async () => {
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { targetId: peerId, offer });
      } catch (err) {
        console.error('Error negotiating:', err);
      }
    };
  } else {
    // We are the controller, we receive video and send data
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };

    // Listen for incoming video from host
    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];

      // Play the video explicitly (some browsers require it)
      remoteVideo.play().catch(e => console.error("Error playing video:", e));

      // Transition UI to remote view when track arrives
      setupContainer.classList.add('hidden');
      remoteContainer.classList.remove('hidden');
      connectedIdEl.textContent = peerId;
    };
  }
}

// Controller side data channel
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log('Data channel open');
    setupInputCapture();
  };
}

// Host side data channel
function setupHostDataChannel(channel) {
  channel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // Send to main process via IPC to execute
    window.electronAPI.sendRemoteControl(data);
  };
}

// UI Event Listeners
connectBtn.addEventListener('click', () => {
  const id = targetIdInput.value.trim();
  if (id && id !== myId) {
    targetId = id;
    statusMsg.textContent = `Requesting connection to ${targetId}...`;
    statusMsg.style.color = 'black';
    socket.emit('request-connection', { targetId });
    // We wait for the offer from the host to create the peer connection
  }
});

disconnectBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  setupContainer.classList.remove('hidden');
  remoteContainer.classList.add('hidden');

  if (targetId) {
    socket.emit('stop-sharing', { targetId });
    targetId = null;
  }
});

stopSharingBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (activeCallerId) {
    socket.emit('stop-sharing', { targetId: activeCallerId });
    activeCallerId = null;
  }

  statusMsg.textContent = 'Screen sharing stopped.';
  stopSharingBtn.classList.add('hidden');
});

// Input Capture (Controller Side)
function setupInputCapture() {
  let isDragging = false;

  const sendInput = (data) => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(data));
    }
  };

  function getCoordinates(e) {
    const rect = remoteVideo.getBoundingClientRect();
    const videoWidth = remoteVideo.videoWidth;
    const videoHeight = remoteVideo.videoHeight;

    if (!videoWidth || !videoHeight) return null;

    const renderedWidth = remoteVideo.clientWidth;
    const renderedHeight = remoteVideo.clientHeight;

    const ratio = Math.min(renderedWidth / videoWidth, renderedHeight / videoHeight);
    const actualWidth = videoWidth * ratio;
    const actualHeight = videoHeight * ratio;

    const xOffset = (renderedWidth - actualWidth) / 2;
    const yOffset = (renderedHeight - actualHeight) / 2;

    const x = ((e.clientX - rect.left - xOffset) / actualWidth) * videoWidth;
    const y = ((e.clientY - rect.top - yOffset) / actualHeight) * videoHeight;

    return {
      x: Math.max(0, Math.min(x, videoWidth)),
      y: Math.max(0, Math.min(y, videoHeight))
    };
  }

  remoteVideo.addEventListener('mousemove', (e) => {
    const coords = getCoordinates(e);
    if (coords) sendInput({ type: 'mousemove', x: coords.x, y: coords.y });
  });

  remoteVideo.addEventListener('mousedown', (e) => {
    const coords = getCoordinates(e);
    isDragging = true;
    if (coords) sendInput({ type: 'mousedown', x: coords.x, y: coords.y, button: e.button });
  });

  remoteVideo.addEventListener('mouseup', (e) => {
    const coords = getCoordinates(e);
    isDragging = false;
    if (coords) sendInput({ type: 'mouseup', x: coords.x, y: coords.y, button: e.button });
  });

  remoteVideo.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (targetId) {
      sendInput({ type: 'keydown', key: e.key });
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (targetId) {
      sendInput({ type: 'keyup', key: e.key });
    }
  });
}
