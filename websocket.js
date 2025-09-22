import express from 'express';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import crypto from 'crypto';

// Load environment variables from .env
dotenv.config();

const app = express();

// Enable JSON body parsing
app.use(express.json());

// Basic root route for testing
app.get('/', (req, res) => {
  res.send('Zoom RTMS Server is up and running.');
});

// Generate signature for RTMS authentication
function generateSignature(meetingUuid, rtmsStreamId) {
  const message = `${process.env.ZOOM_CLIENT_ID},${meetingUuid},${rtmsStreamId}`;
  const signature = crypto
    .createHmac('sha256', process.env.ZOOM_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  console.log(`Generated signature: ${signature}`);
  return signature;
}

// Connect to media WebSocket for receiving transcript data
function connectToMediaWebSocket(mediaUrl, meetingUuid, rtmsStreamId, signalingSocket) {
  const mediaWs = new WebSocket(mediaUrl);

  mediaWs.on('open', () => {
    console.log('Media WebSocket connected');
    const handshakeMsg = {
      msg_type: 3, // DATA_HAND_SHAKE_REQ
      protocol_version: 1,
      sequence: 0,
      meeting_uuid: meetingUuid,
      rtms_stream_id: rtmsStreamId,
      signature: generateSignature(meetingUuid, rtmsStreamId),
      media_type: 8 // TRANSCRIPT only
    };
    console.log('Sending transcript handshake:', handshakeMsg);
    mediaWs.send(JSON.stringify(handshakeMsg));
  });

  mediaWs.on('message', (data) => {
    const msg = JSON.parse(data);
    
    // Handle media handshake response
    if (msg.msg_type === 4 && msg.status_code === 0) {
      console.log('Media handshake successful, sending CLIENT_READY_ACK');
      signalingSocket.send(JSON.stringify({
        msg_type: 7, // CLIENT_READY_ACK
        rtms_stream_id: rtmsStreamId
      }));
    }
    
    // Handle transcript data
    else if (msg.msg_type === 17) { // MEDIA_DATA_TRANSCRIPT
      console.log(`Transcript from ${msg.content.user_name}: ${msg.content.data}`);
    }
    
    // Handle keep-alive
    else if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
      console.log('Received KEEP_ALIVE_REQ, responding with KEEP_ALIVE_ACK');
      mediaWs.send(JSON.stringify({
        msg_type: 13, // KEEP_ALIVE_ACK
        timestamp: msg.timestamp
      }));
    }
  });

  mediaWs.on('error', (error) => {
    console.error('Media WebSocket error:', error);
  });

  mediaWs.on('close', (code, reason) => {
    console.log('Media WebSocket closed:', code, reason);
  });
}

// Connect to signaling WebSocket
function connectToSignalingWebSocket(meetingUuid, rtmsStreamId, serverUrls) {
  const signalingWs = new WebSocket(serverUrls);

  signalingWs.on('open', () => {
    console.log(`Signaling WebSocket opened for meeting ${meetingUuid}`);

    const signature = generateSignature(meetingUuid, rtmsStreamId);

    const handshakeMsg = {
      msg_type: 1, // SIGNALING_HAND_SHAKE_REQ
      meeting_uuid: meetingUuid,
      rtms_stream_id: rtmsStreamId,
      signature
    };

    console.log('Sending handshake message:', handshakeMsg);
    signalingWs.send(JSON.stringify(handshakeMsg));
  });

  signalingWs.on('message', (data) => {
    const msg = JSON.parse(data);
    
    // Handle signaling handshake response
    if (msg.msg_type === 2 && msg.status_code === 0) {
      console.log('Signaling handshake successful');
      const transcriptUrl = msg.media_server.server_urls.transcript;
      connectToMediaWebSocket(transcriptUrl, meetingUuid, rtmsStreamId, signalingWs);
    }
    
    // Handle keep-alive requests
    else if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
      console.log('Received KEEP_ALIVE_REQ, responding with KEEP_ALIVE_RESP');
      signalingWs.send(JSON.stringify({
        msg_type: 13, // KEEP_ALIVE_RESP
        timestamp: msg.timestamp
      }));
    }
  });

  signalingWs.on('error', (error) => {
    console.error('Signaling WebSocket error:', error);
  });

  signalingWs.on('close', (code, reason) => {
    console.log('Signaling WebSocket closed:', code, reason);
  });
}

// Webhook endpoint to receive RTMS events
app.post("/webhook", (req, res) => {
  const { event, payload } = req.body;
  
  // Handle RTMS start event
  if (event === 'meeting.rtms_started') {
    const { meeting_uuid, rtms_stream_id, server_urls } = payload;
    console.log(`Starting RTMS for meeting ${meeting_uuid}`);
    // Connect to signaling WebSocket to establish RTMS connection
    connectToSignalingWebSocket(meeting_uuid, rtms_stream_id, server_urls);
    
  // Handle RTMS stop event
  } else if (event === 'meeting.rtms_stopped') {
    const { meeting_uuid } = payload;
    console.log(`Stopping RTMS for meeting ${meeting_uuid}`);
  } else {
    console.log('Unknown event:', event);
  }
  res.sendStatus(200);
});

// Listen on localhost:3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
