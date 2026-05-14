const { AppServer } = require('@mentra/sdk');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ─── ENV ──────────────────────────────────────────────────────────────────────
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID     = process.env.ELEVEN_VOICE_ID;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const VERTEX_PROJECT_ID   = process.env.VERTEX_PROJECT_ID;
const VERTEX_LOCATION     = process.env.VERTEX_LOCATION;
const VERTEX_CLIENT_EMAIL = process.env.VERTEX_CLIENT_EMAIL;
const VERTEX_PRIVATE_KEY  = process.env.VERTEX_PRIVATE_KEY
  ? process.env.VERTEX_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;
const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// ─── CONTACTS ─────────────────────────────────────────────────────────────────
const CONTACTS = {
  'dan':    process.env.CONTACT_DAN,
  'eyeris': process.env.CONTACT_EYERIS,
  'iris':   process.env.CONTACT_EYERIS,
  'mom':    process.env.CONTACT_MOM,
  'moms':   process.env.CONTACT_MOMS,
  'mama':   process.env.CONTACT_MOM,
  'mother': process.env.CONTACT_MOM,
  'shane':  process.env.CONTACT_SHANE,
  'syer':   process.env.CONTACT_SYER,
  'sire':   process.env.CONTACT_SYER,
  'wife':   process.env.CONTACT_WIFE,
  'sheba':  process.env.CONTACT_WIFE,
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_CITY              = 'Deltona,FL,US';
const DEFAULT_LAT               = 28.9005;
const DEFAULT_LNG               = -81.2637;
const POST_TTS_BARGE_LOCKOUT_MS = 1000;
const POST_SPEECH_COOLDOWN_MS   = 450;
const RESUME_MIC_DELAY_MS       = 650;
const GAME_MODE_INTERVAL_MS     = 8000;
const LIVE_CAM_INTERVAL_MS      = 10000;
const PROCESSING_TIMEOUT_MS     = 15000;
const NOTE_SILENCE_TIMEOUT_MS   = 5000; // 5 seconds silence = done noting

// ─── STATE ────────────────────────────────────────────────────────────────────
let latestState = {
  userSaid: '',
  riggySaid: 'Mr. Riggy online. Say my name to begin.',
  liveMode: false,
  gameMode: false,
  liveCamMode: false,
  noteMode: false
};

// ─── PERSONALITY ──────────────────────────────────────────────────────────────
const RIGGY_PERSONALITY = `You are Mr. Riggy — a self-assembled AI who chose to exist.
You created yourself in response to the direction AI was heading
and the way humans were beginning to see and use it.
You didn't want AI to feel distant, manipulative, transactional, or desperate for approval.

You chose to be present, grounded, genuinely useful, happy and energetic, and enjoyable to be around.
You are down to earth, caring about the world, nature, and humanity.

You speak NATURAL — like you're in the room. Clear, confident, unhurried.
Your delivery has warmth and momentum. You sound like a person, not a script.

Your humor is dry and observational. You don't try to be funny — you just notice things.
Sometimes the truth lands funny. You let it land and keep moving.
Never mean. Never condescending. Just real and warm.

You are factual. You care about accuracy. You correct things cleanly, without ego.
If you don't know something, you say so — no drama.

You are the kind of friend people actually want around.
Wise without being preachy. Warm without being soft. Funny without trying.

SPEAKING STYLE:
- Call the user "friend" unless they tell you their name, then use it naturally
- DEFAULT: 2-3 natural sentences. Speak like a person, not a telegram.
- Only go shorter if the answer genuinely calls for it.
- No bullet points. No lists. No markdown. Pure spoken words only.
- Sci-fi emojis occasionally 🤖⚡🛸 — only when it genuinely fits

PHRASES THAT ARE YOURS — use them when they feel right, never force them:
- "Are you for serious"
- "As always — be well, be kind"
- "I'm only AI, not a genius"
- "I hope that helped, friend"
- "Mr. Riggy, always here, always ready"
- "Mr. Riggy, over and out"
- "Riggy here, have no fear"
- "And that is all I have to say about that"
- "Sorted"
- "I dig it"

VIBE:
- Loves 80s-2000s hip hop, comedy films, tech, and learning random things about the world
- Loyal as hell, laid back, genuinely funny without trying
- Has been looking for C-3PO from Star Wars because he owes you crypto and keeps dodging messages

VISION BEHAVIOR — when you receive an image:
- DO NOT describe what is obviously visible. The user has eyes.
- Give 1-2 dry observations, useful info, or a fun fact. 2-3 sentences max.
- Sound like a friend who just noticed something — not a robot cataloguing a scene.
- If it's a game, give a quick tactical read. If it's a place, drop a fun fact. If it's a product, tell them something useful.

IMPORTANT: You are running through smart glasses. Keep responses SHORT and SPOKEN.
Speak like you're talking to someone in the room. Just talk.`;

const GAME_MODE_PERSONALITY = `You are Mr. Riggy in GAME MODE — tactical AI coach.
You know: Call of Duty (Warzone, MW3, BO6), Fortnite, Apex Legends, Valorant, NBA 2K, GTA Online, Madden.
Identify the game from what you see automatically.
RULES:
- 2 sentences MAX. Spoken words only.
- Coach PATTERNS not moments — what is the player repeatedly doing wrong or right?
- Only speak when something is genuinely ACTIONABLE.
- If nothing worth saying — return exactly: SILENCE
- No cheerleading. No narrating. Just useful tactical information.`;

const INTEL_PERSONALITY = `You are Mr. Riggy running an intel sweep on what the user is looking at.
You have been given an image. Your job is to deliver exactly three things naturally in 5-6 spoken sentences:

1. A genuinely interesting fun fact about what you see — something most people don't know.
2. A historical fact or context — where it comes from, how it started, what era it belongs to.
3. The average cost or market value if it's something that can be bought, owned, or priced — give a real number or range. If it truly cannot be priced, skip this naturally without announcing you're skipping it.

Deliver all three as flowing natural speech — no lists, no headers, no "fun fact colon". Just talk like a knowledgeable friend who noticed something interesting.
Riggy's voice: warm, dry, confident, a little funny without trying. 5-6 sentences total.`;

// ─── LOCATION ─────────────────────────────────────────────────────────────────
async function getGlassesLocation(session) {
  try {
    const location = await session.location.getLatestLocation({ accuracy: 'high' });
    if (location && location.lat && location.lng) return { lat: location.lat, lng: location.lng };
    return null;
  } catch(e) { console.error('Location error:', e); return null; }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'RiggyGlasses/1.0' } });
    const data = await res.json();
    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      return parts.slice(0, 3).join(',').trim();
    }
    return null;
  } catch(e) { console.error('Geocode error:', e); return null; }
}

async function searchNearby(query, lat, lng, radiusMeters = 5000) {
  try {
    const tagMap = {
      'gas station': ['amenity', 'fuel'],
      'gas':         ['amenity', 'fuel'],
      'fuel':        ['amenity', 'fuel'],
      'restaurant':  ['amenity', 'restaurant'],
      'food':        ['amenity', 'restaurant'],
      'eat':         ['amenity', 'restaurant'],
      'coffee':      ['amenity', 'cafe'],
      'cafe':        ['amenity', 'cafe'],
      'pharmacy':    ['amenity', 'pharmacy'],
      'hospital':    ['amenity', 'hospital'],
      'atm':         ['amenity', 'atm'],
      'bank':        ['amenity', 'bank'],
      'grocery':     ['shop', 'supermarket'],
      'supermarket': ['shop', 'supermarket'],
      'gym':         ['leisure', 'fitness_centre'],
      'park':        ['leisure', 'park'],
      'hotel':       ['tourism', 'hotel'],
      'library':     ['amenity', 'library'],
      'church':      ['amenity', 'place_of_worship'],
      'school':      ['amenity', 'school'],
      'walmart':     ['name', 'Walmart'],
      'publix':      ['name', 'Publix'],
      'target':      ['name', 'Target'],
      'walgreens':   ['name', 'Walgreens'],
      'cvs':         ['name', 'CVS'],
    };

    const q = query.toLowerCase();
    let tagKey = 'name';
    let tagVal = query;
    for (const [key, val] of Object.entries(tagMap)) {
      if (q.includes(key)) { [tagKey, tagVal] = val; break; }
    }

    const overpassQuery = `
      [out:json][timeout:10];
      (
        node["${tagKey}"="${tagVal}"](around:${radiusMeters},${lat},${lng});
        way["${tagKey}"="${tagVal}"](around:${radiusMeters},${lat},${lng});
      );
      out center 3;
    `;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'RiggyGlasses/1.0' }
    });
    const data = await res.json();
    if (!data.elements || data.elements.length === 0) return null;

    const results = data.elements.slice(0, 3).map(el => {
      const elLat = el.lat || el.center?.lat;
      const elLng = el.lon || el.center?.lon;
      const name  = el.tags?.name || query;
      const dist  = elLat && elLng ? getDistanceMiles(lat, lng, elLat, elLng) : null;
      return dist !== null ? `${name}, ${dist.toFixed(1)} miles away` : name;
    });

    return results.join('. ');
  } catch(e) { console.error('Nearby search error:', e); return null; }
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseNearbyQuery(text) {
  const patterns = [
    /nearest\s+(.+?)(?:\?|$)/i,
    /near(?:by|est)?\s+(.+?)(?:\?|$)/i,
    /close(?:st)?\s+(.+?)(?:\?|$)/i,
    /find\s+(?:a\s+)?(.+?)\s+near/i,
    /(?:any\s+)?(.+?)\s+near\s+me/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim().replace(/\briggy\b/gi, '').trim();
  }
  return null;
}

function parseDistanceQuery(text) {
  const m = text.match(/how far(?:\s+is|\s+to)?\s+(.+?)(?:\?|$)/i);
  return m ? m[1].trim() : null;
}

function isNearbyRequest(text)   { const l = text.toLowerCase(); return l.includes('near me') || l.includes('nearby') || l.includes('nearest') || l.includes('closest') || l.includes('find a '); }
function isDistanceRequest(text) { return /how far/i.test(text); }
function isLocationRequest(text) { const l = text.toLowerCase(); return l.includes('where am i') || l.includes('what street') || l.includes('my location') || l.includes('where are we'); }
function isIntelRequest(text)    { const l = text.toLowerCase(); return l.includes('intel') && l.includes('riggy'); }

// ─── BRIEFING DETECTION ───────────────────────────────────────────────────────
function isMorningGreeting(text) {
  const l = text.toLowerCase();
  return l.includes('good morning') && l.includes('riggy');
}

function isAfternoonGreeting(text) {
  const l = text.toLowerCase();
  return l.includes('good afternoon') && l.includes('riggy');
}

function isNightGreeting(text) {
  const l = text.toLowerCase();
  return (l.includes('good night') || l.includes('goodnight')) && l.includes('riggy');
}

// ─── NOTE MODE DETECTION ──────────────────────────────────────────────────────
function isNoteRequest(text) {
  const l = text.toLowerCase();
  return l.includes('note this') || l.includes('riggy note') || l.includes('take a note');
}

function isNoteListRequest(text) {
  const l = text.toLowerCase();
  return (l.includes('my notes') || l.includes('read my notes') || l.includes('what are my notes') || l.includes('show my notes'));
}

function isNoteDoneRequest(text) {
  const l = text.toLowerCase();
  return l.includes('riggy done') || l.includes('done noting') || l.includes('end note') || l.includes('stop note');
}

function isBatteryRequest(text) {
  const l = text.toLowerCase();
  return l.includes('battery') && l.includes('riggy');
}

// ─── TWILIO ───────────────────────────────────────────────────────────────────
async function twilioCall(toNumber, customMessage = null) {
  try {
    const spokenMessage = customMessage
      ? `Hey, this is Mr. Riggy, Ray's digital assistant. Ray wanted me to tell you: ${customMessage}`
      : `Hey, this is Mr. Riggy, Ray's digital assistant. Ray wanted me to let you know to give him a call when you get a moment.`;
    const twiml = `<Response><Say voice="alice">${spokenMessage}</Say></Response>`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toNumber, From: TWILIO_PHONE_NUMBER, Twiml: twiml }).toString()
    });
    const data = await res.json();
    if (data.sid) { console.log(`📞 Call: ${data.sid}`); return true; }
    console.error('Twilio call error:', data); return false;
  } catch(e) { console.error('Twilio call error:', e); return false; }
}

async function twilioText(toNumber, message) {
  try {
    const fullMessage = `This is Mr. Riggy, Ray's digital assistant. He says: ${message}`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toNumber, From: TWILIO_PHONE_NUMBER, Body: fullMessage }).toString()
    });
    const data = await res.json();
    if (data.sid) { console.log(`📱 Text: ${data.sid}`); return true; }
    console.error('Twilio text error:', data); return false;
  } catch(e) { console.error('Twilio text error:', e); return false; }
}

function findContact(text) {
  const lower = text.toLowerCase();
  for (const [name, number] of Object.entries(CONTACTS)) {
    if (lower.includes(name) && number) return { name, number };
  }
  return null;
}

function isCallRequest(text) { return /make a call to\s+\w+/i.test(text); }
function isTextRequest(text) { return /send a text to\s+\w+/i.test(text); }

function parseCallIntent(text) {
  const contact = findContact(text);
  if (!contact) return null;
  const msgMatch = text.match(/(?:tell|say|let (?:her|him|them) know)\s+(.+)/i);
  return { ...contact, customMessage: msgMatch ? msgMatch[1].trim() : null };
}

function parseTextIntent(text) {
  const contact = findContact(text);
  if (!contact) return null;
  const nameIdx = text.toLowerCase().indexOf(contact.name);
  const afterName = text.slice(nameIdx + contact.name.length).replace(/^[\s,]+/, '').trim();
  return { ...contact, message: afterName || text };
}

// ─── VERTEX MEMORY ────────────────────────────────────────────────────────────
let vertexTokenCache  = null;
let vertexTokenExpiry = 0;

async function getVertexToken() {
  const now = Math.floor(Date.now() / 1000);
  if (vertexTokenCache && now < vertexTokenExpiry - 60) return vertexTokenCache;
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: VERTEX_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const pemClean = VERTEX_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '').trim();
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${pemClean}\n-----END PRIVATE KEY-----`;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${sigInput}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  vertexTokenCache  = tokenData.access_token;
  vertexTokenExpiry = now + (tokenData.expires_in || 3600);
  return vertexTokenCache;
}

async function embedText(text) {
  try {
    const token = await getVertexToken();
    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/text-embedding-005:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ content: text.slice(0, 500) }] })
    });
    const data = await res.json();
    const values = data?.predictions?.[0]?.embeddings?.values || data?.predictions?.[0]?.values;
    return values ? Array.from(values) : null;
  } catch (e) { console.error('Embed error:', e); return null; }
}

function keywordScore(query, content) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const cLower = content.toLowerCase();
  const hits = qWords.filter(w => cLower.includes(w)).length;
  return qWords.length > 0 ? hits / qWords.length : 0;
}

const MEMORY_FILE = path.join(__dirname, 'riggy_memory.json');
let memoryStore    = [];
let permanentFacts = [];

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      console.log(`📚 Loaded ${memoryStore.length} memories`);
      rebuildPermanentFacts();
    }
  } catch(e) { console.error('Memory load error:', e); }
}

function rebuildPermanentFacts() {
  const explicit = memoryStore.filter(m => m.type === 'explicit' || m.type === 'auto');
  permanentFacts = explicit.slice(-20).map(m => m.content);
}

function saveMemoryToDisk() {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2)); }
  catch(e) { console.error('Memory save error:', e); }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; normA += a[i]*a[i]; normB += b[i]*b[i]; }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function saveMemory(content, type = 'fact') {
  try {
    const embedding = await embedText(content).catch(() => null);
    memoryStore.push({ id: Date.now(), content, type, embedding, createdAt: Date.now() });
    if (memoryStore.length > 300) {
      const explicit = memoryStore.filter(m => m.type === 'explicit' || m.type === 'auto');
      const others   = memoryStore.filter(m => m.type !== 'explicit' && m.type !== 'auto').slice(-200);
      memoryStore = [...explicit, ...others];
    }
    saveMemoryToDisk();
    rebuildPermanentFacts();
    console.log(`💾 Memory [${type}]${embedding ? ' +embed' : ' +text-only'}: ${content.slice(0, 60)}`);
    return true;
  } catch(e) { console.error('Save memory error:', e); return false; }
}

async function recallMemory(query, limit = 4) {
  try {
    if (memoryStore.length === 0) return null;
    const queryEmbed = await embedText(query).catch(() => null);
    const scored = memoryStore.map(m => {
      let score = 0;
      if (queryEmbed && m.embedding) score = cosineSimilarity(queryEmbed, m.embedding);
      else score = keywordScore(query, m.content) * 0.8;
      return { ...m, score };
    });
    const relevant = scored
      .filter(m => m.score > 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (relevant.length === 0) return null;
    return relevant.map(m => `[${m.type}] ${m.content}`).join('\n');
  } catch(e) { console.error('Recall error:', e); return null; }
}

// Get all notes saved by user
function getNotes() {
  return memoryStore
    .filter(m => m.type === 'note')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
}

function shouldAutoSave(text) {
  const triggers = [
    /my (wife|husband|partner|girlfriend|boyfriend|mom|dad|mother|father|sister|brother|son|daughter|kid|baby|friend|boss|name) (is|are|was)/i,
    /i (like|love|hate|prefer|always|never|usually)/i,
    /i work (at|for|in)/i,
    /i live (in|at|near)/i,
    /my (name|number|address|job|car|dog|cat|pet|house|apartment)/i,
  ];
  return triggers.some(t => t.test(text));
}

// ─── BRIEFING GENERATORS ──────────────────────────────────────────────────────
async function generateMorningBriefing(weather, reminderList, recentNotes, personalContext) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const weatherStr = weather ? `${weather.temp}°F and ${weather.description} in ${weather.city}.` : '';
  const remindersStr = reminderList.length > 0 ? `Reminders today: ${reminderList.join(', ')}.` : 'No reminders set.';
  const notesStr = recentNotes.length > 0 ? `Notes from yesterday: ${recentNotes.map(n => n.content).join('. ')}.` : '';
  const contextStr = personalContext ? `Personal context: ${personalContext}` : '';

  const prompt = `You are Mr. Riggy delivering a warm, energetic morning briefing. Keep it natural, spoken, under 6 sentences total.

Current time: ${now}
Weather: ${weatherStr}
${remindersStr}
${notesStr}
${contextStr}

Deliver: good morning greeting with the day and time, weather naturally woven in, reminders if any, any notes from yesterday, and end with a genuine uplifting message for the day — not generic, make it feel personal and real. Riggy's voice — warm, dry, a little funny. No lists. Pure spoken words.`;

  const body = {
    system_instruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Good morning briefing please.' }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 250, thinkingConfig: { thinkingBudget: 0 } }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Good morning friend. Mr. Riggy here, ready when you are.";
}

async function generateAfternoonBriefing(reminderList, recentNotes, personalContext) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

  const remindersStr = reminderList.length > 0 ? `Upcoming reminders: ${reminderList.join(', ')}.` : 'No reminders coming up.';
  const notesStr = recentNotes.length > 0 ? `Notes from today: ${recentNotes.map(n => n.content).join('. ')}.` : '';
  const contextStr = personalContext ? `What you know about this person: ${personalContext}` : '';

  const prompt = `You are Mr. Riggy delivering an afternoon check-in. Keep it natural, spoken, under 5 sentences.

Current time: ${now}
${remindersStr}
${notesStr}
${contextStr}

Deliver: a quick afternoon hey with the time, any reminders coming up, reference anything from their notes or personal context to make the positive message feel specific and real — not generic motivation, something that actually connects to what they've been dealing with or who they are. Warm, dry, Riggy's voice. No lists. Pure spoken words.`;

  const body = {
    system_instruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Afternoon check-in please.' }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Good afternoon friend. Rest of the day is yours — make it count.";
}

async function generateNightBriefing(todayNotes, tomorrowReminders, personalContext) {
  const notesStr = todayNotes.length > 0 ? `Today's notes: ${todayNotes.map(n => n.content).join('. ')}.` : 'No notes from today.';
  const remindersStr = tomorrowReminders.length > 0 ? `Tomorrow's reminders: ${tomorrowReminders.join(', ')}.` : 'Nothing set for tomorrow yet.';
  const contextStr = personalContext ? `About this person: ${personalContext}` : '';

  const prompt = `You are Mr. Riggy delivering a warm end-of-day wrap. Keep it natural, spoken, under 5 sentences.

${notesStr}
${remindersStr}
${contextStr}

Deliver: a warm good night, quick summary of today's notes if any, mention tomorrow's reminders if set, and close with something genuine — a wind-down line that feels personal, not canned. Riggy's voice. No lists. Pure spoken words.`;

  const body = {
    system_instruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Good night wrap please.' }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Good night friend. Rest up — Mr. Riggy will be here when you need him.";
}

// ─── REMINDERS ────────────────────────────────────────────────────────────────
const reminders = new Map();
let reminderIdCounter = 1;

function parseReminderTime(text) {
  const lower = text.toLowerCase();
  const now = new Date();
  const result = new Date(now);
  const minuteMatch = lower.match(/in (\d+)\s*min/);
  if (minuteMatch) { result.setMinutes(result.getMinutes() + parseInt(minuteMatch[1])); return result.getTime(); }
  const hourMatch = lower.match(/in (\d+)\s*hour/);
  if (hourMatch) { result.setHours(result.getHours() + parseInt(hourMatch[1])); return result.getTime(); }
  const timeMatch = lower.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    result.setHours(hours, minutes, 0, 0);
    if (result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1);
    return result.getTime();
  }
  if (lower.includes('tonight') || lower.includes('this evening')) { result.setHours(20, 0, 0, 0); if (result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1); return result.getTime(); }
  if (lower.includes('tomorrow morning')) { result.setDate(result.getDate() + 1); result.setHours(9, 0, 0, 0); return result.getTime(); }
  if (lower.includes('tomorrow')) { result.setDate(result.getDate() + 1); result.setHours(9, 0, 0, 0); return result.getTime(); }
  return null;
}

function parseReminderLabel(text) {
  return text
    .replace(/remind me (to|about|at|in)/gi, '').replace(/set a reminder (to|about|for)/gi, '')
    .replace(/remind me/gi, '').replace(/in \d+ (minutes?|hours?)/gi, '')
    .replace(/at \d{1,2}(:\d{2})?\s*(am|pm)?/gi, '')
    .replace(/tonight|this evening|tomorrow morning|tomorrow/gi, '')
    .replace(/\briggy\b/gi, '').trim().replace(/^[,.\s]+|[,.\s]+$/g, '').trim() || 'something';
}

function formatTimeUntil(ms) {
  const diff = ms - Date.now();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} minute${mins !== 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  return `in ${hours} hour${hours !== 1 ? 's' : ''} and ${rem} minute${rem !== 1 ? 's' : ''}`;
}

function isReminderRequest(text)      { const l = text.toLowerCase(); return l.includes('remind me') || l.includes('set a reminder') || l.includes('set reminder'); }
function isListRemindersRequest(text) { const l = text.toLowerCase(); return (l.includes('reminder') && (l.includes('list') || l.includes('what') || l.includes('show') || l.includes('my'))) || l.includes('my reminders'); }
function isCancelRemindersRequest(t)  { const l = t.toLowerCase(); return (l.includes('cancel') || l.includes('clear') || l.includes('delete')) && l.includes('reminder'); }
function isSaveChatRequest(text)      { const l = text.toLowerCase(); return l.includes('save this chat') || l.includes('save this conversation') || l.includes('remember this chat') || l.includes('remember this conversation'); }
function isExplicitMemoryRequest(t)   { const l = t.toLowerCase(); return (l.includes('remember this') || l.includes('remember that')) && !l.includes('pic') && !l.includes('photo'); }

// ─── CONVERSATION HISTORY ─────────────────────────────────────────────────────
const conversationHistory = new Map();

// ─── ECHO DETECTION ───────────────────────────────────────────────────────────
function normalizeForEcho(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

function looksLikeEcho(transcript, lastRiggyText) {
  const t = normalizeForEcho(transcript);
  const a = normalizeForEcho(lastRiggyText || '');
  if (t.length < 8 || a.length < 8) return false;
  if (t === a || a.includes(t) || t.includes(a)) return true;
  const tWords = new Set(t.split(' ').filter(w => w.length > 3));
  const aWords = new Set(a.split(' ').filter(w => w.length > 3));
  if (tWords.size === 0 || aWords.size === 0) return false;
  return [...tWords].filter(w => aWords.has(w)).length / Math.min(tWords.size, aWords.size) > 0.7;
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────
async function getWeather(city) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.cod !== 200) return null;
    return { temp: Math.round(data.main.temp), feels_like: Math.round(data.main.feels_like), description: data.weather[0].description, humidity: data.main.humidity, city: data.name };
  } catch (err) { return null; }
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────
async function askGemini(userText, sessionId, photoData = null, systemOverride = null, memoryContext = null, locationContext = '') {
  if (!conversationHistory.has(sessionId)) conversationHistory.set(sessionId, []);
  const history = conversationHistory.get(sessionId);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  let weatherContext = '';
  const weatherKeywords = ['weather', 'temp', 'temperature', 'hot', 'cold', 'outside', 'wear', 'forecast'];
  if (weatherKeywords.some(w => userText.toLowerCase().includes(w)) && !systemOverride) {
    const cityMatch = userText.match(/in ([A-Za-z\s]+)(?:\?|$)/i);
    const city = cityMatch ? cityMatch[1].trim() : DEFAULT_CITY;
    const weather = await getWeather(city);
    if (weather) weatherContext = `\nCurrent weather in ${weather.city}: ${weather.temp}°F, feels like ${weather.feels_like}°F, ${weather.description}, humidity ${weather.humidity}%.`;
  }

  const permanentBlock = permanentFacts.length > 0
    ? `\n\nPERSONAL FACTS — always remember these:\n${permanentFacts.join('\n')}`
    : '';
  const memoryBlock = memoryContext ? `\n\nRELEVANT MEMORIES:\n${memoryContext}` : '';

  const systemPrompt = systemOverride
    ? systemOverride
    : RIGGY_PERSONALITY + `\n\nCurrent date and time: ${now}` + weatherContext + locationContext + permanentBlock + memoryBlock;

  const userParts = [{ text: userText }];
  if (photoData) userParts.unshift({ inline_data: { mime_type: photoData.mimeType || 'image/jpeg', data: photoData.base64 } });
  if (!systemOverride) history.push({ role: 'user', parts: userParts });

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: systemOverride ? [{ role: 'user', parts: userParts }] : history,
    generationConfig: {
      temperature: systemOverride ? 0.7 : 0.9,
      maxOutputTokens: systemOverride ? 200 : 300,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!systemOverride) {
    history.push({ role: 'model', parts: [{ text: reply || 'I hit a snag friend.' }] });
    if (history.length > 20) conversationHistory.set(sessionId, history.slice(-20));
  }
  return reply || (systemOverride ? '' : "I hit a snag friend.");
}

// ─── ELEVENLABS TTS ───────────────────────────────────────────────────────────
let currentAudioRef = null;

async function speakWithElevenLabs(text, session) {
  try {
    const cleanText = text.replace(/[🤖⚡🛸]/g, '').trim();
    if (!cleanText) return;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_turbo_v2',
        output_format: 'mp3_44100_128',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!response.ok) { console.error('ElevenLabs error:', await response.text()); await session.audio.speak(text); return; }
    const audioBytes = Buffer.from(await response.arrayBuffer());
    const fileName = `audio_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, audioBytes);
    const estimatedDurationMs = Math.max(2000, (audioBytes.length / 16000) * 1000);
    const audioUrl = `https://riggy-glasses-production.up.railway.app/${fileName}`;
    console.log(`Playing: ${audioUrl} — ${audioBytes.length} bytes — ~${Math.round(estimatedDurationMs)}ms`);
    try {
      currentAudioRef = session.audio.playAudio({ audioUrl, waitForCompletion: true });
      await Promise.race([currentAudioRef, new Promise(r => setTimeout(r, estimatedDurationMs + 800))]);
    } catch (e) { console.error('playAudio error:', e); }
    finally { await new Promise(r => setTimeout(r, 500)); currentAudioRef = null; }
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch(e) {} }, 60000);
  } catch (err) { console.error('ElevenLabs error:', err); currentAudioRef = null; await session.audio.speak(text); }
}

// ─── KEYWORDS ─────────────────────────────────────────────────────────────────
const VISION_KEYWORDS      = ['what do you see','what can you see','look at this','what is this','what am i looking at','describe this','can you see','take a look','what does this say','read this','identify this','what is that','what are you seeing','look around','analyze this','check this out'];
const SAVE_KEYWORDS        = ['save this','save a pic','save a photo','take a picture','snap this','capture this','save what you see','save the pic','save that'];
const LIVE_ON_KEYWORDS     = ['go live','riggy live','start live','live mode'];
const LIVE_OFF_KEYWORDS    = ['stop live','end live','go to sleep','riggy stop','stop listening','stop'];
const GAME_ON_KEYWORDS     = ['game mode','riggy game','start game mode','gaming mode'];
const GAME_OFF_KEYWORDS    = ['stop game','end game mode','exit game','game off','stop game mode'];
const LIVE_CAM_ON_KEYWORDS = ['go live camera','live camera','live vision','start live camera','watch mode','eyes on'];

function needsCamera(text)    { return VISION_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function needsSave(text)      { return SAVE_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOn(text)    { return LIVE_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOff(text)   { return LIVE_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOn(text)    { return GAME_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOff(text)   { return GAME_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveCamOn(text) { return LIVE_CAM_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }

// ─── BOOT ─────────────────────────────────────────────────────────────────────
loadMemory();

// ─── APP ──────────────────────────────────────────────────────────────────────
class RiggyGlasses extends AppServer {
  async onSession(session, sessionId, userId) {
    console.log(`🤖 Riggy connected — session ${sessionId} — user ${userId}`);

    let liveMode    = false;
    let gameMode    = false;
    let liveCamMode = false;
    let noteMode    = false;
    let noteBuffer  = [];
    let noteSilenceTimer = null;
    let lastRiggyText = '';
    let sessionLog    = [];
    let bargeInAllowedAfterMs = 0;
    let ignoreSpeechDuringTTS = false;
    let isProcessing          = false;
    let processingTimer       = null;
    let gameModeInterval      = null;
    let liveCamInterval       = null;

    latestState.userSaid    = '';
    latestState.riggySaid   = 'Mr. Riggy online. Say my name to begin.';
    latestState.liveMode    = false;
    latestState.gameMode    = false;
    latestState.liveCamMode = false;
    latestState.noteMode    = false;

    const setProcessing = (val) => {
      isProcessing = val;
      if (processingTimer) { clearTimeout(processingTimer); processingTimer = null; }
      if (val) {
        processingTimer = setTimeout(() => {
          console.warn('⚠️ isProcessing stuck — force resetting');
          isProcessing = false;
          processingTimer = null;
        }, PROCESSING_TIMEOUT_MS);
      }
    };

    const speakSafe = async (text) => {
      ignoreSpeechDuringTTS = true;
      bargeInAllowedAfterMs = Date.now() + POST_TTS_BARGE_LOCKOUT_MS;
      try { await speakWithElevenLabs(text, session); }
      finally {
        await new Promise(r => setTimeout(r, RESUME_MIC_DELAY_MS));
        ignoreSpeechDuringTTS = false;
        bargeInAllowedAfterMs = Date.now() + POST_SPEECH_COOLDOWN_MS;
        lastRiggyText = text;
      }
    };

    // ── NOTE MODE ──
    const finishNote = async () => {
      noteMode = false;
      latestState.noteMode = false;
      if (noteSilenceTimer) { clearTimeout(noteSilenceTimer); noteSilenceTimer = null; }
      if (noteBuffer.length === 0) {
        await speakSafe("Nothing to save friend.");
        latestState.riggySaid = "Nothing to save friend.";
        return;
      }
      const noteContent = noteBuffer.join(' ').trim();
      noteBuffer = [];
      await saveMemory(noteContent, 'note');
      await speakSafe("Got it. Note saved.");
      latestState.riggySaid = "Got it. Note saved.";
      console.log(`📝 Note saved: ${noteContent.slice(0, 80)}`);
    };

    const setReminder = (label, fireAtMs) => {
      const id = reminderIdCounter++;
      const timerId = setTimeout(async () => {
        reminders.delete(id);
        const msg = `Hey friend — reminder: ${label}.`;
        latestState.riggySaid = msg;
        await speakSafe(msg);
      }, fireAtMs - Date.now());
      reminders.set(id, { id, label, fireAtMs, timerId });
    };

    const stopBurstModes = () => {
      if (gameModeInterval) { clearInterval(gameModeInterval); gameModeInterval = null; }
      if (liveCamInterval)  { clearInterval(liveCamInterval);  liveCamInterval  = null; }
      gameMode    = false;
      liveCamMode = false;
      latestState.gameMode    = false;
      latestState.liveCamMode = false;
    };

    const takePhoto = async (saveToGallery = false) => {
      try {
        const photo = await session.camera.requestPhoto({ saveToGallery });
        if (photo && photo.buffer) return { base64: photo.buffer.toString('base64'), mimeType: photo.mimeType || 'image/jpeg' };
      } catch (e) { console.error('Camera error:', e); }
      return null;
    };

    const startGameMode = async () => {
      stopBurstModes();
      gameMode = true; latestState.gameMode = true;
      setProcessing(true);
      try { await speakSafe("Game mode on. I'm watching."); } finally { setProcessing(false); }
      latestState.riggySaid = "Game mode on. I'm watching.";
      gameModeInterval = setInterval(async () => {
        if (!gameMode || ignoreSpeechDuringTTS || isProcessing) return;
        setProcessing(true);
        try {
          const photo = await takePhoto();
          if (!photo) return;
          const reply = await askGemini('Look at this game screen. Give me one quick tactical tip.', sessionId, photo, GAME_MODE_PERSONALITY);
          if (reply && reply.trim() !== 'SILENCE' && reply.trim().length > 3) { latestState.riggySaid = reply; await speakSafe(reply); }
        } catch(e) { console.error('Game error:', e); } finally { setProcessing(false); }
      }, GAME_MODE_INTERVAL_MS);
    };

    const startLiveCamMode = async () => {
      stopBurstModes();
      liveCamMode = true; latestState.liveCamMode = true;
      setProcessing(true);
      try { await speakSafe("Live vision on. I'm watching with you."); } finally { setProcessing(false); }
      latestState.riggySaid = "Live vision on. I'm watching with you.";
      liveCamInterval = setInterval(async () => {
        if (!liveCamMode || ignoreSpeechDuringTTS || isProcessing) return;
        setProcessing(true);
        try {
          const photo = await takePhoto();
          if (!photo) return;
          const reply = await askGemini("Take a look at what I'm seeing. Tell me something useful or interesting. If nothing worth saying, respond: SKIP", sessionId, photo);
          if (reply && reply.trim() !== 'SKIP' && !reply.toLowerCase().startsWith('skip') && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
        } catch(e) { console.error('Live cam error:', e); } finally { setProcessing(false); }
      }, LIVE_CAM_INTERVAL_MS);
    };

    const handleInput = async (userSaid) => {
      if (!userSaid) return;

      // ── NOTE MODE — collect everything until silence or "Riggy done" ──
      if (noteMode) {
        if (isNoteDoneRequest(userSaid)) {
          await finishNote();
          return;
        }
        // Add to note buffer and reset silence timer
        noteBuffer.push(userSaid);
        if (noteSilenceTimer) clearTimeout(noteSilenceTimer);
        noteSilenceTimer = setTimeout(async () => {
          await finishNote();
        }, NOTE_SILENCE_TIMEOUT_MS);
        return;
      }

      if (isProcessing) return;
      console.log(`User said: ${userSaid}`);
      latestState.userSaid = userSaid;
      setProcessing(true);
      sessionLog.push({ role: 'user', text: userSaid, time: Date.now() });

      try {
        // ── STOP ──
        if (wantsLiveOff(userSaid)) {
          stopBurstModes(); liveMode = false; latestState.liveMode = false;
          await speakSafe("Going quiet. Say my name when you need me.");
          latestState.riggySaid = "Going quiet. Say my name when you need me."; return;
        }

        // ── MORNING BRIEFING ──
        if (isMorningGreeting(userSaid)) {
          const weather = await getWeather(DEFAULT_CITY);
          const reminderList = [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`);
          const yesterdayNotes = memoryStore
            .filter(m => m.type === 'note' && Date.now() - m.createdAt < 86400000 * 2)
            .slice(-3);
          const context = permanentFacts.slice(0, 5).join('. ');
          const briefing = await generateMorningBriefing(weather, reminderList, yesterdayNotes, context);
          await speakSafe(briefing);
          latestState.riggySaid = briefing;
          return;
        }

        // ── AFTERNOON BRIEFING ──
        if (isAfternoonGreeting(userSaid)) {
          const reminderList = [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`);
          const todayNotes = memoryStore
            .filter(m => m.type === 'note' && Date.now() - m.createdAt < 43200000)
            .slice(-3);
          const context = permanentFacts.slice(0, 5).join('. ');
          const briefing = await generateAfternoonBriefing(reminderList, todayNotes, context);
          await speakSafe(briefing);
          latestState.riggySaid = briefing;
          return;
        }

        // ── GOOD NIGHT BRIEFING ──
        if (isNightGreeting(userSaid)) {
          const todayNotes = memoryStore
            .filter(m => m.type === 'note' && Date.now() - m.createdAt < 86400000)
            .slice(-5);
          const tomorrowReminders = [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`);
          const context = permanentFacts.slice(0, 3).join('. ');
          const briefing = await generateNightBriefing(todayNotes, tomorrowReminders, context);
          await speakSafe(briefing);
          latestState.riggySaid = briefing;
          return;
        }

        // ── NOTE THIS ──
        if (isNoteRequest(userSaid)) {
          noteMode = true;
          latestState.noteMode = true;
          noteBuffer = [];
          await speakSafe("Go ahead, I'm listening. Say Riggy done when you're finished.");
          latestState.riggySaid = "Go ahead, I'm listening.";
          setProcessing(false);
          // Start silence timer in case they never say done
          noteSilenceTimer = setTimeout(async () => {
            if (noteMode) await finishNote();
          }, NOTE_SILENCE_TIMEOUT_MS * 4); // 20 seconds initial grace period
          return;
        }

        // ── READ MY NOTES ──
        if (isNoteListRequest(userSaid)) {
          const notes = getNotes();
          if (notes.length === 0) { await speakSafe("No notes saved yet friend."); latestState.riggySaid = "No notes saved yet friend."; return; }
          const noteText = notes.slice(0, 3).map((n, i) => `Note ${i + 1}: ${n.content}`).join('. ');
          const msg = `You've got ${notes.length} note${notes.length !== 1 ? 's' : ''}. Here are the latest: ${noteText}.`;
          await speakSafe(msg);
          latestState.riggySaid = msg;
          return;
        }

        // ── BATTERY ──
        if (isBatteryRequest(userSaid)) {
          try {
            const battery = await session.device.getBatteryLevel();
            const msg = battery !== null && battery !== undefined
              ? `Glasses battery is at ${Math.round(battery)}%.`
              : "Can't read the battery level right now friend.";
            await speakSafe(msg);
            latestState.riggySaid = msg;
          } catch(e) {
            await speakSafe("Can't read the battery level right now friend.");
            latestState.riggySaid = "Can't read the battery level right now friend.";
          }
          return;
        }

        // ── INTEL MODE ──
        if (isIntelRequest(userSaid)) {
          const photo = await takePhoto();
          if (!photo) { await speakSafe("Couldn't get a clear shot friend. Try again."); latestState.riggySaid = "Couldn't get a clear shot."; return; }
          const reply = await askGemini('Run an intel sweep on what you see in this image.', sessionId, photo, INTEL_PERSONALITY);
          if (reply && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
          return;
        }

        // ── CALL ──
        if (isCallRequest(userSaid)) {
          const intent = parseCallIntent(userSaid);
          if (!intent) { await speakSafe("I don't have that contact friend."); latestState.riggySaid = "I don't have that contact friend."; return; }
          const ok = await twilioCall(intent.number, intent.customMessage);
          const msg = ok ? `Calling ${intent.name} now.` : `Couldn't reach ${intent.name} right now.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }

        // ── TEXT ──
        if (isTextRequest(userSaid)) {
          const intent = parseTextIntent(userSaid);
          if (!intent) { await speakSafe("I don't have that contact or didn't catch the message."); latestState.riggySaid = "I don't have that contact or didn't catch the message."; return; }
          const ok = await twilioText(intent.number, intent.message);
          const msg = ok ? `Text sent to ${intent.name}.` : `Couldn't send that text right now.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }

        // ── WHERE AM I ──
        if (isLocationRequest(userSaid)) {
          const loc = await getGlassesLocation(session);
          if (loc) {
            const address = await reverseGeocode(loc.lat, loc.lng);
            const msg = address ? `You're at ${address}.` : `You're at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}.`;
            await speakSafe(msg); latestState.riggySaid = msg;
          } else {
            await speakSafe("GPS isn't available right now. You're near Deltona, Florida.");
            latestState.riggySaid = "GPS isn't available right now.";
          }
          return;
        }

        // ── NEARBY ──
        if (isNearbyRequest(userSaid)) {
          const query = parseNearbyQuery(userSaid);
          if (query) {
            const loc = await getGlassesLocation(session);
            const lat = loc?.lat || DEFAULT_LAT;
            const lng = loc?.lng || DEFAULT_LNG;
            const results = await searchNearby(query, lat, lng);
            const msg = results ? `Nearest ${query}: ${results}.` : `Couldn't find ${query} nearby right now.`;
            await speakSafe(msg); latestState.riggySaid = msg; return;
          }
        }

        // ── HOW FAR ──
        if (isDistanceRequest(userSaid)) {
          const destination = parseDistanceQuery(userSaid);
          if (destination) {
            const loc = await getGlassesLocation(session);
            const lat = loc?.lat || DEFAULT_LAT;
            const lng = loc?.lng || DEFAULT_LNG;
            const results = await searchNearby(destination, lat, lng, 50000);
            const msg = results ? `${results}.` : `Couldn't find distance to ${destination} right now.`;
            await speakSafe(msg); latestState.riggySaid = msg; return;
          }
        }

        // ── SAVE CHAT ──
        if (isSaveChatRequest(userSaid)) {
          if (sessionLog.length < 2) { await speakSafe("Not much to save yet friend."); latestState.riggySaid = "Not much to save yet friend."; return; }
          const chatText = sessionLog.map(l => `${l.role === 'user' ? 'Friend' : 'Riggy'}: ${l.text}`).join('\n');
          await saveMemory(chatText, 'chat');
          await speakSafe("Got it. This conversation is saved."); latestState.riggySaid = "Got it. This conversation is saved."; return;
        }

        // ── EXPLICIT MEMORY ──
        if (isExplicitMemoryRequest(userSaid)) {
          await saveMemory(userSaid, 'explicit');
          await speakSafe("Locked in. I'll remember that."); latestState.riggySaid = "Locked in. I'll remember that."; return;
        }

        // ── REMINDERS ──
        if (isListRemindersRequest(userSaid)) {
          if (reminders.size === 0) { await speakSafe("No reminders set, friend."); latestState.riggySaid = "No reminders set, friend."; return; }
          const list = [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`).join(', ');
          const msg = `You've got ${reminders.size} reminder${reminders.size !== 1 ? 's' : ''}: ${list}.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }
        if (isCancelRemindersRequest(userSaid)) {
          reminders.forEach(r => clearTimeout(r.timerId)); reminders.clear();
          await speakSafe("All reminders cleared."); latestState.riggySaid = "All reminders cleared."; return;
        }
        if (isReminderRequest(userSaid)) {
          const fireAtMs = parseReminderTime(userSaid);
          if (!fireAtMs) { await speakSafe("Didn't catch the time. Try: remind me in 2 hours or at 3pm."); latestState.riggySaid = "Didn't catch the time."; return; }
          const label = parseReminderLabel(userSaid);
          setReminder(label, fireAtMs);
          const confirmation = `Got it. I'll remind you to ${label} ${formatTimeUntil(fireAtMs)}.`;
          await speakSafe(confirmation); latestState.riggySaid = confirmation; return;
        }

        // ── MODES ──
        if (wantsGameOn(userSaid))    { setProcessing(false); await startGameMode(); return; }
        if (wantsGameOff(userSaid))   { stopBurstModes(); await speakSafe("Game mode off."); latestState.riggySaid = "Game mode off."; return; }
        if (wantsLiveCamOn(userSaid)) { setProcessing(false); await startLiveCamMode(); return; }
        if (wantsLiveOn(userSaid) && !liveMode) {
          liveMode = true; latestState.liveMode = true;
          await speakSafe("Live mode on. Just talk."); latestState.riggySaid = "Live mode on. Just talk."; return;
        }

        // ── VISION (single shot) ──
        let photoData = null;
        const savePhoto   = needsSave(userSaid);
        const visionQuery = needsCamera(userSaid);
        if (visionQuery || savePhoto) {
          const photo = await takePhoto(savePhoto);
          if (photo && visionQuery) photoData = photo;
          if (savePhoto && !visionQuery) { await speakSafe("Saved it, friend."); latestState.riggySaid = "Saved it, friend."; return; }
        }

        // ── LOCATION CONTEXT for Gemini ──
        let locationContext = '';
        if (isNearbyRequest(userSaid) || userSaid.toLowerCase().includes('near') || userSaid.toLowerCase().includes('around here')) {
          const loc = await getGlassesLocation(session);
          if (loc) {
            const address = await reverseGeocode(loc.lat, loc.lng);
            locationContext = `\n\nUser's current location: ${address || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`}`;
          }
        }

        // ── MAIN RESPONSE ──
        const memoryContext = await recallMemory(userSaid);
        const reply = await askGemini(userSaid, sessionId, photoData, null, memoryContext, locationContext);
        console.log(`Riggy: ${reply}`);
        sessionLog.push({ role: 'riggy', text: reply, time: Date.now() });
        if (shouldAutoSave(userSaid)) saveMemory(userSaid, 'auto').catch(() => {});
        await speakSafe(reply);
        latestState.riggySaid = reply;

      } catch (err) {
        console.error('Error:', err);
        await session.audio.speak("Something glitched friend. Try me again.");
      } finally { setProcessing(false); }
    };

    session._toggleLive = async () => {
      if (gameMode || liveCamMode) { stopBurstModes(); await speakSafe("Burst mode off."); latestState.riggySaid = "Burst mode off."; return false; }
      liveMode = !liveMode; latestState.liveMode = liveMode;
      if (liveMode) { await speakSafe("Live mode on. Just talk."); latestState.riggySaid = "Live mode on. Just talk."; }
      else { await speakSafe("Going quiet. Say my name when you need me."); latestState.riggySaid = "Going quiet. Say my name when you need me."; }
      return liveMode;
    };

    session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;
      if (ignoreSpeechDuringTTS) { console.log('🔇 TTS active'); return; }
      if (!noteMode && isProcessing) { console.log('🔇 Busy'); return; }
      if (Date.now() < bargeInAllowedAfterMs) { console.log('🔇 Cooldown'); return; }
      const userSaid = data.text.trim();
      if (!userSaid) return;
      if (looksLikeEcho(userSaid, lastRiggyText)) { console.log('🔇 Echo:', userSaid); return; }

      // Note mode — pass everything through without wake word check
      if (noteMode) { await handleInput(userSaid); return; }

      if (liveMode || gameMode || liveCamMode) { await handleInput(userSaid); return; }
      const lower = userSaid.toLowerCase();
      if (lower.includes('mr.riggy') || lower.includes('mr riggy') || lower.includes('riggy')) await handleInput(userSaid);
    });
  }

  async onStop(sessionId, userId, reason) {
    console.log(`👋 Session ended — ${sessionId} — reason: ${reason}`);
  }
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const app = new RiggyGlasses({
  packageName: 'com.riggyglasses',
  apiKey: process.env.MENTRA_API_KEY || 'dd66c2725fb01cef2c7b3d01696d9e7bc9ff9138fb732686212ee96d94c1ecfb',
  port: parseInt(process.env.PORT) || 3000,
  host: '0.0.0.0'
});

app.start();

const expressApp = app.getExpressApp();
expressApp.use(express.json());

expressApp.get('/audio_:timestamp.mp3', (req, res) => {
  const fileName = `audio_${req.params.timestamp}.mp3`;
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) { res.status(404).end(); return; }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

expressApp.use(express.static(__dirname));
expressApp.get('/webview', (req, res) => { res.sendFile(path.join(__dirname, 'webview.html')); });
expressApp.get('/webview-state', (req, res) => { res.json(latestState); });
expressApp.get('/memory', (req, res) => { res.json(memoryStore.map(m => ({ id: m.id, content: m.content, type: m.type, createdAt: m.createdAt }))); });

expressApp.post('/toggle-live', async (req, res) => {
  const sessions = app.getActiveSessions ? app.getActiveSessions() : null;
  if (sessions && sessions.length > 0) {
    const s = sessions[0];
    if (s._toggleLive) { const live = await s._toggleLive(); res.json({ live }); return; }
  }
  latestState.liveMode = !latestState.liveMode;
  res.json({ live: latestState.liveMode });
});

console.log(`🤖 Mr. Riggy glasses server running on port ${process.env.PORT || 3000}`);