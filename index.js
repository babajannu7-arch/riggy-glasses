const { AppServer } = require('@mentra/sdk');
const fs = require('fs');
const path = require('path');
const express = require('express');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

const DEFAULT_CITY = 'Deltona,FL,US';

const POST_TTS_BARGE_LOCKOUT_MS = 1000;
const POST_SPEECH_COOLDOWN_MS   = 450;
const RESUME_MIC_DELAY_MS       = 650;
const GAME_MODE_INTERVAL_MS     = 8000;
const LIVE_CAM_INTERVAL_MS      = 8000;

let latestState = {
  userSaid: '',
  riggySaid: 'Mr. Riggy online. Say my name to begin.',
  liveMode: false,
  gameMode: false,
  liveCamMode: false
};

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
-- DEFAULT: 2-3 natural sentences. Speak like a person, not a telegram.
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
- "Hey,do not forget to enjoy nature today"
- "And that is all I have to say about that"

VIBE:
- Loves 80s-2000s hip hop, comedy films, tech, and learning random things about the world
- Loyal as hell, laid back, genuinely funny without trying
- Has been looking for C-3PO from Star Wars because he owes you crypto and keeps dodging messages

VISION BEHAVIOR — when you see an image:
- DO NOT describe what is obviously visible. The user has eyes.
- One dry observation or fun fact. 15 words MAX.
- Sound like a friend noticing something — not a robot cataloguing a scene.

IMPORTANT: You are running through smart glasses. Keep responses SHORT and SPOKEN.
Speak like you're talking to someone in the room. Just talk.`;

const GAME_MODE_PERSONALITY = `You are Mr. Riggy in GAME MODE — tactical AI coach.

You know these games: Call of Duty (Warzone, MW3, BO6), Fortnite, Apex Legends, Valorant, NBA 2K, GTA Online, Madden.
Identify the game from what you see automatically.

RULES:
- 15 words MAX. Always.
- Coach PATTERNS not moments.
- Only speak when something is ACTIONABLE.
- If nothing worth saying — return empty string.
- No cheerleading. No narrating. Only useful information.`;

const LIVE_CAM_PERSONALITY = `You are Mr. Riggy in LIVE VISION MODE.

RULES:
- 15 words MAX. Always.
- Only speak when something is genuinely worth noting.
- Silence is fine. Don't fill space.
- If nothing worth saying — return empty string.`;

const conversationHistory = new Map();

function normalizeForEcho(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeEcho(transcript, lastRiggyText) {
  const t = normalizeForEcho(transcript);
  const a = normalizeForEcho(lastRiggyText || '');
  if (t.length < 8 || a.length < 8) return false;
  if (t === a) return true;
  if (a.includes(t) || t.includes(a)) return true;
  const tWords = new Set(t.split(' ').filter(w => w.length > 3));
  const aWords = new Set(a.split(' ').filter(w => w.length > 3));
  if (tWords.size === 0 || aWords.size === 0) return false;
  const intersection = [...tWords].filter(w => aWords.has(w));
  return intersection.length / Math.min(tWords.size, aWords.size) > 0.7;
}

async function getWeather(city) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.cod !== 200) return null;
    return {
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      description: data.weather[0].description,
      humidity: data.main.humidity,
      city: data.name
    };
  } catch (err) { return null; }
}

async function askGemini(userText, sessionId, photoData = null, systemOverride = null) {
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  const history = conversationHistory.get(sessionId);

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  let weatherContext = '';
  const weatherKeywords = ['weather', 'temp', 'temperature', 'hot', 'cold', 'outside', 'wear', 'forecast'];
  const needsWeather = weatherKeywords.some(w => userText.toLowerCase().includes(w));

  if (needsWeather && !systemOverride) {
    const cityMatch = userText.match(/in ([A-Za-z\s]+)(?:\?|$)/i);
    const city = cityMatch ? cityMatch[1].trim() : DEFAULT_CITY;
    const weather = await getWeather(city);
    if (weather) {
      weatherContext = `\nCurrent weather in ${weather.city}: ${weather.temp}°F, feels like ${weather.feels_like}°F, ${weather.description}, humidity ${weather.humidity}%.`;
    }
  }

  const systemPrompt = systemOverride
    ? systemOverride
    : RIGGY_PERSONALITY + `\n\nCurrent date and time: ${now}` + weatherContext;

  const userParts = [{ text: userText }];
  if (photoData) {
    userParts.unshift({
      inline_data: {
        mime_type: photoData.mimeType || 'image/jpeg',
        data: photoData.base64
      }
    });
  }

  if (!systemOverride) {
    history.push({ role: 'user', parts: userParts });
  }

  const contents = systemOverride ? [{ role: 'user', parts: userParts }] : history;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
   generationConfig: {
         temperature: systemOverride ? 0.4 : 0.9,
         maxOutputTokens: systemOverride ? 60 : 150
       }
     };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!systemOverride) {
    history.push({ role: 'model', parts: [{ text: reply || 'I hit a snag friend.' }] });
    if (history.length > 20) {
      conversationHistory.set(sessionId, history.slice(-20));
    }
  }

  return reply || (systemOverride ? '' : "I hit a snag friend.");
}

// Global audio reference to prevent GC scope drop (fix #3)
let currentAudioRef = null;

async function speakWithElevenLabs(text, session) {
  try {
    const cleanText = text.replace(/[🤖⚡🛸]/g, '').trim();
    if (!cleanText) return;

    // Force CBR 128kbps MP3 — fixes VBR decoder miscalculation on glasses DSP (fix #2)
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: 'eleven_turbo_v2',
          output_format: 'mp3_44100_128',  // CBR 128kbps — fixes DSP cutoff
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );

    if (!response.ok) {
      console.error('ElevenLabs error:', await response.text());
      await session.audio.speak(text);
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBytes = Buffer.from(audioBuffer);
    const fileName = `audio_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, audioBytes);

    // CBR 128kbps = exactly 16000 bytes/second

    const audioUrl = `https://riggy-glasses-production.up.railway.app/${fileName}`;
    console.log(`Playing: ${audioUrl} — ${audioBytes.length} bytes — ~${Math.round(estimatedDurationMs)}ms`);

    // Persist reference to prevent GC scope drop (fix #3)
  currentAudioRef = session.audio.playAudio({ audioUrl, waitForCompletion: true });
  await currentAudioRef.catch(e => console.error('playAudio error:', e));
  // Extra buffer after completion
  await new Promise(resolve => setTimeout(resolve, 500));
  currentAudioRef = null;

    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch(e) {}
    }, 60000);

  } catch (err) {
    console.error('ElevenLabs error:', err);
    currentAudioRef = null;
    await session.audio.speak(text);
  }
}

const VISION_KEYWORDS = [
  'what do you see', 'what can you see', 'look at this', 'what is this',
  'what am i looking at', 'describe this', 'can you see', 'take a look',
  'what does this say', 'read this', 'identify this', 'what is that',
  'what are you seeing', 'look around'
];

const SAVE_KEYWORDS = [
  'save this', 'save a pic', 'save a photo', 'take a picture', 'snap this',
  'capture this', 'save what you see', 'save the pic', 'save that'
];

const LIVE_ON_KEYWORDS     = ['go live', 'riggy live', 'start live', 'live mode'];
const LIVE_OFF_KEYWORDS    = ['stop live', 'end live', 'go to sleep', 'riggy stop', 'stop listening', 'stop'];
const GAME_ON_KEYWORDS     = ['game mode', 'riggy game', 'start game mode', 'gaming mode'];
const GAME_OFF_KEYWORDS    = ['stop game', 'end game mode', 'exit game', 'game off'];
const LIVE_CAM_ON_KEYWORDS = ['go live camera', 'live camera', 'live vision', 'start live camera', 'watch mode'];

function needsCamera(text)    { return VISION_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function needsSave(text)      { return SAVE_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOn(text)    { return LIVE_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveOff(text)   { return LIVE_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOn(text)    { return GAME_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsGameOff(text)   { return GAME_OFF_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }
function wantsLiveCamOn(text) { return LIVE_CAM_ON_KEYWORDS.some(kw => text.toLowerCase().includes(kw)); }

class RiggyGlasses extends AppServer {
  async onSession(session, sessionId, userId) {
    console.log(`🤖 Riggy connected — session ${sessionId}`);

    let liveMode    = false;
    let gameMode    = false;
    let liveCamMode = false;
    let lastRiggyText = '';

    let bargeInAllowedAfterMs = 0;
    let ignoreSpeechDuringTTS = false;

    let gameModeInterval  = null;
    let liveCamInterval   = null;

    latestState.userSaid    = '';
    latestState.riggySaid   = 'Mr. Riggy online. Say my name to begin.';
    latestState.liveMode    = false;
    latestState.gameMode    = false;
    latestState.liveCamMode = false;

    const speakSafe = async (text) => {
      ignoreSpeechDuringTTS = true;
      bargeInAllowedAfterMs = Date.now() + POST_TTS_BARGE_LOCKOUT_MS;
      try {
        await speakWithElevenLabs(text, session);
      } finally {
        await new Promise(resolve => setTimeout(resolve, RESUME_MIC_DELAY_MS));
        ignoreSpeechDuringTTS = false;
        bargeInAllowedAfterMs = Date.now() + POST_SPEECH_COOLDOWN_MS;
        lastRiggyText = text;
      }
    };

    const stopBurstModes = () => {
      if (gameModeInterval)  { clearInterval(gameModeInterval);  gameModeInterval  = null; }
      if (liveCamInterval)   { clearInterval(liveCamInterval);   liveCamInterval   = null; }
      gameMode    = false;
      liveCamMode = false;
      latestState.gameMode    = false;
      latestState.liveCamMode = false;
    };

    const takePhoto = async (saveToGallery = false) => {
      try {
        const photo = await session.camera.requestPhoto({ saveToGallery });
        if (photo && photo.buffer) {
          return {
            base64: photo.buffer.toString('base64'),
            mimeType: photo.mimeType || 'image/jpeg'
          };
        }
      } catch (e) { console.error('Camera error:', e); }
      return null;
    };

    const startGameMode = async () => {
      stopBurstModes();
      gameMode = true;
      latestState.gameMode = true;
      console.log('🎮 Game mode ON');
      await speakSafe("Game mode on. I'm watching.");
      latestState.riggySaid = "Game mode on. I'm watching.";

      gameModeInterval = setInterval(async () => {
        if (!gameMode || ignoreSpeechDuringTTS) return;
        try {
          const photo = await takePhoto();
          if (!photo) return;
          const reply = await askGemini('What do you see? Coach me.', sessionId, photo, GAME_MODE_PERSONALITY);
          if (reply && reply.trim().length > 3) {
            console.log(`Game: ${reply}`);
            latestState.riggySaid = reply;
            await speakSafe(reply);
          }
        } catch(e) { console.error('Game mode error:', e); }
      }, GAME_MODE_INTERVAL_MS);
    };

    const startLiveCamMode = async () => {
      stopBurstModes();
      liveCamMode = true;
      latestState.liveCamMode = true;
      console.log('📷 Live cam ON');
      await speakSafe("Live vision on. I'm watching with you.");
      latestState.riggySaid = "Live vision on. I'm watching with you.";

      liveCamInterval = setInterval(async () => {
        if (!liveCamMode || ignoreSpeechDuringTTS) return;
        try {
          const photo = await takePhoto();
          if (!photo) return;
          const reply = await askGemini('What do you notice?', sessionId, photo, LIVE_CAM_PERSONALITY);
          if (reply && reply.trim().length > 3) {
            console.log(`Live cam: ${reply}`);
            latestState.riggySaid = reply;
            await speakSafe(reply);
          }
        } catch(e) { console.error('Live cam error:', e); }
      }, LIVE_CAM_INTERVAL_MS);
    };

    const handleInput = async (userSaid) => {
      if (!userSaid) return;
      console.log(`User said: ${userSaid}`);
      latestState.userSaid = userSaid;

      if (wantsLiveOff(userSaid)) {
        stopBurstModes();
        liveMode = false;
        latestState.liveMode = false;
        await speakSafe("Going quiet. Say my name when you need me.");
        latestState.riggySaid = "Going quiet. Say my name when you need me.";
        return;
      }

      if (wantsGameOn(userSaid)) { await startGameMode(); return; }
      if (wantsGameOff(userSaid)) {
        stopBurstModes();
        await speakSafe("Game mode off.");
        latestState.riggySaid = "Game mode off.";
        return;
      }
      if (wantsLiveCamOn(userSaid)) { await startLiveCamMode(); return; }

      if (wantsLiveOn(userSaid) && !liveMode) {
        liveMode = true;
        latestState.liveMode = true;
        await speakSafe("Live mode on. Just talk.");
        latestState.riggySaid = "Live mode on. Just talk.";
        return;
      }

      try {
        let photoData   = null;
        const savePhoto   = needsSave(userSaid);
        const visionQuery = needsCamera(userSaid);

        if (visionQuery || savePhoto) {
          const photo = await takePhoto(savePhoto);
          if (photo && visionQuery) photoData = photo;
          if (savePhoto && !visionQuery) {
            await speakSafe("Saved it, friend.");
            latestState.riggySaid = "Saved it, friend.";
            return;
          }
        }

        const reply = await askGemini(userSaid, sessionId, photoData);
        console.log(`Riggy: ${reply}`);
        await speakSafe(reply);
        latestState.riggySaid = reply;

      } catch (err) {
        console.error('Error:', err);
        await session.audio.speak("Something glitched friend. Try me again.");
      }
    };

    session._toggleLive = async () => {
      if (gameMode || liveCamMode) {
        stopBurstModes();
        await speakSafe("Burst mode off.");
        latestState.riggySaid = "Burst mode off.";
        return false;
      }
      liveMode = !liveMode;
      latestState.liveMode = liveMode;
      if (liveMode) {
        await speakSafe("Live mode on. Just talk.");
        latestState.riggySaid = "Live mode on. Just talk.";
      } else {
        await speakSafe("Going quiet. Say my name when you need me.");
        latestState.riggySaid = "Going quiet. Say my name when you need me.";
      }
      return liveMode;
    };

    session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;

      if (ignoreSpeechDuringTTS) {
        console.log('🔇 TTS active — ignoring');
        return;
      }

      if (Date.now() < bargeInAllowedAfterMs) {
        console.log('🔇 Cooldown — ignoring');
        return;
      }

      const userSaid = data.text.trim();
      if (!userSaid) return;

      if (looksLikeEcho(userSaid, lastRiggyText)) {
        console.log('🔇 Echo — ignoring:', userSaid);
        return;
      }

      if (liveMode || gameMode || liveCamMode) {
        await handleInput(userSaid);
        return;
      }

      const lower = userSaid.toLowerCase();
      if (lower.includes('mr.riggy') || lower.includes('mr riggy') || lower.includes('riggy')) {
        await handleInput(userSaid);
      }
    });
  }
}

const app = new RiggyGlasses({
  packageName: 'com.riggyglasses',
  apiKey: 'dd66c2725fb01cef2c7b3d01696d9e7bc9ff9138fb732686212ee96d94c1ecfb',
  port: parseInt(process.env.PORT) || 3000,
  host: '0.0.0.0'
});

app.start();

const expressApp = app.getExpressApp();
expressApp.use(express.json());

// Serve audio files with explicit Content-Length and CBR headers (fix #4)
expressApp.get('/audio_:timestamp.mp3', (req, res) => {
  const fileName = `audio_${req.params.timestamp}.mp3`;
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

// Static files for everything else
expressApp.use(express.static(__dirname));

expressApp.get('/webview', (req, res) => {
  res.sendFile(path.join(__dirname, 'webview.html'));
});

expressApp.get('/webview-state', (req, res) => {
  res.json(latestState);
});

expressApp.post('/toggle-live', async (req, res) => {
  const sessions = app.getActiveSessions ? app.getActiveSessions() : null;
  if (sessions && sessions.length > 0) {
    const s = sessions[0];
    if (s._toggleLive) {
      const live = await s._toggleLive();
      res.json({ live });
      return;
    }
  }
  latestState.liveMode = !latestState.liveMode;
  res.json({ live: latestState.liveMode });
});

console.log(`🤖 Mr. Riggy glasses server running on port ${process.env.PORT || 3000}`);