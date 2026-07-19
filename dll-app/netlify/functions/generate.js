// netlify/functions/generate.js
// Calls the Gemini API server-side so the API key never reaches the browser.
//
// API key resolution order:
//   1. An override key saved via the admin panel (stored in Netlify Blobs)
//   2. The GEMINI_API_KEY environment variable set in Netlify
//
// Model resolution: the frontend sends a short "model key" (flash / pro /
// flash-lite) rather than a raw model ID, so if Google renames a model this
// map is the only place that needs to change.
const { connectLambda, getStore } = require("@netlify/blobs");

const MODEL_MAP = {
  flash: "gemini-3.5-flash",
  pro: "gemini-3.1-pro-preview",
  "flash-lite": "gemini-3.1-flash-lite",
};
const DEFAULT_MODEL_KEY = "flash";

async function resolveApiKey(event) {
  try {
    connectLambda(event);
    const store = getStore({ name: "ilaw-settings" });
    const override = await store.get("gemini_api_key");
    if (override && override.trim()) return override.trim();
  } catch {
    // Blobs not available (e.g. very old local setup) — fall back silently.
  }
  return process.env.GEMINI_API_KEY || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = await resolveApiKey(event);
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "No Gemini API key is configured. Set GEMINI_API_KEY in Netlify, or add one via the Admin panel.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { subject, gradeLevel, topic, numDays, model } = payload;
  if (!subject || !gradeLevel || !topic || !numDays) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "subject, gradeLevel, topic, and numDays are required" }),
    };
  }

  const modelKey = MODEL_MAP[model] ? model : DEFAULT_MODEL_KEY;
  const MODEL = MODEL_MAP[modelKey];

  const days = Math.max(1, Math.min(10, parseInt(numDays, 10) || 1));

  const schemaHint = `
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "competency": "single string: the overall learning competency + content/performance standard for the whole lesson, covering all days",
  "days": [
    {
      "day": 1,
      "objectives": "string: learning objective for this specific day",
      "learnerContext": "string: a short guiding note on learner context/observations for this day",
      "preLesson": "string: how to get learners ready for this day's lesson",
      "flow": "string: the day's activity flow as short lines separated by newline characters, each line starting with a dash. Should reflect: clear objectives, guided-then-independent practice, checking learner understanding, connecting to prior learning, collaboration, reflection prompt, and inclusion/accommodation notes.",
      "resources": "string: learning resources needed for this day, short lines separated by newline characters",
      "integration": "string: one short line on cross-subject integration opportunities for this day, or 'N/A'",
      "assessment": "string: formative assessment task/questions for this day plus one accommodation note",
      "extended": "string: one optional take-home/extended learning task for this day"
    }
  ]
}
The "days" array must contain exactly ${days} objects, with "day" numbered 1 to ${days} in order, forming a coherent, logically sequenced ${days}-day lesson (not ${days} repeats of the same thing).
`.trim();

  const prompt = `You are an expert Philippine DepEd basic education teacher writing a Daily Lesson Log (DLL) in the ILAW Format for MATATAG curriculum.

Subject/Learning Area: ${subject}
Grade Level: ${gradeLevel}
Topic/Competency focus: ${topic}
Number of days/sessions: ${days}

Write clear, age-appropriate, curriculum-aligned content a Filipino public school teacher could use directly, including inclusive/accommodation notes where the format calls for it.

${schemaHint}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.6,
          },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Gemini API error", details: errText, model: MODEL }),
      };
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Model did not return valid JSON", raw: text }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
