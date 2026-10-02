const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_ROOM_PLAYERS = 6;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Exchanges the OAuth code from sdk.commands.authorize() for an access token
async function handleTokenExchange(req, res) {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    sendJson(res, 503, { error: 'Discord OAuth is not configured' });
    return;
  }

  let code;
  try {
    ({ code } = await readJsonBody(req));
  } catch {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }
  if (typeof code !== 'string' || !code) {
    sendJson(res, 400, { error: 'Missing code' });
    return;
  }

  try {
    const discordRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code
      })
    });
    const data = await discordRes.json();
    if (!discordRes.ok || !data.access_token) {
      console.warn('Discord token exchange failed:', discordRes.status, data.error);
      sendJson(res, 401, { error: 'Token exchange failed' });
      return;
    }
    sendJson(res, 200, { access_token: data.access_token });
  } catch (err) {
    console.error('Discord token exchange error:', err);
    sendJson(res, 502, { error: 'Could not reach Discord' });
  }
}

// Discord's CDN is blocked by the Activity sandbox CSP, so avatars are proxied through this server
async function handleAvatarProxy(res, userId, avatarHash) {
  try {
    const cdnRes = await fetch(`https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`);
    if (!cdnRes.ok) {
      res.writeHead(cdnRes.status === 404 ? 404 : 502);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(Buffer.from(await cdnRes.arrayBuffer()));
  } catch (err) {
    console.error('Avatar proxy error:', err);
    res.writeHead(502);
    res.end();
  }
}

// Static file HTTP server
const server = http.createServer((req, res) => {
  // Add CORS & security headers for Discord iframe sandboxes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];

  if (reqPath === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, {
      clientId: DISCORD_CLIENT_ID || null,
      oauthEnabled: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET)
    });
    return;
  }

  if (reqPath === '/api/token' && req.method === 'POST') {
    handleTokenExchange(req, res);
    return;
  }

  const avatarMatch = reqPath.match(/^\/discord-avatar\/(\d{15,21})\/((?:a_)?[0-9a-f]{32})\.png$/);
  if (avatarMatch && req.method === 'GET') {
    handleAvatarProxy(res, avatarMatch[1], avatarMatch[2]);
    return;
  }

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// WebSocket Server for Multiplayer Synchronisation
const wss = new WebSocketServer({ server, path: '/ws' });

// In-memory rooms: roomId -> { host, opponent, spectators: [], state: {}, settings: {} }
const rooms = new Map();

function broadcastToRoom(roomId, message, senderWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const data = JSON.stringify(message);
  const clients = [room.host?.ws, room.opponent?.ws, ...room.spectators.map(s => s.ws)].filter(Boolean);

  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  }
}

function cleanPlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    ready: player.ready,
    isHost: player.isHost,
    role: player.role
  };
}

function getRoomSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  return {
    roomId,
    host: cleanPlayer(room.host),
    opponent: cleanPlayer(room.opponent),
    spectators: room.spectators.map(cleanPlayer),
    spectatorsCount: room.spectators.length,
    settings: room.settings,
    gameActive: room.gameActive
  };
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, roomId, payload } = msg;

      switch (type) {
        case 'JOIN_ROOM': {
          const { user, requestedRoomId } = payload;
          const targetRoomId = (requestedRoomId || Math.random().toString(36).substring(2, 7).toUpperCase()).toUpperCase();
          currentRoomId = targetRoomId;
          currentPlayerId = user.id;

          let room = rooms.get(targetRoomId);
          if (!room) {
            // Create new room, user is host
            room = {
              roomId: targetRoomId,
              host: { ...user, ws, isHost: true, ready: true, role: 'host' },
              opponent: null,
              spectators: [],
              settings: { maxHp: 3, itemsPerRound: 1 },
              gameActive: false
            };
            rooms.set(targetRoomId, room);
          } else {
            // Check room capacity (max 6 players total)
            const totalCount = 1 + (room.opponent ? 1 : 0) + room.spectators.length;
            if (totalCount >= MAX_ROOM_PLAYERS && room.host.id !== user.id && room.opponent?.id !== user.id && !room.spectators.some(s => s.id === user.id)) {
              ws.send(JSON.stringify({
                type: 'ROOM_FULL',
                payload: { message: 'Lobby is full (Max 6 players).' }
              }));
              return;
            }

            // Assign role
            if (!room.host) {
              room.host = { ...user, ws, isHost: true, ready: true, role: 'host' };
            } else if (!room.opponent && room.host.id !== user.id) {
              room.opponent = { ...user, ws, isHost: false, ready: false, role: 'opponent' };
            } else if (room.host.id === user.id) {
              room.host.ws = ws;
            } else if (room.opponent && room.opponent.id === user.id) {
              room.opponent.ws = ws;
            } else {
              const existingSpec = room.spectators.find(s => s.id === user.id);
              if (existingSpec) {
                existingSpec.ws = ws;
              } else {
                room.spectators.push({ ...user, ws, role: 'spectator' });
              }
            }
          }

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            payload: {
              room: getRoomSnapshot(targetRoomId),
              yourRole: room.host?.id === user.id ? 'host' : (room.opponent?.id === user.id ? 'opponent' : 'spectator')
            }
          }));

          broadcastToRoom(targetRoomId, {
            type: 'ROOM_UPDATED',
            payload: getRoomSnapshot(targetRoomId)
          });
          break;
        }

        case 'KICK_PLAYER': {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          // Host can only kick during lobby setup (!gameActive)
          if (room && !room.gameActive && room.host?.id === currentPlayerId) {
            const targetId = payload.targetPlayerId;
            let targetSocket = null;

            if (room.opponent && room.opponent.id === targetId) {
              targetSocket = room.opponent.ws;
              room.opponent = room.spectators.shift() || null;
              if (room.opponent) room.opponent.role = 'opponent';
            } else {
              const specIdx = room.spectators.findIndex(s => s.id === targetId);
              if (specIdx !== -1) {
                targetSocket = room.spectators[specIdx].ws;
                room.spectators.splice(specIdx, 1);
              }
            }

            if (targetSocket) {
              try {
                targetSocket.send(JSON.stringify({ type: 'KICKED', payload: { message: 'You were kicked from the lobby by the host.' } }));
              } catch (e) {}
            }

            broadcastToRoom(currentRoomId, {
              type: 'ROOM_UPDATED',
              payload: getRoomSnapshot(currentRoomId)
            });
          }
          break;
        }

        case 'UPDATE_SETTINGS': {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (room && room.host?.id === currentPlayerId) {
            room.settings = { ...room.settings, ...payload };
            broadcastToRoom(currentRoomId, {
              type: 'ROOM_UPDATED',
              payload: getRoomSnapshot(currentRoomId)
            });
          }
          break;
        }

        case 'TOGGLE_READY': {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (room) {
            if (room.opponent?.id === currentPlayerId) {
              room.opponent.ready = !room.opponent.ready;
            } else if (room.host?.id === currentPlayerId) {
              room.host.ready = !room.host.ready;
            }
            broadcastToRoom(currentRoomId, {
              type: 'ROOM_UPDATED',
              payload: getRoomSnapshot(currentRoomId)
            });
          }
          break;
        }

        case 'START_MATCH': {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (room && room.host?.id === currentPlayerId) {
            room.gameActive = true;
            broadcastToRoom(currentRoomId, {
              type: 'MATCH_STARTED',
              payload: {
                settings: room.settings,
                initialState: payload.initialState
              }
            });
          }
          break;
        }

        case 'GAME_ACTION': {
          if (!currentRoomId) return;
          // Relay game state changes or actions
          broadcastToRoom(currentRoomId, {
            type: 'GAME_ACTION_RELAY',
            payload: {
              senderId: currentPlayerId,
              action: payload
            }
          });
          break;
        }

        case 'LEAVE_ROOM': {
          handleDisconnect();
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message handling error:', err);
    }
  });

  function handleDisconnect() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (room.host?.id === currentPlayerId) {
      // Host left: promote opponent or disband
      if (room.opponent) {
        room.host = room.opponent;
        room.host.isHost = true;
        room.host.ready = true;
        room.host.role = 'host';
        room.opponent = room.spectators.shift() || null;
        if (room.opponent) room.opponent.role = 'opponent';
      } else {
        rooms.delete(currentRoomId);
        return;
      }
    } else if (room.opponent?.id === currentPlayerId) {
      room.opponent = room.spectators.shift() || null;
      if (room.opponent) room.opponent.role = 'opponent';
    } else {
      room.spectators = room.spectators.filter(s => s.id !== currentPlayerId);
    }

    broadcastToRoom(currentRoomId, {
      type: 'ROOM_UPDATED',
      payload: getRoomSnapshot(currentRoomId)
    });
  }

  ws.on('close', handleDisconnect);
});

server.listen(PORT, () => {
  console.log(`[Short Circuit Server] Listening on http://localhost:${PORT}`);
});
