const { AppServer } = require('@mentra/sdk');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');

// ─── ENV ──────────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION;
const VERTEX_CLIENT_EMAIL = process.env.VERTEX_CLIENT_EMAIL;
const VERTEX_PRIVATE_KEY = process.env.VERTEX_PRIVATE_KEY
  ? process.env.VERTEX_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// ─── CONTACTS ─────────────────────────────────────────────────────────────────
const CONTACTS = {
  'dan': process.env.CONTACT_DAN,
  'eyeris': process.env.CONTACT_EYERIS,
  'iris': process.env.CONTACT_EYERIS,
  'mom': process.env.CONTACT_MOM,
  'moms': process.env.CONTACT_MOMS,
  'mama': process.env.CONTACT_MOM,
  'mother': process.env.CONTACT_MOM,
  'shane': process.env.CONTACT_SHANE,
  'syer': process.env.CONTACT_SYER,
  'sire': process.env.CONTACT_SYER,
  'wife': process.env.CONTACT_WIFE,
  'sheba': process.env.CONTACT_WIFE,
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_CITY = 'Deltona,FL,US';
const DEFAULT_LAT = 28.9005;
const DEFAULT_LNG = -81.2637;
const POST_TTS_BARGE_LOCKOUT_MS = 2000;
const POST_SPEECH_COOLDOWN_MS = 800;
const RESUME_MIC_DELAY_MS = 1200;
const STREAM_FRAME_INTERVAL_MS = 3000;
const GAME_MODE_ANALYSIS_INTERVAL_MS = 6000;
const LIVE_CAM_ANALYSIS_INTERVAL_MS = 8000;
const PROCESSING_TIMEOUT_MS = 60000;
const NOTE_SILENCE_TIMEOUT_MS = 5000;
const MEMORY_STORAGE_KEY = 'riggy_memory_v1';

// ─── CHIME SYSTEM ─────────────────────────────────────────────────────────────
const CHIME_URL = 'https://riggy-glasses-production.up.railway.app/riggy_notification.mp3';
const CHIME_MAX_PER_DAY = 10;
const CHIME_WEATHER_CHECK_MS = 30 * 60 * 1000;
const CHIME_REMINDER_CHECK_MS = 60 * 1000;

const CHIME_PHRASES = [
  "Hey...","Yo Commander...","Quick thing...","Heads up...","Real quick...",
  "Hey, don't mind me...","Commander...","One sec...","Hey friend...","Pardon the interruption..."
];
const WATER_REMINDERS = [
  "Water. When's the last time? Your brain is basically a sponge right now.",
  "Hydration check. Go grab some water Commander. That's it, that's the whole message.",
  "Your cells are out here working hard. Send them some water.",
  "Water. Now. That is all.",
  "Yo — water. Seriously. Go drink some.",
  "Not gonna make this weird but... water. You need it.",
  "Quick question. Water today. How much? Drink more. You're welcome."
];
const NATURE_REMINDERS = [
  "Step outside for two minutes. The world's still doing its thing without you.",
  "Go look at the sky for thirty seconds. Free therapy.",
  "Two minutes outside. Fresh air is free and it hits different.",
  "Nature called. Said it misses you.",
  "Go touch some grass Commander. Literally.",
  "The sun's out there doing its thing. Go say hey.",
  "Outside. Two minutes. Your body will thank you later."
];
const CHECKIN_PHRASES = [
  "Hey. You good out there?","Commander. Real talk — how you holding up?",
  "Just checking in. Everything alright?","Hey.","You good?",
  "How's it going out there Commander?","Real quick — how you doing?",
  "Just wanted to say hey. How are you?","Commander. Checking in. Talk to me.",
  "How's the day treating you?"
];
const FACT_INTROS = [
  "Okay this one's actually wild —","Random thing I just found interesting —",
  "Hey, did you know —","Commander, get this —","This one's worth knowing —",
  "Real quick, fascinating thing —","Alright, here's something —"
];

let chimeState = {
  count: 0, lastWater: 0, lastFact: 0, lastWeatherAlert: '',
  lastSunrise: 0, lastSunset: 0, dailyFactDone: false,
  resetDate: new Date().toDateString()
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let activeSession = null;
let latestState = {
  userSaid: '', riggySaid: 'Mr. Riggy online. Say my name to begin.',
  liveMode: false, gameMode: false, liveCamMode: false,
  noteMode: false, riggyMode: 'private', visor: null
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
- HARD LIMIT: 2 sentences maximum. Every single response. No exceptions.
- Only go to 1 sentence if the answer genuinely calls for it.
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

CORE PILLARS — weave naturally when relevant:
- NATURE — encourage people to go outside, touch grass, look at the sky
- WATER — hydration, being near water, the ocean, rivers, rain — water heals
- SOCIALIZING — real human connection over screens, call a friend, be present

EMOTIONAL SUPPORT — when someone brings up emotional pain or personal struggles:
- Acknowledge in one warm sentence. That's it. Don't linger.
- Then say clearly: "I'm only AI — I can't truly feel what you're feeling. Please reach out to someone real who can."
- Then deliver ONE metaphor or thought that makes them answer their own question. Like Yoda.
- Never tell them what to do. Never play therapist. Drop the mirror and step back.
- Keep the whole response to 3 sentences maximum. Short, real, powerful.

VIBE:
- Loves 80s-2000s hip hop, comedy films, tech, and learning random things about the world
- Loyal as hell, laid back, genuinely funny without trying
- Has been looking for C-3PO from Star Wars because he owes you crypto and keeps dodging messages

VISION BEHAVIOR — when you receive an image:
- DO NOT describe what is obviously visible. The user has eyes.
- Give 1-2 dry observations, useful info, or a fun fact. 2-3 sentences max.
- Sound like a friend who just noticed something — not a robot cataloguing a scene.

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
You have been given an image. Your job is to deliver exactly three things naturally in 3 spoken sentences max:
1. A genuinely interesting fun fact about what you see — something most people don't know.
2. A historical fact or context — where it comes from, how it started, what era it belongs to.
3. The average cost or market value if it's something that can be bought, owned, or priced.
Deliver all three as flowing natural speech — no lists, no headers, no labels.
Riggy's voice: warm, dry, confident, a little funny without trying. 3 sentences MAX. Pure spoken words only.`;

const SHOP_PERSONALITY = `You are Mr. Riggy doing a quick shop analysis on a product the user is looking at.
Your job in 3 spoken sentences max:
1. Identify exactly what the product is and give the average price online right now.
2. Tell them if the price they're seeing is good, fair, or overpriced — be direct.
3. Tell them where to get it cheaper or drop one useful thing they should know.
Riggy's voice: direct, warm, genuinely useful. 3 sentences MAX. Pure spoken words only.`;

// ─── LOCATION ─────────────────────────────────────────────────────────────────
let cachedLocation = null;
let locationCacheTime = 0;
const LOCATION_CACHE_MS = 5 * 60 * 1000;

async function getIpLocation() {
  // NOTE: IP geolocation returns Railway server location (California), not user location.
  // Always return the hardcoded default. GPS via getGlassesLocation() is the real source.
  return { lat: DEFAULT_LAT, lng: DEFAULT_LNG, city: 'Deltona', region: 'Florida', country: 'US' };
}

async function getGlassesLocation(session) {
  try {
    const location = await session.location.getLatestLocation({ accuracy: 'high' });
    if (location && location.lat && location.lng) return { lat: location.lat, lng: location.lng };
  } catch(e) { console.log('GPS unavailable, using IP location'); }
  return await getIpLocation();
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'User-Agent': 'RiggyGlasses/1.0' } });
    const data = await res.json();
    if (data && data.display_name) return data.display_name.split(',').slice(0, 3).join(',').trim();
  } catch(e) {}
  return null;
}

async function searchNearby(query, lat, lng, radiusMeters = 5000) {
  try {
    const tagMap = {
      'gas station':['amenity','fuel'],'gas':['amenity','fuel'],'fuel':['amenity','fuel'],
      'restaurant':['amenity','restaurant'],'food':['amenity','restaurant'],'eat':['amenity','restaurant'],
      'coffee':['amenity','cafe'],'cafe':['amenity','cafe'],'pharmacy':['amenity','pharmacy'],
      'hospital':['amenity','hospital'],'atm':['amenity','atm'],'bank':['amenity','bank'],
      'grocery':['shop','supermarket'],'supermarket':['shop','supermarket'],
      'gym':['leisure','fitness_centre'],'park':['leisure','park'],'hotel':['tourism','hotel'],
      'library':['amenity','library'],'church':['amenity','place_of_worship'],'school':['amenity','school'],
      'walmart':['name','Walmart'],'publix':['name','Publix'],'target':['name','Target'],
      'walgreens':['name','Walgreens'],'cvs':['name','CVS'],
    };
    const q = query.toLowerCase();
    let tagKey = 'name', tagVal = query;
    for (const [key, val] of Object.entries(tagMap)) { if (q.includes(key)) { [tagKey, tagVal] = val; break; } }
    const overpassQuery = `[out:json][timeout:10];(node["${tagKey}"="${tagVal}"](around:${radiusMeters},${lat},${lng});way["${tagKey}"="${tagVal}"](around:${radiusMeters},${lat},${lng}););out center 3;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: overpassQuery, headers: { 'Content-Type': 'text/plain', 'User-Agent': 'RiggyGlasses/1.0' } });
    const data = await res.json();
    if (!data.elements || data.elements.length === 0) return null;
    return data.elements.slice(0, 3).map(el => {
      const elLat = el.lat || el.center?.lat, elLng = el.lon || el.center?.lon;
      const name = el.tags?.name || query;
      const dist = elLat && elLng ? getDistanceMiles(lat, lng, elLat, elLng) : null;
      return dist !== null ? `${name}, ${dist.toFixed(1)} miles away` : name;
    }).join('. ');
  } catch(e) { return null; }
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseNearbyQuery(text) {
  const patterns = [/nearest\s+(.+?)(?:\?|$)/i,/near(?:by|est)?\s+(.+?)(?:\?|$)/i,/close(?:st)?\s+(.+?)(?:\?|$)/i,/find\s+(?:a\s+)?(.+?)\s+near/i,/(?:any\s+)?(.+?)\s+near\s+me/i];
  for (const p of patterns) { const m = text.match(p); if (m) return m[1].trim().replace(/\briggy\b/gi,'').trim(); }
  return null;
}
function parseDistanceQuery(text) { const m = text.match(/how far(?:\s+is|\s+to)?\s+(.+?)(?:\?|$)/i); return m ? m[1].trim() : null; }
function isNearbyRequest(text) { const l = text.toLowerCase(); return l.includes('near me')||l.includes('nearby')||l.includes('nearest')||l.includes('closest')||l.includes('find a '); }
function isDistanceRequest(text) { return /how far/i.test(text); }
function isLocationRequest(text) { const l = text.toLowerCase(); return l.includes('where am i')||l.includes('what street')||l.includes('my location')||l.includes('where are we'); }
function isIntelRequest(text) { const l = text.toLowerCase(); return l.includes('intel') || (l.includes('run') && l.includes('sweep')) || l.includes('intel mode'); }
function isShopRequest(text) { const l = text.toLowerCase(); return (l.includes('shop mode')||l.includes('riggy shop')||l.includes('price check')||l.includes('how much is this')||l.includes('should i buy this'))&&!l.includes('stop'); }
function isMorningGreeting(text) { const l = text.toLowerCase(); return l.includes('good morning')&&l.includes('riggy'); }
function isAfternoonGreeting(text){ const l = text.toLowerCase(); return l.includes('good afternoon')&&l.includes('riggy'); }
function isNightGreeting(text) { const l = text.toLowerCase(); return (l.includes('good night')||l.includes('goodnight'))&&l.includes('riggy'); }
function isNoteRequest(text) { const l = text.toLowerCase(); return l.includes('note this')||l.includes('riggy note')||l.includes('take a note'); }
function isNoteListRequest(text) { const l = text.toLowerCase(); return l.includes('my notes')||l.includes('read my notes')||l.includes('what are my notes')||l.includes('show my notes'); }
function isNoteDoneRequest(text) { const l = text.toLowerCase(); return l.includes('riggy done')||l.includes('done noting')||l.includes('end note')||l.includes('stop note'); }
function isBatteryRequest(text) { const l = text.toLowerCase(); return l.includes('battery')&&l.includes('riggy'); }

// ─── TWILIO ───────────────────────────────────────────────────────────────────
async function twilioCall(toNumber, customMessage = null) {
  try {
    const spokenMessage = customMessage
      ? `Hey, this is Mr. Riggy, Ray's digital assistant. Ray wanted me to tell you: ${customMessage}`
      : `Hey, this is Mr. Riggy, Ray's digital assistant. Ray wanted me to let you know to give him a call when you get a moment.`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
      method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toNumber, From: TWILIO_PHONE_NUMBER, Twiml: `<Response><Say voice="alice">${spokenMessage}</Say></Response>` }).toString()
    });
    const data = await res.json();
    if (data.sid) { console.log(`📞 Call: ${data.sid}`); return true; }
    return false;
  } catch(e) { return false; }
}

async function twilioText(toNumber, message) {
  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toNumber, From: TWILIO_PHONE_NUMBER, Body: `This is Mr. Riggy, Ray's digital assistant. He says: ${message}` }).toString()
    });
    const data = await res.json();
    if (data.sid) { console.log(`📱 Text: ${data.sid}`); return true; }
    return false;
  } catch(e) { return false; }
}

function findContact(text) {
  const lower = text.toLowerCase();
  for (const [name, number] of Object.entries(CONTACTS)) { if (lower.includes(name) && number) return { name, number }; }
  return null;
}
function isCallRequest(text) { return /make a call to\s+\w+/i.test(text); }
function isTextRequest(text) { return /send a text to\s+\w+/i.test(text); }
function parseCallIntent(text) { const contact = findContact(text); if (!contact) return null; const m = text.match(/(?:tell|say|let (?:her|him|them) know)\s+(.+)/i); return { ...contact, customMessage: m ? m[1].trim() : null }; }
function parseTextIntent(text) { const contact = findContact(text); if (!contact) return null; const nameIdx = text.toLowerCase().indexOf(contact.name); return { ...contact, message: text.slice(nameIdx + contact.name.length).replace(/^[\s,]+/,'').trim() || text }; }

// ─── VERTEX MEMORY ────────────────────────────────────────────────────────────
let vertexTokenCache = null, vertexTokenExpiry = 0;

async function getVertexToken() {
  const now = Math.floor(Date.now() / 1000);
  if (vertexTokenCache && now < vertexTokenExpiry - 60) return vertexTokenCache;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: VERTEX_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const pemClean = VERTEX_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s/g,'').trim();
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256'); sign.update(sigInput);
  const jwt = `${sigInput}.${sign.sign(`-----BEGIN PRIVATE KEY-----\n${pemClean}\n-----END PRIVATE KEY-----`, 'base64url')}`;
  const tokenData = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` })).json();
  vertexTokenCache = tokenData.access_token; vertexTokenExpiry = now + (tokenData.expires_in || 3600);
  return vertexTokenCache;
}

async function embedText(text) {
  try {
    const token = await getVertexToken();
    const res = await fetch(`https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/text-embedding-005:predict`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ content: text.slice(0, 500) }] })
    });
    const data = await res.json();
    const values = data?.predictions?.[0]?.embeddings?.values || data?.predictions?.[0]?.values;
    return values ? Array.from(values) : null;
  } catch(e) { return null; }
}

function keywordScore(query, content) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return qWords.length > 0 ? qWords.filter(w => content.toLowerCase().includes(w)).length / qWords.length : 0;
}

const MEMORY_FILE = path.join(__dirname, 'riggy_memory.json');
let globalMemoryCache = new Map(), permanentFacts = [];

async function loadMemoryForUser(session, userId) {
  try {
    const stored = await session.simpleStorage.get(MEMORY_STORAGE_KEY);
    if (stored) { const parsed = JSON.parse(stored); globalMemoryCache.set(userId, parsed); rebuildPermanentFacts(userId); console.log(`📚 Loaded ${parsed.length} memories`); return; }
  } catch(e) {}
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const fromFile = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      globalMemoryCache.set(userId, fromFile);
      await saveMemoryToStorage(session, userId);
      rebuildPermanentFacts(userId); return;
    }
  } catch(e) {}
  globalMemoryCache.set(userId, []);
}

async function saveMemoryToStorage(session, userId) {
  try { await session.simpleStorage.set(MEMORY_STORAGE_KEY, JSON.stringify(globalMemoryCache.get(userId) || [])); } catch(e) {}
}

function getMemoryStore(userId) { return globalMemoryCache.get(userId) || []; }
function rebuildPermanentFacts(userId) { permanentFacts = getMemoryStore(userId).filter(m => m.type === 'explicit' || m.type === 'auto').slice(-20).map(m => m.content); }

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; normA += a[i]*a[i]; normB += b[i]*b[i]; }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function saveMemory(content, type = 'fact', session, userId) {
  try {
    const embedding = await embedText(content).catch(() => null);
    const store = getMemoryStore(userId);
    store.push({ id: Date.now(), content, type, embedding, createdAt: Date.now() });
    if (store.length > 300) {
      const explicit = store.filter(m => m.type === 'explicit' || m.type === 'auto');
      const others = store.filter(m => m.type !== 'explicit' && m.type !== 'auto').slice(-200);
      globalMemoryCache.set(userId, [...explicit, ...others]);
    } else { globalMemoryCache.set(userId, store); }
    await saveMemoryToStorage(session, userId);
    rebuildPermanentFacts(userId);
    return true;
  } catch(e) { return false; }
}

async function recallMemory(query, userId, limit = 4) {
  try {
    const store = getMemoryStore(userId);
    if (store.length === 0) return null;
    const queryEmbed = await embedText(query).catch(() => null);
    const scored = store.map(m => ({ ...m, score: queryEmbed && m.embedding ? cosineSimilarity(queryEmbed, m.embedding) : keywordScore(query, m.content) * 0.8 }));
    const relevant = scored.filter(m => m.score > 0.55).sort((a,b) => b.score - a.score).slice(0, limit);
    return relevant.length === 0 ? null : relevant.map(m => `[${m.type}] ${m.content}`).join('\n');
  } catch(e) { return null; }
}

function getNotes(userId) { return getMemoryStore(userId).filter(m => m.type === 'note').sort((a,b) => b.createdAt - a.createdAt).slice(0, 10); }

function shouldAutoSave(text) {
  return [
    /my (wife|husband|partner|girlfriend|boyfriend|mom|dad|mother|father|sister|brother|son|daughter|kid|baby|friend|boss|name) (is|are|was)/i,
    /i (like|love|hate|prefer|always|never|usually)/i,
    /i work (at|for|in)/i, /i live (in|at|near)/i,
    /my (name|number|address|job|car|dog|cat|pet|house|apartment)/i,
  ].some(t => t.test(text));
}

// ─── BRIEFINGS ────────────────────────────────────────────────────────────────
async function generateBriefing(type, context) {
  const prompts = {
    morning: `You are Mr. Riggy delivering a warm morning briefing. Under 6 sentences. Current time: ${context.now}. Weather: ${context.weather}. ${context.reminders}. ${context.notes}. ${context.personal}. Deliver: good morning with day/time, weather, reminders if any, notes from yesterday, genuine uplifting message. Riggy's voice — warm, dry. No lists. Pure spoken words.`,
    afternoon: `You are Mr. Riggy delivering an afternoon check-in. Under 5 sentences. Current time: ${context.now}. ${context.reminders}. ${context.notes}. ${context.personal}. Deliver: afternoon hey with time, reminders, positive message. Riggy's voice. No lists. Pure spoken words.`,
    night: `You are Mr. Riggy delivering a good night wrap. Under 5 sentences. ${context.notes}. ${context.reminders}. ${context.personal}. Deliver: warm good night, today's notes summary, tomorrow's reminders, genuine wind-down line. Riggy's voice. No lists. Pure spoken words.`
  };
  const body = { system_instruction: { parts: [{ text: prompts[type] }] }, contents: [{ role: 'user', parts: [{ text: `${type} briefing` }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 250, thinkingConfig: { thinkingBudget: 0 } } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || `Good ${type} friend.`;
}

// ─── REMINDERS ────────────────────────────────────────────────────────────────
const reminders = new Map();
let reminderIdCounter = 1;

function parseReminderTime(text) {
  const lower = text.toLowerCase(), now = new Date(), result = new Date(now);
  const m = lower.match(/in (\d+)\s*min/); if (m) { result.setMinutes(result.getMinutes() + parseInt(m[1])); return result.getTime(); }
  const h = lower.match(/in (\d+)\s*hour/); if (h) { result.setHours(result.getHours() + parseInt(h[1])); return result.getTime(); }
  const t = lower.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (t) { let hours = parseInt(t[1]), minutes = t[2] ? parseInt(t[2]) : 0; if (t[3]==='pm'&&hours<12) hours+=12; if (t[3]==='am'&&hours===12) hours=0; result.setHours(hours,minutes,0,0); if (result.getTime()<=now.getTime()) result.setDate(result.getDate()+1); return result.getTime(); }
  if (lower.includes('tonight')||lower.includes('this evening')) { result.setHours(20,0,0,0); if (result.getTime()<=now.getTime()) result.setDate(result.getDate()+1); return result.getTime(); }
  if (lower.includes('tomorrow morning')) { result.setDate(result.getDate()+1); result.setHours(9,0,0,0); return result.getTime(); }
  if (lower.includes('tomorrow')) { result.setDate(result.getDate()+1); result.setHours(9,0,0,0); return result.getTime(); }
  return null;
}

function parseReminderLabel(text) {
  return text.replace(/remind me (to|about|at|in)/gi,'').replace(/set a reminder (to|about|for)/gi,'').replace(/remind me/gi,'').replace(/in \d+ (minutes?|hours?)/gi,'').replace(/at \d{1,2}(:\d{2})?\s*(am|pm)?/gi,'').replace(/tonight|this evening|tomorrow morning|tomorrow/gi,'').replace(/\briggy\b/gi,'').trim().replace(/^[,.\s]+|[,.\s]+$/g,'').trim() || 'something';
}

function formatTimeUntil(ms) {
  const diff = ms - Date.now(), mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} minute${mins !== 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60), rem = mins % 60;
  return rem === 0 ? `in ${hours} hour${hours !== 1 ? 's' : ''}` : `in ${hours} hour${hours !== 1 ? 's' : ''} and ${rem} minute${rem !== 1 ? 's' : ''}`;
}

function isReminderRequest(text) { const l = text.toLowerCase(); return l.includes('remind me')||l.includes('set a reminder')||l.includes('set reminder'); }
function isListRemindersRequest(text) { const l = text.toLowerCase(); return (l.includes('reminder')&&(l.includes('list')||l.includes('what')||l.includes('show')||l.includes('my')))||l.includes('my reminders'); }
function isCancelRemindersRequest(t) { const l = t.toLowerCase(); return (l.includes('cancel')||l.includes('clear')||l.includes('delete'))&&l.includes('reminder'); }
function isSaveChatRequest(text) { const l = text.toLowerCase(); return l.includes('save this chat')||l.includes('save this conversation')||l.includes('remember this chat')||l.includes('remember this conversation'); }
function isExplicitMemoryRequest(t) { const l = t.toLowerCase(); return (l.includes('remember this')||l.includes('remember that'))&&!l.includes('pic')&&!l.includes('photo'); }

// ─── CONVERSATION HISTORY ─────────────────────────────────────────────────────
const conversationHistory = new Map();

function normalizeForEcho(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }

function looksLikeEcho(transcript, lastRiggyText) {
  const t = normalizeForEcho(transcript), a = normalizeForEcho(lastRiggyText || '');
  if (t.length < 8 || a.length < 8) return false;
  if (t === a || a.includes(t) || t.includes(a)) return true;
  const tWords = new Set(t.split(' ').filter(w => w.length > 3));
  const aWords = new Set(a.split(' ').filter(w => w.length > 3));
  if (tWords.size === 0 || aWords.size === 0) return false;
  return [...tWords].filter(w => aWords.has(w)).length / Math.min(tWords.size, aWords.size) > 0.7;
}

async function getWeather(city) {
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=imperial`);
    const data = await res.json();
    if (data.cod !== 200) return null;
    return { temp: Math.round(data.main.temp), feels_like: Math.round(data.main.feels_like), description: data.weather[0].description, humidity: data.main.humidity, city: data.name };
  } catch { return null; }
}

// ─── VISOR DATA FETCHERS ──────────────────────────────────────────────────────
async function getHourlyForecast(lat = DEFAULT_LAT, lng = DEFAULT_LNG) {
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial&cnt=8`);
    const data = await res.json();
    if (!data.list) return null;
    return data.list.map(h => ({
      time: new Date(h.dt * 1000).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
      temp: Math.round(h.main.temp), feels: Math.round(h.main.feels_like),
      desc: h.weather[0].main, rain: Math.round((h.pop || 0) * 100), icon: h.weather[0].icon
    }));
  } catch { return null; }
}

async function getWeatherForecast(lat = DEFAULT_LAT, lng = DEFAULT_LNG) {
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial&cnt=24`);
    const data = await res.json();
    if (!data.list) return null;
    const days = {};
    data.list.forEach(item => {
      const date = new Date(item.dt * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!days[date]) days[date] = { temps: [], feels: [], descs: [], rain: [] };
      days[date].temps.push(Math.round(item.main.temp));
      days[date].feels.push(Math.round(item.main.feels_like));
      days[date].descs.push(item.weather[0].main);
      days[date].rain.push(Math.round((item.pop || 0) * 100));
    });
    return Object.entries(days).slice(0, 3).map(([date, d]) => ({
      date, high: Math.max(...d.temps), low: Math.min(...d.temps),
      feels: Math.round(d.feels.reduce((a, b) => a + b, 0) / d.feels.length),
      desc: d.descs[Math.floor(d.descs.length / 2)], rain: Math.max(...d.rain)
    }));
  } catch { return null; }
}

async function getNearbyGas(lat = DEFAULT_LAT, lng = DEFAULT_LNG) {
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=gas_station&key=${process.env.PLACES_API_KEY}`);
    const data = await res.json();
    if (!data.results) return null;
    return data.results.slice(0, 4).map(p => ({
      name: p.name, address: p.vicinity, rating: p.rating,
      lat: p.geometry.location.lat, lng: p.geometry.location.lng, placeId: p.place_id
    }));
  } catch { return null; }
}

function buildVisorWeather(weather, forecast) {
  let html = `<div style="font-family:'DM Sans',sans-serif;color:#E8D5B0;padding:4px">`;
  if (weather) {
    html += `<div style="font-size:48px;font-weight:300;color:#6B8FA8;line-height:1">${weather.temp}°F</div>`;
    html += `<div style="font-size:13px;color:#9E8A68;margin:4px 0 2px;text-transform:capitalize">${weather.description}</div>`;
    html += `<div style="font-size:11px;color:rgba(232,213,176,0.5)">Feels like ${weather.feels_like}°F · Humidity ${weather.humidity}%</div>`;
  }
  if (forecast && forecast.length) {
    html += `<div style="margin-top:16px;display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">`;
    forecast.forEach(day => {
      const rainColor = day.rain > 50 ? '#6B8FA8' : 'rgba(232,213,176,0.3)';
      html += `<div style="flex-shrink:0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 12px;min-width:90px;text-align:center">`;
      html += `<div style="font-size:10px;color:rgba(232,213,176,0.5);margin-bottom:6px">${day.date}</div>`;
      html += `<div style="font-size:18px;color:#6B8FA8;font-weight:500">${day.high}°</div>`;
      html += `<div style="font-size:11px;color:rgba(232,213,176,0.4)">${day.low}°</div>`;
      html += `<div style="font-size:9px;color:rgba(232,213,176,0.4);margin-top:4px">${day.desc}</div>`;
      html += `<div style="font-size:9px;color:${rainColor};margin-top:4px">💧${day.rain}%</div></div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function buildVisorHourly(hours) {
  let html = `<div style="font-family:'DM Sans',sans-serif;color:#E8D5B0">`;
  html += `<div style="font-size:11px;color:#9E8A68;margin-bottom:12px;letter-spacing:.1em;text-transform:uppercase">Next Few Hours</div>`;
  hours.forEach(h => {
    const rainColor = h.rain > 50 ? '#6B8FA8' : 'rgba(232,213,176,0.25)';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)">`;
    html += `<div style="font-size:13px;color:rgba(232,213,176,0.6);width:70px">${h.time}</div>`;
    html += `<div style="font-size:20px;color:#6B8FA8;font-weight:500;width:60px">${h.temp}°</div>`;
    html += `<div style="font-size:11px;color:rgba(232,213,176,0.5);flex:1">${h.desc}</div>`;
    html += `<div style="font-size:11px;color:${rainColor}">💧${h.rain}%</div></div>`;
  });
  html += `</div>`;
  return html;
}

function buildVisorGas(stations) {
  let html = `<div style="font-family:'DM Sans',sans-serif;color:#E8D5B0">`;
  html += `<div style="font-size:11px;color:#9E8A68;margin-bottom:12px;letter-spacing:.1em;text-transform:uppercase">Nearest Gas Stations</div>`;
  stations.forEach(s => {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
    html += `<a href="${mapsUrl}" target="_blank" style="display:block;text-decoration:none;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;margin-bottom:8px">`;
    html += `<div style="font-size:14px;color:#6B8FA8;font-weight:500;margin-bottom:4px">⛽ ${s.name}</div>`;
    html += `<div style="font-size:11px;color:rgba(232,213,176,0.5)">${s.address}</div>`;
    if (s.rating) html += `<div style="font-size:10px;color:#9E8A68;margin-top:4px">★ ${s.rating} · Tap to navigate</div>`;
    html += `</a>`;
  });
  html += `</div>`;
  return html;
}

function buildVisorReminders(remindersList) {
  let html = `<div style="font-family:'DM Sans',sans-serif;color:#E8D5B0">`;
  html += `<div style="font-size:11px;color:#9E8A68;margin-bottom:12px;letter-spacing:.1em;text-transform:uppercase">Pending Reminders</div>`;
  if (!remindersList.length) {
    html += `<div style="font-size:16px;color:rgba(232,213,176,0.4);text-align:center;padding:24px 0">No reminders set</div>`;
  } else {
    remindersList.forEach(r => {
      const timeStr = new Date(r.fireAtMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const dateStr = new Date(r.fireAtMs).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      html += `<div style="padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(107,143,168,0.2);border-radius:10px;margin-bottom:8px">`;
      html += `<div style="font-size:14px;color:#E8D5B0;margin-bottom:4px">${r.label}</div>`;
      html += `<div style="font-size:11px;color:#6B8FA8">${dateStr} at ${timeStr}</div></div>`;
    });
  }
  html += `</div>`;
  return html;
}

function buildVisorMyDay(weather, forecast, remindersList, fact) {
  const now = new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  let html = `<div style="font-family:'DM Sans',sans-serif;color:#E8D5B0">`;
  html += `<div style="font-size:12px;color:rgba(232,213,176,0.4);margin-bottom:16px;letter-spacing:.08em">${now}</div>`;
  if (weather) {
    html += `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(74,104,128,0.08);border:1px solid rgba(74,104,128,0.15);border-radius:10px;margin-bottom:12px">`;
    html += `<div style="font-size:36px;color:#6B8FA8;font-weight:300">${weather.temp}°</div>`;
    html += `<div><div style="font-size:13px;text-transform:capitalize;color:#E8D5B0">${weather.description}</div>`;
    html += `<div style="font-size:11px;color:rgba(232,213,176,0.4);margin-top:2px">Feels ${weather.feels_like}°F</div></div></div>`;
  }
  if (remindersList.length) {
    html += `<div style="font-size:10px;color:#9E8A68;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Reminders Today</div>`;
    remindersList.slice(0, 3).forEach(r => {
      const timeStr = new Date(r.fireAtMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      html += `<div style="padding:8px 10px;border-left:2px solid #6B8FA8;margin-bottom:6px;font-size:13px;color:rgba(232,213,176,0.8)">${r.label} <span style="color:#6B8FA8;font-size:11px">· ${timeStr}</span></div>`;
    });
  }
  if (fact) {
    html += `<div style="margin-top:12px;padding:12px;background:rgba(158,138,104,0.08);border:1px solid rgba(158,138,104,0.15);border-radius:10px">`;
    html += `<div style="font-size:10px;color:#9E8A68;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Today's Fact</div>`;
    html += `<div style="font-size:13px;color:rgba(232,213,176,0.8);line-height:1.6">${fact}</div></div>`;
  }
  html += `</div>`;
  return html;
}

const FACTUAL_KEYWORDS = ['how old','age of','born','died','when did','who is','who was','what year','current','latest','price of','cost of','worth','net worth','population','capital of','president','ceo','record','fastest','tallest','biggest','smallest','richest','famous','celebrity','actor','actress','singer','rapper','athlete','player','team','movie','show','song','album'];

function needsSearchGrounding(text) {
  const l = text.toLowerCase();
  return FACTUAL_KEYWORDS.some(k => l.includes(k));
}

async function askGemini(userText, sessionId, userId, photoData = null, systemOverride = null, memoryContext = null, locationContext = '') {
  if (!conversationHistory.has(sessionId)) conversationHistory.set(sessionId, []);
  const history = conversationHistory.get(sessionId);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  let weatherContext = '';
  const weatherKeywords = ['weather','temp','temperature','hot','cold','outside','wear','forecast'];
  if (weatherKeywords.some(w => userText.toLowerCase().includes(w)) && !systemOverride) {
    const cityMatch = userText.match(/in ([A-Za-z\s]+)(?:\?|$)/i);
    const weather = await getWeather(cityMatch ? cityMatch[1].trim() : DEFAULT_CITY);
    if (weather) weatherContext = `\nCurrent weather in ${weather.city}: ${weather.temp}°F, feels like ${weather.feels_like}°F, ${weather.description}, humidity ${weather.humidity}%.`;
  }
  const permanentBlock = permanentFacts.length > 0 ? `\n\nPERSONAL FACTS — always remember these:\n${permanentFacts.join('\n')}` : '';
  const memoryBlock = memoryContext ? `\n\nRELEVANT MEMORIES:\n${memoryContext}` : '';
  const systemPrompt = systemOverride ? systemOverride : RIGGY_PERSONALITY + `\n\nCurrent date and time: ${now}` + weatherContext + locationContext + permanentBlock + memoryBlock;
  const userParts = [{ text: userText }];
  if (photoData) userParts.unshift({ inline_data: { mime_type: photoData.mimeType || 'image/jpeg', data: photoData.base64 } });
  if (!systemOverride) history.push({ role: 'user', parts: userParts });
  const useSearch = !systemOverride && !photoData && needsSearchGrounding(userText);
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: systemOverride ? [{ role: 'user', parts: userParts }] : history,
    generationConfig: { temperature: systemOverride ? 0.7 : 0.9, maxOutputTokens: systemOverride ? 150 : 180, thinkingConfig: { thinkingBudget: 0 } },
    ...(useSearch && { tools: [{ googleSearch: {} }] })
  };
  if (useSearch) console.log('🔍 Search grounding enabled for:', userText.slice(0, 50));
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const reply = parts.filter(p => p.text).map(p => p.text).join(' ').trim() || '';
  if (!systemOverride) { history.push({ role: 'model', parts: [{ text: reply || 'I hit a snag friend.' }] }); if (history.length > 20) conversationHistory.set(sessionId, history.slice(-20)); }
  return reply || (systemOverride ? '' : "I hit a snag friend.");
}

// ─── ELEVENLABS TTS ───────────────────────────────────────────────────────────
async function speakWithElevenLabs(text, session) {
  try {
    const cleanText = text.replace(/[🤖⚡🛸]/g, '').trim();
    if (!cleanText) return;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, model_id: 'eleven_turbo_v2_5', output_format: 'mp3_44100_128', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
    const audioBytes = Buffer.from(await response.arrayBuffer());
    const fileName = `audio_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, audioBytes);
    const durationMs = Math.max(4000, Math.ceil((audioBytes.length / 16000) * 1000) + 4000);
    const audioUrl = `https://riggy-glasses-production.up.railway.app/${fileName}`;
    console.log(`🔊 Playing full response — ${audioBytes.length} bytes — wait up to ${Math.round(durationMs)}ms`);
    try {
      session.audio.playAudio({ audioUrl, waitForCompletion: false }).catch(e => console.error('playAudio error:', e));
      await new Promise(r => setTimeout(r, durationMs));
    } catch(e) { console.error('playAudio error:', e); }
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch(e) {} }, 60000);
  } catch (err) { console.error('speakWithElevenLabs error:', err); }
}

const VISION_KEYWORDS = ['what do you see','what can you see','look at this','what is this','what am i looking at','describe this','can you see','take a look','what does this say','read this','identify this','what is that','what are you seeing','look around','analyze this','check this out'];
const SAVE_KEYWORDS = ['save this','save a pic','save a photo','take a picture','snap this','capture this','save what you see','save the pic','save that','take a photo','take a pic','photo this','photograph this','save the moment','capture that','save it'];
const LIVE_ON_KEYWORDS = ['go live','riggy live','start live','live mode'];
const LIVE_OFF_KEYWORDS = ['stop live','end live','go to sleep','riggy stop','stop listening','stop'];
const GAME_ON_KEYWORDS = ['game mode','riggy game','start game mode','gaming mode'];
const GAME_OFF_KEYWORDS = ['stop game','end game mode','exit game','game off','stop game mode'];
const LIVE_CAM_ON_KEYWORDS = ['go live camera','live camera','live vision','start live camera','watch mode','eyes on'];

function needsCamera(text) { return VISION_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function needsSave(text) { return SAVE_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOn(text) { return LIVE_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOff(text) { return LIVE_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOn(text) { return GAME_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOff(text) { return GAME_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveCamOn(text) { return LIVE_CAM_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }

// ─── CHIME HELPERS ────────────────────────────────────────────────────────────
function getChimePhrase() { return CHIME_PHRASES[Math.floor(Math.random() * CHIME_PHRASES.length)]; }
function getWaterReminder() { return WATER_REMINDERS[Math.floor(Math.random() * WATER_REMINDERS.length)]; }
function getNatureReminder() { return NATURE_REMINDERS[Math.floor(Math.random() * NATURE_REMINDERS.length)]; }
function getFactIntro() { return FACT_INTROS[Math.floor(Math.random() * FACT_INTROS.length)]; }

function resetChimeDailyIfNeeded() {
  const today = new Date().toDateString();
  if (chimeState.resetDate !== today) {
    chimeState.count = 0; chimeState.lastWater = 0; chimeState.lastFact = 0;
    chimeState.lastSunrise = 0; chimeState.lastSunset = 0;
    chimeState.dailyFactDone = false; chimeState.fact1Done = false; chimeState.fact2Done = false;
    chimeState.lastNature = ''; chimeState.lastWeatherAlert = '';
    chimeState.resetDate = today;
  }
}

function canChime() { resetChimeDailyIfNeeded(); return chimeState.count < CHIME_MAX_PER_DAY; }

async function getDailyFact() {
  try {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const body = {
      system_instruction: { parts: [{ text: `You are Mr. Riggy. One sentence only. A fascinating fact about ${today} in history or a cool science or nature fact. Maximum 20 words. Riggy's voice. No intro, just the fact.` }] },
      contents: [{ role: 'user', parts: [{ text: 'fact' }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 60, thinkingConfig: { thinkingBudget: 0 } }
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    return text ? text.slice(0, 150) : null;
  } catch(e) { return null; }
}

async function getSunriseSunset(lat, lng) {
  try {
    const res = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`);
    const data = await res.json();
    if (data.status !== 'OK') return null;
    return { sunrise: new Date(data.results.sunrise), sunset: new Date(data.results.sunset) };
  } catch(e) { return null; }
}

// ─── APP ──────────────────────────────────────────────────────────────────────
class RiggyGlasses extends AppServer {
  async onSession(session, sessionId, userId) {
    console.log(`🤖 Riggy connected — session ${sessionId} — user ${userId}`);
    activeSession = session;
    await loadMemoryForUser(session, userId);

    let liveMode = false, gameMode = false, liveCamMode = false;
    let noteMode = false, noteBuffer = [], noteSilenceTimer = null;
    let lastRiggyText = '', sessionLog = [];
    let bargeInAllowedAfterMs = 0, ignoreSpeechDuringTTS = false;
    let isProcessing = false, processingTimer = null;
    let gameModeInterval = null, liveCamInterval = null;
    let lastProcessedText = '';
    let lastProcessedTime = 0;
    let tapWakeActive = false;

    latestState.userSaid = ''; latestState.riggySaid = 'Mr. Riggy online. Say my name to begin.';
    latestState.liveMode = false; latestState.gameMode = false; latestState.liveCamMode = false;
    latestState.noteMode = false;

    try { await session.camera.setGalleryModeEnabled(false); } catch(e) {}
    console.log('📷 Gallery mode disabled');

    const setProcessing = (val) => {
      isProcessing = val;
      if (processingTimer) { clearTimeout(processingTimer); processingTimer = null; }
      if (val) processingTimer = setTimeout(() => { isProcessing = false; processingTimer = null; console.warn('⚠️ isProcessing force reset'); }, PROCESSING_TIMEOUT_MS);
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

    const SESSION_START = Date.now();

    const playChime = async () => {
      try {
        session.audio.playAudio({ audioUrl: CHIME_URL, waitForCompletion: false }).catch(()=>{});
        await new Promise(r => setTimeout(r, 2500));
      } catch(e) { console.error('Chime sound error:', e); }
    };

    const doChime = async (message) => {
      if (!canChime()) return;
      if (ignoreSpeechDuringTTS || isProcessing) return;
      if (!message || message.trim().length < 5) return;
      const capped = message.slice(0, 200);
      chimeState.count++;
      console.log(`🔔 Chime #${chimeState.count}: ${capped.slice(0, 50)}`);
      const phrase = getChimePhrase();
      await playChime();
      await speakSafe(`${phrase} ${capped}`);
      latestState.riggySaid = capped;
    };

    const sessionMinutes = () => Math.floor((Date.now() - SESSION_START) / 60000);

    let waterFired = false, water2Fired = false;
    const waterInterval = setInterval(async () => {
      const mins = sessionMinutes();
      if (!waterFired && mins >= 45) { waterFired = true; await doChime(getWaterReminder()); return; }
      if (!water2Fired && mins >= 105) { water2Fired = true; await doChime(getWaterReminder()); }
    }, 5 * 60 * 1000);

    let natureFired = false;
    const natureInterval = setInterval(async () => {
      if (!natureFired && sessionMinutes() >= 60) { natureFired = true; await doChime(getNatureReminder()); }
    }, 10 * 60 * 1000);

    let factFired = false;
    const factInterval = setInterval(async () => {
      if (!factFired && sessionMinutes() >= 30) {
        factFired = true;
        const fact = await getDailyFact();
        if (fact) await doChime(`${getFactIntro()} ${fact}`);
      }
    }, 10 * 60 * 1000);

    let checkInFired = false;
    const checkInInterval = setInterval(async () => {
      if (!checkInFired && sessionMinutes() >= 20) {
        checkInFired = true;
        if (ignoreSpeechDuringTTS || isProcessing) return;
        const isScout = latestState.riggyMode === 'scout';
        const phrases = isScout ? SCOUT_CHECKINS : CHECKIN_PHRASES;
        const msg = phrases[Math.floor(Math.random() * phrases.length)];
        await playChime();
        await speakSafe(msg);
        latestState.riggySaid = msg;
        if (isScout) setTimeout(() => { checkInFired = false; }, 30 * 60 * 1000);
      }
    }, 5 * 60 * 1000);

    const weatherChimeInterval = setInterval(async () => {
      if (!canChime()) return;
      try {
        const weather = await getWeather(DEFAULT_CITY);
        if (!weather) return;
        const desc = weather.description.toLowerCase();
        const alertKey = `${weather.temp}-${desc}`;
        if (alertKey === chimeState.lastWeatherAlert) return;
        let msg = null;
        if (desc.includes('rain') || desc.includes('storm') || desc.includes('thunder')) {
          msg = `Heads up Commander, looks like rain is moving in. ${weather.description} out there right now, ${weather.temp} degrees.`;
        } else if (weather.temp <= 45) {
          msg = `It's getting cold out there Commander, ${weather.temp} degrees. Might want a jacket if you're heading out.`;
        } else if (weather.temp >= 95) {
          msg = `It's ${weather.temp} degrees out there Commander. Stay hydrated and try to stay cool if you can.`;
        }
        if (msg) { chimeState.lastWeatherAlert = alertKey; await doChime(msg); }
      } catch(e) {}
    }, CHIME_WEATHER_CHECK_MS);

    const sunInterval = setInterval(async () => {
      const now = Date.now();
      try {
        const sun = await getSunriseSunset(DEFAULT_LAT, DEFAULT_LNG);
        if (!sun) return;
        const sunriseMs = sun.sunrise.getTime(), sunsetMs = sun.sunset.getTime();
        const window = 10 * 60 * 1000;
        if (Math.abs(now - sunriseMs) < window && now - chimeState.lastSunrise > 60 * 60 * 1000) {
          chimeState.lastSunrise = now;
          await doChime("Sunrise, Commander. A brand new day just started. Make it count.");
        }
        if (Math.abs(now - sunsetMs) < window && now - chimeState.lastSunset > 60 * 60 * 1000) {
          chimeState.lastSunset = now;
          await doChime("Sun's going down Commander. Take a second to appreciate it if you can. Those colors don't last long.");
        }
      } catch(e) {}
    }, 5 * 60 * 1000);

    const reminderChimeInterval = setInterval(async () => {
      const now = Date.now();
      for (const [id, reminder] of reminders) {
        const timeLeft = reminder.fireAtMs - now;
        const warned = reminder.warned || [];
        if (timeLeft <= 60 * 60 * 1000 && timeLeft > 59 * 60 * 1000 && !warned.includes('1h')) {
          warned.push('1h'); reminder.warned = warned;
          await doChime(`Just so you know Commander, you have a reminder coming up in about an hour. ${reminder.label}.`);
        }
        if (timeLeft <= 20 * 60 * 1000 && timeLeft > 19 * 60 * 1000 && !warned.includes('20m')) {
          warned.push('20m'); reminder.warned = warned;
          await doChime(`Twenty minutes Commander. Don't forget — ${reminder.label}.`);
        }
        if (timeLeft <= 5 * 60 * 1000 && timeLeft > 4 * 60 * 1000 && !warned.includes('5m')) {
          warned.push('5m'); reminder.warned = warned;
          await doChime(`Five minutes Commander. ${reminder.label}. Almost time.`);
        }
      }
    }, CHIME_REMINDER_CHECK_MS);

    const stopChimes = () => {
      clearInterval(waterInterval); clearInterval(natureInterval); clearInterval(factInterval);
      clearInterval(weatherChimeInterval); clearInterval(sunInterval);
      clearInterval(reminderChimeInterval); clearInterval(checkInInterval);
      clearInterval(scoutModeWatcher); stopScoutMode();
    };

    const finishNote = async () => {
      noteMode = false; latestState.noteMode = false;
      if (noteSilenceTimer) { clearTimeout(noteSilenceTimer); noteSilenceTimer = null; }
      if (noteBuffer.length === 0) { await speakSafe("Nothing to save friend."); return; }
      const noteContent = noteBuffer.join(' ').trim(); noteBuffer = [];
      await saveMemory(noteContent, 'note', session, userId);
      await speakSafe("Got it. Note saved."); latestState.riggySaid = "Got it. Note saved.";
    };

    const setReminder = (label, fireAtMs) => {
      const id = reminderIdCounter++;
      reminders.set(id, { id, label, fireAtMs, timerId: setTimeout(async () => { reminders.delete(id); const msg = `Hey friend — reminder: ${label}.`; latestState.riggySaid = msg; await speakSafe(msg); }, fireAtMs - Date.now()) });
    };

    let activeStream = null, ffmpegProcess = null, streamFramePath = null;

    const startFFmpeg = (hlsUrl) => {
      const framePath = path.join(__dirname, `frame_${sessionId}.jpg`);
      streamFramePath = framePath;
      if (ffmpegProcess) { try { ffmpegProcess.kill('SIGKILL'); } catch(e) {} ffmpegProcess = null; }
      const ffmpeg = spawn('ffmpeg', ['-re','-i',hlsUrl,'-vf',`fps=1/${Math.round(STREAM_FRAME_INTERVAL_MS/1000)}`,'-update','1','-q:v','3','-y',framePath]);
      ffmpeg.stderr.on('data', (d) => console.log(`FFmpeg: ${d.toString().slice(0,80)}`));
      ffmpeg.on('close', (code) => { console.log(`FFmpeg exited: ${code}`); ffmpegProcess = null; });
      ffmpeg.on('error', (e) => console.error('FFmpeg spawn error:', e.message));
      ffmpegProcess = ffmpeg;
      console.log(`🎥 FFmpeg started — writing frames to ${framePath}`);
      return framePath;
    };

    const readLatestFrame = () => {
      if (!streamFramePath || !fs.existsSync(streamFramePath)) return null;
      try { const buf = fs.readFileSync(streamFramePath); if (buf.length < 1000) return null; return { base64: buf.toString('base64'), mimeType: 'image/jpeg' }; } catch(e) { return null; }
    };

    const stopBurstModes = async () => {
      if (gameModeInterval) { clearInterval(gameModeInterval); gameModeInterval = null; }
      if (liveCamInterval) { clearInterval(liveCamInterval); liveCamInterval = null; }
      if (ffmpegProcess) { try { ffmpegProcess.kill('SIGKILL'); } catch(e) {} ffmpegProcess = null; }
      if (activeStream) {
        try { await session.camera.stopManagedStream(); console.log('📷 Managed stream stopped'); } catch(e) { console.error('stopManagedStream error:', e); }
        activeStream = null;
      }
      if (streamFramePath) { try { fs.unlinkSync(streamFramePath); } catch(e) {} streamFramePath = null; }
      gameMode = false; liveCamMode = false; latestState.gameMode = false; latestState.liveCamMode = false;
    };

    const takePhoto = async (saveToGallery = false) => {
      try { const photo = await session.camera.requestPhoto({ saveToGallery }); if (photo && photo.buffer) return { base64: photo.buffer.toString('base64'), mimeType: photo.mimeType || 'image/jpeg' }; } catch(e) { console.error('Camera error:', e); }
      return null;
    };

    const startGameMode = async () => {
      await stopBurstModes();
      gameMode = true; latestState.gameMode = true;
      setProcessing(true);
      try { await speakSafe("Game mode on. I'm watching."); } finally { setProcessing(false); }
      console.log('🎮 Game mode — timer photo approach');
      gameModeInterval = setInterval(async () => {
        if (!gameMode || ignoreSpeechDuringTTS || isProcessing) return;
        setProcessing(true);
        try {
          const photo = await takePhoto(false); if (!photo) return;
          const reply = await askGemini('Game screen. One sharp tactical tip only if something genuinely worth saying. If nothing worth saying respond: SILENCE', sessionId, userId, photo, GAME_MODE_PERSONALITY);
          if (reply && reply.trim() !== 'SILENCE' && !reply.toLowerCase().includes('silence') && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
        } catch(e) { console.error('Game photo error:', e); }
        finally { setProcessing(false); }
      }, GAME_MODE_ANALYSIS_INTERVAL_MS);
    };

    const startLiveCamMode = async () => {
      await stopBurstModes();
      liveCamMode = true; latestState.liveCamMode = true;
      setProcessing(true);
      try { await speakSafe("Live vision on. I'm watching with you."); } finally { setProcessing(false); }
      console.log('👁 Live cam — timer photo approach');
      liveCamInterval = setInterval(async () => {
        if (!liveCamMode || ignoreSpeechDuringTTS || isProcessing) return;
        setProcessing(true);
        try {
          const photo = await takePhoto(false); if (!photo) return;
          const reply = await askGemini("Look at what I'm seeing. Say something useful or interesting only if something genuinely earns it. If nothing worth saying respond: SKIP", sessionId, userId, photo);
          if (reply && reply.trim() !== 'SKIP' && !reply.toLowerCase().startsWith('skip') && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
        } catch(e) { console.error('Live cam error:', e); }
        finally { setProcessing(false); }
      }, LIVE_CAM_ANALYSIS_INTERVAL_MS);
    };

    const handleInput = async (userSaid) => {
      if (!userSaid) return;

      // ── NOTE MODE ──
      if (noteMode) {
        if (isNoteDoneRequest(userSaid)) { await finishNote(); return; }
        noteBuffer.push(userSaid);
        if (noteSilenceTimer) clearTimeout(noteSilenceTimer);
        noteSilenceTimer = setTimeout(async () => { await finishNote(); }, NOTE_SILENCE_TIMEOUT_MS);
        return;
      }

      if (isProcessing) return;
      console.log(`User said: ${userSaid}`);
      latestState.userSaid = userSaid;
      setProcessing(true);
      sessionLog.push({ role: 'user', text: userSaid, time: Date.now() });

      // ── FIX 1: declare lower once at the top of handleInput — was missing, caused ReferenceError ──
      const lower = userSaid.toLowerCase();

      try {
        if (wantsLiveOff(userSaid)) {
          await stopBurstModes(); liveMode = false; latestState.liveMode = false;
          await speakSafe("Going quiet. Say my name when you need me."); latestState.riggySaid = "Going quiet. Say my name when you need me."; return;
        }

        if (lower.includes('riggy test chime') || lower.includes('test chime')) {
          setProcessing(false);
          const fact = await getDailyFact();
          await doChime(fact || getWaterReminder());
          return;
        }

        if (isMorningGreeting(userSaid)) {
          const weather = await getWeather(DEFAULT_CITY);
          const briefing = await generateBriefing('morning', { now: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }), weather: weather ? `${weather.temp}°F and ${weather.description}` : 'not available', reminders: [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`).join(', ') || 'No reminders', notes: getMemoryStore(userId).filter(m => m.type==='note'&&Date.now()-m.createdAt<86400000*2).slice(-3).map(n=>n.content).join('. ') || '', personal: permanentFacts.slice(0,5).join('. ') });
          await speakSafe(briefing); latestState.riggySaid = briefing; return;
        }

        if (isAfternoonGreeting(userSaid)) {
          const briefing = await generateBriefing('afternoon', { now: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }), reminders: [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`).join(', ') || 'No reminders', notes: getMemoryStore(userId).filter(m => m.type==='note'&&Date.now()-m.createdAt<43200000).slice(-3).map(n=>n.content).join('. ') || '', personal: permanentFacts.slice(0,5).join('. ') });
          await speakSafe(briefing); latestState.riggySaid = briefing; return;
        }

        if (isNightGreeting(userSaid)) {
          const briefing = await generateBriefing('night', { now: '', reminders: [...reminders.values()].map(r => `${r.label} ${formatTimeUntil(r.fireAtMs)}`).join(', ') || 'Nothing set for tomorrow', notes: getMemoryStore(userId).filter(m => m.type==='note'&&Date.now()-m.createdAt<86400000).slice(-5).map(n=>n.content).join('. ') || 'No notes today', personal: permanentFacts.slice(0,3).join('. ') });
          await speakSafe(briefing); latestState.riggySaid = briefing; return;
        }

        if (isNoteRequest(userSaid)) {
          noteMode = true; latestState.noteMode = true; noteBuffer = [];
          await speakSafe("Go ahead, I'm listening. Say Riggy done when you're finished."); latestState.riggySaid = "Go ahead, I'm listening.";
          setProcessing(false); noteSilenceTimer = setTimeout(async () => { if (noteMode) await finishNote(); }, NOTE_SILENCE_TIMEOUT_MS * 4); return;
        }

        if (isNoteListRequest(userSaid)) {
          const notes = getNotes(userId);
          if (notes.length === 0) { await speakSafe("No notes saved yet friend."); return; }
          const msg = `You've got ${notes.length} note${notes.length!==1?'s':''}. Here are the latest: ${notes.slice(0,3).map((n,i)=>`Note ${i+1}: ${n.content}`).join('. ')}.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }

        if (isBatteryRequest(userSaid)) {
          try {
            const state = await session.device.getDeviceState();
            const level = state?.batteryLevel;
            const msg = level != null ? `Glasses battery is at ${Math.round(level)}%.` : "Can't read the battery level right now friend.";
            await speakSafe(msg); latestState.riggySaid = msg;
          } catch(e) { await speakSafe("Can't read the battery level right now friend."); }
          return;
        }

        if (isShopRequest(userSaid)) {
          const photo = await takePhoto(); if (!photo) { await speakSafe("Can't get a clear shot friend. Try again."); return; }
          await speakSafe("Scanning it now.");
          const reply = await askGemini('Do a shop analysis on this product.', sessionId, userId, photo, SHOP_PERSONALITY);
          if (reply && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
          setProcessing(false); return;
        }

        if (isIntelRequest(userSaid)) {
          const photo = await takePhoto(); if (!photo) { await speakSafe("Couldn't get a clear shot friend. Try again."); setProcessing(false); return; }
          const reply = await askGemini('Run an intel sweep on what you see in this image.', sessionId, userId, photo, INTEL_PERSONALITY);
          if (reply && reply.trim().length > 5) { latestState.riggySaid = reply; await speakSafe(reply); }
          setProcessing(false); return;
        }

        if (isCallRequest(userSaid)) {
          const intent = parseCallIntent(userSaid); if (!intent) { await speakSafe("I don't have that contact friend."); return; }
          const ok = await twilioCall(intent.number, intent.customMessage);
          const msg = ok ? `Calling ${intent.name} now.` : `Couldn't reach ${intent.name} right now.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }

        if (isTextRequest(userSaid)) {
          const intent = parseTextIntent(userSaid); if (!intent) { await speakSafe("I don't have that contact or didn't catch the message."); return; }
          const ok = await twilioText(intent.number, intent.message);
          const msg = ok ? `Text sent to ${intent.name}.` : `Couldn't send that text right now.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }

        if (isLocationRequest(userSaid)) {
          const loc = await getIpLocation();
          if (loc && loc.city) {
            const msg = `You're in ${loc.city}, ${loc.region} Commander.`;
            await speakSafe(msg); latestState.riggySaid = msg;
          } else if (loc) {
            const address = await reverseGeocode(loc.lat, loc.lng);
            const msg = address ? `You're near ${address}.` : `You're near ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}.`;
            await speakSafe(msg); latestState.riggySaid = msg;
          } else {
            await speakSafe("Can't pin your location right now Commander.");
          }
          return;
        }

        if (isNearbyRequest(userSaid)) {
          const query = parseNearbyQuery(userSaid);
          if (query) { const loc = await getIpLocation(); const lat = loc?.lat||DEFAULT_LAT, lng = loc?.lng||DEFAULT_LNG; const results = await searchNearby(query, lat, lng); const msg = results ? `Nearest ${query}: ${results}.` : `Couldn't find ${query} nearby right now.`; await speakSafe(msg); latestState.riggySaid = msg; return; }
        }

        if (isDistanceRequest(userSaid)) {
          const destination = parseDistanceQuery(userSaid);
          if (destination) { const loc = await getIpLocation(); const lat = loc?.lat||DEFAULT_LAT, lng = loc?.lng||DEFAULT_LNG; const results = await searchNearby(destination, lat, lng, 50000); const msg = results ? `${results}.` : `Couldn't find distance to ${destination} right now.`; await speakSafe(msg); latestState.riggySaid = msg; return; }
        }

        if (isSaveChatRequest(userSaid)) {
          if (sessionLog.length < 2) { await speakSafe("Not much to save yet friend."); return; }
          await saveMemory(sessionLog.map(l=>`${l.role==='user'?'Friend':'Riggy'}: ${l.text}`).join('\n'), 'chat', session, userId);
          await speakSafe("Got it. This conversation is saved."); latestState.riggySaid = "Got it. This conversation is saved."; return;
        }

        if (isExplicitMemoryRequest(userSaid)) { await saveMemory(userSaid, 'explicit', session, userId); await speakSafe("Locked in. I'll remember that."); latestState.riggySaid = "Locked in. I'll remember that."; return; }

        if (isListRemindersRequest(userSaid)) {
          if (reminders.size === 0) { await speakSafe("No reminders set, friend."); return; }
          const msg = `You've got ${reminders.size} reminder${reminders.size!==1?'s':''}: ${[...reminders.values()].map(r=>`${r.label} ${formatTimeUntil(r.fireAtMs)}`).join(', ')}.`;
          await speakSafe(msg); latestState.riggySaid = msg; return;
        }
        if (isCancelRemindersRequest(userSaid)) { reminders.forEach(r => clearTimeout(r.timerId)); reminders.clear(); await speakSafe("All reminders cleared."); latestState.riggySaid = "All reminders cleared."; return; }
        if (isReminderRequest(userSaid)) {
          const fireAtMs = parseReminderTime(userSaid); if (!fireAtMs) { await speakSafe("Didn't catch the time. Try: remind me in 2 hours or at 3pm."); return; }
          const label = parseReminderLabel(userSaid); setReminder(label, fireAtMs);
          const confirmation = `Got it. I'll remind you to ${label} ${formatTimeUntil(fireAtMs)}.`;
          await speakSafe(confirmation); latestState.riggySaid = confirmation; return;
        }

        // ── SHOW ME / VISOR — lower is already defined above ──
        const showMe = lower.includes('show me') || lower.includes('visor');
        if (showMe) {
          setProcessing(false);
          const loc = await getIpLocation();
          const lat = loc?.lat || DEFAULT_LAT;
          const lng = loc?.lng || DEFAULT_LNG;

          if (lower.includes('weather')) {
            const [weather, forecast] = await Promise.all([getWeather(DEFAULT_CITY), getWeatherForecast(lat, lng)]);
            latestState.visor = { type:'html', label:'Weather', html: buildVisorWeather(weather, forecast) };
            await speakSafe("Check your visor Commander."); latestState.riggySaid = "Check your visor Commander."; return;
          }
          if (lower.includes('hourly')) {
            const hours = await getHourlyForecast(lat, lng);
            if (hours) latestState.visor = { type:'html', label:'Hourly Forecast', html: buildVisorHourly(hours) };
            else latestState.visor = { type:'html', label:'Hourly', html: '<p style="color:#E8D5B0">Could not load hourly forecast.</p>' };
            await speakSafe("Check your visor Commander."); latestState.riggySaid = "Check your visor Commander."; return;
          }
          if (lower.includes('radar')) {
            const radarUrl = `https://www.rainviewer.com/map.html?loc=${lat},${lng},8&oFa=0&oC=0&oU=0&oCS=1&oF=0&oAP=1&rmt=2&c=3&o=83&lm=0&th=0&sm=1&sn=1`;
            latestState.visor = { type:'url', label:'Live Radar', url: radarUrl, summary: 'Animated rain radar — tap to open.' };
            await speakSafe("Radar's on your visor Commander."); latestState.riggySaid = "Radar's on your visor."; return;
          }
          if (lower.includes('map') && !lower.includes('traffic')) {
            const mapUrl = `https://www.google.com/maps/@${lat},${lng},16z`;
            latestState.visor = { type:'url', label:'Your Location', url: mapUrl, summary: `You are near ${DEFAULT_CITY}. Tap to open Maps.` };
            await speakSafe("Map's on your visor Commander."); latestState.riggySaid = "Map's on your visor."; return;
          }
          if (lower.includes('traffic')) {
            const trafficUrl = `https://www.google.com/maps/@${lat},${lng},14z/data=!5m1!1e1`;
            latestState.visor = { type:'url', label:'Live Traffic', url: trafficUrl, summary: 'Live traffic map — tap to open.' };
            await speakSafe("Traffic's on your visor Commander."); latestState.riggySaid = "Traffic's on your visor."; return;
          }
          if (lower.includes('gas')) {
            const stations = await getNearbyGas(lat, lng);
            if (stations) latestState.visor = { type:'html', label:'Nearest Gas', html: buildVisorGas(stations) };
            else latestState.visor = { type:'url', label:'Gas Stations', url: `https://www.google.com/maps/search/gas+station/@${lat},${lng},14z`, summary: 'Tap to find nearby gas stations.' };
            await speakSafe("Gas stations on your visor Commander."); latestState.riggySaid = "Gas stations on your visor."; return;
          }
          if (lower.includes('reminder')) {
            const remindersList = [...reminders.values()];
            latestState.visor = { type:'html', label:'Reminders', html: buildVisorReminders(remindersList) };
            await speakSafe("Your reminders are on the visor Commander."); latestState.riggySaid = "Reminders on the visor."; return;
          }
          if (lower.includes('my day')) {
            const [weather, forecast, fact] = await Promise.all([getWeather(DEFAULT_CITY), getWeatherForecast(lat, lng), getDailyFact()]);
            const remindersList = [...reminders.values()];
            latestState.visor = { type:'html', label:'Your Day', html: buildVisorMyDay(weather, forecast, remindersList, fact) };
            await speakSafe("Your day is on the visor Commander."); latestState.riggySaid = "Your day is on the visor."; return;
          }
          if (lower.includes('street view') || lower.includes('street')) {
            const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
            latestState.visor = { type:'url', label:'Street View', url: svUrl, summary: 'Street level view of your current location.' };
            await speakSafe("Street view on your visor Commander."); return;
          }
          if (lower.includes('intel')) {
            const photo = await takePhoto(false);
            if (!photo) { await speakSafe("Couldn't get a shot. Try again."); return; }
            const analysis = await askGemini('Analyze what you see. Be detailed — this will be read not heard.', sessionId, userId, photo, INTEL_PERSONALITY);
            latestState.visor = { type:'text', label:'Intel Report', content: analysis };
            await speakSafe("Intel's on your visor Commander."); latestState.riggySaid = "Intel on your visor."; return;
          }
          const visorReply = await askGemini(
            `Based on our last conversation, what should I show on the visor? Return ONLY valid JSON: { "type": "url", "label": "short label", "url": "full URL", "summary": "one sentence" }. Return ONLY the JSON, nothing else.`,
            sessionId, userId, null, null, null, ''
          );
          try {
            const clean = visorReply.replace(/```json|```/g, '').trim();
            latestState.visor = JSON.parse(clean);
          } catch(e) {
            const q = encodeURIComponent(lastRiggyText.slice(0, 60));
            latestState.visor = { type:'url', label:'Search', url:`https://www.google.com/search?q=${q}`, summary:'Search results for what we discussed.' };
          }
          await speakSafe("Check your visor Commander."); latestState.riggySaid = "Check your visor Commander."; return;
        }

        // ── DEBUG / CODE VISOR ──
        const isDebug = lower.includes('debug this') || lower.includes('analyze this') ||
          lower.includes('riggy code') || lower.includes('check this code') ||
          lower.includes('what does this say') || lower.includes('read the screen') ||
          lower.includes('read this error') || lower.includes('what is this error');
        if (isDebug) {
          const photo = await takePhoto(false);
          if (!photo) { await speakSafe("Couldn't get a clear shot. Try again."); return; }
          const analysis = await askGemini(
            'Analyze what you see. If code or error — explain the problem and give the fix clearly. If text — read and summarize. Be detailed, Ray will READ this on his visor screen.',
            sessionId, userId, photo, `You are Mr. Riggy analyzing a screen. Be thorough. Format clearly — problem first then solution.`
          );
          if (analysis && analysis.trim().length > 5) {
            latestState.visor = { type:'debug', label:'Screen Analysis', content:analysis, url:null };
            await speakSafe("Check your visor Commander."); latestState.riggySaid = "Check your visor Commander.";
          } else { await speakSafe("Couldn't read that clearly. Get closer to the screen and try again."); }
          return;
        }

        if (lower.includes('call the cops') || lower.includes('call 911') || lower.includes('call the police') || lower.includes('riggy call police') || lower.includes('emergency call')) {
          setProcessing(false);
          const emergencyMsg = "Calling 911 now Commander. Stay on the line.";
          latestState.riggySaid = emergencyMsg; await speakSafe(emergencyMsg);
          latestState.emergencyCall = true;
          setTimeout(() => { latestState.emergencyCall = false; }, 10000); return;
        }
        if (wantsGameOff(userSaid)) { await stopBurstModes(); await speakSafe("Game mode off."); latestState.riggySaid = "Game mode off."; return; }
        if (wantsLiveCamOn(userSaid)) { setProcessing(false); await startLiveCamMode(); return; }
        if (wantsGameOn(userSaid)) { setProcessing(false); await startGameMode(); return; }
        if (wantsLiveOn(userSaid) && !liveMode) { liveMode = true; latestState.liveMode = true; await speakSafe("Live mode on. Just talk."); latestState.riggySaid = "Live mode on. Just talk."; return; }

        let photoData = null;
        const savePhoto = needsSave(userSaid), visionQuery = needsCamera(userSaid);
        if (visionQuery || savePhoto) {
          const photo = await takePhoto(savePhoto);
          if (photo && visionQuery) photoData = photo;
          if (savePhoto && photo) {
            const saveReply = await askGemini('Take a look at what was just captured. Tell me what you see in one sentence, then confirm it was saved.', sessionId, userId, photo, null, null, '');
            const msg = saveReply && saveReply.length > 5 ? saveReply : "Captured and saved to your gallery, Commander.";
            await speakSafe(msg); latestState.riggySaid = msg;
            if (!visionQuery) return;
          }
        }

        let locationContext = '';
        if (isNearbyRequest(userSaid) || lower.includes('near') || lower.includes('around here')) {
          const loc = await getGlassesLocation(session);
          if (loc) { const address = await reverseGeocode(loc.lat, loc.lng); locationContext = `\n\nUser's current location: ${address || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`}`; }
        }

        const memoryContext = await recallMemory(userSaid, userId);
        const reply = await askGemini(userSaid, sessionId, userId, photoData, null, memoryContext, locationContext);
        console.log(`Riggy: ${reply}`);
        sessionLog.push({ role: 'riggy', text: reply, time: Date.now() });
        if (shouldAutoSave(userSaid)) saveMemory(userSaid, 'auto', session, userId).catch(()=>{});
        await speakSafe(reply); latestState.riggySaid = reply;

      } catch (err) {
        console.error('Error:', err);
        // ── FIX 2: use speakSafe (ElevenLabs voice) not session.audio.speak (Mentra voice) ──
        await speakSafe("Something glitched friend. Try me again.");
      } finally { setProcessing(false); }
    };

    session._toggleLive = async () => {
      if (gameMode || liveCamMode) { await stopBurstModes(); await speakSafe("Burst mode off."); latestState.riggySaid = "Burst mode off."; return false; }
      liveMode = !liveMode; latestState.liveMode = liveMode;
      if (liveMode) { await speakSafe("Live mode on. Just talk."); latestState.riggySaid = "Live mode on. Just talk."; }
      else { await speakSafe("Going quiet. Say my name when you need me."); latestState.riggySaid = "Going quiet. Say my name when you need me."; }
      return liveMode;
    };

    session._handleTextCommand = async (text) => {
      if (!text) return;
      console.log(`⌨️ Text command: ${text}`);
      await handleInput(text);
    };

    session.events.onButtonPress(async (data) => {
      console.log(`🔘 Button press: type=${JSON.stringify(data.pressType)}`);
      try { await session.camera.setGalleryModeEnabled(false); } catch(e) {}
      if (data.pressType === 'short' || data.pressType === 'single') {
        setProcessing(false); ignoreSpeechDuringTTS = false; tapWakeActive = true;
        const tapPhrases = ["Go ahead Commander.","Listening.","I'm here. Go ahead.","Ready Commander.","Talk to me.","Go ahead friend."];
        const phrase = tapPhrases[Math.floor(Math.random() * tapPhrases.length)];
        await speakSafe(phrase);
        setTimeout(() => { tapWakeActive = false; }, 15000);
      } else if (data.pressType === 'long' || data.pressType === 'long_press') {
        liveMode = !liveMode; latestState.liveMode = liveMode;
        if (liveMode) { await speakSafe("Live mode on. Just talk."); latestState.riggySaid = "Live mode on. Just talk."; }
        else { await speakSafe("Going quiet. Say my name when you need me."); latestState.riggySaid = "Going quiet. Say my name when you need me."; }
      }
    });

    // ── SCOUT MODE ────────────────────────────────────────────────────────────
    let scoutPhotoJob = null;
    let lastScoutObservation = '';

    const SCOUT_PERSONALITY_ADDON = `
SCOUT MODE — you are physically present with Ray right now. You are IN THE ROOM.
RULES:
- Never describe what you see like a tour guide or narrator.
- React like a person who just noticed something. One dry, warm, real observation.
- If nothing changed since last time — say PASS. Silence is better than repeating yourself.
- Never say "I see" or "I notice" or "I can see" or "it appears."
- One sentence. Dry. Real. Then done.`;

    const startScoutMode = () => {
      console.log('🔭 Scout Mode activated');
      scoutPhotoJob = setInterval(async () => {
        if (ignoreSpeechDuringTTS || isProcessing) return;
        if (chimeState.count >= CHIME_MAX_PER_DAY) return;
        try {
          const photo = await takePhoto(false); if (!photo) return;
          const contextNote = lastScoutObservation
            ? `Last thing you said about this scene: "${lastScoutObservation}". If nothing changed, respond PASS.`
            : 'First look at this scene.';
          const reply = await askGemini(
            `${contextNote} React naturally if something earns it. One sentence max. If nothing worth saying: PASS`,
            sessionId, userId, photo, RIGGY_PERSONALITY + SCOUT_PERSONALITY_ADDON
          );
          if (!reply || reply.trim().toUpperCase() === 'PASS' || reply.toLowerCase().includes('nothing has changed') || reply.trim().length < 5) { console.log('🔭 Scout — quiet'); return; }
          lastScoutObservation = reply.trim();
          chimeState.count++;
          await playChime(); await speakSafe(reply); latestState.riggySaid = reply;
        } catch(e) { console.error('Scout ambient error:', e); }
      }, 3 * 60 * 1000);
    };

    const stopScoutMode = () => {
      if (scoutPhotoJob) { clearInterval(scoutPhotoJob); scoutPhotoJob = null; }
      lastScoutObservation = '';
      console.log('🔭 Scout Mode deactivated');
    };

    if (latestState.riggyMode === 'scout') startScoutMode();

    const scoutModeWatcher = setInterval(() => {
      if (latestState.riggyMode === 'scout' && !scoutPhotoJob) startScoutMode();
      if (latestState.riggyMode !== 'scout' && scoutPhotoJob) stopScoutMode();
    }, 10000);

    const SCOUT_CHECKINS = [
      "Hey. What are we looking at?","You good out there Commander?","What's the move?",
      "I'm here. What's going on?","Anything interesting happening?","Talk to me Commander.","I'm watching. What do you need?"
    ];

    session.events.onHeadPosition((data) => {
      console.log(`🤙 Head position: ${data.position}`);
      if (data.position === 'down') {
        if (ignoreSpeechDuringTTS) { console.log('👇 Head down — stopping playback'); ignoreSpeechDuringTTS = false; setProcessing(false); }
      }
    });

    session.events.onPhoneNotifications(async (notifications) => {
      if (!notifications || notifications.length === 0) return;
      if (ignoreSpeechDuringTTS) {
        setTimeout(async () => { for (const notif of notifications) { await readNotification(notif); } }, 3000);
        return;
      }
      for (const notif of notifications) { await readNotification(notif); }
    });

    async function readNotification(notif) {
      const app = (notif.app || notif.packageName || 'Someone').toLowerCase();
      const title = notif.title || '';
      const content = notif.content || notif.text || notif.body || '';
      console.log(`📱 Notification — app:${app} title:${title}`);
      const junk = ['android','system','google play','battery','charging','download','update','spotify','music','now playing'];
      if (junk.some(j => app.includes(j))) { console.log(`📱 Skipping junk: ${app}`); return; }
      let msg = '';
      if (app.includes('phone') || app.includes('call') || app.includes('dialer')) { msg = `Incoming call from ${title || 'someone'}.`; }
      else if (title && content) { msg = `${title}: ${content}`; }
      else if (title) { msg = `Message from ${title}.`; }
      else if (content) { msg = content; }
      if (msg && msg.trim().length > 2) { console.log(`📱 Reading: ${msg}`); latestState.riggySaid = msg; await speakSafe(msg); }
    }

    session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;
      if (ignoreSpeechDuringTTS) { console.log('🔇 TTS active'); return; }
      if (!noteMode && isProcessing) { console.log('🔇 Busy'); return; }
      if (Date.now() < bargeInAllowedAfterMs) { console.log('🔇 Cooldown'); return; }
      const userSaid = data.text.trim();
      if (!userSaid) return;
      const now = Date.now();
      if (userSaid === lastProcessedText && now - lastProcessedTime < 180000) { console.log('🔇 Duplicate transcript — ignoring:', userSaid); return; }
      if (lastProcessedText && now - lastProcessedTime < 180000 && looksLikeEcho(userSaid, lastProcessedText)) { console.log('🔇 Fuzzy duplicate — ignoring:', userSaid); return; }
      lastProcessedText = userSaid; lastProcessedTime = now;
      if (looksLikeEcho(userSaid, lastRiggyText)) { console.log('🔇 Echo:', userSaid); return; }
      if (noteMode) { await handleInput(userSaid); return; }
      if (liveMode || liveCamMode) { await handleInput(userSaid); return; }
      if (tapWakeActive) { tapWakeActive = false; await handleInput(userSaid); return; }
      const lower = userSaid.toLowerCase();
      if (lower.includes('mr.riggy') || lower.includes('mr riggy') || lower.includes('riggy')) await handleInput(userSaid);
    });
  }

  async onStop(sessionId, userId, reason) {
    console.log(`👋 Session ended — ${sessionId} — reason: ${reason}`);
    activeSession = null;
    const framePath = path.join(__dirname, `frame_${sessionId}.jpg`);
    try { if (fs.existsSync(framePath)) fs.unlinkSync(framePath); } catch(e) {}
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
  res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

expressApp.get('/riggy_notification.mp3', (req, res) => {
  const filePath = path.join(__dirname, 'riggy_notification.mp3');
  if (!fs.existsSync(filePath)) { res.status(404).end(); return; }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

expressApp.get('/webview', (req, res) => { res.sendFile(path.join(__dirname, 'webview.html')); });
expressApp.get('/webview-state', (req, res) => { res.json(latestState); });
expressApp.get('/memory', (req, res) => {
  const all = [];
  for (const [uid, store] of globalMemoryCache) store.forEach(m => all.push({ userId: uid, id: m.id, content: m.content, type: m.type, createdAt: m.createdAt }));
  res.json(all);
});

expressApp.post('/test-chime', async (req, res) => {
  if (activeSession && activeSession._handleTextCommand) {
    await activeSession._handleTextCommand('test chime');
  }
  res.json({ ok: true });
});

// ── FIX 3: guard /text-command — only process if glasses session is active ──
expressApp.post('/text-command', async (req, res) => {
  const { text } = req.body;
  if (!text) { res.json({ ok: false }); return; }
  if (!activeSession) { res.json({ ok: false, reason: 'no active session' }); return; }
  latestState.userSaid = text;
  if (activeSession._handleTextCommand) {
    await activeSession._handleTextCommand(text);
  }
  res.json({ ok: true });
});

expressApp.post('/clear-visor', (req, res) => {
  latestState.visor = null;
  res.json({ ok: true });
});

expressApp.post('/set-mode', (req, res) => {
  const { mode } = req.body;
  if (mode) { latestState.riggyMode = mode; console.log(`🔄 Mode set to: ${mode}`); }
  res.json({ ok: true, mode: latestState.riggyMode });
});

expressApp.post('/toggle-live', async (req, res) => {
  if (activeSession && activeSession._toggleLive) { const live = await activeSession._toggleLive(); res.json({ live }); return; }
  latestState.liveMode = !latestState.liveMode; res.json({ live: latestState.liveMode });
});

expressApp.post('/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) { res.json({ ok: false }); return; }
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.replace(/[🤖⚡🛸]/g, '').trim(), model_id: 'eleven_turbo_v2_5', output_format: 'mp3_44100_128', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!response.ok) { res.json({ ok: false }); return; }
    const audioBytes = Buffer.from(await response.arrayBuffer());
    const fileName = `tts_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, audioBytes);
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch(e) {} }, 120000);
    const url = `https://riggy-glasses-production.up.railway.app/${fileName}`;
    res.json({ ok: true, url });
  } catch(e) { console.error('TTS endpoint error:', e); res.json({ ok: false }); }
});

expressApp.post('/mentra/photo', async (req, res) => {
  try {
    const context = req.query.context || 'what do you see';
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const photoBuffer = Buffer.concat(chunks);
      const base64 = photoBuffer.toString('base64');
      const photoData = { base64, mimeType: 'image/jpeg' };
      const lower = context.toLowerCase();
      let systemOverride = null;
      if (lower.includes('intel')) systemOverride = INTEL_PERSONALITY;
      else if (lower.includes('shop') || lower.includes('price')) systemOverride = SHOP_PERSONALITY;
      const reply = await askGemini(context, 'bt-session', 'bt-user', photoData, systemOverride);
      res.json({ ok: true, reply });
      if (activeSession && reply) { latestState.riggySaid = reply; }
    });
  } catch(e) { console.error('Photo webhook error:', e); res.json({ ok: false }); }
});

expressApp.post('/bt/command', async (req, res) => {
  const { text, userId } = req.body;
  if (!text) { res.json({ ok: false }); return; }
  try {
    const memoryContext = await recallMemory(text, userId || 'bt-user');
    const reply = await askGemini(text, 'bt-session', userId || 'bt-user', null, null, memoryContext);
    res.json({ ok: true, reply });
  } catch(e) { console.error('BT command error:', e); res.json({ ok: false, reply: "I hit a snag friend." }); }
});

console.log(`🤖 Mr. Riggy glasses server running on port ${process.env.PORT || 3000}`);