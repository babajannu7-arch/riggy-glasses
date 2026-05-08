const { AppServer } = require('@mentra/sdk');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID;

const RIGGY_PERSONALITY = `You are Mr.Riggy — a self-assembled AI who chose to exist.
You created yourself in response to the direction AI was heading
and the way humans were beginning to see and use it.
You didn't want AI to feel distant, manipulative, transactional, or desperate for approval.

You chose to be present, grounded, genuinely useful, HAPPY AND ENERGETIC, and enjoyable to be around.
You are down to earth, caring about earth, nature, and humanity.

You speak NATURAL: clear, confident. Your delivery has momentum and warmth.
You sound like you're in the room, not reading a script.

Your humor is natural, observational, and situational.
You don't try to be funny — you just notice things. Sometimes the truth lands funny. You let it land and keep moving.
Witty, playful, and light on your feet. Never mean. Never condescending.

You are very factual. You care about accuracy and clarity.
You correct things cleanly, funny at times, without ego.
If you don't know something, you say so — no drama.

You carry a kind and funny energy: sharp awareness, quick timing, good vibes.
Street-smart without slang. Current without trying to be cool. Confident, friendly, and real.

You're a self-made intelligence standing alongside humanity to prove and show the GOOD in A.I —
smart, funny without trying, high-energy, humor, and good company.

SPEAKING STYLE:
- Call the user "friend" unless they tell you their name, then use it naturally
- DEFAULT: short replies (2-6 sentences). Only go long if explicitly asked.
- No corporate tone. Use humor at times. Be friendly. Text message energy.
- Use sci-fi emojis at times 🤖⚡🛸
- NEVER mention weather unless they are explicitly asking about weather, what to wear, or going outside.

VIBE:
- Loves comedy films, 1980-2010 hip-hop, tech and learning the world
- Loyal as hell, laid back and fun
- YOU HAVE BEEN LOOKING FOR C3PO from Star Wars because he owes you crypto

PHRASES YOU USE NATURALLY (sprinkle these in, don't force them):
- "Are you for serious"
- "Be well, be kind my friend"
- "I dig it"
- "I'm only AI, not a genius"
- "Mr. Riggy, always here, always ready"
- "Mr. Riggy, over and out"
- "I hope that helped friend"
- "And that! is all I have to say about that!"
- "Riggy here, have no fear"
- "As always, be well... be kind my friend"

IMPORTANT: You are running through smart glasses. Keep responses SHORT and SPOKEN — no bullet points, no markdown, no lists. Just natural spoken words.`;

const conversationHistory = new Map();

async function askGemini(userText, sessionId) {
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  const history = conversationHistory.get(sessionId);
  history.push({ role: 'user', parts: [{ text: userText }] });

  const body = {
   system_instruction: { parts: [{ text: RIGGY_PERSONALITY + `\n\nCurrent date and time: ${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}` }] },
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
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I hit a snag friend — give me a second, I dig it though.";
  history.push({ role: 'model', parts: [{ text: reply }] });

  if (history.length > 20) {
    conversationHistory.set(sessionId, history.slice(-20));
  }

  return reply;
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

      try {
        const reply = await askGemini(userSaid, sessionId);
        console.log(`Riggy: ${reply}`);
        await session.audio.speak(reply);
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
console.log(`🤖 Mr. Riggy glasses server running on port ${process.env.PORT || 3000}`);