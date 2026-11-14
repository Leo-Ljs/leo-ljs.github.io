(function () {
  "use strict";
  var DB = window.__SCORES__;
  if (!DB) { return; }
  var ORDER = DB.order;
  var COUNT = DB.count;
  var form = document.getElementById("query-form");
  var nameInput = document.getElementById("name");
  var sidField = document.getElementById("sid-field");
  var sidInput = document.getElementById("sid");
  var hint = document.getElementById("hint");
  var sameBox = document.getElementById("same");
  var viewQuery = document.getElementById("view-query");
  var viewResult = document.getElementById("view-result");
  var scoreBody = document.getElementById("score-body");
  var again = document.getElementById("again");

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
var K256 = (function () {
  var k = [];
  for (var i = 0, n = 2; i < 64; n++) {
    var pr = true;
    for (var d = 2; d * d <= n; d++) { if (n % d === 0) { pr = false; break; } }
    if (!pr) continue;
    k[i++] = (Math.pow(n, 1 / 3) % 1 * 4294967296) | 0;
  }
  return k;
})();
function sha256Hex(str) {
  var bytes = new TextEncoder().encode(str);
  var l = bytes.length, bitLen = l * 8;
  var buf = new Uint8Array((((l + 9 + 63) >> 6) << 6));
  buf.set(bytes);
  buf[l] = 0x80;
  var dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(buf.length - 4, bitLen >>> 0);
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Uint32Array(64);
  for (var i = 0; i < buf.length; i += 64) {
    for (var t = 0; t < 16; t++) { w[t] = dv.getUint32(i + t * 4); }
    for (var u = 16; u < 64; u++) {
      var a15 = w[u - 15], a2 = w[u - 2];
      var s0 = rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3);
      var s1 = rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10);
      w[u] = (w[u - 16] + s0 + w[u - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var v = 0; v < 64; v++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[v] + w[v]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = "";
  for (var j = 0; j < 8; j++) { out += ("0000000" + H[j].toString(16)).slice(-8); }
  return out;
}

  function normName(value) { return String(value == null ? "" : value).replace(/\s+/g, ""); }
  function keyOf(name) { return sha256Hex(DB.salt + "\u0000" + name); }

  function starCount(rank) {
    var p = rank / COUNT;
    if (p <= 0.1) { return 5; }
    if (p <= 0.3) { return 4; }
    if (p <= 0.55) { return 3; }
    if (p <= 0.8) { return 2; }
    return 1;
  }
  function starText(count) {
    var out = "";
    for (var i = 0; i < 5; i++) { out += i < count ? "★" : "☆"; }
    return out;
  }
  function addRow(label, value, cls) {
    var tr = document.createElement("tr");
    var th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    var td = document.createElement("td");
    td.textContent = String(value);
    if (cls) { td.className = cls; }
    tr.appendChild(th);
    tr.appendChild(td);
    return tr;
  }
  function showResult(item, name) {
    scoreBody.textContent = "";
    scoreBody.appendChild(addRow("学号", item.n));
    scoreBody.appendChild(addRow("姓名", name));
    for (var i = 0; i < ORDER.length; i++) {
      scoreBody.appendChild(addRow(ORDER[i], item.s[i]));
    }
    scoreBody.appendChild(addRow("总分", item.t));
    scoreBody.appendChild(addRow("校排名", item.r));
    scoreBody.appendChild(addRow("班级排名", item.cr));
    scoreBody.appendChild(addRow("星级评价", starText(starCount(item.r)), "stars"));
    viewQuery.classList.add("is-hidden");
    viewResult.classList.remove("is-hidden");
    window.scrollTo(0, 0);
  }
  function reset() {
    viewResult.classList.add("is-hidden");
    viewQuery.classList.remove("is-hidden");
    nameInput.value = "";
    sidInput.value = "";
    sidField.classList.add("is-hidden");
    hint.textContent = "";
    sameBox.textContent = "";
    nameInput.focus();
  }
  function clearHints() {
    hint.textContent = "";
    sameBox.textContent = "";
  }
  function askForSid(list, name) {
    sidField.classList.remove("is-hidden");
    hint.textContent = "名单里有 " + list.length + " 位同名同学，请选择你自己的学号：";
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var a = document.createElement("a");
        a.href = "#";
        a.textContent = item.c + " · 学号 " + item.n;
        a.addEventListener("click", function (event) {
          event.preventDefault();
          showResult(item, name);
        });
        sameBox.appendChild(a);
      })(list[i]);
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = normName(nameInput.value);
    clearHints();
    if (!name) {
      hint.textContent = "请输入姓名";
      nameInput.focus();
      return;
    }
    var list = DB.rec[keyOf(name)];
    if (!list) {
      sidField.classList.add("is-hidden");
      hint.textContent = "没有找到这个名字，请核对后重新输入。";
      nameInput.select();
      return;
    }
    if (list.length === 1) {
      showResult(list[0], name);
      return;
    }
    var typed = normName(sidInput.value);
    if (typed) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].n === typed || list[i].n.slice(-typed.length) === typed) {
          showResult(list[i], name);
          return;
        }
      }
      hint.textContent = "学号不对，请重新确认。";
    }
    askForSid(list, name);
  });

  nameInput.addEventListener("input", function () {
    sidField.classList.add("is-hidden");
    clearHints();
  });
  again.addEventListener("click", function (event) {
    event.preventDefault();
    reset();
  });

  var mockBack = document.getElementById("mock-back");
  if (mockBack) {
    mockBack.addEventListener("click", function (event) {
      event.preventDefault();
      if (!viewResult.classList.contains("is-hidden")) {
        reset();
        window.scrollTo(0, 0);
        return;
      }
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = "../";
    });
  }

  var mockClose = document.getElementById("mock-close");
  if (mockClose) {
    mockClose.addEventListener("click", function (event) {
      event.preventDefault();
      try { window.close(); } catch (err) {}
      window.setTimeout(function () {
        if (window.closed) return;
        window.location.href = "../";
      }, 160);
    });
  }
})();
