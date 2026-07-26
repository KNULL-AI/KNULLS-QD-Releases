require('dotenv').config();

const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = function emitWarning(warning, ...args) {
  const warningName = typeof warning === 'object' && warning ? warning.name : '';
  const warningMessage = typeof warning === 'string' ? warning : warning?.message || '';

  if (
    warningName === 'DeprecationWarning' &&
    warningMessage.includes('ready event has been renamed to clientReady')
  ) {
    return;
  }

  return originalEmitWarning(warning, ...args);
};

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const CHANNELS = {
  POKEMON_CENTER: process.env.POKEMON_CENTER_CHANNEL_ID,
  WALMART: process.env.WALMART_CHANNEL_ID,
  COSTCO: process.env.COSTCO_CHANNEL_ID,
};

const TRIGGER_API = {
  base: process.env.TRIGGER_API_BASE,
  secret: process.env.TRIGGER_API_SECRET,
};

// Parse Pokemon Center alerts
function parsePokemonCenterAlert(embeds) {
  if (!embeds.length) return null;

  const embed = embeds[0];
  const title = embed.title || '';

  // Detect "Queue" or "Security" alerts
  if (title.includes('Queue') || title.includes('Security')) {
    return {
      retailer: 'pokemon-center',
      type: title.includes('Queue') ? 'queue' : 'security',
      url: null, // No URL needed for PC, just trigger tasks
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// Parse Costco alerts
function parseCostcoAlert(embeds) {
  if (!embeds.length) return null;

  const embed = embeds[0];
  const title = embed.title || '';
  const links = embed.fields?.find(f => f.name === 'Links')?.value || '';

  // Extract URL from links field
  const urlMatch = links.match(/\[(\w+)\]\((https?[^\)]+)\)/);
  const url = urlMatch ? urlMatch[2] : null;

  if (title && url) {
    return {
      retailer: 'costco',
      title,
      url,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// Parse Walmart alerts
function parseWalmartAlert(embeds) {
  if (!embeds.length) return null;

  const embed = embeds[0];
  const title = embed.title || '';
  const links = embed.fields?.find(f => f.name?.includes('Links'))?.value || '';

  // Extract all URLs from links field
  const urlRegex = /\[(\w+)\]\((https?[^\)]+)\)/g;
  let match;
  const urls = [];

  while ((match = urlRegex.exec(links)) !== null) {
    urls.push(match[2]);
  }

  if (title && urls.length > 0) {
    return {
      retailer: 'walmart',
      title,
      urls, // Multiple URLs for Walmart
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// Send alert to trigger worker with retry logic
async function sendTriggerAlert(alert, retries = 3) {
  if (!TRIGGER_API.secret || !TRIGGER_API.base) {
    console.error('❌ Trigger API not configured (missing secret or base URL)');
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = {
        secret: TRIGGER_API.secret,
        ...alert,
      };

      const response = await fetch(`${TRIGGER_API.base}/v1/global/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeout: 10000,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      console.log(`✅ Alert sent to worker (attempt ${attempt}/${retries}):`, alert);
      return true;
    } catch (error) {
      console.error(`❌ Alert send failed (attempt ${attempt}/${retries}):`, error?.message || error);
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
        console.log(`   Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`❌ Alert failed after ${retries} retries`);
  return false;
}

client.once('clientReady', () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  console.log(`📡 Monitoring channels:`, CHANNELS);
});

client.on('error', error => {
  console.error('❌ Discord Client Error:', error);
});

client.on('warn', warning => {
  console.warn('⚠️ Discord Client Warning:', warning);
});

// Extract embeds from a message, including forwarded message snapshots
function getEmbeds(message) {
  if (message.embeds?.length > 0) return message.embeds;
  // Forwarded messages store the original embeds in messageSnapshots
  const snapshot = message.messageSnapshots?.first?.();
  if (snapshot?.embeds?.length > 0) return snapshot.embeds;
  return [];
}

client.on('messageCreate', async (message) => {
  // Log ALL messages to debug
  console.log(`\n📨 Message received in channel ${message.channelId}:`, message.content.slice(0, 100));
  console.log(`   Author: ${message.author.tag}, isBot: ${message.author.bot}`);
  
  // Ignore bot messages (allow forwarded messages from real users)
  if (message.author.bot) return;

  const embeds = getEmbeds(message);
  let alert = null;

  // Check which channel the message came from
  if (message.channelId === CHANNELS.POKEMON_CENTER) {
    // Try embeds first (including forwarded), then fallback to text for testing
    if (embeds.length > 0) {
      alert = parsePokemonCenterAlert(embeds);
    } else if (message.content.includes('Queue') || message.content.includes('Security')) {
      alert = {
        retailer: 'pokemon-center',
        type: message.content.includes('Queue') ? 'queue' : 'security',
        url: null,
        timestamp: new Date().toISOString(),
      };
    }
  } else if (message.channelId === CHANNELS.WALMART) {
    // Try embeds first (including forwarded), then fallback to text for testing
    if (embeds.length > 0) {
      alert = parseWalmartAlert(embeds);
    } else {
      // Test mode: extract URLs from plain text
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = [];
      let match;
      while ((match = urlRegex.exec(message.content)) !== null) {
        urls.push(match[1]);
      }
      if (urls.length > 0) {
        alert = {
          retailer: 'walmart',
          title: 'Test Alert',
          urls,
          timestamp: new Date().toISOString(),
        };
      }
    }
  } else if (message.channelId === CHANNELS.COSTCO) {
    // Try embeds first (including forwarded), then fallback to text for testing
    if (embeds.length > 0) {
      alert = parseCostcoAlert(embeds);
    } else {
      // Test mode: extract URLs from plain text
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = [];
      let match;
      while ((match = urlRegex.exec(message.content)) !== null) {
        urls.push(match[1]);
      }
      if (urls.length > 0) {
        alert = {
          retailer: 'costco',
          title: 'Test Alert',
          url: urls[0],
          timestamp: new Date().toISOString(),
        };
      }
    }
  }

  if (alert) {
    console.log(`\n🚨 Alert detected:`, JSON.stringify(alert, null, 2));
    await sendTriggerAlert(alert);
  } else if (message.channelId === CHANNELS.POKEMON_CENTER || message.channelId === CHANNELS.WALMART || message.channelId === CHANNELS.COSTCO) {
    console.warn(`⚠️  Message in monitored channel but no alert parsed:`, message.content.slice(0, 100));
  }
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

client.login(process.env.DISCORD_BOT_TOKEN);
