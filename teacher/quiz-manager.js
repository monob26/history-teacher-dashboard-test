(function () {
  "use strict";
  const C = window.QUIZ_CONTRACT,
    $ = (id) => document.getElementById(id);
  const clone = (v) => structuredClone(v);
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const n = node("button", text, "secondary");
    n.type = "button";
    n.addEventListener("click", fn);
    return n;
  };
  const option = (select, value, text) => {
    const n = node("option", text);
    n.value = value;
    select.append(n);
  };
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let client = null,
    identity = null,
    generation = 0,
    listGeneration = 0,
    importGeneration = 0,
    rows = [],
    record = null,
    year = 10,
    seq = 0,
    savedSeq = 0,
    saving = false,
    timer = null,
    conflict = false,
    imported = null,
    replacing = null,
    preview = null,
    previewClock = null;
  const dirty = () => !!record && seq !== savedSeq;
  const editable = () => record?.state === "draft" && !record.first_started_at;
  const stateLabel = (q) =>
    q.state === "scheduled" && Date.parse(q.release_at) <= Date.now() ? "published" : q.state;
  const publication = window.QUIZ_PUBLICATION.create({
    client: () => client,
    record: () => record,
    save,
    reload: (id) => openQuiz(id, true),
    preview: startPreview,
    error: tell,
  });
  function tell(message = "") {
    $("qmMessage").textContent = message;
    $("qmMessage").hidden = !message;
  }
  function status(message) {
    $("qmStatus").textContent = message;
  }
  function canLeave() {
    return !dirty() || window.confirm("There are unsaved quiz changes. Leave this view anyway?");
  }
  function disconnect() {
    publication.close();
    generation++;
    importGeneration++;
    client = null;
    identity = null;
    record = null;
    rows = [];
    seq = savedSeq = 0;
    saving = false;
    conflict = false;
    clearTimeout(timer);
    clearInterval(previewClock);
    preview = null;
    for (const id of ["qmCreate", "qmReplace", "qmPreview"]) if ($(id).open) $(id).close();
    $("quizManager").hidden = true;
    $("dashboardSections").hidden = true;
    $("overviewPanels").hidden = false;
    $("managerTab").setAttribute("aria-pressed", "false");
    $("overviewTab").setAttribute("aria-pressed", "true");
    $("qmQuestions").replaceChildren();
    $("qmRows").replaceChildren();
    $("qmSimulation").replaceChildren();
    $("qmReplaceJSON").value = "";
    for (const id of ["qmTitle", "qmTopic", "qmWeek", "qmNewTitle", "qmImportFile"])
      $(id).value = "";
    for (const id of ["qmMetadata", "qmCount", "qmValidation", "qmImportSummary", "qmCreateError"])
      $(id).replaceChildren();
    tell();
    status("");
    imported = null;
  }
  function connect(next, who) {
    // Stage 2 is authorised for this TEST project only. This is a release guard,
    // not a replacement for backend teacher authorisation.
    if (window.HISTORY_CONFIG.supabaseUrl !== "https://ohkpvuhzvshjglbqyepq.supabase.co") return;
    if (identity && identity !== who) disconnect();
    client = next;
    identity = who;
    $("dashboardSections").hidden = false;
  }
  async function write(action, payload = {}, id = record?.id, revision = record?.revision) {
    if (!client) throw new Error("Teacher session ended. Sign in again.");
    const result = await client.rpc("quiz_manager_write", {
      action,
      quiz_id: id || null,
      expected_revision: revision ?? null,
      payload,
    });
    if (result.error)
      throw new Error(
        result.error.status === 401
          ? "Teacher session ended. Sign in again."
          : result.error.message || "Request failed",
      );
    if (!result.data?.ok) {
      const code = result.data?.error || "request_failed";
      const messages = {
        revision_conflict:
          "Another save changed this quiz. Export your changes, then reload the saved version.",
        quiz_locked:
          "A pupil has started this quiz. Its questions and scoring are permanently locked. Duplicate it to make corrections.",
        take_offline_first: "Take this quiz offline before editing. It will need reapproval.",
        teacher_required: "Teacher authorisation is no longer valid. Sign in again.",
        draft_has_references: "This draft has linked records and cannot be deleted.",
      };
      const error = new Error(messages[code] || "Unable to save: " + code);
      error.code = code;
      throw error;
    }
    return result.data;
  }
  async function loadList() {
    if (!client) return;
    const token = generation;
    const request = ++listGeneration;
    const requestedYear = year;
    status("Loading quizzes…");
    tell();
    try {
      const result = await client
        .from("quiz_manager_quizzes")
        .select("id,title,year_group,state,release_at,updated_at")
        .eq("year_group", year)
        .order("updated_at", { ascending: false });
      if (token !== generation || request !== listGeneration || requestedYear !== year) return;
      if (result.error) throw result.error;
      rows = result.data || [];
      renderList();
      status("Quizzes loaded");
    } catch (e) {
      if (token === generation && request === listGeneration && requestedYear === year) {
        tell("Unable to load quizzes. " + e.message);
        status("Load failed — retry with Refresh list");
      }
    }
  }
  function renderList() {
    $("qmRows").replaceChildren();
    const search = $("qmSearch").value.toLowerCase(),
      filter = $("qmFilter").value;
    const list = rows.filter(
      (r) =>
        r.year_group === year &&
        r.title.toLowerCase().includes(search) &&
        (!filter || stateLabel(r) === filter),
    );
    for (const r of list) {
      const tr = node("tr"),
        name = node("td");
      name.append(button(r.title, () => openQuiz(r.id)));
      tr.append(
        name,
        node("td", stateLabel(r)),
        node(
          "td",
          r.release_at
            ? new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Europe/London",
              }).format(new Date(r.release_at))
            : "—",
        ),
      );
      $("qmRows").append(tr);
    }
    if (!list.length) {
      const tr = node("tr"),
        td = node("td", "No quizzes match this year and filter.");
      td.colSpan = 3;
      tr.append(td);
      $("qmRows").append(tr);
    }
    for (const b of $("qmYears").children)
      b.setAttribute("aria-pressed", String(Number(b.dataset.qmYear) === year));
  }
  async function openQuiz(id, force = false) {
    if (!force && !canLeave()) return;
    const token = ++generation;
    clearTimeout(timer);
    status("Opening quiz…");
    tell();
    try {
      const result = await client.from("quiz_manager_quizzes").select("*").eq("id", id).single();
      if (token !== generation) return;
      if (result.error) throw result.error;
      record = clone(result.data);
      record.content.questions = record.content.questions.map((q) => {
        if (!Object.hasOwn(C.types, q.type))
          throw new Error("Unsupported question type in saved draft");
        const defaults = C.blank(q.type);
        const next = { ...defaults, ...q };
        if (defaults.answers) next.answers = { ...defaults.answers, ...q.answers };
        return next;
      });
      seq = savedSeq = 0;
      conflict = false;
      saving = false;
      $("qmList").hidden = true;
      $("qmEditor").hidden = false;
      renderEditor();
      status("Saved · revision " + record.revision);
      $("qmHeading").focus();
    } catch (e) {
      if (token === generation) tell("Unable to open quiz. " + e.message);
    }
  }
  function payload() {
    return {
      title: record.title,
      year_group: record.year_group,
      topic: record.topic || null,
      week_number: record.week_number || null,
      content: clone(record.content),
    };
  }
  function changed() {
    seq++;
    status(navigator.onLine ? "Unsaved changes" : "Offline — unsaved changes kept in this tab");
    clearTimeout(timer);
    if (!conflict) timer = setTimeout(save, 800);
    updateValidation();
  }
  function focusQuestion(index) {
    const panel = $("qmQuestion" + index);
    if (panel) panel.querySelector("summary").focus();
    else $("qmAdd").focus();
  }
  async function save() {
    clearTimeout(timer);
    if (!record || !dirty()) return true;
    if (saving) return false;
    if (conflict) {
      tell("Export your changes before reloading the newer saved version.");
      return false;
    }
    if (!navigator.onLine) {
      status("Offline — unsaved changes kept in this tab");
      return false;
    }
    const token = generation,
      version = seq,
      id = record.id;
    saving = true;
    status("Saving…");
    try {
      const result = await write("save", payload());
      if (token !== generation || record?.id !== id) return false;
      record.revision = result.quiz.revision;
      record.updated_at = result.quiz.updated_at;
      record.updated_by = result.quiz.updated_by;
      savedSeq = version;
      status(dirty() ? "Unsaved changes" : "Saved · revision " + record.revision);
      tell();
      return !dirty();
    } catch (e) {
      if (token === generation) {
        conflict = [
          "revision_conflict",
          "quiz_locked",
          "teacher_required",
          "take_offline_first",
        ].includes(e.code);
        status("Save failed — changes remain unsaved");
        tell(e.message);
      }
      return false;
    } finally {
      if (token === generation) {
        saving = false;
        if (dirty() && !conflict && version !== seq) timer = setTimeout(save, 800);
      }
    }
  }
  function field(parent, label, value, onchange, kind = "text") {
    const wrap = node("label", label),
      input = node(kind === "textarea" ? "textarea" : "input");
    if (kind !== "textarea") input.type = kind;
    input.value = value ?? "";
    input.disabled = !editable();
    input.addEventListener("input", () => {
      onchange(input.value);
      changed();
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function check(parent, label, value, onchange) {
    const wrap = node("label", undefined, "qm-inline"),
      input = node("input");
    input.type = "checkbox";
    input.checked = value;
    input.disabled = !editable();
    input.addEventListener("change", () => {
      onchange(input.checked);
      changed();
    });
    wrap.append(input, document.createTextNode(label));
    parent.append(wrap);
    return input;
  }
  function renderEditor() {
    $("qmTitle").value = record.title;
    $("qmYear").value = record.year_group;
    $("qmTopic").value = record.topic || "";
    $("qmWeek").value = record.week_number || "";
    $("qmFields").disabled = !editable();
    $("qmAdd").disabled = !editable() || record.content.questions.length >= 25;
    $("qmRetry").disabled = !editable();
    $("qmDelete").disabled = !editable() || !!record.runtime_quiz_id;
    $("qmOffline").hidden = record.state === "draft" || !!record.first_started_at;
    $("qmMetadata").textContent =
      stateLabel(record) +
      " · revision " +
      record.revision +
      (record.updated_at
        ? " · last edited " + new Date(record.updated_at).toLocaleString("en-GB")
        : "") +
      (record.first_started_at ? " · Permanently locked after first pupil start" : "");
    $("qmQuestions").replaceChildren();
    record.content.questions.forEach(renderQuestion);
    updateValidation();
  }
  function updateSummary(index) {
    const q = record.content.questions[index],
      s = $("qmQuestion" + index)?.querySelector("summary");
    if (!s) return;
    s.replaceChildren(
      document.createTextNode(
        index + 1 + ". " + (q.prompt || "Untitled question") + " · " + C.types[q.type],
      ),
      node("span", "Correct answer: " + C.answerText(q), "qm-answer"),
    );
  }
  function updateValidation() {
    if (!record) return;
    const issues = C.errors(record.content, record.topic || "");
    if (!record.topic?.trim())
      issues.unshift({
        path: "topic",
        message: "Add the taught topic before approval",
        question: null,
      });
    if (!Number.isInteger(record.week_number) || record.week_number < 1)
      issues.unshift({
        path: "week_number",
        message: "Add a positive week number before approval",
        question: null,
      });
    $("qmCount").textContent =
      record.content.questions.length +
      " / 25 questions · " +
      (issues.length
        ? issues.length + " validation issue(s)"
        : "25 valid questions · ready for review");
    $("qmValidation").replaceChildren();
    if (issues.length) {
      const details = node("details"),
        summary = node("summary", "Validation: " + issues.length + " issue(s)"),
        list = node("ul", undefined, "qm-errors");
      details.append(summary, list);
      for (const e of issues) {
        const li = node("li");
        if (e.question !== null) {
          const a = node(
            "a",
            "Question " + (e.question + 1) + ": " + e.message + " (" + e.path + ")",
          );
          a.href = "#qmQuestion" + e.question;
          a.addEventListener("click", () => {
            const panel = $("qmQuestion" + e.question);
            panel.open = true;
            panel.querySelector("summary").focus();
          });
          li.append(a);
        } else li.textContent = e.message;
        list.append(li);
      }
      $("qmValidation").append(details);
    }
    $("qmPreviewOpen").disabled = issues.length > 0;
    $("qmPublishOpen").disabled =
      issues.length > 0 ||
      !!record.first_started_at ||
      ["published", "scheduled"].includes(record.state);
    $("qmAdd").disabled = !editable() || record.content.questions.length >= 25;
    record.content.questions.forEach((_, i) => updateSummary(i));
  }
  function renderQuestion(q, index) {
    const panel = node("details");
    panel.id = "qmQuestion" + index;
    const summary = node("summary");
    panel.append(summary);
    $("qmQuestions").append(panel);
    const actions = node("div", undefined, "qm-actions");
    panel.append(actions);
    for (const [label, fn] of [
      ["Move up", () => move(index, -1)],
      ["Move down", () => move(index, 1)],
      [
        "Duplicate question",
        () => {
          if (record.content.questions.length >= 25) return;
          const copy = clone(q);
          copy.id = crypto.randomUUID();
          record.content.questions.splice(index + 1, 0, copy);
          changed();
          renderEditor();
          focusQuestion(index + 1);
        },
      ],
      [
        "Delete question",
        () => {
          if (confirm("Delete question " + (index + 1) + " from this draft?")) {
            record.content.questions.splice(index, 1);
            changed();
            renderEditor();
            focusQuestion(Math.min(index, record.content.questions.length - 1));
          }
        },
      ],
      [
        "Replace with JSON",
        () => {
          replacing = index;
          $("qmReplaceJSON").value = JSON.stringify(q, null, 2);
          $("qmReplaceError").textContent = "";
          $("qmReplace").showModal();
        },
      ],
    ]) {
      const b = button(label, fn);
      b.disabled =
        !editable() ||
        (label === "Move up" && index === 0) ||
        (label === "Move down" && index === record.content.questions.length - 1) ||
        (label === "Duplicate question" && record.content.questions.length >= 25);
      actions.append(b);
    }
    const typeLabel = node("label", "Question type"),
      type = node("select");
    for (const [value, label] of Object.entries(C.types)) option(type, value, label);
    type.value = q.type;
    type.disabled = !editable();
    type.addEventListener("change", () => {
      if (confirm("Replace this question's type and answer settings?")) {
        const next = C.blank(type.value);
        next.id = q.id;
        next.prompt = q.prompt;
        next.explanation = q.explanation;
        record.content.questions[index] = next;
        changed();
        renderEditor();
        $("qmQuestion" + index).open = true;
      } else type.value = q.type;
    });
    typeLabel.append(type);
    panel.append(typeLabel);
    field(panel, "Question wording", q.prompt, (v) => (q.prompt = v), "textarea");
    field(
      panel,
      "Explanation after answering",
      q.explanation,
      (v) => (q.explanation = v),
      "textarea",
    );
    panel.append(node("p", "Timer: " + q.seconds + " seconds · 1 point"));
    if (C.choiceTypes.includes(q.type)) {
      q.options.forEach((o, i) => {
        const box = node("fieldset");
        box.append(node("legend", "Option " + (i + 1)));
        panel.append(box);
        field(box, "Statement / option", o.text, (v) => (o.text = v));
        check(
          box,
          q.type === "spot_the_mistake"
            ? "This is the incorrect statement (the answer)"
            : "Correct answer",
          q.correct.includes(o.id),
          (value) => {
            q.correct = value ? [...q.correct, o.id] : q.correct.filter((x) => x !== o.id);
            if (q.type !== "select_all" && value) {
              q.correct = [o.id];
              panel
                .querySelectorAll('input[type="checkbox"]')
                .forEach((c) => (c.checked = c === box.querySelector('input[type="checkbox"]')));
            }
          },
        );
      });
      if (q.type === "select_all") {
        const b = button(
          q.options.length === 4 ? "Add fifth option" : "Remove fifth option",
          () => {
            if (q.options.length === 4) q.options.push({ id: "o" + crypto.randomUUID(), text: "" });
            else {
              const removed = q.options.pop();
              q.correct = q.correct.filter((x) => x !== removed.id);
            }
            changed();
            renderEditor();
            $("qmQuestion" + index).open = true;
          },
        );
        b.disabled = !editable();
        panel.append(b);
      }
    } else if (C.typedTypes.includes(q.type)) {
      field(
        panel,
        "Canonical correct answer",
        q.answers.canonical,
        (v) => (q.answers.canonical = v),
      );
      for (const [key, label] of [
        ["aliases", "Approved alternative spellings / names (one per line)"],
        ["surname_aliases", "Unambiguous surname answers (Who Am I? only, one per line)"],
        ["confusable", "Historically different or ambiguous answers to reject (one per line)"],
      ])
        field(
          panel,
          label,
          q.answers[key].join("\n"),
          (v) =>
            (q.answers[key] = v
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)),
          "textarea",
        );
      check(
        panel,
        "Allow guarded minor spelling errors",
        q.answers.allow_minor_typos,
        (v) => (q.answers.allow_minor_typos = v),
      );
      if (q.type === "who_am_i")
        q.clues.forEach((c, i) => field(panel, "Clue " + (i + 1), c, (v) => (q.clues[i] = v)));
    } else if (q.type === "matching")
      q.pairs.forEach((p, i) => {
        const box = node("fieldset");
        box.append(node("legend", "Correct pair " + (i + 1)));
        panel.append(box);
        field(box, "Left label", p.left, (v) => (p.left = v));
        field(box, "Matching right label", p.right, (v) => (p.right = v));
      });
    else {
      q.events.forEach((e, i) =>
        field(panel, "Event " + (i + 1) + " (no dates or years)", e.text, (v) => (e.text = v)),
      );
      const order = node("fieldset");
      order.append(node("legend", "Correct chronological order"));
      panel.append(order);
      q.correct.forEach((id, i) => {
        const label = node("label", "Position " + (i + 1)),
          select = node("select");
        q.events.forEach((e, j) => option(select, e.id, "Event " + (j + 1)));
        select.value = id;
        select.disabled = !editable();
        select.addEventListener("change", () => {
          q.correct[i] = select.value;
          changed();
        });
        label.append(select);
        order.append(label);
      });
    }
  }
  function move(i, d) {
    const qs = record.content.questions;
    [qs[i], qs[i + d]] = [qs[i + d], qs[i]];
    changed();
    renderEditor();
    $("qmQuestion" + (i + d))
      .querySelector("summary")
      .focus();
  }
  async function newQuiz(e) {
    e.preventDefault();
    if (!client) return;
    const token = generation;
    $("qmAcceptCreate").disabled = true;
    $("qmCancelCreate").disabled = true;
    $("qmCreateError").textContent = "";
    try {
      let result;
      if ($("qmMethod").value === "import") {
        if (!imported || imported.errors.length)
          throw new Error("Choose and validate a complete 25-question JSON file first.");
        const response = await client.rpc("quiz_manager_import", {
          payload: {
            ...imported.meta,
            title: $("qmNewTitle").value,
            year_group: Number($("qmNewYear").value),
            content: imported.content,
          },
        });
        if (response.error) throw response.error;
        if (!response.data?.ok)
          throw new Error(
            response.data?.errors?.map((x) => x.path + ": " + x.message).join("; ") ||
              response.data?.error ||
              "Import failed",
          );
        result = response.data;
      } else
        result = await write(
          "create",
          { title: $("qmNewTitle").value, year_group: Number($("qmNewYear").value) },
          null,
          null,
        );
      if (token !== generation) return;
      $("qmCreate").close();
      await openQuiz(result.id, true);
    } catch (e) {
      if (token === generation) $("qmCreateError").textContent = e.message;
    } finally {
      $("qmAcceptCreate").disabled = false;
      $("qmCancelCreate").disabled = false;
    }
  }
  async function acceptImport() {
    const file = $("qmImportFile").files[0];
    const request = ++importGeneration,
      token = generation;
    imported = null;
    $("qmImportSummary").replaceChildren();
    $("qmCreateError").textContent = "";
    if (!file) return;
    try {
      if (file.size > 1100000) throw new Error("JSON file is too large (maximum 1 MiB content).");
      const parsed = C.parseImport(await file.text());
      if (request !== importGeneration || token !== generation || !$("qmCreate").open) return;
      imported = parsed;
      $("qmNewTitle").value = parsed.meta.title;
      $("qmNewYear").value = parsed.meta.year_group;
      const summary = $("qmImportSummary");
      summary.append(
        node(
          "p",
          parsed.meta.title +
            " · Year " +
            parsed.meta.year_group +
            " · " +
            parsed.meta.topic +
            " · Week " +
            parsed.meta.week_number,
        ),
      );
      if (parsed.errors.length) {
        const list = node("ul", undefined, "qm-errors");
        parsed.errors.forEach((e) => list.append(node("li", e.path + ": " + e.message)));
        summary.append(list);
      } else {
        summary.append(
          node(
            "p",
            "25 valid questions. Accepting creates a new draft; no existing quiz will be overwritten.",
          ),
        );
        const details = node("details");
        details.append(node("summary", "Preview all imported questions"));
        parsed.content.questions.forEach((q, i) =>
          details.append(
            node("p", i + 1 + ". " + q.prompt + " — Correct answer: " + C.answerText(q)),
          ),
        );
        summary.append(details);
      }
    } catch (e) {
      if (request === importGeneration && token === generation)
        $("qmCreateError").textContent = e.message;
    }
  }
  function exportJSON() {
    if (!record) return;
    const data = {
      schema_version: 1,
      quiz: {
        title: record.title,
        year_group: record.year_group,
        topic: record.topic || "",
        week_number: record.week_number,
      },
      questions: record.content.questions,
    };
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      ),
      a = node("a");
    a.href = url;
    a.download = "quiz-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function startPreview() {
    if (C.errors(record.content, record.topic || "").length) return;
    preview = {
      questions: shuffle(clone(record.content.questions)),
      index: 0,
      answers: [],
      deadline: 0,
      submitted: false,
    };
    $("qmPreview").showModal();
    showPreviewQuestion();
  }
  function showPreviewQuestion() {
    clearInterval(previewClock);
    const p = preview,
      host = $("qmSimulation");
    host.replaceChildren();
    if (p.index === p.questions.length) {
      let score = 0;
      p.questions.forEach((q, i) => {
        if (C.mark(q, p.answers[i])) score++;
      });
      host.append(
        node("h3", "Score: " + score + " / 25 · " + (score >= 20 ? "Passed" : "Not passed")),
        node("p", "Preview only. Nothing has been recorded."),
      );
      p.questions.forEach((q, i) => {
        const box = node("div", undefined, "qm-review");
        const a = p.answers[i];
        let shown =
          a === null
            ? "Timed out"
            : C.typedTypes.includes(q.type)
              ? a
              : q.type === "matching"
                ? q.pairs
                    .map(
                      (pair) =>
                        pair.left +
                        " → " +
                        (q.pairs.find((x) => x.id === a[pair.id])?.right || "Not answered"),
                    )
                    .join("; ")
                : C.answerText({ ...q, correct: a });
        box.append(
          node("strong", i + 1 + ". " + q.prompt),
          node("p", "Your answer: " + shown),
          node("p", "Correct answer: " + C.answerText(q)),
          node("p", q.explanation),
        );
        host.append(box);
      });
      host.append(button("Try preview again", startPreview));
      return;
    }
    const q = p.questions[p.index];
    p.submitted = false;
    p.deadline = Date.now() + q.seconds * 1000;
    host.append(node("h3", "Question " + (p.index + 1) + " of 25"), node("p", q.prompt));
    host.querySelector("h3").tabIndex = -1;
    host.querySelector("h3").focus();
    if (q.clues) q.clues.forEach((c, i) => host.append(node("p", "Clue " + (i + 1) + ": " + c)));
    const clock = node("p"),
      fields = node("fieldset"),
      feedback = node("div"),
      submit = button("Submit answer", () => answer(false));
    fields.append(
      node(
        "legend",
        q.type === "select_all"
          ? "Select " + q.correct.length + " options"
          : q.type === "matching"
            ? "Match all three pairs"
            : q.type === "chronology"
              ? "Arrange from earliest to latest"
              : "Your answer",
      ),
    );
    feedback.setAttribute("role", "status");
    host.append(clock, fields, submit, feedback);
    let getAnswer;
    if (C.choiceTypes.includes(q.type)) {
      const inputs = [];
      shuffle(q.options).forEach((o) => {
        const label = node("label", undefined, "qm-inline qm-option"),
          input = node("input");
        input.type = q.type === "select_all" ? "checkbox" : "radio";
        input.name = "preview-answer";
        input.value = o.id;
        inputs.push(input);
        input.addEventListener("change", () => {
          if (q.type === "select_all") {
            const n = inputs.filter((i) => i.checked).length;
            inputs.forEach((i) => (i.disabled = !i.checked && n >= q.correct.length));
          }
        });
        label.append(input, document.createTextNode(o.text));
        fields.append(label);
      });
      getAnswer = () => inputs.filter((i) => i.checked).map((i) => i.value);
    } else if (C.typedTypes.includes(q.type)) {
      const label = node("label", "Type your answer"),
        input = node("input");
      input.type = "text";
      input.autocomplete = "off";
      label.append(input);
      fields.append(label);
      getAnswer = () => input.value;
    } else if (q.type === "matching") {
      const selects = [];
      shuffle(q.pairs).forEach((pair) => {
        const label = node("label", pair.left),
          select = node("select");
        option(select, "", "Choose a match");
        select.setAttribute("aria-label", pair.left);
        shuffle(q.pairs).forEach((v) => option(select, v.id, v.right));
        label.append(select);
        fields.append(label);
        selects.push([pair.id, select]);
      });
      getAnswer = () => Object.fromEntries(selects.map(([id, s]) => [id, s.value]));
    } else {
      let order = shuffle(q.events);
      const list = node("div");
      fields.append(list);
      function draw() {
        list.replaceChildren();
        order.forEach((e, i) => {
          const row = node("div", e.text, "qm-actions"),
            up = button("Move earlier", () => {
              [order[i - 1], order[i]] = [order[i], order[i - 1]];
              draw();
              list.children[i - 1].querySelector("button").focus();
            }),
            down = button("Move later", () => {
              [order[i + 1], order[i]] = [order[i], order[i + 1]];
              draw();
              list.children[i + 1].querySelectorAll("button")[1].focus();
            });
          up.disabled = i === 0;
          down.disabled = i === 2;
          row.append(up, down);
          list.append(row);
        });
      }
      draw();
      getAnswer = () => order.map((e) => e.id);
    }
    function answer(timeout) {
      if (p.submitted) return;
      const expired = Date.now() >= p.deadline,
        a = timeout || expired ? null : getAnswer();
      if (
        a !== null &&
        (typeof a === "string"
          ? !a.trim()
          : Array.isArray(a)
            ? !a.length
            : Object.values(a).some((v) => !v))
      ) {
        feedback.textContent = "Enter your answer before submitting.";
        return;
      }
      p.submitted = true;
      clearInterval(previewClock);
      p.answers.push(a);
      fields.disabled = true;
      submit.disabled = true;
      feedback.replaceChildren(
        node("p", C.mark(q, a) ? "Correct" : "Not correct"),
        node("p", "Correct answer: " + C.answerText(q)),
        node("p", q.explanation),
      );
      const next = button(p.index === 24 ? "Finish and review" : "Next question", () => {
        p.index++;
        showPreviewQuestion();
      });
      feedback.append(next);
      next.focus();
    }
    const tick = () => {
      const n = Math.max(0, Math.ceil((p.deadline - Date.now()) / 1000));
      clock.textContent = "Time remaining: " + n + " seconds";
      if (n === 0) answer(true);
    };
    tick();
    previewClock = setInterval(tick, 250);
  }
  $("managerTab").addEventListener("click", () => {
    if (!client) return;
    $("overviewPanels").hidden = true;
    $("quizManager").hidden = false;
    $("managerTab").setAttribute("aria-pressed", "true");
    $("overviewTab").setAttribute("aria-pressed", "false");
    if (!record) {
      $("qmList").hidden = false;
      $("qmEditor").hidden = true;
      loadList();
    }
  });
  $("overviewTab").addEventListener("click", () => {
    if (!canLeave()) return;
    $("overviewPanels").hidden = false;
    $("quizManager").hidden = true;
    $("managerTab").setAttribute("aria-pressed", "false");
    $("overviewTab").setAttribute("aria-pressed", "true");
  });
  for (const y of [9, 10, 11]) {
    const b = button("Year " + y, () => {
      year = y;
      loadList();
    });
    b.dataset.qmYear = y;
    $("qmYears").append(b);
  }
  for (const [type, label] of Object.entries(C.types)) option($("qmAddType"), type, label);
  $("qmSearch").addEventListener("input", renderList);
  $("qmFilter").addEventListener("change", renderList);
  $("qmRefresh").addEventListener("click", loadList);
  $("qmNew").addEventListener("click", () => {
    importGeneration++;
    imported = null;
    $("qmCreateForm").reset();
    $("qmNewYear").value = year;
    $("qmCreateError").textContent = "";
    $("qmImportSummary").replaceChildren();
    $("qmImportArea").hidden = false;
    $("qmCreate").showModal();
  });
  $("qmMethod").addEventListener(
    "change",
    () => ($("qmImportArea").hidden = $("qmMethod").value !== "import"),
  );
  $("qmImportFile").addEventListener("change", acceptImport);
  $("qmCreateForm").addEventListener("submit", newQuiz);
  $("qmCancelCreate").addEventListener("click", () => $("qmCreate").close());
  $("qmCreate").addEventListener("cancel", (e) => {
    if ($("qmAcceptCreate").disabled) e.preventDefault();
  });
  $("qmCreate").addEventListener("close", () => {
    importGeneration++;
    imported = null;
  });
  for (const [id, key, convert] of [
    ["qmTitle", "title", String],
    ["qmYear", "year_group", Number],
    ["qmTopic", "topic", String],
    ["qmWeek", "week_number", (v) => (v ? Number(v) : null)],
  ])
    $(id).addEventListener("input", () => {
      record[key] = convert($(id).value);
      changed();
    });
  $("qmAdd").addEventListener("click", () => {
    if (!editable() || record.content.questions.length >= 25) return;
    record.content.questions.push(C.blank($("qmAddType").value));
    changed();
    renderEditor();
    $("qmQuestion" + (record.content.questions.length - 1)).open = true;
    focusQuestion(record.content.questions.length - 1);
  });
  $("qmRetry").addEventListener("click", save);
  $("qmExport").addEventListener("click", exportJSON);
  $("qmReload").addEventListener("click", () => {
    if (canLeave()) openQuiz(record.id, true);
  });
  $("qmBack").addEventListener("click", async () => {
    await save();
    if (!canLeave()) return;
    clearTimeout(timer);
    record = null;
    generation++;
    $("qmEditor").hidden = true;
    $("qmList").hidden = false;
    loadList();
  });
  for (const [id, action, prompt] of [
    ["qmCopy", "duplicate", "Create an independent draft copy of this quiz?"],
    ["qmDelete", "delete", "Permanently delete this draft? Pupil history will not be deleted."],
    [
      "qmOffline",
      "take_offline",
      "Take this quiz offline? It will need reapproval before release.",
    ],
  ])
    $(id).addEventListener("click", async () => {
      if (!confirm(prompt)) return;
      try {
        if (dirty() && !(await save())) return;
        const token = generation;
        const result = await write(action, action === "duplicate" ? {} : { confirmed: true });
        if (token !== generation) return;
        if (action === "delete") {
          record = null;
          $("qmEditor").hidden = true;
          $("qmList").hidden = false;
          await loadList();
        } else await openQuiz(result.id, true);
      } catch (e) {
        tell(e.message);
      }
    });
  $("qmReplaceCancel").addEventListener("click", () => $("qmReplace").close());
  $("qmReplaceAccept").addEventListener("click", () => {
    try {
      const q = JSON.parse($("qmReplaceJSON").value);
      q.id = record.content.questions[replacing].id;
      const issues = C.errors({ schema_version: 1, questions: [q] }, record.topic || "").filter(
        (e) => e.question !== null,
      );
      if (issues.length) throw new Error(issues.map((e) => e.path + ": " + e.message).join("; "));
      record.content.questions[replacing] = q;
      $("qmReplace").close();
      changed();
      renderEditor();
    } catch (e) {
      $("qmReplaceError").textContent = e.message;
    }
  });
  $("qmPreviewOpen").addEventListener("click", startPreview);
  $("qmPublishOpen").addEventListener("click", () => publication.open());
  $("qmPreviewClose").addEventListener("click", () => $("qmPreview").close());
  $("qmPreview").addEventListener("close", () => {
    clearInterval(previewClock);
    preview = null;
    $("qmSimulation").replaceChildren();
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("online", () => {
    if (dirty() && !conflict) save();
  });
  window.addEventListener("offline", () => {
    if (dirty()) status("Offline — unsaved changes kept in this tab");
  });
  window.QUIZ_MANAGER = Object.freeze({ connect, disconnect, canLeave });
})();
