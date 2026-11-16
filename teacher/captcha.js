"use strict";
window.HISTORY_CAPTCHA_GATE = {
  create(onChange) {
    const config = window.HISTORY_CAPTCHA || {};
    const configured = Object.keys(config).length > 0;
    const container = document.getElementById("authCaptcha");
    const status = document.getElementById("captchaStatus");
    let token = null,
      widget = null,
      mode = "signin",
      loaded = false;
    const required = () => configured && mode !== "reset";
    function notice(text) {
      status.textContent = text;
      status.hidden = !required();
      container.hidden = !required();
    }
    function reset() {
      token = null;
      if (widget !== null && window.turnstile) window.turnstile.reset(widget);
      notice(loaded ? "Complete the security check before continuing." : "Loading security check…");
      onChange();
    }
    if (configured) {
      notice("Loading security check…");
      if (
        config.provider !== "turnstile" ||
        typeof config.siteKey !== "string" ||
        /^(sb_|sk_|eyJ)/.test(config.siteKey) ||
        !/^[A-Za-z0-9_-]{10,200}$/.test(config.siteKey)
      ) {
        notice("Security check is not configured correctly. Contact the site administrator.");
      } else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        const timer = setTimeout(() => {
          if (!loaded) {
            notice("Security check could not load. Reload the page to try again.");
            onChange();
          }
        }, 15000);
        script.onerror = () => {
          clearTimeout(timer);
          notice("Security check could not load. Reload the page to try again.");
          onChange();
        };
        script.onload = () => {
          if (!window.turnstile) return script.onerror();
          window.turnstile.ready(() => {
            try {
              widget = window.turnstile.render(container, {
                sitekey: config.siteKey,
                "response-field": false,
                callback: (value) => {
                  token = typeof value === "string" && value ? value : null;
                  notice(token ? "Security check complete." : "Complete the security check.");
                  onChange();
                },
                "expired-callback": () => {
                  token = null;
                  notice("Security check expired. Complete it again.");
                  onChange();
                },
                "error-callback": () => {
                  token = null;
                  notice("Security check failed. Reload the page to try again.");
                  onChange();
                },
              });
              loaded = true;
              clearTimeout(timer);
            } catch {
              script.onerror();
            }
          });
        };
        document.head.append(script);
      }
    }
    return {
      ready: () => !required() || !!token,
      required,
      consume() {
        const value = token;
        token = null;
        return value;
      },
      reset,
      setMode(next) {
        if (mode !== next) {
          mode = next;
          reset();
        }
      },
    };
  },
};
