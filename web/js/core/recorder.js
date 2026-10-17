// Grabador web: codifica con WebCodecs (mediabunny) y escribe en streaming en el sistema de archivos del navegador.
//   screen : MediaStreamVideoTrackSource con recorte/escala dentro del codificador
//   canvas : composición (pantalla + cámara con aro de luz, o solo cámara) → captureStream → mismo codificador
import {
  Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, BufferTarget,
  MediaStreamVideoTrackSource, MediaStreamAudioTrackSource, canEncodeVideo, canEncodeAudio,
} from '../../vendor/mediabunny.min.mjs';
import { targetSize, bitrateFor, even } from '../lib/sizing.js';
import { videoFrom, stopStream } from './capture.js';
import * as storage from './storage.js';

function drawCamCircle(ctx, cam, cx, cy, r, mirror) {
  const vw = cam.videoWidth, vh = cam.videoHeight;
  if (!vw || !vh) return;
  const side = Math.min(vw, vh);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (mirror) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
  ctx.drawImage(cam, (vw - side) / 2, (vh - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

export class Recorder extends EventTarget {
  // cfg: ajustes de grabación. streams: { screen, cam, mic } (MediaStream o null). region: {x,y,w,h} en px del vídeo, o null.
  constructor(cfg, streams, region) {
    super();
    this.cfg = cfg; this.streams = streams; this.region = region;
    this.tracks = []; this.timers = [];
    this.frames = 0; this.late = 0;
    this.state = 'idle';           // idle | prepared | recording | paused | stopping | done
    this.t0 = 0; this.pausedAt = 0; this.pausedAcc = 0;
  }

  async prepare() {
    const { cfg, streams } = this, s = this;
    const useScreen = cfg.mode !== 'cam' && streams.screen;
    const canvasMode = cfg.mode === 'cam' || cfg.mode === 'screen-cam';
    let screenVideo = null, camVideo = null;
    if (useScreen) {
      screenVideo = await videoFrom(streams.screen);
      streams.screen.getVideoTracks()[0].addEventListener('ended', () => {
        if (['recording', 'paused'].includes(s.state)) this.dispatchEvent(new CustomEvent('ended'));
      });
    }
    if (cfg.mode !== 'screen' && streams.cam) {
      camVideo = await videoFrom(streams.cam);
      // cámara desconectada a mitad de grabación: en "solo cámara" se termina; en los demás modos se sigue sin burbuja
      streams.cam.getVideoTracks()[0].addEventListener('ended', () => {
        if (!['recording', 'paused'].includes(s.state)) return;
        if (cfg.mode === 'cam') this.dispatchEvent(new CustomEvent('ended')); else camVideo = null;
      });
    }

    // ---- geometría ----
    let sx = 0, sy = 0, sw = 0, sh = 0, crop = false;
    if (cfg.mode === 'cam') { sw = 1280; sh = 720; }
    else if (this.region) { ({ x: sx, y: sy, w: sw, h: sh } = this.region); crop = true; }
    else { sw = screenVideo.videoWidth; sh = screenVideo.videoHeight; }
    const [outW, outH] = cfg.mode === 'cam' ? targetSize(1280, 720, cfg.resolution === 'native' ? '720' : cfg.resolution) : targetSize(sw, sh, cfg.resolution);
    const needScale = cfg.mode !== 'cam' && (outW !== even(sw) || outH !== even(sh));
    const pipeline = canvasMode ? 'canvas' : (crop ? 'crop' : (needScale ? 'scale' : 'direct'));
    this.info = { pipeline, width: outW, height: outH, captureWidth: screenVideo ? screenVideo.videoWidth : null, captureHeight: screenVideo ? screenVideo.videoHeight : null, fps: cfg.fps };

    // ---- pista de vídeo ----
    let videoTrack, transform;
    if (pipeline === 'canvas') {
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      ctx.imageSmoothingQuality = 'high';
      videoTrack = canvas.captureStream(0).getVideoTracks()[0];
      const t0 = performance.now();
      const paint = () => {
        const t = (performance.now() - t0) / 1000, cw = outW, ch = outH;
        if (cfg.mode === 'cam') {
          const g = ctx.createRadialGradient(cw / 2, ch / 2, 40, cw / 2, ch / 2, cw * 0.7);
          g.addColorStop(0, '#171a2b'); g.addColorStop(1, '#05060c');
          ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
          if (camVideo) {
            const r = ch * 0.36;
            drawCamCircle(ctx, camVideo, cw / 2, ch / 2, r, cfg.mirror);
            if (cfg.ringEnabled) window.Ring.drawRing(ctx, cw / 2, ch / 2, r, t, cfg.ringStyle, 1.5);
          }
        } else {
          const vw = screenVideo.videoWidth, vh = screenVideo.videoHeight;
          if (crop) ctx.drawImage(screenVideo, sx, sy, sw, sh, 0, 0, cw, ch);
          else {   // si la ventana cambia de tamaño se encaja sin deformar
            const k = Math.min(cw / vw, ch / vh);
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(screenVideo, 0, 0, vw, vh, (cw - vw * k) / 2, (ch - vh * k) / 2, vw * k, vh * k);
          }
          if (camVideo) {
            const m = Math.min(cw, ch), r = (m * cfg.bubbleSize) / 2, pad = r * 0.45 + r * 0.1;
            const cx = cfg.corner.endsWith('l') ? pad + r : cw - pad - r;
            const cy = cfg.corner.startsWith('t') ? pad + r : ch - pad - r;
            drawCamCircle(ctx, camVideo, cx, cy, r, cfg.mirror);
            if (cfg.ringEnabled) window.Ring.drawRing(ctx, cx, cy, r, t, cfg.ringStyle, 1.5);
          }
        }
        videoTrack.requestFrame();
      };
      paint();
      this.startPaint = () => {
        const step = 1000 / cfg.fps; let next = performance.now() + step;
        const loop = () => {
          if (['stopping', 'done'].includes(s.state)) return;
          if (s.state === 'recording') paint();
          const now = performance.now();
          if (now - next > step * 2) { s.late++; next = now; }     // si nos retrasamos mucho no acumulamos
          next += step;
          s.loopTimer = setTimeout(loop, Math.max(0, next - performance.now()));
        };
        loop();
      };
    } else {
      videoTrack = streams.screen.getVideoTracks()[0];
      if (pipeline !== 'direct') transform = { ...(crop ? { crop: { left: sx, top: sy, width: sw, height: sh } } : {}), width: outW, height: outH, fit: 'fill' };
    }

    // ---- audio (compartido + micrófono mezclados) ----
    const actx = new AudioContext({ latencyHint: 'interactive' }); this.actx = actx;
    const dest = actx.createMediaStreamDestination();
    let hasAudio = false;
    if (streams.screen && streams.screen.getAudioTracks().length) {
      actx.createMediaStreamSource(new MediaStream(streams.screen.getAudioTracks())).connect(dest); hasAudio = true; this.info.systemAudio = true;
    }
    if (streams.mic && streams.mic.getAudioTracks().length) {
      actx.createMediaStreamSource(streams.mic).connect(dest); hasAudio = true; this.info.mic = true;
    }
    if (actx.state === 'suspended') await actx.resume();

    // ---- contenedor y códecs (con alternativas si el equipo no puede con el pedido) ----
    const bps = bitrateFor(outW, outH, cfg.fps, cfg.quality);
    let container = cfg.format === 'mp4' ? 'mp4' : 'webm', vcodec = container === 'mp4' ? 'avc' : 'vp9';
    if (!(await canEncodeVideo(vcodec, { width: outW, height: outH, bitrate: bps }))) {
      let ok = false;
      for (const [c, v] of [['mp4', 'avc'], ['webm', 'vp9'], ['webm', 'vp8']]) {
        if (v === vcodec) continue;
        if (await canEncodeVideo(v, { width: outW, height: outH, bitrate: bps })) { container = c; vcodec = v; ok = true; break; }
      }
      if (!ok) throw new Error(`Este navegador no puede codificar video de ${outW}×${outH}. Elige una resolución menor.`);
      this.info.codecFallback = true;
    }
    const acodec = container === 'mp4' && (await canEncodeAudio('aac')) ? 'aac' : 'opus';

    this.container = container;
    this.name = `Capturo ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}.${container}`;
    this.sink = await storage.openSink(this.name);
    const target = this.sink.opfs ? new StreamTarget(this.sink.writable) : new BufferTarget();
    this.target = target;
    const output = new Output({ format: container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target });
    const vsrc = new MediaStreamVideoTrackSource(videoTrack, {
      codec: vcodec, bitrate: bps, keyFrameInterval: 2,
      sizeChangeBehavior: pipeline === 'direct' && cfg.target === 'window' ? 'contain' : 'passThrough',
      onEncodedPacket: () => { s.frames++; },
      ...(transform ? { transform } : {}),
    }, { frameRate: cfg.fps });
    output.addVideoTrack(vsrc, { frameRate: cfg.fps });
    let asrc = null;
    if (hasAudio) { asrc = new MediaStreamAudioTrackSource(dest.stream.getAudioTracks()[0], { codec: acodec, bitrate: 160000 }); output.addAudioTrack(asrc); }
    this.output = output; this.vsrc = vsrc; this.asrc = asrc; this.videoTrack = videoTrack;
    const onErr = (e) => { if (!['stopping', 'done'].includes(s.state)) this.dispatchEvent(new CustomEvent('error', { detail: e })); };
    vsrc.errorPromise.catch(onErr);
    if (asrc) asrc.errorPromise.catch(onErr);
    Object.assign(this.info, { container, vcodec, acodec: hasAudio ? acodec : null, bitrate: bps, hasAudio });
    this.state = 'prepared';
    return this.info;
  }

  async start() {
    if (this.state !== 'prepared') throw new Error('El grabador no está preparado.');
    await this.output.start();
    this.state = 'recording';
    this.t0 = performance.now(); this.frames = 0;
    if (this.startPaint) this.startPaint();
    this.timers.push(setInterval(() => this.#tick(), 250));
    this.#tick();
  }

  pause() {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this.vsrc.pause(); if (this.asrc) this.asrc.pause();
    this.pausedAt = performance.now();
    this.#tick();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.vsrc.resume(); if (this.asrc) this.asrc.resume();
    this.pausedAcc += performance.now() - this.pausedAt; this.pausedAt = 0;
    this.state = 'recording';
    this.#tick();
  }

  elapsedMs() {
    if (!this.t0) return 0;
    const now = this.state === 'paused' ? this.pausedAt : performance.now();
    return Math.max(0, now - this.t0 - this.pausedAcc);
  }

  #lastFrames = 0; #lastT = 0; #lastFps = null;
  #tick() {
    const nowP = performance.now();
    if (!this.#lastT || this.frames < this.#lastFrames) { this.#lastT = nowP; this.#lastFrames = this.frames; }
    else if (nowP - this.#lastT >= 1000) {
      if (this.state === 'recording') this.#lastFps = Math.round((this.frames - this.#lastFrames) / ((nowP - this.#lastT) / 1000));
      this.#lastT = nowP; this.#lastFrames = this.frames;
    }
    this.dispatchEvent(new CustomEvent('tick', { detail: { state: this.state, elapsed: this.elapsedMs(), fps: this.#lastFps, target: this.cfg.fps } }));
  }

  #teardown() {
    clearTimeout(this.loopTimer);
    this.timers.forEach((t) => clearInterval(t));
    for (const k of ['screen', 'cam', 'mic']) stopStream(this.streams[k]);
    if (this.actx && this.actx.state !== 'closed') this.actx.close().catch(() => {});
  }

  // Termina y devuelve { name, size, durationMs, ... } o lanza si falla.
  async stop() {
    if (!['recording', 'paused'].includes(this.state)) return null;
    const elapsed = this.elapsedMs();
    this.state = 'stopping';
    clearTimeout(this.loopTimer);
    this.timers.forEach((t) => clearInterval(t));
    try {
      this.videoTrack.stop();
      for (const k of ['screen', 'cam', 'mic']) stopStream(this.streams[k]);
      await this.output.finalize();
      let size = 0, blob = null;
      if (this.sink.opfs) size = (await storage.getFile(this.name)).size;
      else { blob = new Blob([this.target.buffer], { type: this.container === 'mp4' ? 'video/mp4' : 'video/webm' }); size = blob.size; await storage.saveBlob(this.name, blob); }
      this.state = 'done';
      this.#teardown();
      return { name: this.name, size, durationMs: elapsed, width: this.info.width, height: this.info.height, container: this.container, info: this.info, stats: { frames: this.frames, late: this.late, seconds: Math.max(0.001, elapsed / 1000) } };
    } catch (e) {
      this.state = 'done';
      this.#teardown();
      try { await storage.removeFile(this.name); } catch { /* ya no está */ }
      throw e;
    }
  }

  // Descarta todo lo grabado
  async cancel() {
    if (this.state === 'done') return;
    const was = this.state;
    this.state = 'stopping';
    clearTimeout(this.loopTimer);
    this.timers.forEach((t) => clearInterval(t));
    try { if (this.videoTrack) this.videoTrack.stop(); } catch { /* ya parado */ }
    this.#teardown();
    try { if (this.output && ['pending', 'started'].includes(this.output.state)) await this.output.cancel(); } catch { /* ya cancelado */ }
    try { if (this.sink && this.sink.opfs && this.sink.writable) await this.sink.writable.abort().catch(() => {}); } catch { /* ignorar */ }
    if (this.name) { try { await storage.removeFile(this.name); } catch { /* no existe */ } }
    this.state = 'done';
    void was;
  }
}
