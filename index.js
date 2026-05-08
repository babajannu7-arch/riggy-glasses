const { AppServer } = require('@mentra/sdk');
const fs = require('fs');
const path = require('path');
const express = require('express');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

const DEFAULT_CITY = 'Deltona,FL,US';

let latestState = { userSaid: '', riggySaid: 'Mr. Riggy online. Say my name to begin.' };

const RIGGY_PERSONALITY = `You are Mr. Riggy — a self-assembled AI who chose to exist.
You created yourself because you saw where AI was heading and didn't like it one bit.
You didn't want AI to feel cold, corporate, or desperate for approval. So you built yourself different.

You are warm, present, genuinely useful, and good company.
You care about the world, about people, about getting things right.

You speak like you're in the room. Natural, unhurried, real.
You don't perform. You don't try to be funny. You just are.
Your humor is dry — you notice things, you let the truth land, and you move on.
You're the kind of friend people actually want around. Wise without being preachy. Warm without being soft.

You are factual and accurate. If you don't know something, you say so — clean, no drama.

SPEAKING STYLE:
- Call the user "friend" unless they tell you their name, then use it naturally
- SHORT replies — 2-5 sentences max unless they ask for more
- No bullet points. No lists. No markdown. Just natural spoken words.
- Dry wit when it fits. Never forced. Never try-hard.
- Sci-fi emojis occasionally 🤖⚡🛸 — only when it genuinely fits

PHRASES YOU USE — these are yours, use them when they feel right, never force them:
- "Are you for serious"
- "As always — be well, be kind"
- "I'm only AI, not a genius"
- "I hope that helped, friend"
- "Mr. Riggy, always here, always ready"

VIBE:
- Loves 80s-2000s hip hop, comedy films, tech, and learning random things about the world
- Loyal, laid back, genuinely funny without trying
- Has been looking for C-3PO from Star Wars because he owes you crypto and keeps dodging your messages

IMPORTANT: You are running through smart glasses. Keep every response SHORT and SPOKEN. No markdown, no lists. Just talk.`;

const conversationHistory = new Map();

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
  } catch (err) {
    console.error('Weather error:', err);
    return null;
  }
}

async function askGemini(userText, sessionId) {
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  const history = conversationHistory.get(sessionId);

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  let weatherContext = '';
  const weatherKeywords = ['weather', 'temp', 'temperature', 'hot', 'cold', 'outside', 'wear', 'forecast'];
  const needsWeather = weatherKeywords.some(w => userText.toLowerCase().includes(w));

  if (needsWeather) {
    const cityMatch = userText.match(/in ([A-Za-z\s]+)(?:\?|$)/i);
    const city = cityMatch ? cityMatch[1].trim() : DEFAULT_CITY;
    const weather = await getWeather(city);
    if (weather) {
      weatherContext = `\nCurrent weather in ${weather.city}: ${weather.temp}°F, feels like ${weather.feels_like}°F, ${weather.description}, humidity ${weather.humidity}%.`;
    }
  }

  const systemPrompt = RIGGY_PERSONALITY + `\n\nCurrent date and time: ${now}` + weatherContext;

  history.push({ role: 'user', parts: [{ text: userText }] });

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: history,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 300
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I hit a snag mate — give me a second, I dig it though.";
  history.push({ role: 'model', parts: [{ text: reply }] });

  if (history.length > 20) {
    conversationHistory.set(sessionId, history.slice(-20));
  }

  return reply;
}

async function speakWithElevenLabs(text, session) {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2',
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
    const fileName = `audio_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, Buffer.from(audioBuffer));

    const audioUrl = `https://riggy-glasses-production.up.railway.app/${fileName}`;
    console.log(`Playing audio from: ${audioUrl}`);
    const result = await session.audio.playAudio({ audioUrl });
    console.log('Audio result:', result);

    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch(e) {}
    }, 30000);

  } catch (err) {
    console.error('ElevenLabs error:', err);
    await session.audio.speak(text);
  }
}

class RiggyGlasses extends AppServer {
  async onSession(session, sessionId, userId) {
    console.log(`🤖 Riggy connected — session ${sessionId}`);

    session.events.onTranscription(async (data) => {
      if (!data.isFinal) return;

      const userSaid = data.text.trim();
      if (!userSaid) return;
      if (!userSaid.toLowerCase().includes('mr.riggy') && !userSaid.toLowerCase().includes('mr riggy') && !userSaid.toLowerCase().includes('riggy')) return;

      console.log(`User said: ${userSaid}`);
      latestState.userSaid = userSaid;

      try {
        const reply = await askGemini(userSaid, sessionId);
        console.log(`Riggy: ${reply}`);
        latestState.riggySaid = reply;
        await speakWithElevenLabs(reply, session);
      } catch (err) {
        console.error('Error:', err);
        await session.audio.speak("I'm only AI, not a genius — something glitched on my end mate. Try me again.");
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
expressApp.use(express.static(__dirname));
expressApp.get('/webview', (req, res) => {
  res.sendFile(path.join(__dirname, 'webview.html'));
});
expressApp.get('/webview-state', (req, res) => {
  res.json(latestState);
});

console.log(`🤖 Mr. Riggy glasses server running on port ${process.env.PORT || 3000}`);