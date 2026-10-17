/* Sothis: draws the Switch video through the GPU, upscaled to your screen with a sharp
   Catmull-Rom (bicubic) filter plus contrast-adaptive sharpening, so it looks crisp
   instead of soft when the window is bigger than the capture.
   Usage: const up = SwUpscale.attach(videoEl, canvasEl); up.setOn(true); up.setStrength(0..1); */
(function () {
  const VS = `#version 300 es
in vec2 p; out vec2 uv;
uniform vec4 rect; // x, y, w, h of the picture inside the canvas, in clip space
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(rect.xy + (p * .5 + .5) * rect.zw, 0., 1.); }`;
  const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform vec2 size; uniform float sharp;
// Catmull-Rom sampling with 9 bilinear taps (sharper than plain bilinear, no ringing halos)
vec3 cr(vec2 t) {
  vec2 sp = t * size, c = floor(sp - .5) + .5, f = sp - c;
  vec2 w0 = f * (-.5 + f * (1. - .5 * f)), w1 = 1. + f * f * (-2.5 + 1.5 * f), w2 = f * (.5 + f * (2. - 1.5 * f)), w3 = f * f * (-.5 + .5 * f);
  vec2 w12 = w1 + w2, o12 = w2 / w12;
  vec2 t0 = (c - 1.) / size, t3 = (c + 2.) / size, t12 = (c + o12) / size;
  vec3 r = vec3(0.);
  r += texture(tex, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;  r += texture(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;  r += texture(tex, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
  r += texture(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y; r += texture(tex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y; r += texture(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
  r += texture(tex, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;  r += texture(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;  r += texture(tex, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  return r;
}
void main() {
  vec3 c = cr(uv);
  if (sharp <= 0.) { o = vec4(clamp(c, 0., 1.), 1.); return; }
  // AMD FidelityFX CAS-style sharpening on the source-pixel grid
  vec2 d = 1. / size;
  vec3 n = texture(tex, uv - vec2(0., d.y)).rgb, s = texture(tex, uv + vec2(0., d.y)).rgb;
  vec3 e = texture(tex, uv + vec2(d.x, 0.)).rgb, w = texture(tex, uv - vec2(d.x, 0.)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 2. - mx) / max(mx, 1e-4), 0., 1.));
  vec3 wt = amp * mix(-.125, -.2, sharp);
  o = vec4(clamp((c + (n + s + e + w) * wt) / (1. + 4. * wt), 0., 1.), 1.);
}`;
  function attach(video, canvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, desynchronized: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    try { gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); } catch (e) { console.warn("upscale shader", e); return null; }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const U = { rect: gl.getUniformLocation(prog, "rect"), size: gl.getUniformLocation(prog, "size"), sharp: gl.getUniformLocation(prog, "sharp") };
    let on = false, strength = .6, alive = true, cb = 0, raf = 0;
    function draw() {
      if (!alive || !on) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr)), ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      gl.viewport(0, 0, cw, ch); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!vw || !vh || video.readyState < 2) return;
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch { return; }
      // fit the picture (like object-fit: contain), snapped to whole pixels
      const s = Math.min(cw / vw, ch / vh), w = Math.round(vw * s), h = Math.round(vh * s), x = Math.floor((cw - w) / 2), y = Math.floor((ch - h) / 2);
      gl.uniform4f(U.rect, x / cw * 2 - 1, 1 - (y + h) / ch * 2, w / cw * 2, h / ch * 2);
      gl.uniform2f(U.size, vw, vh);
      gl.uniform1f(U.sharp, strength);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function loop() {
      if (!alive || !on) return;
      if (video.requestVideoFrameCallback) cb = video.requestVideoFrameCallback(() => { draw(); loop(); });
      else raf = requestAnimationFrame(() => { draw(); loop(); });
    }
    const ro = new ResizeObserver(() => draw()); ro.observe(canvas);
    return {
      setOn(v) { v = !!v; if (v === on) return; on = v; canvas.hidden = !on; if (on) { draw(); loop(); } else { if (cb && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(cb); cancelAnimationFrame(raf); } },
      setStrength(v) { strength = Math.max(0, Math.min(1, +v || 0)); draw(); },
      kick() { if (on) { if (cb && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(cb); draw(); loop(); } },
      stop() { alive = false; ro.disconnect(); }
    };
  }
  window.SwUpscale = { attach };
})();
