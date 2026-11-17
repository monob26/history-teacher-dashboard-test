(function () {
  "use strict";
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const format = (value) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  window.QUIZ_PUBLICATION = {
    create(owner) {
      const dialog = node("dialog");
      dialog.className = "qm qm-dialog";
      dialog.setAttribute("aria-labelledby", "qmPublishHeading");
      const heading = node("h2", "Review & Publish");
      heading.id = "qmPublishHeading";
      const summary = node("p"),
        message = node("p");
      message.setAttribute("role", "alert");
      const classes = node("fieldset");
      classes.append(node("legend", "Assign to existing classes"));
      const approvalLabel = node("label"),
        approval = node("input");
      approval.type = "checkbox";
      approvalLabel.className = "qm-inline";
      approvalLabel.append(
        approval,
        document.createTextNode(
          "I have reviewed all 25 questions, answers, explanations and taught-topic suitability.",
        ),
      );
      const approve = node("button", "Approve questions");
      approve.type = "button";
      approve.className = "primary";
      const preview = node("button", "Preview as a pupil");
      preview.type = "button";
      preview.className = "secondary";
      preview.onclick = () => owner.preview();
      function input(label, type) {
        const l = node("label", label),
          i = node("input");
        i.type = type;
        l.append(i);
        dialog.append(l);
        return i;
      }
      function fold(label) {
        const l = node("label", label),
          s = node("select");
        s.setAttribute("aria-label", label);
        for (const [v, t] of [
          ["", "Choose only if the time occurs twice"],
          ["earlier", "First occurrence (BST)"],
          ["later", "Second occurrence (GMT)"],
        ]) {
          const o = node("option", t);
          o.value = v;
          s.append(o);
        }
        l.append(s);
        dialog.append(l);
        return s;
      }
      dialog.append(
        heading,
        summary,
        preview,
        approvalLabel,
        approve,
        classes,
        node(
          "p",
          "All dates and times below are UK local time (Europe/London). Missing spring times are refused. Repeated autumn times require an explicit occurrence.",
        ),
      );
      const due = input("Shared homework deadline (UK)", "datetime-local"),
        dueFold = fold("Deadline clock-change occurrence");
      const modeLabel = node("label", "Release method"),
        mode = node("select");
      for (const [value, text] of [
        ["publish_now", "Publish now"],
        ["schedule", "Schedule publication"],
      ]) {
        const o = node("option", text);
        o.value = value;
        mode.append(o);
      }
      mode.setAttribute("aria-label", "Release method");
      modeLabel.append(mode);
      dialog.append(modeLabel);
      const release = input("Exact release date and time (UK)", "datetime-local"),
        releaseFold = fold("Release clock-change occurrence");
      const publish = node("button", "Confirm publication / schedule");
      publish.type = "button";
      publish.className = "primary";
      const linkLabel = node("label", "ClassCharts quiz link"),
        link = node("input");
      link.readOnly = true;
      linkLabel.append(link);
      const close = node("button", "Close");
      close.type = "button";
      close.className = "secondary";
      dialog.append(message, publish, linkLabel, close);
      document.body.append(dialog);
      let epoch = 0,
        busy = false;
      function sync() {
        const q = owner.record();
        if (!q) return;
        summary.textContent =
          q.title +
          " · " +
          q.state +
          (q.release_at ? " · Release: " + format(q.release_at) : "") +
          (q.due_at ? " · Deadline: " + format(q.due_at) : "");
        approve.disabled = busy || q.state !== "draft";
        approval.disabled = busy || q.state !== "draft";
        publish.disabled = busy || q.state !== "approved" || !!q.first_started_at;
        close.disabled = busy;
        release.disabled = busy || mode.value !== "schedule";
        releaseFold.disabled = release.disabled;
        link.value = q.runtime_quiz_id
          ? "https://monob26.github.io/gcse-history-homework-hub-test/?quiz=" + q.runtime_quiz_id
          : "Available after approval";
      }
      mode.onchange = sync;
      close.onclick = () => dialog.close();
      dialog.addEventListener("cancel", (e) => {
        if (busy) e.preventDefault();
      });
      dialog.addEventListener("close", () => epoch++);
      async function act(action, payload) {
        const client = owner.client(),
          q = owner.record(),
          id = q.id,
          request = epoch;
        busy = true;
        message.textContent = "Saving publication settings…";
        sync();
        try {
          const result = await client.rpc("quiz_manager_release", {
            action,
            quiz_id: id,
            expected_revision: q.revision,
            payload,
          });
          if (request !== epoch || client !== owner.client()) return;
          if (result.error) throw result.error;
          if (!result.data?.ok) {
            const code = result.data?.error;
            const map = {
              nonexistent_uk_time:
                "That UK time does not exist because the clocks move forward. Choose another time.",
              ambiguous_uk_time_choose_earlier_or_later:
                "That UK time occurs twice. Choose the first or second occurrence.",
              invalid_classes: "Select at least one valid existing class for this year.",
              invalid_release_or_deadline:
                "The scheduled release must be in the future and the deadline must follow release.",
              approval_required: "Approve the questions before publishing.",
              revision_conflict:
                "This quiz changed elsewhere. Close this panel and reload the saved version.",
              quiz_locked: "A pupil has started. Questions and scoring are permanently locked.",
              validation_failed: "Complete all 25 valid questions, topic and week before approval.",
              year9_medicine_only:
                "Year 9 currently covers Medicine only. Use Medicine as the broad topic and review taught content.",
              teacher_required: "Your teacher authorisation has ended. Sign in again.",
            };
            throw new Error(
              map[code] ||
                "The publication settings could not be saved. Check your selections and try again.",
            );
          }
          await owner.reload(id);
          if (request !== epoch) return;
          approval.checked = false;
          message.textContent =
            action === "approve"
              ? "Questions approved. Choose classes, deadline and release, then confirm separately."
              : "Saved. " +
                (action === "schedule"
                  ? "This quiz becomes available automatically at the release time."
                  : "This quiz is now available to the assigned classes.");
          if (action !== "approve") document.dispatchEvent(new Event("quiz-published"));
        } catch (e) {
          if (request === epoch)
            message.textContent =
              (e.message || "Could not confirm publication.") +
              " Reload the saved quiz status before retrying if your connection was interrupted.";
        } finally {
          if (request === epoch) {
            busy = false;
            sync();
          }
        }
      }
      approve.onclick = async () => {
        if (!approval.checked) {
          message.textContent = "Confirm that you have reviewed all 25 questions before approving.";
          return;
        }
        await act("approve", { confirmed: true });
      };
      publish.onclick = () => {
        const selected = [...classes.querySelectorAll("input:checked")].map((i) => i.value);
        if (!selected.length || !due.value || (mode.value === "schedule" && !release.value)) {
          message.textContent =
            "Select classes and fill in the UK deadline and scheduled release time, if needed.";
          return;
        }
        if (
          !confirm(
            (mode.value === "schedule"
              ? "Schedule for " +
                release.value.replace("T", " ") +
                " UK time" +
                (releaseFold.value ? " (" + releaseFold.selectedOptions[0].textContent + ")" : "")
              : "Publish now") +
              " to " +
              selected.length +
              " class(es), with shared deadline " +
              due.value.replace("T", " ") +
              (dueFold.value ? " (" + dueFold.selectedOptions[0].textContent + ")" : "") +
              " UK time?",
          )
        )
          return;
        act(mode.value, {
          confirmed: true,
          classes: selected,
          due_local: due.value,
          due_fold: dueFold.value || null,
          ...(mode.value === "schedule"
            ? { release_local: release.value, release_fold: releaseFold.value || null }
            : {}),
        });
      };
      return {
        async open() {
          if (!owner.client()) return;
          if (!(await owner.save())) {
            owner.error(
              "Wait for the current save or resolve unsaved changes before reviewing publication.",
            );
            return;
          }
          const q = owner.record(),
            client = owner.client(),
            request = ++epoch;
          message.textContent = "Loading existing classes…";
          approval.checked = false;
          due.value = "";
          release.value = "";
          dueFold.value = "";
          releaseFold.value = "";
          mode.value = "publish_now";
          dialog.showModal();
          sync();
          try {
            const [catalogue, allocated] = await Promise.all([
              client.rpc("quiz_manager_classes"),
              client.from("quiz_manager_allocations").select("class_id").eq("quiz_id", q.id),
            ]);
            if (request !== epoch || client !== owner.client()) return;
            if (catalogue.error) throw catalogue.error;
            if (allocated.error) throw allocated.error;
            classes.replaceChildren(node("legend", "Assign to existing classes"));
            for (const c of catalogue.data.filter((c) => c.year_group === q.year_group)) {
              const l = node("label"),
                i = node("input");
              l.className = "qm-inline";
              i.type = "checkbox";
              i.value = c.id;
              i.checked = allocated.data.some((a) => a.class_id === c.id);
              l.append(i, document.createTextNode(c.class_name));
              classes.append(l);
            }
            message.textContent =
              "Approval and release are separate actions. Previews never create pupil attempts.";
          } catch (e) {
            if (request === epoch)
              message.textContent = "Unable to load class choices. " + e.message;
          }
        },
        close() {
          epoch++;
          busy = false;
          if (dialog.open) dialog.close();
          summary.textContent = "";
          message.textContent = "";
          link.value = "";
          due.value = "";
          release.value = "";
          dueFold.value = "";
          releaseFold.value = "";
          approval.checked = false;
          classes.replaceChildren(node("legend", "Assign to existing classes"));
        },
      };
    },
  };
})();
