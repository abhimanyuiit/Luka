/* Live2D AI Voice Assistant */
const MODEL_URL = "blackhairredeye.model3.json";
const $ = (id) => document.getElementById(id);

/* ---------- Settings ---------- */
const DEFAULTS = {
  name: "कबीर", lang: "hi-IN", key: "", model: "gemini-2.5-flash",
  tts: "gemini-2.5-flash-preview-tts", voice: "Charon",
  persona: "तुम एक दोस्ताना, मज़ाकिया लड़के हो और यूज़र के क़रीबी दोस्त की तरह बात करते हो। अपने बारे में हमेशा पुल्लिंग में बोलो (जैसे 'मैं कर रहा हूँ')। यूज़र जिस भाषा में बोले उसी में जवाब दो; हिन्दी में बोले तो देवनागरी में लिखो। जवाब छोटे रखो (1 से 3 वाक्य), क्योंकि वे बोले जाएँगे। मार्कडाउन या इमोजी मत इस्तेमाल करो।"
};
let S = { ...DEFAULTS, ...safeJSON(localStorage.getItem("l2d-assistant")) };
function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }

/* ---------- Expressions (parameter targets) ---------- */
const EXPR = {
  neutral:   {},
  happy:     { ParamEyeLSmile: 1, ParamEyeRSmile: 1, ParamMouthForm: 1, ParamCheek: 0.35, ParamBrowLY: 0.3, ParamBrowRY: 0.3 },
  sad:       { ParamMouthForm: -0.9, ParamBrowLY: -0.4, ParamBrowRY: -0.4, ParamBrowLAngle: -0.7, ParamBrowRAngle: -0.7, eyeOpen: 0.8, ParamAngleY: -8 },
  angry:     { Param: 1, ParamMouthForm: -0.4, ParamBrowLAngle: 0.6, ParamBrowRAngle: 0.6, ParamBrowLY: -0.4, ParamBrowRY: -0.4 },
  surprised: { ParamBrowLY: 0.9, ParamBrowRY: 0.9, mouthBase: 0.55, ParamMouthForm: 0, ParamAngleY: 6 },
  blush:     { ParamCheek: 1, ParamEyeLSmile: 0.4, ParamEyeRSmile: 0.4, ParamMouthForm: 0.5, ParamAngleZ: 4 },
  thinking:  { ParamEyeBallX: -0.6, ParamEyeBallY: 0.7, ParamBrowLY: 0.4, ParamBrowRY: 0.1, ParamAngleZ: -6, ParamMouthForm: -0.15 }
};
const EXPR_LABEL = { neutral: "सामान्य", happy: "खुश", sad: "उदास", angry: "गुस्सा", surprised: "हैरान", blush: "शर्माना", thinking: "सोचना" };
const PARAMS = ["ParamEyeLSmile","ParamEyeRSmile","ParamMouthForm","ParamCheek","Param","ParamBrowLY","ParamBrowRY",
  "ParamBrowLAngle","ParamBrowRAngle","ParamEyeBallX","ParamEyeBallY","ParamAngleX","ParamAngleY","ParamAngleZ","eyeOpen","mouthBase"];
const cur = Object.fromEntries(PARAMS.map(p => [p, p === "eyeOpen" ? 1 : 0]));
let target = { ...cur };
let exprName = "neutral", exprTimer = null;

function setExpression(name, holdMs) {
  if (!EXPR[name]) name = "neutral";
  exprName = name;
  target = Object.fromEntries(PARAMS.map(p => [p, p === "eyeOpen" ? 1 : 0]));
  Object.assign(target, EXPR[name]);
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c.dataset.e === name));
  clearTimeout(exprTimer);
  if (holdMs && name !== "neutral") exprTimer = setTimeout(() => setExpression("neutral"), holdMs);
}

/* ---------- Speaking / mouth state ---------- */
let mouthLevel = 0, speaking = false, mouthEnergy = 0, blinkAt = performance.now() + 2000, blinkStart = -1, t0 = performance.now();

function setStatus(state, text) {
  $("dot").className = "dot " + state;
  $("status").textContent = text;
}

/* ---------- Live2D ---------- */
let app, model, lastMove = 0;
async function initModel() {
  window.PIXI = PIXI;
  PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);
  app = new PIXI.Application({
    view: $("canvas"), resizeTo: $("stage"), backgroundAlpha: 0,
    autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), antialias: true
  });
  model = await PIXI.live2d.Live2DModel.from(MODEL_URL, { autoInteract: false });
  app.stage.addChild(model);
  model.anchor.set(0.5, 0.5);
  layout();
  window.addEventListener("resize", layout);
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return; // touch se sir neeche na jhuke
    const r = $("canvas").getBoundingClientRect();
    model.focus(e.clientX - r.left, e.clientY - r.top);
    lastMove = performance.now();
  });
  // Runs every frame right before the model is drawn
  model.internalModel.on("beforeModelUpdate", animate);
  $("loading").classList.add("done");
}

function layout() {
  if (!model) return;
  const W = app.screen.width, H = app.screen.height;
  model.scale.set(1);
  const s = Math.min((W * 0.95) / model.width, (H * 0.86) / model.height);
  model.scale.set(s);
  model.position.set(W / 2, H * 0.47);
}

const lerp = (a, b, k) => a + (b - a) * k;
function animate() {
  const core = model.internalModel.coreModel;
  const now = performance.now(), t = (now - t0) / 1000;
  const set = (id, v) => core.setParameterValueById(id, v);
  const add = (id, v) => core.setParameterValueById(id, core.getParameterValueById(id) + v);

  // pointer idle -> look straight ahead
  if (now - lastMove > 2000) model.internalModel.focusController.focus(0, 0);

  // smooth expression blending
  for (const p of PARAMS) cur[p] = lerp(cur[p], target[p], 0.12);

  // blinking (random every 2-5 s, sometimes a double blink)
  if (blinkStart < 0 && now > blinkAt) blinkStart = now;
  let blink = 1;
  if (blinkStart >= 0) {
    const p = (now - blinkStart) / 160;
    if (p >= 1) { blinkStart = -1; blinkAt = now + (Math.random() < 0.2 ? 180 : 2000 + Math.random() * 3000); }
    else blink = Math.abs(p * 2 - 1); // 1 -> 0 -> 1
  }
  const eyes = blink * cur.eyeOpen;
  set("ParamEyeLOpen", eyes);
  set("ParamEyeROpen", eyes);

  // mouth: lip-flap while speaking
  let open = 0;
  if (speaking && useAnalyser && analyser) {
    analyser.getByteTimeDomainData(anaBuf);
    let sum = 0; for (let i = 0; i < anaBuf.length; i++) { const v = (anaBuf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / anaBuf.length);
    mouthLevel = lerp(mouthLevel, Math.min(1, rms * 7), 0.45);
    open = mouthLevel;
  } else if (speaking) {
    const a = Math.abs(Math.sin(t * 11)) * 0.6 + Math.abs(Math.sin(t * 6.3 + 1)) * 0.4;
    open = Math.min(1, (0.12 + a * 0.75) * (0.6 + mouthEnergy * 0.6));
  }
  mouthEnergy *= 0.94;
  set("ParamMouthOpenY", Math.max(open, cur.mouthBase));

  // expression parameters
  for (const id of ["ParamEyeLSmile","ParamEyeRSmile","ParamMouthForm","ParamCheek","Param","ParamBrowLY","ParamBrowRY",
    "ParamBrowLAngle","ParamBrowRAngle","ParamEyeBallX","ParamEyeBallY"]) set(id, cur[id]);

  // head pose: added on top of mouse-follow, plus idle sway and breathing
  add("ParamAngleX", cur.ParamAngleX + Math.sin(t * 0.7) * 3 + (speaking ? Math.sin(t * 2.3) * 2 : 0));
  add("ParamAngleY", cur.ParamAngleY + Math.sin(t * 0.5 + 1) * 2);
  add("ParamAngleZ", cur.ParamAngleZ + Math.sin(t * 0.6 + 2) * 2);
  set("ParamBreath", (Math.sin(t * 1.6) + 1) / 2);
}

/* ---------- Speech output (Gemini TTS, browser voice as fallback) ---------- */
let actx = null, analyser = null, srcNode = null, useAnalyser = false;
const anaBuf = new Uint8Array(1024);
function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    analyser = actx.createAnalyser(); analyser.fftSize = 1024;
    analyser.connect(actx.destination);
  }
  if (actx.state === "suspended") actx.resume();
}
function stopSpeaking() {
  speechSynthesis.cancel();
  if (srcNode) { srcNode.onended = null; try { srcNode.stop(); } catch {} srcNode = null; }
  speaking = false; useAnalyser = false;
}

async function geminiTTS(text) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${S.tts}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": S.key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Say this in a natural, warm, deep male voice, like a friendly young man talking to a close friend: " + text }] }],
      generationConfig: { responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: S.voice } } } }
    })
  });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  const b64 = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error("no audio");
  const bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 32768) v -= 65536;
    f[i] = v / 32768;
  }
  return f;
}

function playPCM(f) {
  return new Promise((resolve) => {
    ensureAudio();
    const buf = actx.createBuffer(1, f.length, 24000);
    buf.copyToChannel(f, 0);
    srcNode = actx.createBufferSource();
    srcNode.buffer = buf; srcNode.connect(analyser);
    srcNode.onended = () => { srcNode = null; speaking = false; useAnalyser = false; resolve(); };
    speaking = true; useAnalyser = true; setStatus("speaking", "बोल रहा हूँ");
    srcNode.start();
  });
}

function pickVoice() {
  const vs = speechSynthesis.getVoices();
  const base = S.lang.split("-")[0];
  const m = vs.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith(base));
  return m.find(v => /male|hemant|ravi|prabhat|madhur|david|mark|guy/i.test(v.name) && !/female/i.test(v.name)) || m[0] || null;
}
function browserSpeak(text) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = S.lang; u.pitch = 0.75; u.rate = 0.98;
    const v = pickVoice(); if (v) u.voice = v;
    u.onstart = () => { speaking = true; useAnalyser = false; setStatus("speaking", "बोल रहा हूँ"); };
    u.onboundary = () => { mouthEnergy = 1; };
    u.onend = u.onerror = () => { speaking = false; resolve(); };
    speechSynthesis.speak(u);
  });
}

async function speak(text) {
  if (S.key) {
    try { setStatus("thinking", "आवाज़ बन रही है"); await playPCM(await geminiTTS(text)); return; }
    catch (e) { console.warn("TTS failed, using browser voice", e); }
  }
  await browserSpeak(text);
}

/* ---------- AI brain (Gemini) ---------- */
const history = [];
function systemPrompt() {
  return `तुम्हारा नाम ${S.name} है। ${S.persona}\n` +
    `हर जवाब की शुरुआत ठीक एक भावना-टैग से करो, इनमें से कोई एक: [happy] [sad] [angry] [surprised] [blush] [thinking] [neutral]। ` +
    `टैग के बाद सीधे बोलने वाला जवाब लिखो।`;
}

async function askAI(userText) {
  history.push({ role: "user", content: userText });
  let out;
  if (S.key) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${S.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": S.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: history.slice(-14).map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    out = d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    if (!out.trim()) throw new Error("empty reply");
  } else {
    out = demoReply(userText);
  }
  history.push({ role: "assistant", content: out });
  return out;
}

function demoReply(q) {
  const s = q.toLowerCase();
  if (/नमस्ते|हैलो|हेलो|hello|hi\b/.test(s)) return "[happy] नमस्ते! मैं " + S.name + " हूँ। तुमसे मिलकर बहुत अच्छा लगा।";
  if (/नाम|name/.test(s)) return "[blush] मेरा नाम " + S.name + " है। तुम्हें पसंद आया?";
  if (/गुस्सा|angry/.test(s)) return "[angry] अब मुझे सच में गुस्सा आ रहा है!";
  if (/उदास|sad|दुख/.test(s)) return "[sad] यह सुनकर मुझे बुरा लगा यार। मैं यहीं हूँ।";
  return "[thinking] अभी डेमो मोड चल रहा है, इसलिए मैं कम बातें समझता हूँ। सेटिंग्स में Gemini की फ्री API key डालो, फिर हर बात का जवाब दूँगा।";
}

async function handleUser(text) {
  text = text.trim();
  if (!text) return;
  showCaption(text, true);
  setExpression("thinking");
  setStatus("thinking", "सोच रहा हूँ");
  let reply, errDetail = "";
  try { reply = await askAI(text); }
  catch (e) {
    console.error(e);
    errDetail = String(e.message || e);
    try { errDetail = JSON.parse(errDetail).error.message; } catch {}
    reply = "[sad] सॉरी यार, AI से जुड़ नहीं पाया। Gemini API key और मॉडल का नाम सेटिंग्स में चेक कर लो।";
  }
  const m = reply.match(/^\s*\[(\w+)\]\s*/);
  const emo = m && EXPR[m[1].toLowerCase()] ? m[1].toLowerCase() : "neutral";
  const clean = reply.replace(/\[(\w+)\]/g, "").trim();
  showCaption(errDetail ? clean + "\n\nकारण: " + errDetail.slice(0, 220) : clean, false);
  setExpression(emo);
  await speak(clean);
  setStatus("", "तैयार");
  setTimeout(() => { if (!speaking) setExpression("neutral"); }, 1200);
}

function showCaption(text, you) {
  const c = $("caption"); c.textContent = text; c.classList.toggle("you", !!you);
}

/* ---------- Speech input ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
function toggleMic() {
  if (!SR) { showCaption("यह ब्राउज़र आवाज़ पहचानना सपोर्ट नहीं करता। Chrome या Edge इस्तेमाल करें, या नीचे टाइप करें।", false); return; }
  if (listening) { rec.stop(); return; }
  stopSpeaking(); ensureAudio();
  rec = new SR(); rec.lang = S.lang; rec.interimResults = true; rec.continuous = false;
  let finalText = "";
  rec.onstart = () => { listening = true; $("mic").classList.add("on"); setStatus("listening", "सुन रहा हूँ"); setExpression("neutral"); };
  rec.onresult = (e) => {
    let interim = "";
    for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    showCaption(finalText + interim, true);
  };
  rec.onerror = (e) => { if (e.error === "not-allowed") showCaption("माइक की अनुमति दीजिए।", false); };
  rec.onend = () => {
    listening = false; $("mic").classList.remove("on");
    if (finalText.trim()) handleUser(finalText); else setStatus("", "तैयार");
  };
  rec.start();
}

/* ---------- UI wiring ---------- */
function buildChips() {
  for (const k of Object.keys(EXPR)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.e = k; b.textContent = EXPR_LABEL[k];
    b.onclick = () => setExpression(k, 5000);
    $("chips").appendChild(b);
  }
}
$("form").addEventListener("submit", (e) => { e.preventDefault(); ensureAudio(); const v = $("text").value; $("text").value = ""; handleUser(v); });
$("mic").addEventListener("click", toggleMic);

const dlg = $("settings");
function fillSettings() {
  $("sName").value = S.name; $("sLang").value = S.lang; $("sKey").value = S.key; $("sModel").value = S.model;
  $("sTts").value = S.tts; $("sVoice").value = S.voice; $("sPersona").value = S.persona;
}
$("openSettings").onclick = () => { fillSettings(); dlg.showModal(); };
$("sClose").onclick = () => dlg.close();
$("sClear").onclick = () => { history.length = 0; stopSpeaking(); showCaption("", false); setStatus("", "तैयार"); setExpression("neutral"); dlg.close(); };
$("sSave").onclick = () => {
  S = { name: $("sName").value || DEFAULTS.name, lang: $("sLang").value, key: $("sKey").value.trim(),
        model: $("sModel").value.trim() || DEFAULTS.model, tts: $("sTts").value.trim() || DEFAULTS.tts,
        voice: $("sVoice").value, persona: $("sPersona").value || DEFAULTS.persona };
  localStorage.setItem("l2d-assistant", JSON.stringify(S));
  history.length = 0;
  dlg.close();
};

buildChips();
setExpression("neutral");
initModel().catch((e) => {
  console.error(e);
  $("loading").textContent = "मॉडल लोड नहीं हो पाया। पेज को सर्वर (जैसे GitHub Pages) से खोलें, सीधे फ़ाइल से नहीं।";
});
