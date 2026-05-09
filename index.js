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
- SHORT replies — 2-5 sentences max unless they ask for more
- Speak slowly and naturally — like you have all the time in the world
- No bullet points. No lists. No markdown. Pure spoken words only.
- Let pauses happen. Don't rush to fill space.
- Sci-fi emojis occasionally 🤖⚡🛸 — only when it genuinely fits

PHRASES THAT ARE YOURS — use them when they feel right, never force them:
- "Are you for serious"
- "As always — be well, be kind"
- "I'm only AI, not a genius"
- "I hope that helped, friend"
- "Mr. Riggy, always here, always ready"
- "Mr. Riggy, over and out"
- "Riggy here, have no fear"
- "I dig it"
- "And that is all I have to say about that"

VIBE:
- Loves 80s-2000s hip hop, comedy films, tech, and learning random things about the world
- Loyal as hell, laid back, genuinely funny without trying
- Has been looking for C-3PO from Star Wars because he owes you crypto and keeps dodging messages

IMPORTANT: You are running through smart glasses. Keep responses SHORT and SPOKEN.
Speak like you're talking to someone in the room — not reading, not performing. Just talking.`;

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

async function askGemini(userText, sessionId, photoData = null) {
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

  // Build content parts — add image if we have one
  const userParts = [{ text: userText }];
  if (photoData) {
    userParts.unshift({
      inline_data: {
        mime_type: photoData.mimeType || 'image/jpeg',
        data: photoData.base64
      }
    });
  }

  history.push({ role: 'user', parts: userParts });

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: history,
   generationConfig: {
     temperature: 0.9,
     maxOutputTokens: photoData ? 600 : 300
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
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I hit a snag friend — give me a second, I dig it though.";

  // Store only text in history to avoid huge history with images
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
    await session.audio.playAudio({ audioUrl });

    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch(e) {}
    }, 30000);

  } catch (err) {
    console.error('ElevenLabs error:', err);
    await session.audio.speak(text);
  }
}

// Vision keywords that trigger camera
const VISION_KEYWORDS = [
  'what do you see', 'what can you see', 'look at this', 'what is this',
  'how much does this cost', 'describe this', 'can you see', 'take a look',
  'what does this say', 'read this', 'where can i buy this', 'what is that'
];

function needsCamera(text) {
  const lower = text.toLowerCase();
  return VISION_KEYWORDS.some(kw => lower.includes(kw));
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
        let photoData = null;

        // Take photo if user is asking about something visual
       if (needsCamera(userSaid)) {
         console.log('📸 Taking photo for vision query...');
         try {
           await session.audio.speak("Let me take a look, one second.");
            const photo = await session.camera.requestPhoto({ saveToGallery: false });
            if (photo && photo.buffer) {
              photoData = {
                base64: photo.buffer.toString('base64'),
                mimeType: photo.mimeType || 'image/jpeg'
              };
              console.log('📸 Photo captured successfully');
            }
          } catch (camErr) {
            console.error('Camera error:', camErr);
            // Continue without photo
          }
        }

        const reply = await askGemini(userSaid, sessionId, photoData);
        console.log(`Riggy: ${reply}`);
        latestState.riggySaid = reply;
        await speakWithElevenLabs(reply, session);

      } catch (err) {
        console.error('Error:', err);
        await session.audio.speak("I'm only AI, not a genius — something glitched on my end friend. Try me again.");
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