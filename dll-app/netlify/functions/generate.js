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

// Each lesson-design pattern is expressed as an ordered list of phases.
// The model is told to structure the "flow" field using exactly these
// phases, in this order, one bold heading line per phase.
const DESIGN_PATTERNS = {
  "5Es": {
    label: "5Es",
    phases: ["Engage", "Explore", "Explain", "Elaborate", "Evaluate"],
  },
  "6Es": {
    label: "6Es",
    phases: ["Engage", "Explore", "Explain", "Elaborate", "Extend", "Evaluate"],
  },
  experiential: {
    label: "Experiential Learning (Kolb's Cycle)",
    phases: [
      "Concrete Experience",
      "Reflective Observation",
      "Abstract Conceptualization",
      "Active Experimentation",
    ],
  },
  inquiry: {
    label: "Inquiry-Based Learning",
    phases: ["Ask / Wonder", "Investigate", "Create", "Discuss", "Reflect"],
  },
  explicit: {
    label: "Explicit Instruction",
    phases: [
      "Review & State Objective",
      "Model (I Do)",
      "Guided Practice (We Do)",
      "Independent Practice (You Do)",
      "Closure & Check for Understanding",
    ],
  },
};
const DEFAULT_DESIGN_PATTERN = "5Es";

// Instructions for how to write each formative assessment type. {n} is
// replaced with the requested multiple-choice item count.
const ASSESSMENT_INSTRUCTIONS = {
  mc: (n) =>
    `**Multiple Choice Test ({n} items):** exactly ${n} questions, each as ONE bullet line in the ` +
    `format "- 1. <question stem> | A. <choice> B. <choice> C. <choice> D. <choice> | Answer: <letter>". ` +
    `Keep the whole question on a single line (do not split choices onto new lines).`,
  exitTicket:
    `**Exit Ticket:** 1-2 bullet lines with a short question or prompt learners answer on a slip of ` +
    `paper before leaving class.`,
  trueFalse:
    `**True or False:** 4-5 bullet lines, each a statement ending with "(Answer: True)" or "(Answer: False)".`,
  identification:
    `**Identification / Short Answer:** 4-5 bullet lines, each a short-answer prompt or item to identify, ` +
    `with the answer in parentheses at the end.`,
  oral:
    `**Oral Questioning:** 3-4 bullet lines of guide questions the teacher can ask learners directly.`,
  performanceTask:
    `**Performance Task (Rubric-based):** 1 bullet line describing the task, followed by 3 bullet lines ` +
    `for a simple 3-level rubric (Excellent / Satisfactory / Needs Improvement).`,
  thinkPairShare:
    `**Think-Pair-Share:** 1 bullet line with the discussion prompt, followed by 2-3 bullet lines for the ` +
    `Think / Pair / Share steps.`,
};

function buildAssessmentInstructions(assessmentTypes, mcItemCount, otherAssessment) {
  const types = Array.isArray(assessmentTypes) && assessmentTypes.length ? assessmentTypes : ["exitTicket"];
  const lines = [];
  types.forEach((t) => {
    if (t === "mc") {
      lines.push(ASSESSMENT_INSTRUCTIONS.mc(mcItemCount).replace("{n}", mcItemCount));
    } else if (t === "other") {
      const label = otherAssessment && otherAssessment.trim() ? otherAssessment.trim() : "a suitable custom assessment";
      lines.push(
        `**${label}:** design a short formative assessment activity matching this description, written as 2-3 bullet lines.`
      );
    } else if (ASSESSMENT_INSTRUCTIONS[t]) {
      lines.push(ASSESSMENT_INSTRUCTIONS[t]);
    }
  });
  return lines.join("\n");
}

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

  const {
    subject, gradeLevel, topic, numDays, model,
    designPattern, assessmentTypes, mcItemCount, otherAssessment,
  } = payload;

  if (!subject || !gradeLevel || !topic || !numDays) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "subject, gradeLevel, topic, and numDays are required" }),
    };
  }

  const modelKey = MODEL_MAP[model] ? model : DEFAULT_MODEL_KEY;
  const MODEL = MODEL_MAP[modelKey];
  const days = Math.max(1, Math.min(10, parseInt(numDays, 10) || 1));
  const mcCount = Math.max(1, Math.min(20, parseInt(mcItemCount, 10) || 5));

  const pattern = DESIGN_PATTERNS[designPattern] || DESIGN_PATTERNS[DEFAULT_DESIGN_PATTERN];
  const phaseList = pattern.phases.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const assessmentInstructions = buildAssessmentInstructions(assessmentTypes, mcCount, otherAssessment);

  const schemaHint = `
Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "competency": "single string: the overall learning competency + content/performance standard for the whole lesson, covering all days",
  "days": [
    {
      "day": 1,
      "objectives": "string: learning objective for this specific day",
      "learnerContext": "string: a short guiding note on learner context/observations for this day",
      "preLesson": "string: how to get learners ready for this day's lesson, as 1-2 bullet lines starting with \\"- \\"",
      "flow": "string: the day's activity flow, formatted as described below in FLOW FORMAT",
      "resources": "string: learning resources needed for this day, as bullet lines starting with \\"- \\"",
      "integration": "string: one short line on cross-subject integration opportunities for this day, or 'N/A'",
      "assessment": "string: formative assessment content for this day, formatted as described below in ASSESSMENT FORMAT",
      "extended": "string: one optional take-home/extended learning task for this day, as a bullet line starting with \\"- \\""
    }
  ]
}
The "days" array must contain exactly ${days} objects, with "day" numbered 1 to ${days} in order, forming a coherent, logically sequenced ${days}-day lesson (not ${days} repeats of the same thing).

FORMATTING RULES (applies to preLesson, flow, resources, assessment, extended):
- Use "\\n" to separate lines within a field's string value.
- Bulleted lines start with "- ".
- Use **double asterisks** to bold short labels/headings (e.g. "**Engage:**"), never bold whole sentences.
- Do not use any other markdown (no #, no numbered-list syntax outside what's specified below).

FLOW FORMAT — structure every day's "flow" using the "${pattern.label}" lesson design pattern.
Use exactly these phases, in this order, one bold heading line per phase (e.g. "**Engage:**") followed
by 2-4 bullet lines ("- ...") describing concrete, grade-appropriate classroom actions for that phase.
Phases:
${phaseList}
End the final phase with one bullet line covering inclusion/accommodation for learners with varied needs.

ASSESSMENT FORMAT — the "assessment" field for every day must include ALL of the following, each as a
bold heading line followed by its bullet content, using the exact instructions given:
${assessmentInstructions}
`.trim();

  const prompt = `You are an expert Philippine DepEd basic education teacher writing a Daily Lesson Log (DLL) in the ILAW Format for the MATATAG curriculum.

Subject/Learning Area: ${subject}
Grade Level: ${gradeLevel}
Topic/Competency focus: ${topic}
Number of days/sessions: ${days}
Lesson design pattern to follow: ${pattern.label}

CONTEXT AND LEVEL REQUIREMENTS (very important):
- Write in clear, grade-appropriate English matched to the cognitive level and typical vocabulary of a
  Filipino learner in ${gradeLevel}. Use simpler sentences and concrete, hands-on examples for lower
  grades; more academic vocabulary and abstract reasoning are acceptable for higher grades.
- Ground every example, scenario, and material in the Philippine setting: use Filipino learner names
  (e.g. Ana, Mateo, Liza, Jomar, Kristine), local settings (barangay, palengke, sari-sari store,
  jeepney, rice field, school canteen), Philippine peso (₱) for any money examples, and locally familiar
  plants/animals/food (e.g. mango, santol, carabao, adobo, sinigang) instead of foreign references.
  Avoid US-centric defaults (no dollars, no Fahrenheit, no foreign brand names or settings).
- Keep every activity realistic for a public school classroom with limited materials (recycled/low-cost
  materials, items learners can bring from home, or simple teacher demonstrations).
- Include at least one brief inclusive/accommodation note per day for learners with varied abilities.

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
