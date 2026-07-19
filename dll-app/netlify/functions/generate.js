// netlify/functions/generate.js
// Calls the Gemini API server-side so the API key never reaches the browser.
// Requires env var GEMINI_API_KEY to be set in Netlify (Site settings > Environment variables).

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "GEMINI_API_KEY is not set on the server. Add it in Netlify: Site settings > Environment variables.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { subject, gradeLevel, topic, numDays } = payload;
  if (!subject || !gradeLevel || !topic || !numDays) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "subject, gradeLevel, topic, and numDays are required" }),
    };
  }

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
        body: JSON.stringify({ error: "Gemini API error", details: errText }),
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
