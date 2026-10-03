const screen = document.getElementById("screen");
const bottomNav = document.getElementById("bottomNav");
const sourceStatus = document.getElementById("sourceStatus");
const logoutButton = document.getElementById("logoutButton");
const toastElement = document.getElementById("toast");
const state = {
  authenticated: false,
  recoveryAvailable: false,
  page: "login",
  history: [],
  selectedJourney: null,
  latestJourney: null,
  language: "en",
  initialError: "",
  alertJourneyId: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => toastElement.classList.remove("show"), 3600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body !== "string" && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(path, {
    ...options,
    body,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || `Request failed (${response.status}).`);
    error.status = response.status;
    if (response.status === 401 && path !== "/api/session") {
      state.authenticated = false;
      state.recoveryAvailable = true;
      state.page = "login";
      state.initialError = "Your 15-day inactive session expired. Enter the same number on this browser to restore your private progress.";
      render();
    }
    throw error;
  }
  return payload;
}

function setPage(page) {
  state.page = page;
  render();
  screen.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateNav() {
  bottomNav.classList.toggle("hidden", !state.authenticated);
  document.querySelector('[data-page="profile"]').classList.toggle("hidden", !state.authenticated);
  for (const button of bottomNav.querySelectorAll("button")) {
    const active = button.dataset.page === state.page
      || (state.page === "journey-detail" && button.dataset.page === "journeys")
      || (state.page === "journey-complete" && button.dataset.page === "journeys")
      || (state.page === "journey-ready" && button.dataset.page === "home")
      || (state.page === "pesel" && button.dataset.page === "explore");
    button.classList.toggle("active", active);
  }
  logoutButton.classList.toggle("hidden", !state.authenticated);
}

function renderLogin() {
  screen.innerHTML = `
    <section class="hero login-hero">
      <p class="eyebrow">A new chapter</p>
      <h1>Make Poland<br>a little easier.</h1>
      <p class="lead">A friendly guide to official steps, local services and the life you’re building here.</p>
    </section>
    <section class="card">
      <p class="eyebrow">${state.recoveryAvailable ? "Welcome back" : "Start your private profile"}</p>
      <h2>${state.recoveryAvailable ? "Continue on this device" : "Let’s get started"}</h2>
      <p class="subtle">${state.recoveryAvailable
        ? "Enter the same phone number to reopen the private profile linked to this browser."
        : "Enter your phone number to create a private, device-bound profile. No code is sent for this demo."}</p>
      <form id="sessionForm">
        <div class="field">
          <label for="phone">Phone number with country code</label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+48 600 000 000" required maxlength="24">
        </div>
        <p id="sessionError" class="inline-error" role="alert">${escapeHtml(state.initialError)}</p>
        <button class="primary-button wide" type="submit">${state.recoveryAvailable ? "Continue to my profile" : "Continue without a code"} <span aria-hidden="true">→</span></button>
      </form>
      <p class="privacy-note">Your number is not verified and is not sent to the assistant. It is stored as a protected hash to keep profiles unique. Your journeys are private to this browser; clear browser data or use another device and they cannot be recovered. Active sessions sign out after 15 days without activity.</p>
    </section>`;
  document.getElementById("sessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const error = document.getElementById("sessionError");
    button.disabled = true;
    error.textContent = "";
    try {
      await api("/api/session", {
        method: "POST",
        body: { phone: document.getElementById("phone").value },
      });
      state.authenticated = true;
      state.recoveryAvailable = false;
      state.initialError = "";
      await loadConversation();
      setPage("home");
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      button.disabled = false;
    }
  });
}

function renderHome() {
  screen.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Your life in Poland</p>
      <h1>One step at a time.</h1>
      <p class="lead">Tell us what you’re working through. We’ll help you find the official next steps, with sources you can check.</p>
      <button class="primary-button" data-action="new-chat">Start a journey <span aria-hidden="true">→</span></button>
    </section>
    ${state.history.length ? `<button class="card card-click wide" data-action="continue-chat">
      <span class="eyebrow">Your open conversation</span><strong>Continue where you left off</strong><p class="subtle">Your conversation is saved privately to this browser profile.</p>
    </button>` : ""}
    <div class="page-heading"><div><p class="eyebrow">Find your way</p><h2>What would you like help with?</h2></div></div>
    <div class="tile-grid">
      ${[
        ["⌂", "Residence & documents", "Permits, registration and everyday paperwork", "I need help with residence and official documents in Poland."],
        ["◈", "PESEL number", "What it is and how to apply", "I need to understand how to get a PESEL number."],
        ["♡", "Marriage & family", "Civil registry steps and documents", "I need information about getting married in Poland."],
        ["✳", "City life & events", "Find official local information", "I’m looking for local events and city services."],
      ].map(([icon, title, description, topic]) => `
        <button class="tile" data-topic="${escapeHtml(topic)}"><span class="tile-icon">${icon}</span><strong>${title}</strong><small>${description}</small></button>
      `).join("")}
    </div>
    <section class="card">
      <p class="eyebrow">A little Polish goes a long way</p>
      <h3>Useful words for your next visit</h3>
      <p class="subtle">Learn a few practical phrases before you go to an office.</p>
      <button class="quiet-button" data-page="learn">Explore Polish phrases <span aria-hidden="true">→</span></button>
    </section>`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function renderSources(sources = []) {
  if (!sources.length) return "";
  return `<div class="chat-sources">${sources.map((source) => `
    <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
      [${escapeHtml(source.id)}] ${escapeHtml(source.title)}
      <small> · ${escapeHtml(source.source || "official source")}${source.fetched_at ? ` · fetched ${escapeHtml(formatDate(source.fetched_at))}` : ""}</small>
    </a>`).join("")}</div>`;
}

function renderChatMessage(message, sources = []) {
  return `<article class="chat-message ${message.role === "user" ? "user" : "assistant"}">
    <div class="chat-bubble">${escapeHtml(message.content)}</div>
    ${renderSources(sources)}
  </article>`;
}

function renderChat() {
  const greeting = state.history.length ? "" : `
    <div class="chat-welcome">
      <div class="round-icon" aria-hidden="true">✳</div>
      <h3>What brings you here today?</h3>
      <p class="subtle">I’ll ask a few questions, then help you map out the next steps from official sources.</p>
      <div class="stack">
        <button class="secondary-button" data-topic="I need help applying for a residence permit.">Help with residence</button>
        <button class="secondary-button" data-topic="I want to understand health insurance in Poland.">Understand health insurance</button>
        <button class="secondary-button" data-topic="I’m looking for local events in Kraków.">Find local events</button>
      </div>
    </div>`;
  screen.innerHTML = `
    <div class="page-heading">
      <div><button class="back-button" data-page="home">← Home</button><p class="eyebrow">Your personal guide</p><h2>Let’s talk it through.</h2></div>
      <select id="language" class="language-select" aria-label="Assistant language">
        <option value="en" ${state.language === "en" ? "selected" : ""}>EN</option><option value="pl" ${state.language === "pl" ? "selected" : ""}>PL</option><option value="uk" ${state.language === "uk" ? "selected" : ""}>UK</option>
      </select>
    </div>
    <section class="chat-shell" aria-label="SmartIN assistant chat">
      <div id="chatMessages" class="chat-messages" aria-live="polite">
        ${greeting}
        ${state.history.map((message) => renderChatMessage(message)).join("")}
      </div>
      <form id="chatForm" class="chat-composer">
        <textarea id="chatInput" class="chat-input" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Your message"></textarea>
        <button class="send-button" id="sendButton" type="submit" aria-label="Send">↑</button>
      </form>
      <p class="chat-hint">Enter to send · Shift+Enter for a new line</p>
    </section>
    <p class="privacy-note">Please don’t share sensitive information. Your message and relevant official excerpts are sent to Anthropic to prepare a response. This is general information, not legal advice.</p>`;
  const messageList = document.getElementById("chatMessages");
  messageList.scrollTop = messageList.scrollHeight;
  document.getElementById("chatForm").addEventListener("submit", submitChat);
  document.getElementById("language").addEventListener("change", (event) => {
    state.language = event.target.value;
  });
  document.getElementById("chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      document.getElementById("chatForm").requestSubmit();
    }
  });
}

async function submitChat(event) {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const answer = input.value.trim();
  if (!answer) return;
  state.language = document.getElementById("language").value;
  const language = state.language;
  state.history.push({ role: "user", content: answer });
  state.page = "chat";
  renderChat();
  document.getElementById("sendButton").disabled = true;
  document.getElementById("chatInput").disabled = true;
  const messageList = document.getElementById("chatMessages");
  const pending = document.createElement("div");
  pending.className = "loading-row";
  pending.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Finding official information…</span>';
  messageList.appendChild(pending);
  messageList.scrollTop = messageList.scrollHeight;
  try {
    const result = await api("/api/interview", {
      method: "POST",
      body: {
        answer,
        history: state.history.slice(0, -1).slice(-12),
        language,
      },
    });
    const assistantText = result.outcome === "interview"
      ? `${result.message}\n\n${result.question}`
      : result.message;
    state.history.push({ role: "assistant", content: assistantText });
    if (result.outcome === "journey" && result.saved_journey_id) {
      state.latestJourney = await api(`/api/journeys/${result.saved_journey_id}`);
      if (state.page === "chat") {
        state.page = "journey-ready";
        render();
      } else {
        toast("Your source-backed journey has been saved.");
      }
      return;
    }
    if (state.page !== "chat") return;
    renderChat();
    const freshMessages = document.getElementById("chatMessages");
    const last = freshMessages.lastElementChild;
    if (last) {
      const sourceNode = document.createElement("div");
      sourceNode.innerHTML = renderSources(result.sources || []);
      if (sourceNode.firstElementChild) last.appendChild(sourceNode.firstElementChild);
    }
    freshMessages.scrollTop = freshMessages.scrollHeight;
  } catch (error) {
    if (error.status !== 401) toast(error.message);
    if (error.status !== 401) {
      state.history.push({ role: "assistant", content: "I couldn’t complete that just now. Please try again in a moment." });
      if (state.authenticated && state.page === "chat") renderChat();
    }
  } finally {
    if (state.page === "chat") {
      const send = document.getElementById("sendButton");
      if (send) send.disabled = false;
      const chatInput = document.getElementById("chatInput");
      if (chatInput) {
        chatInput.disabled = false;
        chatInput.focus();
      }
    }
  }
}

function renderJourneyBlocks(record, interactive) {
  const result = record.journey || record;
  const blocks = result.journey_blocks || [];
  const sources = new Map((result.sources || []).map((source) => [source.id, source]));
  const completed = new Set(record.completed_steps || []);
  return blocks.map((block, index) => {
    const facts = [
      block.where && `Where: ${block.where}`,
      block.documents?.length && `Documents: ${block.documents.join(", ")}`,
      block.fee && `Fee: ${block.fee}`,
      block.deadline && `Deadline: ${block.deadline}`,
    ].filter(Boolean);
    return `<article class="journey-step">
      <div class="step-head">
        ${interactive ? `<input class="step-check" type="checkbox" data-step="${index}" aria-label="Mark step ${index + 1} complete" ${completed.has(index) ? "checked" : ""}>` : `<span class="step-number">${String(index + 1).padStart(2, "0")}</span>`}
        <div>
          <h3 class="step-title">${escapeHtml(block.title)}</h3>
          <p class="step-action">${escapeHtml(block.action)}</p>
          ${facts.length ? `<p class="step-facts">${escapeHtml(facts.join("\n"))}</p>` : ""}
          ${(block.source_ids || []).map((id) => {
            const source = sources.get(id);
            return source ? `<a class="journey-source" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">[${escapeHtml(id)}] ${escapeHtml(source.title)}${source.fetched_at ? ` · ${escapeHtml(formatDate(source.fetched_at))}` : ""}</a>` : "";
          }).join("")}
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderJourneyReady() {
  const record = state.latestJourney;
  if (!record) {
    setPage("journeys");
    return;
  }
  const journey = record.journey || {};
  screen.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Your journey is ready</p>
      <h1>A clearer path forward.</h1>
      <p class="lead">${escapeHtml(journey.message || "Here are suggested next steps based on official information.")}</p>
    </section>
    ${journey.needs_official_help ? `<p class="warning">This situation may need an official or professional. Please confirm with the responsible office.</p>` : ""}
    ${renderJourneyBlocks(record, false)}
    <div class="stack">
      <button class="primary-button wide" data-action="open-latest">Open my journey</button>
      <button class="secondary-button wide" data-action="new-chat">Ask another question</button>
    </div>`;
}

async function renderJourneys() {
  screen.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>Loading your journeys…</span></div>`;
  try {
    const result = await api("/api/journeys");
    if (state.page !== "journeys") return;
    const journeys = result.journeys;
    screen.innerHTML = `
      <div class="page-heading"><div><p class="eyebrow">Saved privately on this device</p><h1>My journeys</h1></div></div>
      ${journeys.length ? journeys.map((item) => `
        <button class="card card-click wide list-item" data-journey="${item.id}">
          <span><span class="pill">${escapeHtml(item.language.toUpperCase())}</span><h3 style="margin-top:9px">${escapeHtml(item.title)}</h3><p class="subtle">${escapeHtml(item.goal)}</p><small class="subtle">Updated ${escapeHtml(formatDate(item.updated_at))}</small></span><span class="arrow">→</span>
        </button>`).join("") : `
        <section class="card empty-state"><div class="round-icon" aria-hidden="true">✓</div><h3>Your journeys will live here</h3><p class="subtle">Start a chat and we’ll save your source-backed next steps in this private profile.</p><button class="primary-button" data-action="new-chat">Start a journey</button></section>`}`;
  } catch (error) {
    if (state.page !== "journeys") return;
    screen.innerHTML = `<section class="card"><h2>Couldn’t load journeys</h2><p class="subtle">${escapeHtml(error.message)}</p><button class="secondary-button" data-page="home">Back home</button></section>`;
  }
}

async function renderJourneyDetail() {
  const selected = state.selectedJourney;
  if (!selected) {
    setPage("journeys");
    return;
  }
  screen.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>Opening your journey…</span></div>`;
  try {
    const record = await api(`/api/journeys/${selected}`);
    if (state.page !== "journey-detail" || state.selectedJourney !== selected) return;
    state.selectedJourney = record.id;
    const journey = record.journey || {};
    screen.innerHTML = `
      <button class="back-button" data-page="journeys">← My journeys</button>
      <div class="page-heading"><div><p class="eyebrow">Your step-by-step plan</p><h1>${escapeHtml(record.title)}</h1><p class="subtle">Started ${escapeHtml(formatDate(record.created_at))}</p></div></div>
      ${journey.needs_official_help ? `<p class="warning">This situation may need an official or professional. Please confirm with the responsible office.</p>` : ""}
      <p class="lead">${escapeHtml(journey.message || "")}</p>
      <div id="journeySteps">${renderJourneyBlocks(record, true)}</div>
      <div class="stack">
        <button class="secondary-button wide" data-action="remind" data-id="${record.id}">＋ Set a reminder</button>
        <button class="danger-button wide" data-action="delete-journey" data-id="${record.id}">Delete this journey</button>
      </div>`;
    screen.querySelectorAll(".step-check").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const completed = [...screen.querySelectorAll(".step-check")]
          .filter((item) => item.checked)
          .map((item) => Number(item.dataset.step));
        checkbox.disabled = true;
        try {
          await api(`/api/journeys/${record.id}/progress`, {
            method: "PATCH",
            body: { completed_steps: completed },
          });
          if (completed.length === (journey.journey_blocks || []).length && completed.length > 0) {
            state.latestJourney = { ...record, completed_steps: completed };
            setPage("journey-complete");
          }
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          toast(error.message);
        } finally {
          checkbox.disabled = false;
        }
      });
    });
  } catch (error) {
    if (state.page !== "journey-detail" || state.selectedJourney !== selected) return;
    screen.innerHTML = `<section class="card"><h2>Journey unavailable</h2><p class="subtle">${escapeHtml(error.message)}</p><button class="secondary-button" data-page="journeys">Back to journeys</button></section>`;
  }
}

function renderJourneyComplete() {
  const record = state.latestJourney;
  if (!record) {
    setPage("journeys");
    return;
  }
  const journey = record.journey || {};
  screen.innerHTML = `
    <section class="card completion-card">
      <div class="round-icon" aria-hidden="true">✓</div>
      <p class="eyebrow">Journey complete</p>
      <h1>Look how far you’ve come.</h1>
      <p class="lead">You’ve marked every step in “${escapeHtml(record.title)}” as complete. Keep your source links handy in case you need to check anything again.</p>
      <button class="primary-button wide" data-action="open-completed">View my completed journey</button>
    </section>
    ${journey.needs_official_help ? `<p class="warning">For this situation, please still confirm the outcome with the responsible official office or professional.</p>` : ""}
    <button class="quiet-button wide" data-page="home">Back to home</button>`;
}

function renderExplore() {
  const categories = [
    ["⌂", "Moving & residence", "Residence permits, registration and everyday administration", "I need help with moving to Poland or residence procedures."],
    ["◈", "PESEL", "Understand the number and official application route", "I need help understanding the PESEL number and how to apply."],
    ["♡", "Marriage & family", "Civil registry information and family matters", "I need help with marriage or family procedures in Poland."],
    ["✳", "Work & business", "Official guidance for work, tax and starting a business", "I need information about work, taxes or starting a business in Poland."],
    ["＋", "Health & insurance", "Public healthcare, NFZ and social insurance", "I need help understanding health insurance and NFZ in Poland."],
    ["◎", "City life & events", "Official events and municipal services in Kraków and Warsaw", "I’m looking for official events or city services in Kraków or Warsaw."],
  ];
  screen.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Official information</p><h1>Explore topics</h1><p class="subtle">Choose a starting point. The assistant will ask what it needs to tailor your next steps.</p></div></div>
    ${categories.map(([icon, title, description, topic]) => `<button class="card card-click wide list-item" data-topic="${escapeHtml(topic)}"><span class="tile-icon">${icon}</span><span style="flex:1"><h3>${title}</h3><p class="subtle">${description}</p></span><span class="arrow">→</span></button>`).join("")}
    <section class="card"><p class="eyebrow">A focused guide</p><h3>Need a PESEL number?</h3><p class="subtle">Start with an official-source-backed guide and get a plan that fits your situation.</p><button class="secondary-button" data-page="pesel">Open PESEL guide</button></section>`;
}

function renderPesel() {
  screen.innerHTML = `
    <button class="back-button" data-page="explore">← Explore topics</button>
    <section class="hero"><p class="eyebrow">Step guide</p><h1>Getting a PESEL number</h1><p class="lead">The right route depends on why you need one and your situation. Let’s find the official information that applies to you.</p><button class="primary-button" data-topic="I need to get a PESEL number. Can you ask me what you need to find the right official process?">Find my next steps <span aria-hidden="true">→</span></button></section>
    <section class="card"><h3>What we’ll clarify</h3><p class="subtle">We may ask what you need the number for, whether you live in Poland, and which city applies. Please don’t share the number itself or other sensitive documents.</p></section>
    <section class="card"><h3>Source-first, not guesswork</h3><p class="subtle">The assistant uses the latest available official excerpts and links to the source page. Confirm current requirements with the responsible office.</p></section>`;
}

function renderLearn() {
  const phrases = [
    ["Dzień dobry", "Good morning / Hello", "A polite greeting when entering an office."],
    ["Proszę", "Please / Here you are", "Useful when asking for help or handing over a document."],
    ["Dziękuję", "Thank you", "A simple way to end a request."],
    ["Poproszę o pomoc", "I’d like to ask for help", "A friendly way to start a conversation."],
    ["Gdzie jest urząd?", "Where is the office?", "Ask where the local public office is."],
    ["Jakie dokumenty są potrzebne?", "Which documents are needed?", "Ask what paperwork to bring."],
  ];
  screen.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Small words, big confidence</p><h1>Learn Polish</h1><p class="subtle">A few phrases to make everyday official visits feel easier.</p></div></div>
    <section class="card">${phrases.map(([polish, english, note]) => `<div class="phrase"><strong>${polish}</strong><small>${english} · ${note}</small></div>`).join("")}</section>
    <p class="privacy-note">These are practical language examples, not official terminology. For process-specific terms, ask the assistant and check the cited source.</p>`;
}

function renderProfile() {
  screen.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Your account</p><h1>Profile settings</h1><p class="subtle">Manage your app preferences and understand how this private guest profile works.</p></div></div>
    <section class="card">
      <p class="eyebrow">Device-bound guest profile</p>
      <h3>Your progress stays with this browser</h3>
      <p class="subtle">Your phone number is not verified and is never shown to the assistant. A protected hash is used to link this browser to your private profile. If you clear browser data or switch devices, the profile cannot be recovered with the number alone.</p>
      <p class="subtle">Your session signs out after 15 days without activity. Saved conversations and journeys remain in Supabase after sign-out.</p>
    </section>
    <section class="card">
      <div class="field">
        <label for="profileLanguage">Preferred assistant language</label>
        <select id="profileLanguage">
          <option value="en" ${state.language === "en" ? "selected" : ""}>English</option>
          <option value="pl" ${state.language === "pl" ? "selected" : ""}>Polski</option>
          <option value="uk" ${state.language === "uk" ? "selected" : ""}>Українська</option>
        </select>
      </div>
      <p class="subtle">You can also change the language from the chat screen. The preference is kept for this visit.</p>
    </section>
    <section class="card">
      <h3>Your private information</h3>
      <p class="subtle">The assistant does not need your PESEL, document number, exact address, or other sensitive details. Please do not enter them in chat.</p>
      <div class="stack">
        <button class="secondary-button" data-page="journeys">Open saved journeys</button>
        <button class="secondary-button" data-page="alerts">Open reminders</button>
        <button class="danger-button" data-action="logout">Sign out of this device</button>
      </div>
    </section>`;
  document.getElementById("profileLanguage").addEventListener("change", (event) => {
    state.language = event.target.value;
    toast("Assistant language updated for this visit.");
  });
}

async function renderAlerts() {
  screen.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Just for you</p><h1>Your reminders</h1><p class="subtle">In-app reminders stay in this profile. They don’t send email or push notifications.</p></div></div>
    <section class="card">
      <h3>Create a reminder</h3>
      <form id="alertForm">
        <div class="field"><label for="alertTitle">What would you like to remember?</label><input id="alertTitle" maxlength="160" required placeholder="For example, check the office opening hours"></div>
        <div class="field"><label for="alertBody">Note (optional)</label><textarea id="alertBody" maxlength="1000" placeholder="Add a short note"></textarea></div>
        <div class="field"><label for="alertDate">Date and time (optional)</label><input id="alertDate" type="datetime-local"></div>
        <button class="primary-button wide" type="submit">Save reminder</button>
      </form>
    </section>
    <div id="alertList"><div class="loading-row"><span class="spinner"></span><span>Loading reminders…</span></div></div>`;
  document.getElementById("alertForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = document.getElementById("alertDate").value;
    try {
      await api("/api/alerts", {
        method: "POST",
        body: {
          title: document.getElementById("alertTitle").value,
          body: document.getElementById("alertBody").value,
          due_at: date ? new Date(date).toISOString() : null,
          journey_id: state.alertJourneyId || null,
        },
      });
      state.alertJourneyId = "";
      toast("Reminder saved to your private profile.");
      if (state.page === "alerts") renderAlerts();
    } catch (error) {
      toast(error.message);
    }
  });
  try {
    const { alerts } = await api("/api/alerts");
    if (state.page !== "alerts") return;
    const list = document.getElementById("alertList");
    list.innerHTML = alerts.length ? alerts.map((alert) => `
      <article class="card alert-row">
        <input type="checkbox" data-alert-read="${alert.id}" aria-label="Mark reminder as read" ${alert.is_read ? "checked" : ""}>
        <div style="flex:1"><h3>${escapeHtml(alert.title)}</h3><p class="subtle">${escapeHtml(alert.body || "")}</p>${alert.due_at ? `<small class="subtle">${escapeHtml(formatDate(alert.due_at))}</small>` : ""}</div>
        <button class="quiet-button" data-delete-alert="${alert.id}" aria-label="Delete reminder">×</button>
      </article>`).join("") : `<section class="card empty-state"><div class="round-icon">♧</div><h3>No reminders yet</h3><p class="subtle">Create a private in-app reminder above.</p></section>`;
    list.querySelectorAll("[data-alert-read]").forEach((input) => input.addEventListener("change", async () => {
      try {
        await api(`/api/alerts/${input.dataset.alertRead}`, { method: "PATCH", body: { is_read: input.checked } });
      } catch (error) { toast(error.message); }
    }));
    list.querySelectorAll("[data-delete-alert]").forEach((button) => button.addEventListener("click", async () => {
      try {
        await api(`/api/alerts/${button.dataset.deleteAlert}`, { method: "DELETE" });
        if (state.page === "alerts") renderAlerts();
      } catch (error) { toast(error.message); }
    }));
  } catch (error) {
    if (state.page === "alerts") {
      document.getElementById("alertList").innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
    }
  }
}

function render() {
  updateNav();
  switch (state.page) {
    case "login": renderLogin(); break;
    case "home": renderHome(); break;
    case "chat": renderChat(); break;
    case "journey-ready": renderJourneyReady(); break;
    case "journey-complete": renderJourneyComplete(); break;
    case "journeys": renderJourneys(); break;
    case "journey-detail": renderJourneyDetail(); break;
    case "explore": renderExplore(); break;
    case "pesel": renderPesel(); break;
    case "learn": renderLearn(); break;
    case "profile": renderProfile(); break;
    case "alerts": renderAlerts(); break;
    default: state.page = "home"; renderHome();
  }
  updateNav();
}

async function loadConversation() {
  const result = await api("/api/conversation");
  state.history = Array.isArray(result.history) ? result.history : [];
}

document.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    setPage(pageButton.dataset.page);
    return;
  }
  const topicButton = event.target.closest("[data-topic]");
  if (topicButton) {
    state.page = "chat";
    renderChat();
    const input = document.getElementById("chatInput");
    input.value = topicButton.dataset.topic;
    document.getElementById("chatForm").requestSubmit();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "new-chat") {
    state.page = "chat";
    renderChat();
    document.getElementById("chatInput").focus();
  } else if (action.dataset.action === "continue-chat") {
    setPage("chat");
  } else if (action.dataset.action === "open-latest" && state.latestJourney?.id) {
    state.selectedJourney = state.latestJourney.id;
    setPage("journey-detail");
  } else if (action.dataset.action === "open-completed" && state.latestJourney?.id) {
    state.selectedJourney = state.latestJourney.id;
    setPage("journey-detail");
  } else if (action.dataset.action === "remind") {
    state.alertJourneyId = action.dataset.id;
    setPage("alerts");
  } else if (action.dataset.action === "delete-journey") {
    if (!window.confirm("Delete this journey from your private profile?")) return;
    try {
      await api(`/api/journeys/${action.dataset.id}`, { method: "DELETE" });
      state.selectedJourney = null;
      toast("Journey deleted.");
      setPage("journeys");
    } catch (error) { toast(error.message); }
  } else if (action.dataset.action === "logout") {
    logoutButton.click();
  }
  const journeyButton = event.target.closest("[data-journey]");
  if (journeyButton) {
    state.selectedJourney = journeyButton.dataset.journey;
    setPage("journey-detail");
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/session/logout", { method: "POST" });
    state.authenticated = false;
    state.recoveryAvailable = true;
    state.history = [];
    state.selectedJourney = null;
    state.latestJourney = null;
    state.alertJourneyId = "";
    state.initialError = "You’re signed out. Enter the same number on this browser to continue your private profile.";
    setPage("login");
  } catch (error) { toast(error.message); }
});

async function initialize() {
  try {
    const status = await api("/api/status");
    const source = status.knowledge_source || "Official information";
    sourceStatus.querySelector("span").textContent = source === "Supabase"
      ? "Official sources"
      : status.loaded_pages ? `${status.loaded_pages.toLocaleString()} sources` : "Sources unavailable";
    sourceStatus.classList.toggle("ready", source === "Supabase" || Boolean(status.loaded_pages));
    sourceStatus.classList.toggle("error", Boolean(status.knowledge_error));
  } catch {
    sourceStatus.querySelector("span").textContent = "Sources unavailable";
    sourceStatus.classList.add("error");
  }
  try {
    const session = await api("/api/session");
    state.authenticated = session.authenticated;
    state.recoveryAvailable = session.recovery_available;
    if (state.authenticated) {
      await loadConversation();
      state.page = "home";
    } else {
      state.page = "login";
      if (session.recovery_available) {
        state.initialError = "Your session expired. Enter the same phone number on this browser to restore your progress.";
      }
    }
  } catch (error) {
    state.authenticated = false;
    state.page = "login";
    state.initialError = error.message;
  }
  render();
}

initialize();
