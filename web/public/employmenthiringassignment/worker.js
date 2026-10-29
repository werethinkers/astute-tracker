/* Runs a candidate's function against test cases, off the page's main thread.
   The page terminates this worker after a few seconds, so an infinite loop cannot freeze the tab. */
function norm(v) {
  if (v === undefined) return "__undefined__";
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  }
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function runCases(code, fn, cases) {
  let f;
  try {
    f = new Function(code + "\n;return typeof " + fn + ' === "function" ? ' + fn + " : undefined;")();
  } catch (err) {
    return { error: "Your code has an error: " + (err && err.message ? err.message : err) };
  }
  if (!f) return { error: "Define a function named " + fn + "." };
  const results = cases.map((c) => {
    try {
      const got = f(...JSON.parse(JSON.stringify(c.args)));
      if (got && typeof got.then === "function") return { ok: false, err: "Return the value directly, not a promise." };
      return { ok: same(got, c.expected), got: got === undefined ? "undefined" : got };
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) };
    }
  });
  return { results };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (e) => self.postMessage(runCases(e.data.code, e.data.fn, e.data.cases));
}
if (typeof module !== "undefined") module.exports = { runCases };
