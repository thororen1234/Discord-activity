// Discord Embedded App SDK Integration & Standalone Fallback Bridge
// Ensures full compliance with Discord TOS & seamless operation inside or outside Discord Activities.

class DiscordBridge {
  constructor() {
    this.isInDiscord = false;
    this.discordSdk = null;
    const guestName = 'GUEST_' + Math.floor(100 + Math.random() * 900);
    this.user = {
      id: 'runner_' + Math.floor(1000 + Math.random() * 9000),
      username: guestName,
      name: guestName,
      avatar: null,
      discriminator: '0000',
      isDiscordUser: false
    };
    this.channelId = null;
    this.guildId = null;
    this.onReadyCallbacks = [];
  }

  async init() {
    // Discord always launches Activities with a frame_id query param
    const urlParams = new URLSearchParams(window.location.search);
    const frameId = urlParams.get('frame_id');

    if (frameId && window.DiscordSDK) {
      try {
        const config = await fetch('/api/config').then(r => r.json());
        if (!config.clientId) {
          throw new Error('DISCORD_CLIENT_ID is not configured on the server');
        }

        this.discordSdk = new window.DiscordSDK.DiscordSDK(config.clientId);
        // ready() never resolves outside a real Discord client, so don't let it hang the app
        await this.withTimeout(this.discordSdk.ready(), 10000, 'Discord SDK handshake timed out');
        this.isInDiscord = true;
        this.channelId = this.discordSdk.channelId;
        this.guildId = this.discordSdk.guildId;

        if (config.oauthEnabled) {
          await this.authenticate(config.clientId);
        }
      } catch (e) {
        console.warn('Discord SDK initialize skipped or running in development preview:', e);
      }
    }

    // If avatar is empty, generate an 8-bit neon cyberpunk avatar SVG
    if (!this.user.avatar) {
      this.user.avatar = this.generateNeonAvatar(this.user.username);
    }

    // Notify listeners
    this.onReadyCallbacks.forEach(cb => cb(this.user));
    return this.user;
  }

  // OAuth handshake: authorize in the Discord client, swap the code for a token on our server, then authenticate
  async authenticate(clientId) {
    const { code } = await this.discordSdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify']
    });

    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed (${res.status})`);
    }
    const { access_token } = await res.json();

    const auth = await this.discordSdk.commands.authenticate({ access_token });
    const discordUser = auth.user;

    const displayName = (discordUser.global_name || discordUser.username).toUpperCase().slice(0, 16);
    this.user = {
      id: discordUser.id,
      username: displayName,
      name: displayName,
      // Discord's CDN is blocked inside the Activity sandbox, so avatars go through our server
      avatar: discordUser.avatar ? `/discord-avatar/${discordUser.id}/${discordUser.avatar}.png` : null,
      discriminator: discordUser.discriminator,
      isDiscordUser: true
    };
  }

  withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
  }

  onReady(cb) {
    if (this.user) {
      cb(this.user);
    }
    this.onReadyCallbacks.push(cb);
  }

  // Open native Discord Activity invite dialog
  async openInviteDialog() {
    if (this.isInDiscord && this.discordSdk) {
      try {
        await this.discordSdk.commands.openInviteDialog();
        return { success: true, native: true };
      } catch (e) {
        console.warn('Discord invite dialog error:', e);
      }
    }

    // Fallback: Copy room URL or invite code to clipboard
    return { success: true, native: false };
  }

  // Procedural SVG Cyberpunk Avatar generator for players/bots
  generateNeonAvatar(seed, isBot = false) {
    const colors = isBot
      ? ['#ff0055', '#ff5500', '#ff00aa', '#880033']
      : ['#00ffcc', '#0099ff', '#39ff14', '#bd00ff'];

    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }

    const c1 = colors[Math.abs(hash) % colors.length];
    const c2 = colors[(Math.abs(hash) + 1) % colors.length];
    const letter = isBot ? '🤖' : seed.charAt(0).toUpperCase();

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <linearGradient id="grad_${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${c1}" />
            <stop offset="100%" stop-color="${c2}" />
          </linearGradient>
          <filter id="glow_${hash}">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <rect width="100" height="100" rx="16" fill="#080c14" stroke="${c1}" stroke-width="3" />
        <circle cx="50" cy="50" r="34" fill="none" stroke="url(#grad_${hash})" stroke-width="4" filter="url(#glow_${hash})" />
        <text x="50" y="${isBot ? 58 : 61}" font-size="${isBot ? 34 : 32}" font-family="monospace, sans-serif" font-weight="900" text-anchor="middle" fill="#ffffff" filter="url(#glow_${hash})">${letter}</text>
      </svg>
    `.trim();

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
}

window.discordBridge = new DiscordBridge();
