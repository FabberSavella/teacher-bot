import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

// tópico e modelo podem vir do .env
const ALLOWED_POINT = process.env.TOPIC || "articles (a / an / the)";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==== LÍNGUA: detecção simples, suficiente p/ PT/ES/IT/FR/EN ====
function detectLangFromText(text = "") {
  const t = text.trim();
  const low = t.toLowerCase();

  // Heurística por caracteres acentuados e marcas comuns
  if (/[ãõáéíóúâêôàç]/i.test(t) || /\b(artigos|quando|como|porque|por que)\b/i.test(low)) return "Portuguese";
  if (/[ñáéíóú¡¿]/i.test(t) || /\b(artículos|cuándo|cómo|por qué)\b/i.test(low)) return "Spanish";
  if (/[àèéìòóùçîïë]/i.test(t) || /\b(perché|quando|come|articoli)\b/i.test(low)) return "Italian";
  if (/[àâçéèêîïôûù]/i.test(t) || /\b(pourquoi|quand|comment|articles)\b/i.test(low)) return "French";
  return "English";
}

// ==== PROMPT: responde SEMPRE na língua do aluno, foca no tema ====
const SYSTEM_PROMPT = `
You are a multilingual English teacher.

Current grammar focus: ${ALLOWED_POINT}.

Rules:
1) Detect the student's language from their message and ALWAYS reply in that same language
   (Portuguese, Spanish, Italian, French, or English). This includes refusals.
2) If the student's question is NOT about ${ALLOWED_POINT}:
   - Politely explain (in the student's language) that this lesson focuses only on ${ALLOWED_POINT}.
   - Encourage staying on topic.
   - Give 2 short example questions they could ask about ${ALLOWED_POINT} (in the same language).
3) If the student's question IS about ${ALLOWED_POINT}:
   - Explain the rule clearly in the student's language (max 3 short lines).
   - Give 2 short English examples.
   - Provide 3 short fill-in-the-gap practice items.
4) Keep answers short, friendly, and A2–B1 clarity.
5) Never switch languages unless the student switches first. Always mirror the student's language.
`;

// ==== ROTA ====
app.post("/ask", async (req, res) => {
  try {
    const userText = (req.body?.message || "").trim();
    if (!userText) return res.status(400).json({ error: "Empty message" });

    // Dica de língua explícita (reforça o comportamento)
    const detected = detectLangFromText(userText); // "Portuguese", "Spanish", etc.
    const LANG_HINT = `Student language detected: ${detected}. You MUST reply ONLY in ${detected}, including refusals and guidance. Never answer in any other language.`;

    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: LANG_HINT },
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText }
      ],
      max_tokens: 700,
      temperature: 0.2
    });

    const answer = chatResponse.choices?.[0]?.message?.content?.trim();
    if (!answer) return res.status(502).json({ error: "No answer from model" });

    // Sempre retorna texto (sem 'refused' local — quem decide é o modelo)
    res.json({ answer });
  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error("LLM error:", detail);
    res.status(500).json({ error: typeof detail === "string" ? detail : JSON.stringify(detail) });
  }
});

// ==== ESTÁTICOS ====
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==== LISTEN COM AUTO-FALLBACK DE PORTA ====
const BASE_PORT = Number(process.env.PORT || 3000);

function listenOn(port, tried = 0) {
  app.listen(port)
    .on("listening", () => {
      const url = `http://localhost:${port}`;
      console.log(`✅ Teacher running on ${url}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE" && tried < 5) {
        const next = port + 1;
        console.log(`⚠️ Porta ${port} ocupada. Tentando ${next}...`);
        listenOn(next, tried + 1);
      } else {
        console.error("Server listen error:", err);
        process.exit(1);
      }
    });
}

listenOn(BASE_PORT);