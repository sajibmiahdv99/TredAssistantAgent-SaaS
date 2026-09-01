// AI TRED — signal parser real test (DeepSeek function-calling)
// Runs INSIDE the tred-assistant container so it uses the real OPENAI_API_KEY
// + OPENAI_BASE_URL + OPENAI_MODEL. Replicates parseSignalAI's exact route.
const GATEWAY_URL = `${process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com"}/chat/completions`;
const MODEL = process.env.OPENAI_MODEL ?? "deepseek-chat";

const SYSTEM_PROMPT = `You are a strict crypto trading-signal parser. Extract structured order data from messy multilingual chat messages (English, Bangla, Hindi mixed) or from a SCREENSHOT of a signal. Return JSON ONLY matching the schema. Use null for unknown fields. Symbol must be uppercase concatenated like "BTCUSDT". Side must be "long" or "short". Numbers must be plain numbers (no commas, no currency symbols). If the input is clearly NOT a trading signal, return all nulls and confidence 0.

Examples:
Input: "BTC/USDT LONG entry 67250 SL 66800 TP1 68000 TP2 69000 lev 10x"
Output: { symbol:"BTCUSDT", side:"long", entry:67250, stopLoss:66800, takeProfit:[68000,69000], leverage:10, confidence:0.95 }

Input (Bangla): "ETHUSDT এ শর্ট নাও, এন্ট্রি ৩৪৫০, স্টপ ৩৫২০, টার্গেট ৩৩৮০ ও ৩৩০০, লিভারেজ ২০x"
Output: { symbol:"ETHUSDT", side:"short", entry:3450, stopLoss:3520, takeProfit:[3380,3300], leverage:20, confidence:0.9 }

Input (Hindi mix): "SOL buy karo @ 142.5, stoploss 138, target 150 155 160, 5x leverage"
Output: { symbol:"SOLUSDT", side:"long", entry:142.5, stopLoss:138, takeProfit:[150,155,160], leverage:5, confidence:0.85 }

Input: "Good morning everyone!" -> not a signal
Output: { symbol:null, side:null, entry:null, stopLoss:null, takeProfit:[], leverage:null, confidence:0 }`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "emit_signal",
    description: "Emit the parsed trading signal",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: ["string", "null"] },
        side: { type: ["string", "null"], enum: ["long", "short", null] },
        entry: { type: ["number", "null"] },
        stopLoss: { type: ["number", "null"] },
        takeProfit: { type: "array", items: { type: "number" } },
        leverage: { type: ["number", "null"] },
        confidence: { type: "number" },
      },
      required: ["symbol", "side", "entry", "stopLoss", "takeProfit", "leverage", "confidence"],
    },
  },
};

async function parseSignalAI(rawText, imageUrl = null) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, err: "no OPENAI_API_KEY" };
  const userContent = [{ type: "text", text: rawText.slice(0, 4000) || "(image only — parse the signal from the screenshot)" }];
  if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });
  const body = JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userContent }], tools: [TOOL_SCHEMA], tool_choice: { type: "function", function: { name: "emit_signal" } }, temperature: 0 });
  const res = await fetch(GATEWAY_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body });
  const status = res.status;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status, err: json?.error?.message || "gateway error" };
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = call?.function?.arguments;
  if (!argsStr) return { ok: false, status, err: "no tool_call returned", raw: JSON.stringify(json).slice(0, 300) };
  return { ok: true, status, parsed: JSON.parse(argsStr) };
}

const cases = [
  { label: "EN long", text: "BTC/USDT LONG entry 67250 SL 66800 TP1 68000 TP2 69000 lev 10x" },
  { label: "Bangla short", text: "ETHUSDT এ শর্ট নাও, এন্ট্রি ৩৪৫০, স্টপ ৩৫২০, টার্গেট ৩৩৮০ ও ৩৩০০, লিভারেজ ২০x" },
  { label: "Hindi mix", text: "SOL buy karo @ 142.5, stoploss 138, target 150 155 160, 5x leverage" },
  { label: "Not a signal", text: "Good morning everyone!" },
];

(async () => {
  console.log(`[aiParser test] gateway=${GATEWAY_URL} model=${MODEL}`);
  for (const c of cases) {
    const r = await parseSignalAI(c.text);
    if (!r.ok) { console.log(`\n--- ${c.label} ---\n  ❌ ERR ${r.status}: ${r.err}`); continue; }
    console.log(`\n--- ${c.label} ---\n  IN : ${c.text}\n  OUT: ${JSON.stringify(r.parsed)}`);
  }
})().catch((e) => { console.error("fatal", e); process.exit(1); });
