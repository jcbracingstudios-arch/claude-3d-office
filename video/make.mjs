// Presentation video pipeline.
//   node video/make.mjs voices            -> lists French-friendly voices + 3 samples in video/out/samples/
//   node video/make.mjs voice <voiceId>   -> narration per shot (ElevenLabs, with word timings) -> video/out/timing.json
//   node video/capture.mjs                -> frames per shot (uses timing.json for durations and lip-sync)
//   node video/make.mjs edit              -> video/out/claude-3d-office.mp4
// The ElevenLabs key is read from video/.env (ELEVENLABS_API_KEY=...) and never printed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHOTS } from './shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');
fs.mkdirSync(OUT, { recursive: true });
const FPS = 30;
const W = 1080, H = 1920;
const MODEL = 'eleven_multilingual_v2';

function apiKey() {
  const f = path.join(here, '.env');
  const m = fs.existsSync(f) && /^ELEVENLABS_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(fs.readFileSync(f, 'utf8'));
  if (!m) throw new Error('Clé absente : crée video/.env avec la ligne ELEVENLABS_API_KEY=ta_clé');
  return m[1].trim();
}

async function eleven(urlPath, body) {
  const res = await fetch(`https://api.elevenlabs.io${urlPath}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const duration = (f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));

async function tts(voiceId, text, file) {
  const r = await eleven(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    text, model_id: MODEL, voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  });
  fs.writeFileSync(file, Buffer.from(r.audio_base64, 'base64'));
  return r.alignment;
}

// Characters -> words with start/end (seconds).
export function words(al) {
  const out = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { cur = null; return; }
    if (!cur) { cur = { w: '', a: al.character_start_times_seconds[i] }; out.push(cur); }
    cur.w += ch;
    cur.b = al.character_end_times_seconds[i];
  });
  return out;
}

// Loudness per 1/30 s, normalised 0..1, for the mascot's mouth.
function talkTrack(file) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-af', `aresample=44100,asetnsamples=${44100 / FPS},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-']);
  const db = [...raw.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -90 : Number(m[1])));
  return db.map((d) => Math.round(Math.min(1, Math.max(0, (d + 42) / 30)) * 100) / 100);
}

async function voices() {
  const { voices: list } = await eleven('/v1/voices');
  const pick = list.filter((v) => /fr|french|multilingual/i.test(JSON.stringify(v.labels || {}) + v.name + (v.verified_languages ? JSON.stringify(v.verified_languages) : ''))).slice(0, 8);
  const chosen = (pick.length ? pick : list).slice(0, 3);
  fs.mkdirSync(path.join(OUT, 'samples'), { recursive: true });
  for (const v of chosen) {
    await tts(v.voice_id, SHOTS[0].line + ' ' + SHOTS[8].line, path.join(OUT, 'samples', `${v.name.replace(/[^\w-]+/g, '_')}.mp3`));
    console.log(`${v.voice_id}  ${v.name}  ${JSON.stringify(v.labels || {})}`);
  }
  console.log(`Écoute : ${path.join(OUT, 'samples')}`);
}

async function voice(voiceId) {
  const timing = {};
  for (const s of SHOTS) {
    const file = path.join(OUT, `voice_${s.id}.mp3`);
    const al = await tts(voiceId, s.line, file);
    const d = duration(file);
    timing[s.id] = { audio: file, voiceDur: d, dur: Math.max(1.6, d + 0.25), words: words(al), talk: talkTrack(file) };
    console.log(`${s.id}: ${d.toFixed(2)} s`);
  }
  fs.writeFileSync(path.join(OUT, 'timing.json'), JSON.stringify(timing, null, 1));
  const total = Object.values(timing).reduce((n, t) => n + t.dur, 0);
  console.log(`Total ${total.toFixed(1)} s`);
}

// ---------- edit ----------
const assTime = (t) => { const cs = Math.max(0, Math.round(t * 100)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assEsc = (s) => s.replace(/[{}\\]/g, '');

function captions(timing) {
  const lines = [];
  let off = 0;
  for (const s of SHOTS) {
    const t = timing[s.id];
    const light = s.card; // dark text on the light end card
    for (const w of t.words) {
      const word = assEsc(w.w.toLowerCase().replace(/[.,!?:;…«»"]+/g, ''));
      if (!word) continue;
      lines.push(`Dialogue: 0,${assTime(off + w.a)},${assTime(off + Math.max(w.b, w.a + 0.12) + 0.05)},${light ? 'Dark' : 'Word'},,0,0,0,,{\\pos(540,${light ? 1420 : 1270})\\fscx70\\fscy70\\t(0,90,\\fscx100\\fscy100)}${word}`);
    }
    if (s.toast) {
      const a = off + s.toast.at, b = off + t.dur;
      lines.push(`Dialogue: 1,${assTime(a)},${assTime(b)},Toast,,0,0,0,,{\\an7\\pos(60,110)\\fad(150,0)}{\\b1}${assEsc(s.toast.title)}{\\b0}\\N{\\c&HC8C8C8&\\fs40}${assEsc(s.toast.body)}`);
    }
    off += t.dur;
  }
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,Archivo Black,96,&H00FFFFFF,&H00FFFFFF,&H00141414,&H64000000,0,0,0,0,100,100,0,0,1,7,3,5,40,40,0,1
Style: Dark,Archivo Black,96,&H00272A2B,&H00272A2B,&H00EAF1F4,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: Toast,Segoe UI,50,&H00FFFFFF,&H00FFFFFF,&H00303030,&H1A303030,0,0,0,0,100,100,0,0,3,26,0,7,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return head + lines.join('\n') + '\n';
}

function edit() {
  const timing = JSON.parse(fs.readFileSync(path.join(OUT, 'timing.json'), 'utf8'));
  const tmp = path.join(OUT, 'parts');
  fs.mkdirSync(tmp, { recursive: true });
  const parts = [];
  const icon = path.join(here, '..', 'src-tauri', 'icons', 'icon.png');
  for (const s of SHOTS) {
    const t = timing[s.id];
    const part = path.join(tmp, `${s.id}.mp4`);
    const audio = ['-i', t.audio, '-filter_complex', null];
    if (s.card) {
      // End card: cream background, logo popping in, name and call to action.
      const vf = `[1:v]scale=420:420[logo];[0:v][logo]overlay=x=(W-w)/2:y=520:enable='gte(t,0.05)',` +
        `drawtext=fontfile='${path.join(here, 'fonts', 'ArchivoBlack-Regular.ttf').replace(/\\/g, '/').replace(':', '\\:')}':text='Claude 3D Office':fontsize=92:fontcolor=0x2B2A27:x=(w-text_w)/2:y=1010,` +
        `drawtext=fontfile='${path.join(here, 'fonts', 'ArchivoBlack-Regular.ttf').replace(/\\/g, '/').replace(':', '\\:')}':text='Tes agents Claude Code en 3D':fontsize=46:fontcolor=0xD97757:x=(w-text_w)/2:y=1130[v];` +
        `[2:a]apad,atrim=0:${t.dur}[a]`;
      run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0xF4F1EA:s=${W}x${H}:r=${FPS}:d=${t.dur}`, '-loop', '1', '-t', String(t.dur), '-i', icon,
        '-i', t.audio, '-filter_complex', vf, '-map', '[v]', '-map', '[a]', '-t', String(t.dur), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', part]);
    } else {
      audio[3] = `[1:a]apad,atrim=0:${t.dur}[a]`;
      run('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(here, 'frames', s.id, '%04d.jpg'), ...audio,
        '-map', '0:v', '-map', '[a]', '-t', String(t.dur), '-vf', `scale=${W}:${H}`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', part]);
    }
    parts.push(part);
  }
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  const joined = path.join(tmp, 'joined.mp4');
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const ass = path.join(tmp, 'captions.ass');
  fs.writeFileSync(ass, captions(timing));
  const final = path.join(OUT, 'claude-3d-office.mp4');
  // Run from the parts folder so the subtitles filter gets simple relative paths (no Windows drive colon to escape).
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'joined.mp4', '-vf', `subtitles=captions.ass:fontsdir=../../fonts`, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
    // Social platforms play around -14 LUFS: normalise the voice so it isn't quieter than other videos.
    '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', final], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`Vidéo : ${final} (${duration(final).toFixed(1)} s)`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'voices') await voices();
else if (cmd === 'voice') await voice(arg);
else if (cmd === 'edit') edit();
else console.log('Usage : node video/make.mjs voices | voice <voiceId> | edit');
