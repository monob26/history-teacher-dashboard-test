/* Canonical authoring contract and isolated preview helpers; no backend access. */
(function (root) {
  "use strict";
  const types = {
    multiple_choice: "Multiple choice",
    missing_word: "Missing Word",
    matching: "Matching",
    chronology: "Chronology",
    select_all: "Select-All",
    spot_the_mistake: "Spot the Mistake",
    cause_consequence: "Cause / Consequence",
    who_am_i: "Who Am I?",
  };
  const choiceTypes = ["multiple_choice", "select_all", "spot_the_mistake", "cause_consequence"];
  const typedTypes = ["missing_word", "who_am_i"];
  const slowTypes = ["matching", "chronology", "select_all"];
  const text = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 4000;
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const normalize = (v) => String(v).normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
  const dateLabel =
    /\b\d{3,4}\b|\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i;
  const id = () => crypto.randomUUID();
  function blank(type = "multiple_choice") {
    const q = {
      id: id(),
      type,
      prompt: "",
      explanation: "",
      seconds: slowTypes.includes(type) ? 60 : 45,
    };
    if (choiceTypes.includes(type)) {
      q.options = Array.from({ length: 4 }, (_, i) => ({ id: "o" + (i + 1), text: "" }));
      q.correct = [];
    } else if (typedTypes.includes(type)) {
      q.answers = {
        canonical: "",
        aliases: [],
        surname_aliases: [],
        confusable: [],
        allow_minor_typos: false,
      };
      if (type === "who_am_i") q.clues = ["", "", ""];
    } else if (type === "matching")
      q.pairs = Array.from({ length: 3 }, (_, i) => ({ id: "p" + (i + 1), left: "", right: "" }));
    else {
      q.events = Array.from({ length: 3 }, (_, i) => ({ id: "e" + (i + 1), text: "" }));
      q.correct = q.events.map((e) => e.id);
    }
    return q;
  }
  function errors(content, topic = "", complete = true) {
    const out = [];
    const add = (path, message, question = null) => out.push({ path, message, question });
    const keys = (v, allowed, path, qi) => {
      if (object(v))
        for (const key of Object.keys(v))
          if (!allowed.includes(key)) add(path + "." + key, "Unsupported field", qi);
    };
    const stringList = (v) => Array.isArray(v) && v.every(text);
    if (!object(content))
      return [{ path: "content", message: "Expected an object", question: null }];
    keys(content, ["schema_version", "questions"], "content", null);
    if (content.schema_version !== 1) add("schema_version", "Use schema_version 1");
    if (new TextEncoder().encode(JSON.stringify(content)).length > 1048576)
      add("content", "Maximum file content size is 1 MiB");
    if (!Array.isArray(content.questions)) {
      add("questions", "Expected a question array");
      return out;
    }
    if (content.questions.length > 25 || (complete && content.questions.length !== 25))
      add("questions", "Exactly 25 valid questions are required for approval");
    const seen = new Set();
    content.questions.forEach((q, qi) => {
      const p = "questions[" + qi + "]";
      if (!object(q)) {
        add(p, "Expected a question object", qi);
        return;
      }
      if (typeof q.id !== "string" || !q.id.trim() || q.id.length > 100 || seen.has(q.id))
        add(p + ".id", "Use a unique non-empty ID (maximum 100 characters)", qi);
      seen.add(q.id);
      if (!Object.hasOwn(types, q.type)) {
        add(p + ".type", "Unsupported question type", qi);
        return;
      }
      const extra = choiceTypes.includes(q.type)
        ? ["options", "correct"]
        : typedTypes.includes(q.type)
          ? ["answers", ...(q.type === "who_am_i" ? ["clues"] : [])]
          : q.type === "matching"
            ? ["pairs"]
            : ["events", "correct"];
      keys(q, ["id", "type", "prompt", "explanation", "seconds", ...extra], p, qi);
      for (const field of ["prompt", "explanation"])
        if ((complete || q[field]) && !text(q[field]))
          add(p + "." + field, "Enter " + field + " (maximum 4000 characters)", qi);
      if (q.seconds !== (slowTypes.includes(q.type) ? 60 : 45))
        add(
          p + ".seconds",
          "Timer must be " + (slowTypes.includes(q.type) ? 60 : 45) + " seconds",
          qi,
        );
      if (complete && q.type === "cause_consequence" && !/cold[\s_-]*war/i.test(topic))
        add(p + ".type", "Cause / Consequence is Cold War only", qi);
      const entries = choiceTypes.includes(q.type)
        ? q.options
        : q.type === "matching"
          ? q.pairs
          : q.type === "chronology"
            ? q.events
            : null;
      if (!typedTypes.includes(q.type)) {
        const field = choiceTypes.includes(q.type)
          ? "options"
          : q.type === "matching"
            ? "pairs"
            : "events";
        const n = field === "options" ? 4 : 3;
        const allowedCount =
          Array.isArray(entries) &&
          (entries.length === n || (q.type === "select_all" && entries.length === 5));
        if (!allowedCount)
          add(
            p + "." + field,
            field === "options"
              ? "Use four options (four or five for Select-All)"
              : "Use exactly three entries",
            qi,
          );
        const entryIds = new Set(),
          labels = new Set(),
          rightLabels = new Set();
        if (Array.isArray(entries))
          entries.forEach((v, vi) => {
            const ep = p + "." + field + "[" + vi + "]";
            if (!object(v)) {
              add(ep, "Expected an entry object", qi);
              return;
            }
            keys(v, field === "pairs" ? ["id", "left", "right"] : ["id", "text"], ep, qi);
            if (!text(v.id) || v.id.length > 100 || entryIds.has(v.id))
              add(ep + ".id", "Entry IDs must be unique", qi);
            entryIds.add(v.id);
            for (const f of field === "pairs" ? ["left", "right"] : ["text"]) {
              if ((complete || v[f]) && !text(v[f]))
                add(ep + "." + f, "Enter a non-empty label", qi);
              const set = f === "right" ? rightLabels : labels,
                label = normalize(v[f] || "");
              if (label && set.has(label)) add(ep + "." + f, "Labels must be distinguishable", qi);
              set.add(label);
              if (field === "events" && dateLabel.test(String(v[f] || "").normalize("NFKC")))
                add(ep + ".text", "Remove dates and years from event labels", qi);
            }
          });
        if (field !== "pairs") {
          const c = q.correct;
          if (
            !Array.isArray(c) ||
            c.some((v) => typeof v !== "string" || !entryIds.has(v)) ||
            new Set(c).size !== c.length
          )
            add(p + ".correct", "Correct answers must reference distinct entry IDs", qi);
          else if (
            (complete || c.length) &&
            (q.type === "chronology"
              ? c.length !== 3
              : q.type === "select_all"
                ? ![2, 3].includes(c.length)
                : c.length !== 1)
          )
            add(
              p + ".correct",
              q.type === "select_all"
                ? "Select exactly two or three correct options"
                : q.type === "chronology"
                  ? "Order all three events"
                  : "Choose exactly one correct option",
              qi,
            );
        }
      }
      if (typedTypes.includes(q.type)) {
        const a = q.answers;
        if (!object(a)) add(p + ".answers", "Provide typed-answer settings", qi);
        else {
          keys(
            a,
            ["canonical", "aliases", "surname_aliases", "confusable", "allow_minor_typos"],
            p + ".answers",
            qi,
          );
          if ((complete || a.canonical) && !text(a.canonical))
            add(p + ".answers.canonical", "Enter the canonical answer", qi);
          for (const field of ["aliases", "surname_aliases", "confusable"])
            if (!stringList(a[field]) || a[field].length > 50)
              add(p + ".answers." + field, "Use an array of up to 50 non-empty strings", qi);
          if (typeof a.allow_minor_typos !== "boolean")
            add(
              p + ".answers.allow_minor_typos",
              "Choose whether guarded minor typos are allowed",
              qi,
            );
          const accepted = [
            a.canonical,
            ...(Array.isArray(a.aliases) ? a.aliases : []),
            ...(Array.isArray(a.surname_aliases) ? a.surname_aliases : []),
          ]
            .filter((x) => typeof x === "string")
            .map(normalize);
          if (
            Array.isArray(a.confusable) &&
            a.confusable.some((x) => accepted.includes(normalize(x)))
          )
            add(p + ".answers.confusable", "An answer cannot be both accepted and excluded", qi);
          if (
            q.type === "missing_word" &&
            Array.isArray(a.surname_aliases) &&
            a.surname_aliases.length
          )
            add(p + ".answers.surname_aliases", "Surname aliases apply only to Who Am I?", qi);
        }
        if (
          q.type === "who_am_i" &&
          (!Array.isArray(q.clues) || q.clues.length !== 3 || (complete && !q.clues.every(text)))
        )
          add(p + ".clues", "Provide exactly three non-empty clues", qi);
      }
    });
    return out;
  }
  function parseImport(raw) {
    if (new TextEncoder().encode(raw).length > 1100000)
      throw new Error("JSON file exceeds 1 MiB content limit");
    let file;
    try {
      file = JSON.parse(raw);
    } catch {
      throw new Error("Malformed JSON: check commas, quotes and brackets");
    }
    if (
      !object(file) ||
      Object.keys(file).some((k) => !["schema_version", "quiz", "questions"].includes(k))
    )
      throw new Error("Use the version 1 import document");
    const meta = file.quiz;
    if (
      !object(meta) ||
      Object.keys(meta).some((k) => !["title", "year_group", "topic", "week_number"].includes(k)) ||
      !text(meta.title) ||
      meta.title.length > 200 ||
      ![9, 10, 11].includes(meta.year_group) ||
      !text(meta.topic) ||
      meta.topic.length > 200 ||
      !Number.isInteger(meta.week_number) ||
      meta.week_number < 1 ||
      meta.week_number > 999999999
    )
      throw new Error(
        "Quiz metadata needs title, year group (9–11), topic and positive week number",
      );
    const content = { schema_version: file.schema_version, questions: file.questions };
    return { meta, content, errors: errors(content, meta.topic) };
  }
  function answerText(q) {
    if (typedTypes.includes(q.type)) return q.answers?.canonical || "Not set";
    if (q.type === "matching")
      return (q.pairs || []).map((p) => p.left + " → " + p.right).join("; ");
    const list = q.type === "chronology" ? q.events : q.options;
    return (
      (q.correct || [])
        .map((id) => list?.find((o) => o.id === id)?.text || "Not set")
        .join(q.type === "chronology" ? " → " : "; ") || "Not set"
    );
  }
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    if (a === b) return 0;
    if (a.length === b.length) return [...a].filter((c, i) => c !== b[i]).length;
    if (a.length > b.length) [a, b] = [b, a];
    let i = 0,
      j = 0,
      n = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
      } else {
        j++;
        n++;
      }
    }
    return n + b.length - j;
  }
  function mark(q, answer) {
    if (answer === null) return false;
    if (typedTypes.includes(q.type)) {
      const a = q.answers,
        value = normalize(answer),
        accepted = [a.canonical, ...a.aliases].map(normalize);
      if (!value || a.confusable.map(normalize).includes(value)) return false;
      if ([...accepted, ...a.surname_aliases.map(normalize)].includes(value)) return true;
      return (
        a.allow_minor_typos &&
        value.length >= 6 &&
        accepted.some((s) => s.length >= 6 && distance(value, s) === 1) &&
        !a.confusable.some((s) => distance(value, normalize(s)) <= 1)
      );
    }
    if (q.type === "matching") return object(answer) && q.pairs.every((p) => answer[p.id] === p.id);
    if (!Array.isArray(answer)) return false;
    return q.type === "chronology"
      ? JSON.stringify(answer) === JSON.stringify(q.correct)
      : answer.length === q.correct.length &&
          new Set(answer).size === answer.length &&
          answer.every((a) => q.correct.includes(a));
  }
  const api = {
    types,
    choiceTypes,
    typedTypes,
    slowTypes,
    blank,
    errors,
    parseImport,
    answerText,
    mark,
    normalize,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QUIZ_CONTRACT = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
