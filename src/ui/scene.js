import * as THREE from "three";
export function createScene(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch {
    return { burst() {}, destroy() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 10;
  const texture = new THREE.TextureLoader().load("/assets/vietnam-table.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: texture, color: 0xc5c4ac }),
  );
  scene.add(plane);
  const positions = new Float32Array(100 * 3);
  for (let i = 0; i < 100; i++) {
    positions[i * 3] = Math.random() * 2 - 1;
    positions[i * 3 + 1] = Math.random() * 2 - 1;
    positions[i * 3 + 2] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xf2d79b,
      size: 0.0025,
      transparent: true,
      opacity: 0.35,
    }),
  );
  scene.add(dust);
  const pulses = [];
  let width = 1,
    height = 1,
    raf,
    last = performance.now();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() {
    width = innerWidth;
    height = innerHeight;
    renderer.setSize(width, height);
    const a = width / height,
      ta = 1672 / 941;
    if (a > ta) plane.scale.set(1, a / ta, 1);
    else plane.scale.set(ta / a, 1, 1);
  }
  function burst(x, y, toX = x, toY = y) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffbd58,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.005, 0.012, 32), mat);
    const pos = (x, y) =>
      new THREE.Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 2);
    ring.position.copy(pos(toX, toY));
    scene.add(ring);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pos(x, y), pos(toX, toY)]),
      new THREE.LineBasicMaterial({
        color: 0xffd685,
        transparent: true,
        opacity: 0.9,
      }),
    );
    scene.add(line);
    pulses.push({ ring, line, t: 0 });
  }
  function animate(now) {
    raf = requestAnimationFrame(animate);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduce && !document.hidden) {
      for (let i = 0; i < 100; i++) {
        positions[i * 3 + 1] += dt * 0.003;
        if (positions[i * 3 + 1] > 1) positions[i * 3 + 1] = -1;
      }
      geo.attributes.position.needsUpdate = true;
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const a = pulses[i];
      a.t += dt;
      a.ring.scale.setScalar(1 + a.t * 20);
      a.ring.material.opacity = Math.max(0, 1 - a.t * 1.5);
      a.line.material.opacity = Math.max(0, 1 - a.t * 3);
      if (a.t > 1) {
        scene.remove(a.ring, a.line);
        a.ring.geometry.dispose();
        a.ring.material.dispose();
        a.line.geometry.dispose();
        a.line.material.dispose();
        pulses.splice(i, 1);
      }
    }
    if (!document.hidden) renderer.render(scene, camera);
  }
  resize();
  addEventListener("resize", resize);
  raf = requestAnimationFrame(animate);
  return {
    burst,
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      texture.dispose();
      geo.dispose();
      dust.material.dispose();
      plane.geometry.dispose();
      plane.material.dispose();
      renderer.dispose();
    },
  };
}
