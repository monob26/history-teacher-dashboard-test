"use strict";
// Only a public Supabase publishable key belongs in this browser file.
const { supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY } =
  window.HISTORY_CONFIG;
const { teacherRedirectUrl: REDIRECT_URL } = window.HISTORY_CONFIG;
const el = (id) => document.getElementById(id);
const authScreen = el("authScreen"),
  dashboard = el("dashboard"),
  authForm = el("authForm");
const authMsg = el("authMsg"),
  authTitle = el("authTitle"),
  passwordGroup = el("passwordGroup");
const submitAuth = el("submitAuth"),
  back = el("back"),
  forgot = el("forgot");
const classSelect = el("classSelect"),
  weekSelect = el("weekSelect");
const yearButtons = [...document.querySelectorAll("[data-year]")];
let client = null,
  mode = "signin",
  approved = false,
  year = "10",
  classes = [],
  quizzes = [],
  liveRows = [];
let authGeneration = 0,
  resultsGeneration = 0,
  selectedClass = null,
  selectedQuiz = null,
  loading = false,
  resultsError = "",
  classCodes = [];
function message(value, error = false) {
  authMsg.textContent = value;
  authMsg.className = "auth-msg " + (error ? "error" : "ok");
}
function setMode(next) {
  mode = next;
  authTitle.textContent =
    next === "signin"
      ? "Teacher sign in"
      : next === "reset"
        ? "Set a new password"
        : "Reset your password";
  passwordGroup.hidden = next === "forgot";
  el("password").required = next !== "forgot";
  el("password").autocomplete = next === "reset" ? "new-password" : "current-password";
  submitAuth.textContent =
    next === "signin"
      ? "Sign in"
      : next === "reset"
        ? "Save new password"
        : "Send password reset email";
  forgot.hidden = next !== "signin";
  back.hidden = next === "signin";
  message("");
}
function option(select, value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  select.append(o);
}
function cell(row, value, className) {
  const td = document.createElement("td");
  td.textContent = value;
  if (className) td.className = className;
  row.append(td);
}
function emptyRow(text) {
  const tr = document.createElement("tr"),
    td = document.createElement("td");
  td.colSpan = 5;
  td.className = "empty";
  td.textContent = text;
  tr.append(td);
  el("results").append(tr);
}
function showSignedOut() {
  authGeneration++;
  resultsGeneration++;
  approved = false;
  classes = [];
  quizzes = [];
  liveRows = [];
  classCodes = [];
  loading = false;
  resultsError = "";
  dashboard.hidden = true;
  authScreen.hidden = false;
  el("signedIn").hidden = true;
  render();
}
function syncYear() {
  for (const b of yearButtons) b.setAttribute("aria-selected", String(b.dataset.year === year));
}
function updateSelectors() {
  const priorClass = classSelect.value,
    priorQuiz = weekSelect.value;
  classSelect.replaceChildren();
  const available = classes.filter((c) => String(c.year_group) === year);
  if (!available.length) option(classSelect, "", "No allocated classes");
  else for (const c of available) option(classSelect, c.class_name, c.class_name);
  if (available.some((c) => c.class_name === priorClass)) classSelect.value = priorClass;
  selectedClass = available.find((c) => c.class_name === classSelect.value) || null;
  weekSelect.replaceChildren();
  const availableQuizzes = quizzes.filter((q) => Number(q.year_group) === Number(year));
  if (!availableQuizzes.length) option(weekSelect, "", "No published homework");
  else
    for (const q of availableQuizzes)
      option(weekSelect, q.id, "Week " + q.week_number + " · " + q.quiz_title);
  if (availableQuizzes.some((q) => q.id === priorQuiz)) weekSelect.value = priorQuiz;
  selectedQuiz = availableQuizzes.find((q) => q.id === weekSelect.value) || null;
  classSelect.disabled = !selectedClass;
  weekSelect.disabled = !selectedQuiz;
}
function registerNumber(pupil) {
  const n = Number(pupil.register_number);
  return Number.isInteger(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}
function render() {
  const ready = approved && selectedClass && !loading && !resultsError;
  const hasQuiz = Boolean(selectedQuiz);
  const data = ready
    ? hasQuiz
      ? liveRows
      : classCodes.map((p) => ({
          pupil_code: p.pupil_code,
          register_number: p.register_number,
          attempts: 0,
          highest_score: null,
          homework_status: "No homework assigned",
        }))
    : [];
  const completed = hasQuiz ? data.filter((p) => Number(p.attempts) > 0).length : 0;
  const passed = hasQuiz ? data.filter((p) => p.homework_status === "Passed").length : 0;
  const values = {
    total: ready ? data.length : "—",
    completed: ready && hasQuiz ? completed : "—",
    passed: ready && hasQuiz ? passed : "—",
    missing: ready && hasQuiz ? data.length - completed : "—",
  };
  for (const [id, value] of Object.entries(values)) el(id).textContent = value;
  el("context").textContent =
    (selectedClass?.class_name || "No class") +
    " · " +
    (selectedQuiz ? "Week " + selectedQuiz.week_number : "No published quiz");
  el("results").replaceChildren();
  if (!approved) {
    emptyRow("Sign in to view results.");
    return;
  }
  if (!selectedClass) {
    emptyRow("No classes allocated for this year group.");
    return;
  }
  if (loading) {
    emptyRow("Loading pupil codes…");
    return;
  }
  if (resultsError) {
    emptyRow("Unable to load pupil codes or results: " + resultsError);
    return;
  }
  if (!data.length) {
    emptyRow("No pupil codes found in this class.");
    return;
  }
  data.sort(
    (a, b) => registerNumber(a) - registerNumber(b) || a.pupil_code.localeCompare(b.pupil_code),
  );
  for (const p of data) {
    const tr = document.createElement("tr");
    cell(tr, p.register_number);
    cell(tr, p.pupil_code);
    cell(tr, hasQuiz ? String(p.attempts) : "—");
    cell(
      tr,
      hasQuiz && p.highest_score !== null
        ? p.highest_score + "/" + (selectedQuiz.total_questions || 25)
        : "—",
    );
    const status = hasQuiz ? p.homework_status || "Not completed" : "No homework assigned";
    cell(
      tr,
      status,
      status === "Passed"
        ? "status passed"
        : status === "Not passed"
          ? "status notpassed"
          : "status missing",
    );
    el("results").append(tr);
  }
}
async function loadResults() {
  const generation = ++resultsGeneration;
  liveRows = [];
  classCodes = [];
  resultsError = "";
  loading = Boolean(approved && selectedClass);
  render();
  if (!loading) return;
  const classId = selectedClass.id,
    requested_class = selectedClass.class_name,
    requested_quiz = selectedQuiz?.id;
  try {
    const codeRequest = client
      .from("history_pupils")
      .select("pupil_code,register_number")
      .eq("class_id", classId);
    const resultRequest = requested_quiz
      ? client.rpc("get_history_class_results", { requested_class, requested_quiz })
      : Promise.resolve({ data: [], error: null });
    const [codesResult, resultsResult] = await Promise.all([codeRequest, resultRequest]);
    if (generation !== resultsGeneration || !approved) return;
    if (codesResult.error) throw codesResult.error;
    if (resultsResult.error) throw resultsResult.error;
    classCodes = Array.isArray(codesResult.data) ? codesResult.data : [];
    liveRows = Array.isArray(resultsResult.data) ? resultsResult.data : [];
  } catch (e) {
    if (generation !== resultsGeneration || !approved) return;
    resultsError = e.message || "Unknown error";
  } finally {
    if (generation === resultsGeneration) {
      loading = false;
      render();
    }
  }
}
async function showSignedIn(user) {
  const generation = ++authGeneration;
  dashboard.hidden = true;
  authScreen.hidden = false;
  message("Checking teacher authorisation…");
  try {
    const approval = await client.rpc("is_history_teacher");
    if (generation !== authGeneration) return;
    if (approval.error) throw approval.error;
    if (approval.data !== true) throw new Error("This account is not approved for teacher access.");
    // Both queries are filtered by database row-level security.
    const [classResult, quizResult] = await Promise.all([
      client.from("history_classes").select("id,class_name,year_group").order("class_name"),
      client
        .from("history_quizzes")
        .select("id,quiz_title,year_group,topic,week_number,total_questions,pass_mark")
        .eq("is_published", true)
        .order("week_number"),
    ]);
    if (generation !== authGeneration) return;
    if (classResult.error) throw classResult.error;
    if (quizResult.error) throw quizResult.error;
    approved = true;
    classes = classResult.data || [];
    quizzes = quizResult.data || [];
    authScreen.hidden = true;
    dashboard.hidden = false;
    el("signedIn").hidden = false;
    el("signedInEmail").textContent = user.email || "Approved teacher";
    if (!classes.some((c) => String(c.year_group) === year) && classes.length)
      year = String(classes[0].year_group);
    syncYear();
    updateSelectors();
    message("");
    await loadResults();
  } catch (e) {
    if (generation !== authGeneration) return;
    approved = false;
    classes = [];
    quizzes = [];
    dashboard.hidden = true;
    authScreen.hidden = false;
    el("signedIn").hidden = true;
    message("Access not granted: " + (e.message || "Unable to verify teacher permissions."), true);
  }
}
if (!window.supabase)
  message("The login library could not load. Check your internet connection.", true);
else {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { detectSessionInUrl: true, autoRefreshToken: true, persistSession: true },
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showSignedOut();
      setMode("reset");
      return;
    }
    if (session?.user) {
      if (mode !== "reset") showSignedIn(session.user);
    } else showSignedOut();
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) message(error.message, true);
    else if (data.session?.user && mode !== "reset") showSignedIn(data.session.user);
  });
}
forgot.addEventListener("click", () => setMode("forgot"));
back.addEventListener("click", () => setMode("signin"));
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!client) {
    message("Supabase configuration is not complete.", true);
    return;
  }
  const email = el("email").value.trim(),
    password = el("password").value;
  submitAuth.disabled = true;
  message("Please wait…");
  try {
    let result;
    if (mode === "signin") result = await client.auth.signInWithPassword({ email, password });
    else if (mode === "forgot")
      result = await client.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL });
    else result = await client.auth.updateUser({ password });
    if (result.error) throw result.error;
    if (mode === "forgot")
      message("If the address belongs to an account, a recovery email will be sent.");
    else if (mode === "reset") {
      await client.auth.signOut();
      setMode("signin");
      message("Password saved. Please sign in.");
    } else if (result.data?.user) showSignedIn(result.data.user);
  } catch (e) {
    message(e.message || "Something went wrong.", true);
  } finally {
    submitAuth.disabled = false;
  }
});
el("signOut").addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  showSignedOut();
  setMode("signin");
});
for (const b of yearButtons)
  b.addEventListener("click", () => {
    year = b.dataset.year;
    syncYear();
    updateSelectors();
    loadResults();
  });
classSelect.addEventListener("change", () => {
  selectedClass =
    classes.find((c) => c.class_name === classSelect.value && String(c.year_group) === year) ||
    null;
  loadResults();
});
weekSelect.addEventListener("change", () => {
  selectedQuiz = quizzes.find((q) => q.id === weekSelect.value) || null;
  loadResults();
});
updateSelectors();
render();
