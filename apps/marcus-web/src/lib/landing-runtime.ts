import { TERMINAL_STEPS, type TerminalLine } from "./terminal-steps";

export function mountLandingExperience(): () => void {
const events = new AbortController();
const { signal } = events;

const body = document.body;
const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = reducedMotion.matches;

body.classList.add("reveal-ready");
document.querySelectorAll<HTMLElement>(".hero [data-reveal]").forEach((element) => element.classList.add("is-visible"));

const header = document.querySelector<HTMLElement>("[data-header]");
const progress = document.querySelector<HTMLElement>(".scroll-progress span");
let scrollFrame = 0;

function updateScrollState(): void {
  const scrollTop = window.scrollY;
  const available = document.documentElement.scrollHeight - window.innerHeight;
  header?.classList.toggle("is-scrolled", scrollTop > 24);
  if (progress !== null) progress.style.scale = `${available <= 0 ? 0 : Math.min(1, scrollTop / available)} 1`;
  scrollFrame = 0;
}

window.addEventListener("scroll", () => {
  if (scrollFrame === 0) scrollFrame = requestAnimationFrame(updateScrollState);
}, { passive: true, signal });
updateScrollState();

const revealElements = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
let revealObserver: IntersectionObserver | undefined;
if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  for (const element of revealElements) element.classList.add("is-visible");
} else {
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      revealObserver?.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
  for (const element of revealElements) {
    if (!element.classList.contains("is-visible")) revealObserver.observe(element);
  }
}

const menuToggle = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
const navigation = document.querySelector<HTMLElement>("[data-nav]");

function setMenu(open: boolean): void {
  menuToggle?.setAttribute("aria-expanded", String(open));
  const label = menuToggle?.querySelector<HTMLElement>(".sr-only");
  if (label !== null && label !== undefined) label.textContent = open ? "Cerrar menú" : "Abrir menú";
  navigation?.classList.toggle("is-open", open);
  body.classList.toggle("nav-open", open);
}

menuToggle?.addEventListener("click", () => setMenu(menuToggle.getAttribute("aria-expanded") !== "true"), { signal });
navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false), { signal }));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
    setMenu(false);
    menuToggle.focus();
  }
}, { signal });

const clock = document.querySelector<HTMLElement>("[data-clock]");
const clockFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function updateClock(): void {
  if (clock !== null) clock.textContent = `${clockFormatter.format(new Date())} ART`;
}

updateClock();
const clockTimer = window.setInterval(updateClock, 1000);

const motionToggle = document.querySelector<HTMLButtonElement>("[data-motion-toggle]");

function applyMotionPreference(paused: boolean): void {
  motionPaused = paused;
  root.classList.toggle("motion-paused", paused);
  motionToggle?.setAttribute("aria-pressed", String(paused));
  motionToggle?.setAttribute("aria-label", paused ? "Reanudar animaciones" : "Pausar animaciones");
}

applyMotionPreference(motionPaused);
motionToggle?.addEventListener("click", () => {
  applyMotionPreference(!motionPaused);
  renderTerminalStep(currentStep, !motionPaused);
}, { signal });
reducedMotion.addEventListener("change", (event) => {
  applyMotionPreference(event.matches);
  void renderTerminalStep(currentStep, !event.matches);
}, { signal });

const systemFrame = document.querySelector<HTMLElement>("[data-system-frame]");
systemFrame?.addEventListener("pointermove", (event) => {
  if (motionPaused || event.pointerType === "touch") return;
  const bounds = systemFrame.getBoundingClientRect();
  const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 3.2;
  const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -3.2;
  systemFrame.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
}, { signal });
systemFrame?.addEventListener("pointerleave", () => { systemFrame.style.transform = ""; }, { signal });

const copyToast = document.querySelector<HTMLElement>("[data-copy-toast]");
let toastTimer = 0;

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard !== undefined && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await copyText(button.dataset.copy ?? "");
      const text = button.querySelector<HTMLElement>("span");
      const previous = text?.textContent;
      if (text !== null && text !== undefined) text.textContent = "Copiado";
      if (copyToast !== null) copyToast.textContent = "Comando copiado";
      copyToast?.classList.add("is-visible");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        copyToast?.classList.remove("is-visible");
      }, 1800);
      window.setTimeout(() => {
        if (text !== null && text !== undefined && previous !== undefined) text.textContent = previous;
      }, 1800);
    } catch {
      if (copyToast !== null) copyToast.textContent = "No se pudo copiar; seleccioná el comando";
      copyToast?.classList.add("is-visible");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => copyToast?.classList.remove("is-visible"), 2600);
    }
  }, { signal });
});

const terminalOutput = document.querySelector<HTMLElement>("[data-terminal-output]");
const stepButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-step]")];
const stepNumber = document.querySelector<HTMLElement>("[data-step-number]");
const stepLabel = document.querySelector<HTMLElement>("[data-step-label]");
const stepTitle = document.querySelector<HTMLElement>("[data-step-title]");
const stepDescription = document.querySelector<HTMLElement>("[data-step-description]");
const terminalKicker = document.querySelector<HTMLElement>("[data-terminal-kicker]");
const currentStepLabel = document.querySelector<HTMLElement>("[data-current-step]");
const terminalAnnouncement = document.querySelector<HTMLElement>("[data-terminal-announcement]");
let currentStep = 0;
let renderSequence = 0;
let autoAdvanceTimer = 0;
let terminalScrollFrame = 0;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function scheduleTerminalScroll(): void {
  if (terminalOutput === null || terminalScrollFrame !== 0) return;
  terminalScrollFrame = requestAnimationFrame(() => {
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    terminalScrollFrame = 0;
  });
}

function createTerminalLine(line: TerminalLine, followOutput = true): { paragraph: HTMLParagraphElement; text: Text } {
  const paragraph = document.createElement("p");
  paragraph.className = `terminal-line terminal-line--${line.kind}`;
  const text = document.createTextNode("");
  paragraph.append(text);
  terminalOutput?.append(paragraph);
  if (followOutput) scheduleTerminalScroll();
  return { paragraph, text };
}

async function typeTerminalLine(line: TerminalLine, sequence: number): Promise<boolean> {
  const { paragraph, text } = createTerminalLine(line);
  if ((line.kind !== "command" && line.kind !== "prompt") || motionPaused) {
    text.data = line.value;
    scheduleTerminalScroll();
    await wait(motionPaused ? 1 : 260);
    return sequence === renderSequence;
  }

  const cursor = document.createElement("span");
  cursor.className = "terminal-cursor";
  paragraph.append(cursor);
  for (const character of line.value) {
    if (sequence !== renderSequence) return false;
    text.data += character;
    scheduleTerminalScroll();
    await wait(character === " " ? 12 : 18 + Math.random() * 18);
  }
  cursor.remove();
  await wait(210);
  return sequence === renderSequence;
}

async function renderTerminalStep(index: number, animate = true): Promise<void> {
  const step = TERMINAL_STEPS[index];
  if (step === undefined || terminalOutput === null) return;
  currentStep = index;
  renderSequence += 1;
  const sequence = renderSequence;
  window.clearTimeout(autoAdvanceTimer);

  for (const [buttonIndex, button] of stepButtons.entries()) {
    const active = buttonIndex === index;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }

  if (stepNumber !== null) stepNumber.textContent = step.number;
  if (stepLabel !== null) stepLabel.textContent = step.label.toUpperCase();
  if (stepTitle !== null) stepTitle.textContent = step.title;
  if (stepDescription !== null) stepDescription.textContent = step.description;
  if (terminalKicker !== null) terminalKicker.textContent = `PASO ${step.number} · ${step.label.toUpperCase()}`;
  if (currentStepLabel !== null) currentStepLabel.textContent = String(index + 1);
  if (terminalAnnouncement !== null) terminalAnnouncement.textContent = `Paso ${index + 1} de ${TERMINAL_STEPS.length}: ${step.title}`;
  if (terminalScrollFrame !== 0) cancelAnimationFrame(terminalScrollFrame);
  terminalScrollFrame = 0;
  terminalOutput.replaceChildren();
  terminalOutput.scrollTop = 0;

  if (!animate || motionPaused) {
    for (const line of step.lines) createTerminalLine(line, false).text.data = line.value;
    terminalOutput.scrollTop = 0;
    return;
  }

  await wait(160);
  for (const line of step.lines) {
    if (!(await typeTerminalLine(line, sequence))) return;
  }

  const cursorLine = document.createElement("p");
  cursorLine.className = "terminal-line terminal-line--command";
  const cursor = document.createElement("span");
  cursor.className = "terminal-cursor";
  cursorLine.append(cursor);
  terminalOutput.append(cursorLine);
  scheduleTerminalScroll();

  autoAdvanceTimer = window.setTimeout(() => {
    if (sequence === renderSequence && !motionPaused) void renderTerminalStep((index + 1) % TERMINAL_STEPS.length);
  }, 3200);
}

for (const [index, button] of stepButtons.entries()) {
  button.addEventListener("click", () => void renderTerminalStep(index), { signal });
  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? stepButtons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + stepButtons.length) % stepButtons.length;
    stepButtons[target]?.focus();
    void renderTerminalStep(target);
  }, { signal });
}

document.querySelector<HTMLButtonElement>("[data-replay]")?.addEventListener("click", () => void renderTerminalStep(currentStep), { signal });
document.querySelector<HTMLButtonElement>("[data-step-previous]")?.addEventListener("click", () => void renderTerminalStep((currentStep - 1 + TERMINAL_STEPS.length) % TERMINAL_STEPS.length), { signal });
document.querySelector<HTMLButtonElement>("[data-step-next]")?.addEventListener("click", () => void renderTerminalStep((currentStep + 1) % TERMINAL_STEPS.length), { signal });

void renderTerminalStep(0, !motionPaused);

return () => {
  renderSequence += 1;
  events.abort();
  revealObserver?.disconnect();
  if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
  if (terminalScrollFrame !== 0) cancelAnimationFrame(terminalScrollFrame);
  window.clearInterval(clockTimer);
  window.clearTimeout(toastTimer);
  window.clearTimeout(autoAdvanceTimer);
  setMenu(false);
  body.classList.remove("reveal-ready");
  root.classList.remove("motion-paused");
  if (systemFrame !== null) systemFrame.style.transform = "";
};
}
