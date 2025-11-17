// ScraperX enrichment server (Railway-ready)
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json({ limit: '1mb' }));

// Allow browser extension access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are ScraperX Enrichment AI. Return ONLY VALID JSON following the schema exactly." },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: 1200
    })
  });

  const data = await resp.json();
  if (!data || !data.choices || !data.choices[0]) {
    throw new Error("OpenAI returned invalid response: " + JSON.stringify(data));
  }
  return data.choices[0].message.content;
}

const methodology = `
Return JSON only.
Keys: company_name, name_variations, website, start_date, email_pattern,
social_handles, short_description, full_description, primary_industry,
secondary_industries, industry_slices, hq_address, keywords, needs_secondary_check,
c_level_name, c_level_linkedin, source_citation.
short_description: NOT starting with company name, <= 28 words.
full_description: ONE sentence starting with "The company's".
Be conservative and follow all rules strictly.
`;

app.post("/enrich", async (req, res) => {
  try {
    const raw = req.body.raw || {};
    const prompt = methodology + "\nRAW:\n" + JSON.stringify(raw, null, 2);

    const reply = await callOpenAI(prompt);

    let parsed = null;
    try { parsed = JSON.parse(reply); }
    catch (e) {
      const m = reply.match(/\{[\s\S]*\}$/);
      if (m) parsed = JSON.parse(m[0]);
    }

    if (!parsed) {
      return res.status(500).json({ error: "Invalid JSON from AI", rawReply: reply });
    }

    parsed.source_citation = parsed.source_citation || raw.url || "";
    return res.json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("ScraperX server running on port", PORT));
