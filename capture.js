'use strict';

/**
 * Capture window: plays the picture and the sound of a capture card in a window of its own.
 * Nothing is sent anywhere – you share this window in Discord ("Fenster teilen"); Discord takes the sound of the window with it.
 * Only the video input the user picks and a sound input that belongs to a capture card are ever opened (never a microphone).
 * The only things the page asks the main process for are the update check and the Discord display (preload.js).
 *
 * Sound path: card audio input -> Web Audio (48 kHz, small buffer) -> gain (+ limiter) -> master -> output device.
 * The <video> only shows the picture. Nothing is muted for listening (a muted window would give Discord silence): the sound always
 * plays once, on the Windows default device, so nothing has to be switched on in Windows ("Listen to this device"). Whoever hears the
 * game on the TV already can choose another output in the settings (a device that is not listened to); Discord still has the sound.
 * "Schwarz" is the only mute: master gain 0.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const pic = $('pic');
  const media = navigator.mediaDevices;

  const IDLE_MS = 3000; // bars fade out after 3 s without mouse movement

  const st = {
    run: 0, stream: null, busy: false, ctx: null, analyser: null, buf: null, master: null,
    frames: 0, fpsAt: 0, fps: 0, hasAudio: false, peak: 0, timer: 0, idleTimer: 0,
    wantOn: false, deviceId: '', lostId: '', waitTimer: 0, lastFrame: 0, restartAt: 0, boost: null, limiter: null, outAnalyser: null,
    manualOff: false, modesFor: '', cams: [], maxFps: 60, startedAt: 0,
    audioProblem: '', quietSince: 0, silent: false, listening: false, // what the sound hints in the top bar are built from
  };

  /* ---------- small settings (kept between starts; every access is guarded) ---------- */

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('cf.' + key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('cf.' + key, String(value));
      } catch {
        /* storage unavailable: the setting just does not persist */
      }
    },
  };

  /* ---------- language: English unless the user chose another; the window is drawn again at once ---------- */

  const I18n = window.CfI18n;
  let lang = I18n.pick(store.get('lang', I18n.DEFAULT));
  const t = (key, params) => I18n.t(lang, key, params);

  let sinkId = store.get('sink', ''); // the output device ('' = Windows default), chosen in the settings
  let sourceId = ''; // the sound input chosen at the bottom ('' = by itself: the one of the capture card); not kept, the card is found again each time
  let blackout = false;
  let presenceOn = store.get('presence', '0') === '1'; // the Discord display: off until the user switches it on

  /* resolution the user asks the card for (Auto = 1080p at the best frame rate) */
  const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], '4k': [3840, 2160] };
  const RES_NAME = { 720: '720p', 1080: '1080p', 1440: '1440p', '4k': '4K' };
  const LIMIT_DB = -3; // the limiter that works when the sound is turned up
  const LIMIT_RATIO = 20;
  const SILENT_DB = -42; // the card's own hiss peaks at about -47 dB; a menu click at about -36 dB: at or below -42 dB nothing real arrives
  const SILENT_MS = 8000; // so long only silence: the window says what to check
  const clampInt = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  let resChoice = RES[store.get('res', 'auto')] || store.get('res', 'auto') === 'custom' ? store.get('res', 'auto') : 'auto';
  let customRes = [clampInt(store.get('resW', '1920'), 160, 7680, 1920), clampInt(store.get('resH', '1080'), 120, 4320, 1080)];
  const FPS_STEPS = [24, 30, 60, 90, 100, 120, 144, 165, 200, 240]; // frame rates that can be chosen (those above 60 only when the card has them)
  let fpsChoice = FPS_STEPS.includes(Number(store.get('fps', '60'))) ? Number(store.get('fps', '60')) : 60; // 60 unless chosen otherwise
  const wantSize = () => (resChoice === 'custom' ? customRes : RES[resChoice] || null); // null = Auto
  const sizeName = (h) => (h >= 2100 ? '4K' : `${h}p`);
  let boostDb = clampInt(store.get('boost', '0'), -12, 24, 0); // sound gain in dB
  const look = { bright: clampInt(store.get('bright', '50'), 0, 100, 50), contrast: clampInt(store.get('contrast', '50'), 0, 100, 50), hue: clampInt(store.get('hue', '50'), 0, 100, 50), sat: clampInt(store.get('sat', '50'), 0, 100, 50) };
  st.flip = store.get('flip', '0') === '1'; // mirror vertically
  st.flipH = store.get('flipH', '0') === '1'; // mirror horizontally
  st.modes = null; // what the card offers right now: [{ h, fps }], read by itself when the card is found and by the button "Neu erkennen"

  /* ---------- device lists ---------- */

  async function inputs() {
    return (await media.enumerateDevices()).filter((d) => d.deviceId);
  }

  function fillSelect(select, items, placeholder) {
    const keep = select.value;
    select.replaceChildren(
      ...[placeholder, ...items].filter(Boolean).map(({ value, label }) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        return o;
      })
    );
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  }

  async function fillDevices() {
    const all = await inputs();
    const cams = all.filter((d) => d.kind === 'videoinput');
    st.cams = cams;
    const select = $('device');
    const keep = select.value;
    select.replaceChildren(
      ...cams.map((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || t('dev.video', { n: i + 1 });
        return o;
      })
    );
    if (!cams.length) {
      const o = document.createElement('option');
      o.textContent = t('dev.none');
      o.value = '';
      select.append(o);
    }
    if (cams.some((d) => d.deviceId === keep)) select.value = keep;
    $('btnBig').disabled = $('btnPower').disabled = !cams.length;

    fillSources(all);
    // outputs that can be chosen in the settings (the virtual "default"/"communications" entries are no real choice)
    const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    fillSelect($('sink'), outs.map((d, i) => ({ value: d.deviceId, label: d.label || t('dev.out', { n: i + 1 }) })), { value: '', label: t('sink.none') });
    if (!outs.some((d) => d.deviceId === sinkId)) sinkId = '';
    $('sink').value = sinkId;
    return cams;
  }

  /** The sound inputs that can be chosen: only those that belong to a capture card, never a microphone (plus the one of the picture input shown). */
  function soundInputs(all, videoId) {
    const own = all.filter((d) => d.kind === 'videoinput' && (d.deviceId === videoId || !['webcam', 'virtual'].includes(window.CfCardDetect.classify(d.label))));
    const found = own.map((d) => window.CfCardMatch.matchAudioInput(d, all)).filter(Boolean);
    return [...new Map(found.map((d) => [d.deviceId, d])).values()];
  }

  /** The sound input in use: the one chosen at the bottom, else (by itself) the one that belongs to the picture input. */
  function pickSound(videoId, all) {
    return soundInputs(all, videoId).find((d) => d.deviceId === sourceId) || window.CfCardMatch.matchAudioInput(all.find((d) => d.kind === 'videoinput' && d.deviceId === videoId), all);
  }

  function fillSources(all) {
    const videoId = $('device').value;
    const now = pickSound(videoId, all);
    fillSelect($('source'), soundInputs(all, videoId).map((d, i) => ({ value: d.deviceId, label: d.label || t('dev.in', { n: i + 1 }) })), now ? null : { value: '', label: t('source.none') });
    $('source').value = now ? now.deviceId : '';
  }

  /* ---------- on / off ---------- */

  let offView = { title: 'off.title', hint: 'off.hint', params: {}, error: false };

  function renderOff() {
    $('offTitle').textContent = t(offView.title, offView.params);
    $('offHint').textContent = t(offView.hint, offView.params);
    $('offScreen').classList.toggle('error', offView.error);
    $('btnBig').textContent = t(offView.error ? 'off.btnRetry' : 'off.btn');
  }

  /** The off screen says what is the matter; it is given as keys of the words so that it can be drawn again in another language. */
  function showOff(title, hint, params = {}, error = false) {
    offView = { title, hint, params, error };
    renderOff();
  }

  async function start() {
    if (st.stream || st.busy) return;
    const deviceId = $('device').value;
    if (!deviceId) return;
    st.busy = true;
    $('btnBig').disabled = $('btnPower').disabled = true;
    let tracks = []; // opened so far: stopped again when the start fails half way (else the card stays busy)
    try {
      const list = await inputs();
      const cam = list.find((d) => d.kind === 'videoinput' && d.deviceId === deviceId);
      const picture = await openPicture(deviceId);
      tracks = picture.getTracks();
      noteCapabilities(picture.getVideoTracks()[0]);
      const cardAudio = pickSound(deviceId, list); // only a sound input that belongs to a capture card; no other input (microphone) is ever opened
      fillSources(list); // shows the sound input that is used (the names of the devices are known now)
      st.audioProblem = cardAudio ? '' : 'none';
      if (cardAudio) {
        try {
          // raw 48 kHz sound: no echo cancellation, noise suppression or level control (that is for voices)
          const sound = await media.getUserMedia({
            audio: { deviceId: { exact: cardAudio.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: { ideal: 48000 }, latency: { ideal: 0.01 } },
          });
          tracks.push(...sound.getAudioTracks());
        } catch (err) {
          console.warn('card audio failed', err && err.name);
          st.audioProblem = 'failed'; // most often Windows keeps desktop programs from the microphone, or another program uses the input
        }
      }
      st.stream = new MediaStream(tracks);
      st.hasAudio = tracks.some((t) => t.kind === 'audio');
      tracks[0].addEventListener('ended', connectionLost);
      st.wantOn = true;
      st.deviceId = deviceId; // the device list may be rebuilt before the card is noticed as gone
      st.lastFrame = st.startedAt = performance.now();
      clearInterval(st.waitTimer);
      document.body.dataset.waiting = '0';
      pic.srcObject = new MediaStream(st.stream.getVideoTracks()); // picture only: the sound goes through Web Audio
      await pic.play();
      document.body.classList.remove('is-off');
      layout();
      startMeters();
      checkListening(cardAudio && st.hasAudio ? cardAudio.label : '');
      wake();
      rememberCard(deviceId);
      sendPresence();
    } catch (err) {
      if (!st.stream) tracks.forEach((t) => t.stop());
      stop(err && err.name === 'NotReadableError' ? 'off.busy' : 'off.failed', true, false, { error: err && err.message ? err.message : String(err) });
    } finally {
      st.busy = false;
      $('btnBig').disabled = $('btnPower').disabled = !$('device').value;
    }
  }

  /**
   * Windows plays the card's sound by itself when "Listen to this device" is on for it: then everything is heard twice (and the hiss
   * of the card even without this program). The program only reads that setting (listen.js) and says it; no answer or trouble: nothing is said.
   */
  async function checkListening(label) {
    const run = st.run;
    st.listening = false;
    if (!label || !window.cfAudio) return;
    const yes = await window.cfAudio.listening(label).catch(() => false);
    if (run !== st.run || !st.stream) return; // switched off or started again meanwhile
    st.listening = yes === true;
    updateHint();
  }

  /**
   * Asks the card for the chosen size and frame rate (60 unless chosen otherwise). Steps, first that works wins:
   *  1. the size, strictly, with at least about the wanted frame rate  (Auto: 1080p, then 720p)
   *  2. the same size, with whatever frame rate the card has there (the top bar then says it is slower)
   *  3. loosely, the nearest the card has
   * Strict sizes mean a chosen "1080p" really is 1080p instead of some 1280x1024 mode that merely has more frames.
   */
  async function openPicture(deviceId) {
    const base = { deviceId: { exact: deviceId } };
    const fps = effectiveFps(); // never more than the card has at this size
    const strict = (w, h, minFps) =>
      media.getUserMedia({ video: { ...base, width: { min: w, ideal: w }, height: { min: h, ideal: h }, frameRate: minFps ? { min: minFps, ideal: fps } : { ideal: fps } } });
    const want = wantSize();
    const sizes = want ? [want] : [RES[1080], RES[720]];
    const minFps = Math.max(1, fps - 10);
    const attempts = [...sizes.map(([w, h]) => [w, h, minFps]), ...sizes.map(([w, h]) => [w, h, 0])];
    for (const [w, h, f] of attempts) {
      try {
        return await strict(w, h, f);
      } catch (err) {
        if (!err || err.name !== 'OverconstrainedError') throw err; // a busy or unplugged card is a different problem
      }
    }
    const [w, h] = want || RES[1080];
    return media.getUserMedia({ video: { ...base, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps } } });
  }

  /** What the card can deliver at most (known once it is open): sizes it cannot do are marked in the list. */
  function noteCapabilities(track) {
    if (st.modes && st.modesFor === (track && track.getSettings ? track.getSettings().deviceId : '')) return; // the exact modes of this card were read already
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    const maxH = caps.height && caps.height.max ? caps.height.max : 0;
    document.body.dataset.maxh = String(maxH);
    st.maxFps = Math.max(60, caps.frameRate && caps.frameRate.max ? Math.floor(caps.frameRate.max) : 0); // the highest rate of any size: offered in the list
    showFpsOptions();
    refreshResOptions();
  }

  function stop(hint, error = false, keepWanting = false, params = {}) {
    if (!keepWanting) {
      st.wantOn = false;
      st.lostId = '';
      clearInterval(st.waitTimer);
      document.body.dataset.waiting = '0';
    }
    document.body.classList.remove('no-signal');
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
    st.stream = null;
    st.hasAudio = false;
    st.listening = st.silent = false;
    st.quietSince = 0;
    pic.srcObject = null;
    stopMeters();
    document.body.classList.add('is-off');
    showOff(error ? 'off.stopped' : 'off.title', hint || 'off.hint', params, error);
    sendPresence();
  }

  /** Switching off by hand sticks: the card is not switched on again by itself until it is plugged in again. */
  const toggle = () => {
    if (st.stream) {
      st.manualOff = true;
      stop();
    } else {
      st.manualOff = false;
      start();
    }
  };

  /** The card was unplugged (or went away): wait for it and open it again by itself. Switching off by hand never does this. */
  function connectionLost() {
    if (!st.stream) return;
    st.lostId = st.deviceId;
    stop('off.lost', true, true);
    document.body.dataset.waiting = '1';
    clearInterval(st.waitTimer);
    st.waitTimer = setInterval(tryReconnect, 2000);
  }

  async function tryReconnect() {
    if (!st.wantOn || st.stream || st.busy || !st.lostId) return;
    const cams = await fillDevices().catch(() => []);
    if (!cams.some((d) => d.deviceId === st.lostId)) return;
    $('device').value = st.lostId;
    await start();
  }

  /* ---------- finding the card by itself ---------- */

  let knownIds = null; // the video inputs seen at the last look (null = nothing seen yet)

  function rememberedCard() {
    try {
      return JSON.parse(store.get('card', 'null'));
    } catch {
      return null;
    }
  }

  /** The card that ran is remembered (a card with a name nobody can recognize is found again that way); webcams never are. */
  function rememberCard(deviceId) {
    const d = st.cams.find((c) => c.deviceId === deviceId);
    if (d && !['webcam', 'virtual'].includes(window.CfCardDetect.classify(d.label))) store.set('card', JSON.stringify({ id: d.deviceId, label: d.label }));
  }

  let cardView = { device: null, why: '' };

  function renderCard() {
    const { device, why } = cardView;
    $('cardName').textContent = device ? `${device.label || t('card.input')}${why ? ` · ${t('card.why.' + why)}` : ''}` : t('card.none');
    document.body.dataset.cardWhy = device ? why || '' : '';
  }

  function showCard(device, why) {
    cardView = { device, why: why || '' };
    renderCard();
  }

  /**
   * Looks at the video inputs at the start and whenever devices come or go. The card is chosen by itself. A card that has just shown
   * up (or is there at the start) is then read (modes) and switched on, unless it was switched off by hand and not plugged in again.
   * Webcams and virtual cameras are never switched on by themselves.
   */
  async function detectCard() {
    const cams = st.cams;
    const first = knownIds === null;
    const arrived = cams.filter((d) => first || !knownIds.has(d.deviceId));
    knownIds = new Set(cams.map((d) => d.deviceId));
    if (st.stream || st.busy || st.wantOn) return; // running, starting or reconnecting: leave it alone
    if (!cams.length) {
      showCard(null);
      showOff('off.noCard', 'off.noCardHint');
      return;
    }
    if (!arrived.length) return;
    const pick = window.CfCardDetect.pickCard(cams, rememberedCard());
    $('device').value = pick.device.deviceId;
    fillSources(await inputs()); // the sound input of this card
    showCard(pick.device, pick.why === 'none' ? '' : pick.why);
    if (st.modesFor !== pick.device.deviceId) resetModes(); // what is shown belongs to another card
    const known = st.modesFor === pick.device.deviceId || useSavedModes(pick.device); // the same card as before: its modes are known
    const justThere = arrived.some((d) => d.deviceId === pick.device.deviceId);
    if (justThere) st.manualOff = false; // plugged in again: automatic again
    if (!pick.auto || !justThere || st.manualOff) return;
    if (known) {
      showOff('off.detected', 'off.go', { name: pick.device.label || t('card.input') });
    } else {
      showOff('off.detected', 'off.reading', { name: pick.device.label || t('card.input') });
      await probeModes(); // a new card: the picture is not running yet, so it can be read first
    }
    if (!st.stream && !st.busy && !st.manualOff && $('device').value === pick.device.deviceId) await start();
  }

  /* ---------- sound: Web Audio path, output routing, level, picture info ---------- */

  function buildAudio() {
    if (!st.hasAudio) return;
    // same 48 kHz as the card's USB audio: no resampling (that is where crackling comes from); small buffer: little delay
    st.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const source = st.ctx.createMediaStreamSource(new MediaStream(st.stream.getAudioTracks()));
    st.analyser = st.ctx.createAnalyser(); // only measures the card's level
    st.analyser.fftSize = 1024;
    st.buf = new Float32Array(st.analyser.fftSize);
    st.boost = st.ctx.createGain();
    st.limiter = st.ctx.createDynamicsCompressor(); // protects against clipping when the sound is turned up
    st.limiter.threshold.value = LIMIT_DB;
    st.limiter.knee.value = 0;
    st.limiter.ratio.value = LIMIT_RATIO;
    st.limiter.attack.value = 0.003;
    st.limiter.release.value = 0.1;
    // Chromium adds a make-up gain of 0.6 * |threshold| * (1 - 1/ratio) dB to every compressor; this takes it out again, so the slider is exact
    st.trim = st.ctx.createGain();
    st.trim.gain.value = 10 ** ((-0.6 * -LIMIT_DB * (1 - 1 / LIMIT_RATIO)) / 20);
    st.outAnalyser = st.ctx.createAnalyser(); // the level after the gain
    st.outAnalyser.fftSize = 1024;
    st.master = st.ctx.createGain();
    source.connect(st.analyser);
    source.connect(st.boost);
    st.master.connect(st.ctx.destination); // boost (and the limiter) are wired in applyBoost
    applyBoost();
    applyMaster();
    st.ctx.resume().catch(() => {});
    routeOutput();
    document.body.dataset.rate = String(st.ctx.sampleRate);
  }

  /** Gain in dB. Up to 0 dB the sound goes straight through (the limiter adds a few ms and is only used when turning it up). */
  function applyBoost() {
    $('boost').value = String(boostDb);
    $('boostOut').textContent = `${boostDb > 0 ? '+' : ''}${boostDb} dB`;
    document.body.dataset.boost = String(boostDb);
    const gain = 10 ** (boostDb / 20);
    document.body.dataset.gain = gain.toFixed(3);
    store.set('boost', boostDb);
    if (!st.boost) return;
    st.boost.gain.value = gain;
    st.boost.disconnect();
    st.limiter.disconnect();
    st.trim.disconnect();
    const last = boostDb > 0 ? st.trim : st.boost;
    if (last === st.trim) {
      st.boost.connect(st.limiter);
      st.limiter.connect(st.trim);
    }
    last.connect(st.master);
    last.connect(st.outAnalyser); // measures what really leaves
  }

  function applyMaster() {
    document.body.dataset.master = blackout ? '0' : '1'; // the only thing that ever silences the sound
    if (st.master) st.master.gain.value = blackout ? 0 : 1;
  }

  /** The sound goes to the output chosen in the settings (or, with none chosen, the Windows default); nothing is ever muted for it. */
  async function routeOutput() {
    const target = sinkId; // '' = Windows default
    if (st.ctx && st.ctx.setSinkId) {
      try {
        await st.ctx.setSinkId(target);
      } catch (err) {
        console.warn('setSinkId failed', err && err.name);
        if (target !== '') await st.ctx.setSinkId('').catch(() => {});
      }
    }
    document.body.dataset.sink = st.ctx ? (typeof st.ctx.sinkId === 'string' ? st.ctx.sinkId : 'none') : target;
    updateHint();
  }

  /** The hint in the top bar: no sound from the card, Windows playing it as well, or only silence arriving. */
  let level = -90; // the card's level, shown by the bar at the bottom
  function updateHint() {
    // the most important first: no sound input at all, Windows playing the sound as well, only silence arriving
    const text = !st.stream
      ? ''
      : !st.hasAudio
        ? st.audioProblem === 'failed'
          ? t('hint.audioFailed')
          : t('hint.noAudio')
        : st.listening
          ? t('hint.listening')
          : st.silent
            ? t('hint.silent')
            : '';
    document.body.dataset.silent = st.silent ? '1' : '0';
    document.body.dataset.listening = st.listening ? '1' : '0';
    const hint = $('stHint');
    hint.textContent = text;
    hint.classList.toggle('hidden', !text);
    syncTop();
  }

  /** The top bar stays for warnings even when the statistics are off; with nothing to say it is gone. */
  function syncTop() {
    document.body.classList.toggle('no-warn', $('stHint').classList.contains('hidden') && $('stReq').classList.contains('hidden'));
  }

  function startMeters() {
    stopMeters();
    buildAudio();
    st.frames = 0;
    st.fpsAt = performance.now();
    const run = st.run;
    const onFrame = () => {
      if (run !== st.run || !st.stream) return; // a frame loop of an earlier start must not keep counting
      st.frames++;
      st.lastFrame = performance.now();
      pic.requestVideoFrameCallback(onFrame);
    };
    pic.requestVideoFrameCallback(onFrame);
    st.timer = setInterval(tick, 100);
  }

  function stopMeters() {
    st.run++;
    clearInterval(st.timer);
    if (st.ctx) st.ctx.close().catch(() => {});
    st.ctx = st.analyser = st.buf = st.master = st.boost = st.limiter = st.trim = st.outAnalyser = null;
    $('meterFill').style.transform = 'scaleX(0)';
    level = -90;
    updateHint();
  }

  const resLabel = (h) => (h >= 2100 ? '4K' : `${h}p`);

  /*
   * Picture levels. A card often delivers its picture "limited" (black at 16, white at 235): it then looks grey and washed out.
   * The picture is always corrected (16-235 stretched to 0-255, the filter #cfRange of the page), so its colours never change by themselves.
   */

  function tick() {
    let peak = 0;
    if (st.analyser) {
      st.analyser.getFloatTimeDomainData(st.buf);
      for (const v of st.buf) peak = Math.max(peak, Math.abs(v));
    }
    if (st.outAnalyser) {
      const out = new Float32Array(st.outAnalyser.fftSize);
      st.outAnalyser.getFloatTimeDomainData(out);
      let op = 0;
      for (const v of out) op = Math.max(op, Math.abs(v));
      st.outPeak = Math.max(op, (st.outPeak || 0) * 0.85);
      document.body.dataset.outdb = st.outPeak > 0.00003 ? (20 * Math.log10(st.outPeak)).toFixed(1) : '-90';
    }
    st.peak = Math.max(peak, st.peak * 0.85); // quick rise, smooth fall
    level = st.peak > 0.00003 ? 20 * Math.log10(st.peak) : -90;
    $('meterFill').style.transform = `scaleX(${Math.min(1, Math.max(0, (level + 60) / 60)).toFixed(3)})`;

    const now = performance.now();
    // only silence arrives from the card (while the picture runs): after a while the window says what to check
    const quietNow = st.hasAudio && !blackout && !document.body.classList.contains('no-signal') && level <= SILENT_DB;
    st.quietSince = quietNow ? st.quietSince || now : 0;
    st.silent = quietNow && now - st.quietSince > SILENT_MS;
    // no new frame for a while: say so, and open the card again if it stays that way (a card that lost its signal often needs that)
    const quiet = st.stream && !document.hidden && !blackout ? now - st.lastFrame : 0; // the hidden picture of the private mode delivers no frames: that is no lost signal
    document.body.classList.toggle('no-signal', quiet > 1500);
    if (quiet > 6000 && now - st.restartAt > 15000) {
      st.restartAt = now;
      restartStream();
    }
    if (now - st.fpsAt >= 1000) {
      st.fps = (st.frames * 1000) / (now - st.fpsAt);
      st.frames = 0;
      st.fpsAt = now;
      const s = st.stream && st.stream.getVideoTracks()[0] ? st.stream.getVideoTracks()[0].getSettings() : {};
      $('stLive').textContent = document.body.classList.contains('no-signal') ? t('stat.noSignal') : s.height ? `${resLabel(s.height)} • ${Math.round(st.fps)} FPS` : '–';
      const want = wantSize();
      const sizeShort = Boolean(want && s.height && s.height < want[1] * 0.9);
      // what really arrives (counted), not what was asked: the card may offer more than the source, the USB port or the PC can carry
      const live = Math.round(st.fps);
      const settled = now - st.startedAt > 4000 && !document.hidden && live > 0;
      const wantFps = effectiveFps();
      const fpsShort = Boolean(!sizeShort && s.height && settled && live < wantFps * 0.85);
      $('stReq').textContent = sizeShort
        ? t('stat.size', { want: sizeName(want[1]), got: sizeName(s.height) })
        : fpsShort
          ? t('stat.fps', { want: wantFps, got: live })
          : '';
      $('stReq').classList.toggle('hidden', !(sizeShort || fpsShort));
      document.body.dataset.delivered = s.width ? `${s.width}x${s.height}@${Math.round(s.frameRate || 0)}` : '';
    }
    updateHint();
  }

  /** The picture always fits the window completely (like OBS, 100 %): nothing is cut off, nothing is zoomed. */
  function layout() {
    const vw = pic.videoWidth;
    const vh = pic.videoHeight;
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    if (!vw || !vh || !ww || !wh) return;
    const s0 = Math.min(ww / vw, wh / vh);
    pic.style.width = `${vw * s0}px`;
    pic.style.height = `${vh * s0}px`;
    const scale = st.flip || st.flipH ? `scale(${st.flipH ? -1 : 1}, ${st.flip ? -1 : 1})` : 'scale(1)';
    pic.style.transform = `translate(-50%, -50%) ${scale}`;
  }

  /* ---------- settings panel (like OBS "Eigenschaften") ---------- */

  /** The statistics at the top: on or off (kept between starts). */
  function applyStats(on) {
    document.body.classList.toggle('no-stats', !on);
    $('statsOn').checked = on;
    store.set('stats', on ? '1' : '0');
    document.body.dataset.stats = on ? '1' : '0';
  }

  async function restartStream() {
    if (!st.stream && !st.busy) return; // switched off: the new setting is used at the next start
    while (st.busy) await new Promise((r) => setTimeout(r, 50)); // a start in progress finishes first
    stop();
    await start(); // a new size or frame rate needs the card to be opened again
  }

  /** Brightness, contrast, hue and saturation as on the OBS sliders (0-100, 50 = unchanged), applied to the picture that is shared. */
  function applyLook() {
    const f = (v) => 0.4 + 1.2 * (v / 100);
    const neutral = look.bright === 50 && look.contrast === 50 && look.hue === 50 && look.sat === 50;
    const range = 'url(#cfRange) '; // the correction of the levels of the card, always first
    pic.style.filter = neutral
      ? range.trim()
      : `${range}brightness(${f(look.bright).toFixed(3)}) contrast(${f(look.contrast).toFixed(3)}) saturate(${(look.sat / 50).toFixed(3)}) hue-rotate(${((look.hue - 50) * 3.6).toFixed(1)}deg)`;
    for (const [id, key] of [['bright', 'bright'], ['contrast', 'contrast'], ['hue', 'hue'], ['sat', 'sat']]) {
      $(id).value = String(look[key]);
      $(id + 'Out').textContent = String(look[key]);
      store.set(id, look[key]);
    }
    document.body.dataset.look = `${look.bright}/${look.contrast}/${look.hue}/${look.sat}`;
  }

  function applyFlip() {
    $('flip').checked = st.flip;
    $('flipH').checked = st.flipH;
    store.set('flip', st.flip ? '1' : '0');
    store.set('flipH', st.flipH ? '1' : '0');
    document.body.dataset.flip = st.flip ? '1' : '0';
    document.body.dataset.fliph = st.flipH ? '1' : '0';
    layout();
  }

  const SIZES = [[3840, 2160], [2560, 1440], [1920, 1080], [1280, 720], [640, 480]]; // the sizes that are asked of the card
  const TIERS = [360, 240, 200, 165, 144, 120, 100, 90, 60, 30]; // frame rates tried per size, highest first: the first that works is what the card offers there

  /**
   * The highest frame rate the card has at the chosen size, from what was read (the nearest size if the chosen one is not offered).
   * Auto asks for 1080p, then 720p. Without a reading: the highest the card has at all.
   */
  function maxFpsFor() {
    const modes = st.modes && st.modesFor === $('device').value ? st.modes : null;
    if (!modes || !modes.length) return st.maxFps;
    const want = wantSize();
    const wantH = want ? want[1] : modes.some((f) => f.h === 1080) ? 1080 : 720;
    const near = modes.reduce((best, f) => (Math.abs(f.h - wantH) < Math.abs(best.h - wantH) ? f : best), modes[0]);
    return near.fps;
  }

  /** The frame rates that can be chosen at this size: the steps up to what the card has there. */
  function fpsSteps() {
    const max = maxFpsFor();
    const steps = FPS_STEPS.filter((n) => n <= max);
    return steps.length ? steps : [Math.max(1, Math.floor(max))];
  }

  /** What is really asked: the wish, but never more than the card has at this size (the wish stays, so it is back at a size that can do it). */
  function effectiveFps() {
    const steps = fpsSteps();
    return [...steps].reverse().find((n) => n <= fpsChoice) || steps[0];
  }

  function showFpsOptions() {
    const steps = fpsSteps().slice().reverse();
    $('fps').replaceChildren(
      ...steps.map((n) => {
        const o = document.createElement('option');
        o.value = String(n);
        o.textContent = n === 60 ? t('fps.std', { n }) : `${n} FPS`;
        return o;
      })
    );
    $('fps').value = String(effectiveFps());
    document.body.dataset.fps = String(effectiveFps());
  }

  /** The names of the sizes in the list of resolutions, with what the card can do there. */
  function refreshResOptions() {
    const maxH = Number(document.body.dataset.maxh) || 0;
    const read = st.modes && st.modesFor === $('device').value ? st.modes : null;
    for (const o of $('res').options) {
      if (o.value === 'auto') o.textContent = t('res.auto');
      else if (o.value === 'custom') o.textContent = t('res.custom');
      else {
        const name = RES_NAME[o.value];
        const m = read ? read.find((f) => f.h === RES[o.value][1]) : null;
        o.textContent = read ? (m ? t('res.upTo', { name, fps: m.fps }) : t('res.na', { name })) : maxH && maxH < RES[o.value][1] * 0.9 ? t('res.max', { name, h: resLabel(maxH) }) : name;
      }
    }
  }

  /** The modes as a list: one row per size with its frame rate, or "not available". Without a result, only the note is shown. */
  let modesView = { found: null, note: null, savedAt: 0 };

  function showModes(found, note, savedAt) {
    modesView = { found, note: note || null, savedAt: savedAt || 0 };
    const box = $('modes');
    box.replaceChildren();
    const saved = savedAt ? t('modes.saved', { date: new Date(savedAt).toLocaleDateString(lang) }) : '';
    $('modesNote').textContent = note
      ? t(note.key, note.params)
      : found
        ? found.length
          ? saved + t('modes.ok')
          : t('modes.none')
        : t('modes.not');
    if (!found || !found.length) return;
    for (const [w, h] of SIZES) {
      const m = found.find((f) => f.h === h);
      const row = document.createElement('div');
      row.className = m ? 'mode-row' : 'mode-row na';
      const res = document.createElement('span');
      res.className = 'mode-res';
      res.textContent = sizeName(h);
      const dim = document.createElement('small');
      dim.textContent = `${w} × ${h}`;
      res.append(dim);
      const fps = document.createElement('span');
      fps.className = 'mode-fps';
      fps.textContent = m ? `${m.fps} FPS` : t('modes.na');
      row.append(res, fps);
      box.append(row);
    }
  }

  /** Another card was chosen: what was read from the old one no longer applies. */
  function resetModes() {
    st.modes = null;
    st.modesFor = '';
    st.maxFps = 60;
    showFpsOptions();
    document.body.dataset.modes = '';
    refreshResOptions();
    showModes(null);
  }

  /** Makes these modes the ones of this card: the list, the sizes with their frame rates, the frame rates to choose from. */
  function applyModes(found, deviceId, savedAt) {
    st.modes = found;
    st.modesFor = deviceId;
    st.maxFps = Math.max(60, ...found.map((f) => f.fps));
    showFpsOptions();
    showModes(found, '', savedAt);
    document.body.dataset.modes = found.map((f) => `${f.h}@${f.fps}`).join(',');
    refreshResOptions();
  }

  /*
   * What was read from a card is kept, by the name of the card (it contains the USB id, so another card has another name).
   * The same card is not read again at every start; another card is read in full; "Neu erkennen" reads again and replaces it.
   */
  const MODES_FORMAT = 1; // raise it when the way the modes are read changes: older entries are then ignored
  const MODES_KEPT = 8; // cards remembered (the oldest go first)
  const validMode = (m) => Boolean(m) && Number.isInteger(m.h) && m.h > 0 && Number.isFinite(m.fps) && m.fps > 0 && m.fps <= 1000;

  function savedModes() {
    try {
      const all = JSON.parse(store.get('modes', '{}'));
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
      return {};
    }
  }

  function saveModes(label, found) {
    if (!label || !found.length) return; // nothing to remember without a name or a result (no signal, card busy): the next start reads again
    const all = savedModes();
    all[label] = { f: MODES_FORMAT, at: Date.now(), modes: found };
    const newest = Object.entries(all).filter(([, e]) => e && Number.isFinite(e.at)).sort((a, b) => b[1].at - a[1].at).slice(0, MODES_KEPT);
    store.set('modes', JSON.stringify(Object.fromEntries(newest)));
  }

  /** Shows the modes kept for this card. @returns {boolean} false when there are none (or they are not usable): the card has to be read. */
  function useSavedModes(device) {
    const e = device && device.label ? savedModes()[device.label] : null;
    if (!e || e.f !== MODES_FORMAT || !Number.isFinite(e.at) || !Array.isArray(e.modes) || !e.modes.length || !e.modes.every(validMode)) return false;
    applyModes(e.modes, device.deviceId, e.at);
    return true;
  }

  /**
   * Reads what the card offers right now (it announces its modes according to the HDMI signal): every size is tried strictly with
   * at least 55, else at least 25 frames. Needs the card for a moment, so a running picture stops and comes back.
   * Runs by itself when the card is found, and again with the button "Neu erkennen".
   */
  async function probeModes() {
    const deviceId = $('device').value;
    if (!deviceId) return;
    while (st.busy) await new Promise((r) => setTimeout(r, 50)); // a start in progress finishes first
    const wasOn = Boolean(st.stream);
    if (wasOn) stop();
    st.busy = true; // nobody opens the card while it is being read
    $('btnBig').disabled = $('btnPower').disabled = $('btnProbe').disabled = true;
    showModes(null, { key: 'modes.reading' });
    const found = [];
    let problem = null;
    try {
      for (const [w, h] of SIZES) {
        for (const tier of TIERS) {
          try {
            const s = await media.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { exact: w }, height: { exact: h }, frameRate: { min: tier - 5, ideal: tier } } });
            const got = Math.round(s.getVideoTracks()[0].getSettings().frameRate || tier); // the rate the card really chose (59.94 is 60)
            s.getTracks().forEach((t) => t.stop());
            found.push({ h, fps: got });
            await new Promise((r) => setTimeout(r, 250)); // the card needs a moment to be free again
            break;
          } catch (err) {
            if (err && err.name !== 'OverconstrainedError') throw err;
          }
        }
      }
    } catch (err) {
      problem = err && err.name === 'NotReadableError' ? { key: 'modes.busy' } : { key: 'modes.failed', params: { error: err && err.message ? err.message : String(err) } };
    }
    st.busy = false;
    $('btnBig').disabled = $('btnPower').disabled = !$('device').value;
    $('btnProbe').disabled = false;
    if ($('device').value !== deviceId) {
      showModes(null); // another card was chosen while reading: this result is not for it
    } else if (problem) {
      showModes(null, problem);
    } else {
      applyModes(found, deviceId);
      const cam = st.cams.find((d) => d.deviceId === deviceId);
      saveModes(cam && cam.label, found);
    }
    if (wasOn) await start();
  }

  function showResolution() {
    showFpsOptions();
    $('res').value = resChoice;
    $('customRes').classList.toggle('hidden', resChoice !== 'custom');
    $('resW').value = String(customRes[0]);
    $('resH').value = String(customRes[1]);
    document.body.dataset.res = resChoice === 'custom' ? `${customRes[0]}x${customRes[1]}` : resChoice;
  }

  function togglePanel(open = $('panel').classList.contains('hidden')) {
    $('panel').classList.toggle('hidden', !open);
    $('btnSettings').classList.toggle('pressed', open);
  }

  function bindSettings() {
    const chooseRes = async () => {
      resChoice = $('res').value;
      store.set('res', resChoice);
      showResolution();
      await restartStream();
    };
    const chooseCustom = async () => {
      customRes = [clampInt($('resW').value, 160, 7680, customRes[0]), clampInt($('resH').value, 120, 4320, customRes[1])];
      store.set('resW', customRes[0]);
      store.set('resH', customRes[1]);
      showResolution();
      await restartStream();
    };
    $('res').addEventListener('change', chooseRes);
    $('resW').addEventListener('change', chooseCustom);
    $('resH').addEventListener('change', chooseCustom);
    $('fps').addEventListener('change', async () => {
      fpsChoice = Number($('fps').value);
      store.set('fps', fpsChoice);
      showResolution();
      await restartStream();
    });
    for (const key of ['bright', 'contrast', 'hue', 'sat']) {
      $(key).addEventListener('input', () => {
        look[key] = clampInt($(key).value, 0, 100, 50);
        applyLook();
      });
      $(key).addEventListener('dblclick', () => {
        look[key] = 50;
        applyLook();
      });
    }
    $('flip').addEventListener('change', () => {
      st.flip = $('flip').checked;
      applyFlip();
    });
    $('flipH').addEventListener('change', () => {
      st.flipH = $('flipH').checked;
      applyFlip();
    });
    $('btnProbe').addEventListener('click', probeModes);
    $('boost').addEventListener('input', () => {
      boostDb = clampInt($('boost').value, -12, 24, 0);
      applyBoost();
    });
    $('boost').addEventListener('dblclick', () => {
      boostDb = 0;
      applyBoost();
    });
    $('btnPanelDefault').addEventListener('click', async () => {
      boostDb = 0;
      resChoice = 'auto';
      fpsChoice = 60;
      st.flip = false;
      st.flipH = false;
      Object.assign(look, { bright: 50, contrast: 50, hue: 50, sat: 50 });
      for (const [k, v] of [['res', 'auto'], ['fps', 60]]) store.set(k, v);
      showResolution();
      applyBoost();
      applyLook();
      applyFlip();
      await restartStream();
    });
    $('btnSettings').addEventListener('click', () => togglePanel());
    $('statsOn').addEventListener('change', () => applyStats($('statsOn').checked));
    applyStats(store.get('stats', '0') === '1');
    showResolution();
    applyBoost();
    applyLook();
    applyFlip();
  }

  /* ---------- black, fullscreen, controls ---------- */

  /** Picture black and sound silent at once (e.g. something private shows up on the phone). */
  function setBlackout(on) {
    blackout = on;
    if (!on) st.lastFrame = performance.now(); // frames are counted afresh when the picture is shown again
    document.body.classList.toggle('blackout', on);
    $('btnBlack').classList.toggle('pressed', on);
    applyMaster();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  /** Bars fade out after a moment without mouse movement so the shared picture stays clean. */
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(st.idleTimer);
    st.idleTimer = setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
  }

  function bind() {
    $('btnPower').addEventListener('click', toggle);
    $('btnBig').addEventListener('click', toggle);
    $('device').addEventListener('change', async () => {
      resetModes();
      const chosen = st.cams.find((d) => d.deviceId === $('device').value);
      useSavedModes(chosen); // a card that was read before shows its modes at once
      showCard(chosen, 'manual');
      sourceId = ''; // the sound follows the picture input again
      fillSources(await inputs());
      if (!st.stream) return;
      stop();
      await start();
    });
    bindSettings();
    $('source').addEventListener('change', () => {
      sourceId = $('source').value;
      restartStream(); // the sound input is opened again (running only; otherwise it is used at the next start)
    });
    $('sink').addEventListener('change', () => {
      sinkId = $('sink').value;
      store.set('sink', sinkId);
      routeOutput();
    });
    $('btnBlack').addEventListener('click', () => setBlackout(!blackout));
    $('btnFull').addEventListener('click', toggleFullscreen);
    pic.addEventListener('dblclick', toggleFullscreen);
    pic.addEventListener('loadedmetadata', layout);
    pic.addEventListener('resize', layout); // the card switched its resolution
    window.addEventListener('resize', layout);
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', (e) => {
      wake();
      if (e.key === 'Escape' && !$('panel').classList.contains('hidden')) return togglePanel(false);
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'f11') toggleFullscreen();
      else if (k === 'b') $('btnBlack').click();
      else if (k === 's') $('btnSettings').click();
      else if (k === 'i') applyStats(!$('statsOn').checked);
      else if (k === ' ' && e.target === document.body) toggle();
      else return;
      e.preventDefault();
    });
    media.addEventListener('devicechange', async () => {
      const wanted = $('device').value;
      const cams = await fillDevices();
      if (st.stream && !cams.some((d) => d.deviceId === wanted)) connectionLost();
      else if (st.wantOn && !st.stream && st.lostId) tryReconnect();
      routeOutput();
      await detectCard();
    });
  }

  /* ---------- version, newer versions and the update (GitHub only, done by the program, see updater.js) ---------- */

  const About = window.CfAbout;
  const Update = window.cfUpdate; // the only thing the page can ask of the program (preload.js)

  function showVersion() {
    const v = new URLSearchParams(window.location.search).get('v');
    $('verNow').textContent = About.parseVersion(v) ? v : '–';
    $('verLink').href = About.RELEASES_URL;
    $('donateLink').href = About.DONATE_URL;
  }

  let lastUpdate = null;
  const updateError = (u) => t('upd.err.' + (u.code || 'other'), { status: u.status });

  /** Shows how the update stands: checking, up to date, a newer version (with the bar "Aktualisieren"), downloading, installing. */
  function renderUpdate(next) {
    if (next) lastUpdate = next;
    const u = lastUpdate;
    if (!u) return;
    const out = $('verLatest');
    const working = u.state === 'checking' || u.state === 'downloading' || u.state === 'installing';
    $('btnVerCheck').disabled = working;
    document.body.dataset.update = u.state;
    document.body.dataset.latest = u.latest || '';
    if (u.state === 'idle') return;
    $('updateRow').classList.remove('hidden');
    out.className = '';
    if (u.state === 'checking') out.textContent = t('upd.checking');
    else if (u.state === 'error' && !u.latest) (out.textContent = updateError(u)), (out.className = 'warn');
    else if (u.state === 'current') out.textContent = u.latest ? t('upd.current', { v: u.latest }) : t('upd.none');
    else (out.textContent = t('upd.new', { v: u.latest })), (out.className = 'new');
    const offer = Boolean(u.latest) && ['available', 'downloading', 'installing', 'error'].includes(u.state);
    $('updateBar').classList.toggle('hidden', !offer);
    if (!offer) return;
    const text = $('updateText');
    text.className = u.state === 'error' ? 'warn' : '';
    text.textContent =
      u.state === 'downloading' ? t('upd.downloading', { v: u.latest, p: u.percent || 0 })
      : u.state === 'installing' ? t('upd.installing')
      : u.state === 'error' ? updateError(u)
      : u.installable === false ? t('upd.noInstaller', { v: u.latest })
      : t('upd.available', { v: u.latest });
    $('btnUpdate').textContent = u.state === 'error' ? t('upd.retry') : t('info.update');
    $('btnUpdate').disabled = u.state === 'downloading' || u.state === 'installing';
    $('btnUpdate').classList.toggle('hidden', u.installable === false);
  }

  /* ---------- the Discord display (off by default; the program does the talking, see presence.js) ---------- */

  const Presence = window.cfPresence;
  let lastPresence = null;

  /** Tells the program whether the display is wanted and whether the picture runs; it shows or removes the display by itself. */
  function sendPresence() {
    if (Presence) Presence.update({ enabled: presenceOn, running: Boolean(st.stream) }).then(renderPresence).catch(() => {});
  }

  function renderPresence(next) {
    if (next) lastPresence = next;
    const p = lastPresence || { available: Boolean(Presence), enabled: presenceOn, connected: false };
    $('presenceOn').checked = presenceOn;
    $('presenceOn').disabled = !p.available;
    document.body.dataset.presence = !p.available ? 'unavailable' : !p.enabled ? 'off' : p.problem ? 'problem' : p.connected ? 'on' : 'waiting';
    $('presenceNote').textContent = !p.available
      ? t('pres.na')
      : !p.enabled
        ? t('pres.off')
        : p.problem
          ? t('pres.refused', { problem: p.problem })
          : p.connected
            ? t(st.stream ? 'pres.running' : 'pres.wait')
            : t('pres.nodiscord');
  }

  /* ---------- language ---------- */

  function applyStatic() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }

  /** Draws every word of the window again in the chosen language (what is only drawn from time to time is redrawn from what it last showed). */
  function redraw() {
    applyStatic();
    renderOff();
    renderCard();
    showModes(modesView.found, modesView.note, modesView.savedAt);
    refreshResOptions();
    showFpsOptions();
    renderUpdate();
    if (!lastUpdate) $('btnUpdate').textContent = t('info.update');
    renderPresence();
    updateHint();
  }

  function buildLanguageSelect() {
    $('lang').replaceChildren(
      ...I18n.languages.map(({ code, name }) => {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = name;
        return o;
      })
    );
    $('lang').value = lang;
    $('lang').addEventListener('change', () => {
      lang = I18n.pick($('lang').value);
      store.set('lang', lang);
      redraw();
      fillDevices().catch(() => {}); // the names of the devices that are made up ("Video input 2") and the first lines of the lists
    });
  }

  buildLanguageSelect();
  bind();
  showVersion();
  if (Presence) {
    Presence.onStatus(renderPresence);
    $('presenceOn').addEventListener('change', () => {
      presenceOn = $('presenceOn').checked;
      store.set('presence', presenceOn ? '1' : '0');
      sendPresence();
    });
    sendPresence();
  } else {
    renderPresence();
  }
  if (Update) {
    Update.onStatus(renderUpdate);
    $('btnVerCheck').addEventListener('click', () => Update.check().then(renderUpdate));
    $('btnUpdate').addEventListener('click', () => Update.install().then(renderUpdate));
    Update.check().then(renderUpdate); // once at the start
  } else {
    $('btnVerCheck').disabled = true;
  }
  showModes(null);
  redraw();
  fillDevices()
    .then(routeOutput)
    .then(detectCard)
    .catch((err) => showOff('off.noDevices', 'off.noDevicesHint', { error: err && err.message }, true));
})();
