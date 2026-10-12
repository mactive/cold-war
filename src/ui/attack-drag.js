export function installAttackDrag({
  app,
  visuals,
  begin,
  targets,
  fire,
  cancel,
  allowed,
}) {
  let drag = null,
    suppressUntil = 0;
  function clear() {
    if (!drag) return;
    const id = drag.pointerId;
    drag = null;
    if (app.hasPointerCapture(id)) app.releasePointerCapture(id);
    document.body.classList.remove("attack-dragging");
    document
      .querySelectorAll(".drag-source,.drop-target")
      .forEach((el) => el.classList.remove("drag-source", "drop-target"));
    visuals.hideAim();
  }
  function abort() {
    if (!drag) return;
    suppressUntil = performance.now() + 350;
    clear();
    cancel();
  }
  app.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary || drag || !allowed()) return;
    const el = e.target.closest(".on-board[data-target]");
    if (!el) return;
    const id = el.dataset.target;
    if (!begin(id)) return;
    // begin renders the selection, so query the new element before measuring it.
    const source = app.querySelector(`[data-target="${id}"]`),
      r = source.getBoundingClientRect();
    drag = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      from: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      moved: false,
    };
    source.classList.add("drag-source");
    app.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6)
      drag.moved = true;
    if (!drag.moved) return;
    document.body.classList.add("attack-dragging");
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-target]");
    const valid = el && targets(drag.id).includes(el.dataset.target);
    document
      .querySelectorAll(".drop-target")
      .forEach((x) => x.classList.remove("drop-target"));
    let to = { x: e.clientX, y: e.clientY };
    if (valid) {
      el.classList.add("drop-target");
      const r = el.getBoundingClientRect();
      to = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    visuals.aim(drag.from, to, !!valid);
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const { id, moved } = drag;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-target]")?.dataset.target;
    clear();
    if (!moved) return; // A tap keeps the existing click-to-select interaction.
    suppressUntil = performance.now() + 350;
    if (target && targets(id).includes(target)) fire(id, target);
    else cancel();
  });
  window.addEventListener("pointercancel", abort);
  app.addEventListener("lostpointercapture", () => {
    if (drag) abort();
  });
  window.addEventListener("blur", abort);
  window.addEventListener("resize", abort);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) {
      e.preventDefault();
      abort();
    }
  });
  document.addEventListener(
    "click",
    (e) => {
      if (performance.now() < suppressUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  app.addEventListener("dragstart", (e) => e.preventDefault());
}
