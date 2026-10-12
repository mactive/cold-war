// Screen-space combat presentation. The battlefield remains rendered by Three.js;
// this transparent foreground layer keeps targeting and impacts above the cards.
export function createCombatVisuals() {
  const layer = document.createElement("div");
  layer.className = "combat-overlay";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `<svg class="aim-overlay" hidden><defs><linearGradient id="aim-fill" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#703739"/><stop offset="1" stop-color="#b2504c"/></linearGradient></defs><path class="aim-ribbon"/><g class="aim-reticle"><circle r="24"/><circle r="5"/><path d="M-35 0H-17M17 0H35M0-35V-17M0 17V35"/></g></svg><canvas class="combat-canvas"></canvas>`;
  document.body.append(layer);
  const svg = layer.querySelector("svg"),
    path = layer.querySelector(".aim-ribbon"),
    reticle = layer.querySelector("g"),
    canvas = layer.querySelector("canvas"),
    ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0,
    width,
    height;
  const effects = [];
  function resize() {
    width = innerWidth;
    height = innerHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  function curve(a, b, t, lift) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t - 4 * lift * t * (1 - t),
    };
  }
  function aim(a, b, locked) {
    svg.removeAttribute("hidden");
    svg.classList.toggle("locked", locked);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const lift = Math.min(130, length * 0.24),
      left = [],
      right = [];
    // Tapered curved ribbon with a broad arrow head, like a tabletop order arrow.
    const shaftEnd = Math.max(0.4, 1 - 30 / Math.max(length, 1));
    let normal;
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * shaftEnd,
        p = curve(a, b, t, lift);
      const dx = b.x - a.x,
        dy = b.y - a.y - 4 * lift * (1 - 2 * t),
        n = Math.hypot(dx, dy) || 1;
      normal = { x: -dy / n, y: dx / n };
      const w = 4 + 9 * t;
      left.push(`${p.x + normal.x * w},${p.y + normal.y * w}`);
      right.unshift(`${p.x - normal.x * w},${p.y - normal.y * w}`);
    }
    const neck = curve(a, b, shaftEnd, lift);
    path.setAttribute(
      "d",
      `M${left.join(" L")} L${neck.x + normal.x * 27},${neck.y + normal.y * 27} L${b.x},${b.y} L${neck.x - normal.x * 27},${neck.y - normal.y * 27} L${right.join(" L")} Z`,
    );
    reticle.setAttribute("transform", `translate(${b.x} ${b.y})`);
    reticle.style.opacity = locked ? "1" : "0";
  }
  function hideAim() {
    svg.setAttribute("hidden", "");
  }
  function glow(x, y, r, alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,219,${alpha})`);
    g.addColorStop(0.2, `rgba(255,205,92,${alpha})`);
    g.addColorStop(0.5, `rgba(255,105,25,${alpha * 0.7})`);
    g.addColorStop(1, "rgba(225,60,8,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function shot(a, b, type, onImpact) {
    const heavy = ["坦克", "炮兵", "轰炸机"].includes(type);
    const duration = reduce ? 90 : heavy ? 430 : 300;
    layer.dataset.phase = "flight";
    return new Promise((resolve) => {
      effects.push({
        a,
        b,
        heavy,
        start: performance.now(),
        duration,
        onImpact,
        resolve,
        hit: false,
        sparks: Array.from({ length: heavy ? 42 : 26 }, () => ({
          angle: Math.random() * Math.PI * 2,
          speed: 45 + Math.random() * 150,
          size: 1 + Math.random() * 3,
        })),
        smoke: Array.from({ length: 9 }, () => ({
          x: (Math.random() - 0.5) * 60,
          y: (Math.random() - 0.5) * 50,
          r: 12 + Math.random() * 17,
        })),
      });
      if (!raf) raf = requestAnimationFrame(frame);
    });
  }
  function frame(now) {
    ctx.clearRect(0, 0, width, height);
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i],
        elapsed = now - e.start,
        t = Math.min(1, elapsed / e.duration),
        lift = e.heavy ? 55 : 22;
      if (t < 1) {
        glow(e.a.x, e.a.y, Math.max(1, 38 * (1 - t)), (1 - t) * 0.9);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let j = 12; j >= 0; j--) {
          const q = curve(e.a, e.b, Math.max(0, t - j * 0.012), lift);
          glow(q.x, q.y, j === 0 ? 12 : 6, (1 - j / 13) * 0.8);
        }
        ctx.restore();
      } else {
        if (!e.hit) {
          e.hit = true;
          layer.dataset.phase = "impact";
          e.onImpact?.();
        }
        const age = (elapsed - e.duration) / 1000;
        // Dark smoke follows the bright flash instead of covering it immediately.
        for (const s of e.smoke) {
          const r = s.r * (0.7 + age * 1.7),
            x = e.b.x + s.x * (0.4 + age),
            y = e.b.y + s.y * 0.6 - age * 35;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const opacity = Math.max(
            0,
            Math.min(0.5, age * 3) * (1 - age / 1.05),
          );
          g.addColorStop(0, `rgba(22,21,18,${opacity})`);
          g.addColorStop(0.6, `rgba(48,44,37,${opacity * 0.8})`);
          g.addColorStop(1, "rgba(40,36,30,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (age < 0.3)
          glow(
            e.b.x,
            e.b.y,
            (e.heavy ? 88 : 62) * (1 + age),
            Math.max(0, 1 - age / 0.3),
          );
        ctx.strokeStyle = `rgba(250,210,143,${Math.max(0, 0.75 - age * 2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.b.x, e.b.y, 8 + age * 170, 0, Math.PI * 2);
        ctx.stroke();
        if (!reduce)
          for (const p of e.sparks) {
            const dx = Math.cos(p.angle) * p.speed,
              dy = Math.sin(p.angle) * p.speed;
            ctx.strokeStyle = `rgba(255,${Math.round(140 + 60 * (1 - age))},59,${Math.max(0, 1 - age * 1.5)})`;
            ctx.lineWidth = p.size;
            ctx.beginPath();
            ctx.moveTo(e.b.x + dx * age, e.b.y + dy * age + age * age * 45);
            ctx.lineTo(
              e.b.x + dx * Math.max(0, age - 0.05),
              e.b.y + dy * Math.max(0, age - 0.05) + age * age * 45,
            );
            ctx.stroke();
          }
        if (age > (reduce ? 0.18 : 1.05)) {
          effects.splice(i, 1);
          e.resolve();
        }
      }
    }
    if (effects.length) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      ctx.clearRect(0, 0, width, height);
      delete layer.dataset.phase;
    }
  }
  resize();
  addEventListener("resize", resize);
  return { aim, hideAim, shot };
}
