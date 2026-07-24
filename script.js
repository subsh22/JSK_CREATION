window.firebaseReady = (async function () {
  try {
    var appMod =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js");
    var fsMod =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    var firebaseConfig = {
      apiKey: "AIzaSyAP1W9aEd6alEs-3Ac2s36ecRT6sIkzkFs",
      authDomain: "jsk-creation.firebaseapp.com",
      projectId: "jsk-creation",
      storageBucket: "jsk-creation.firebasestorage.app",
      messagingSenderId: "682729907422",
      appId: "1:682729907422:web:7a2b9a127ef70a4e0e8e4f",
      measurementId: "G-1QGH1N1EMR",
    };
    var app = appMod.initializeApp(firebaseConfig);
    var db = fsMod.getFirestore(app);
    return {
      db: db,
      doc: fsMod.doc,
      getDoc: fsMod.getDoc,
      setDoc: fsMod.setDoc,
      collection: fsMod.collection,
      query: fsMod.query,
      orderBy: fsMod.orderBy,
      onSnapshot: fsMod.onSnapshot,
      updateDoc: fsMod.updateDoc,
      ok: true,
    };
  } catch (e) {
    console.error(
      "Firebase init failed, falling back to local storage only.",
      e,
    );
    return { ok: false };
  }
})();

(function () {
  "use strict";

  /* ================= persistence layer =================
     Order of preference: window.storage (claude.ai artifact
     sandbox) -> Firebase Firestore (cross-device cloud sync)
     -> localStorage (offline cache / standalone fallback)
     -> in-memory object (last resort, e.g. private/blocked storage) */
  var memoryFallback = {};
  var LS_PREFIX = "jsk-creation:";
  var FIRESTORE_COLLECTION = "jsk-creation";

  function lsGet(key) {
    try {
      var raw = window.localStorage.getItem(LS_PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function storeGet(key, fallback) {
    try {
      if (window.storage) {
        var res = await window.storage.get(key, false);
        if (res) return JSON.parse(res.value);
      }
    } catch (e) {
      /* key not found in window.storage, keep looking */
    }
    try {
      var fb = await window.firebaseReady;
      if (fb && fb.ok) {
        var ref = fb.doc(fb.db, FIRESTORE_COLLECTION, key);
        var snap = await fb.getDoc(ref);
        if (snap.exists()) {
          var val = snap.data().value;
          lsSet(key, val); // keep a local cache too
          return val;
        }
      }
    } catch (e) {
      console.warn("Firestore read failed for", key, e);
    }
    var ls = lsGet(key);
    if (ls !== undefined) return ls;
    return memoryFallback.hasOwnProperty(key) ? memoryFallback[key] : fallback;
  }
  async function storeSet(key, value) {
    memoryFallback[key] = value;
    lsSet(key, value);
    try {
      if (window.storage) {
        await window.storage.set(key, JSON.stringify(value), false);
      }
    } catch (e) {
      /* localStorage already has it as a safety net */
    }
    try {
      var fb = await window.firebaseReady;
      if (fb && fb.ok) {
        var ref = fb.doc(fb.db, FIRESTORE_COLLECTION, key);
        await fb.setDoc(ref, { value: value });
      }
    } catch (e) {
      console.warn("Firestore write failed for", key, e);
    }
  }

  /* ================= warehouse login gate =================
     Password itself is never stored in the code. Only its SHA-256
     hash is saved (in Firestore/localStorage via storeGet/storeSet),
     and it's chosen by whoever sets it up on first visit. This blocks
     casual access to the dashboard; it is not bank-grade security
     since everything here runs in the browser. */
  var AUTH_KEY = "warehouseAuth";
  var AUTH_LOCAL_FLAG = LS_PREFIX + "warehouseAuthed";
  var WAREHOUSE_USERNAME = "jskcreation";
  var gate = { mode: "login", error: "", busy: false };

  function isAuthedOnThisDevice() {
    try {
      return window.localStorage.getItem(AUTH_LOCAL_FLAG) === "1";
    } catch (e) {
      return false;
    }
  }
  function setAuthedOnThisDevice(flag) {
    try {
      if (flag) window.localStorage.setItem(AUTH_LOCAL_FLAG, "1");
      else window.localStorage.removeItem(AUTH_LOCAL_FLAG);
    } catch (e) {
      /* ignore */
    }
  }
  async function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    var hashBuf = await crypto.subtle.digest("SHA-256", data);
    var bytes = Array.from(new Uint8Array(hashBuf));
    return bytes
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function renderGate() {
    var isSetup = gate.mode === "setup";
    var title = isSetup ? "Set Up Warehouse Password" : "Warehouse Login";
    var sub = isSetup
      ? "One-time setup — choose a password to protect this dashboard. Only people who know it will be able to log in."
      : "Enter your username and password to continue.";
    var fields = isSetup
      ? '<div class="field"><label>Username</label><input type="text" value="' +
        esc(WAREHOUSE_USERNAME) +
        '" readonly></div>' +
        '<div class="field"><label>Choose Password</label><input type="password" id="gatePass" autocomplete="new-password" required minlength="4"></div>' +
        '<div class="field"><label>Confirm Password</label><input type="password" id="gateConfirmPass" autocomplete="new-password" required minlength="4"></div>'
      : '<div class="field"><label>Username</label><input type="text" id="gateUser" autocomplete="username" required></div>' +
        '<div class="field"><label>Password</label><input type="password" id="gatePass" autocomplete="current-password" required></div>';

    return (
      '<div class="gate-wrap">' +
      '<form id="gate-form" class="gate-card">' +
      '<div class="brand" style="color:var(--maroon);">JSK Creation<small style="color:var(--gold-soft);background:var(--maroon);display:inline-block;padding:2px 8px;border-radius:4px;margin-top:6px;">Warehouse Access</small></div>' +
      '<h2 class="display" style="margin:18px 0 4px;">' +
      title +
      "</h2>" +
      '<p class="muted" style="margin:0 0 18px;">' +
      sub +
      "</p>" +
      fields +
      (gate.error
        ? '<p class="gate-error">' + esc(gate.error) + "</p>"
        : "") +
      '<button type="submit" class="btn btn-primary" id="gateSubmitBtn" style="width:100%;justify-content:center;margin-top:6px;">' +
      (isSetup ? "Set Password &amp; Continue" : "Login") +
      "</button>" +
      '<a href="index.html" class="back-to-store" style="display:block;text-align:center;margin-top:16px;position:static;">&larr; Back to Store</a>' +
      "</form>" +
      "</div>"
    );
  }

  function showGate() {
    document.getElementById("app").innerHTML = renderGate();
    bindGateEvents();
  }

  function bindGateEvents() {
    var form = document.getElementById("gate-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (gate.busy) return;
      if (gate.mode === "setup") handleSetupSubmit();
      else handleLoginSubmit();
    });
  }

  async function handleSetupSubmit() {
    var pass = document.getElementById("gatePass").value;
    var confirm = document.getElementById("gateConfirmPass").value;
    if (!pass || pass.length < 4) {
      gate.error = "Password kam se kam 4 characters ka hona chahiye.";
      showGate();
      return;
    }
    if (pass !== confirm) {
      gate.error = "Dono password match nahi ho rahe.";
      showGate();
      return;
    }
    gate.busy = true;
    var hash = await sha256Hex(pass);
    await storeSet(AUTH_KEY, { passwordHash: hash });
    gate.busy = false;
    setAuthedOnThisDevice(true);
    init();
  }

  async function handleLoginSubmit() {
    var user = document.getElementById("gateUser").value.trim().toLowerCase();
    var pass = document.getElementById("gatePass").value;
    gate.busy = true;
    /* kick off the app-data fetch at the same time as the password
       check, instead of waiting for login to finish first — the two
       network round-trips happen together instead of back-to-back */
    var dataPromise = fetchAppData();
    var auth = await storeGet(AUTH_KEY, null);
    var hash = await sha256Hex(pass || "");
    gate.busy = false;
    if (
      !auth ||
      user !== WAREHOUSE_USERNAME ||
      hash !== auth.passwordHash
    ) {
      gate.error = "Galat username ya password.";
      showGate();
      return;
    }
    gate.error = "";
    setAuthedOnThisDevice(true);
    init(dataPromise);
  }

  async function boot() {
    var auth = await storeGet(AUTH_KEY, null);
    if (!auth || !auth.passwordHash) {
      gate.mode = "setup";
      showGate();
      return;
    }
    /* Always ask for the password on every fresh visit to the warehouse
       page (including coming back via "Back to Store"), even if this
       device logged in successfully before. */
    gate.mode = "login";
    showGate();
  }

  async function submitChangePassword() {
    var current = document.getElementById("cpCurrent").value;
    var next = document.getElementById("cpNew").value;
    var confirm = document.getElementById("cpConfirm").value;
    var auth = await storeGet(AUTH_KEY, null);
    var currentHash = await sha256Hex(current || "");
    if (!auth || currentHash !== auth.passwordHash) {
      state.modal = {
        type: "changePassword",
        payload: { error: "Current password galat hai." },
      };
      render();
      return;
    }
    if (!next || next.length < 4) {
      state.modal = {
        type: "changePassword",
        payload: { error: "New password kam se kam 4 characters ka ho." },
      };
      render();
      return;
    }
    if (next !== confirm) {
      state.modal = {
        type: "changePassword",
        payload: { error: "Naye password match nahi ho rahe." },
      };
      render();
      return;
    }
    var newHash = await sha256Hex(next);
    await storeSet(AUTH_KEY, { passwordHash: newHash });
    state.modal = null;
    render();
  }

  function logout() {
    setAuthedOnThisDevice(false);
    gate.mode = "login";
    gate.error = "";
    showGate();
  }

  /* ================= state ================= */
  var state = {
    view: "dashboard",
    items: [],
    invoices: [],
    orders: [],
    ordersSubscribed: false,
    invoiceCounter: 1000,
    modal: null,
    draft: null,
    activeInvoiceId: null,
    activeItemId: null,
    clientFilter: null,
    formErrors: null,
    editingInvoiceId: null,
    editingSnapshot: null,
    activeComboLine: null,
    pendingLineForNewItem: null,
    itemSearchQuery: "",
  };

  var PALETTE = [
    "#6C1E3C",
    "#0F6E6E",
    "#C9973B",
    "#3E5C76",
    "#7A4A9E",
    "#1F6E43",
    "#A23B2E",
    "#2E4A6B",
  ];
  function colorFor(name) {
    var str = name || "?";
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return PALETTE[hash % PALETTE.length];
  }
  function initials(name) {
    var parts = (name || "?").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  var UNIT_LABELS = {
    pc: "pc",
    pair: "pair",
    packet: "packet",
    yard: "yard",
    gram: "gram",
  };
  function unitLabel(unit) {
    return UNIT_LABELS[unit] || "pc";
  }
  var CATEGORY_LABELS = {
    tulip: "Tulip",
    moon: "Moon",
    lotus: "Lotus",
    kundan: "Kundan",
    "ghanthan-mala": "Ghanthan Mala",
    connectors: "Connectors",
    minakari: "Minakari",
    chains: "Chains",
    stones: "Stones",
  };
  function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || "Tulip";
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return "Rs. " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  function uid() {
    return (
      "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    );
  }

  /* filters items for the item combobox: matches whose NAME or any WORD in the
     name starts with the query are ranked first, plain substring matches after */
  function comboFilter(items, query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return items;
    var starts = [],
      contains = [];
    items.forEach(function (i) {
      var nameLower = i.name.toLowerCase();
      var words = nameLower.split(/\s+/);
      if (
        words.some(function (w) {
          return w.indexOf(q) === 0;
        })
      ) {
        starts.push(i);
      } else if (nameLower.indexOf(q) > -1) {
        contains.push(i);
      }
    });
    return starts.concat(contains);
  }

  /* re-renders the whole app while keeping the currently focused search/combo
     input focused (and its cursor position), since render() replaces all HTML */
  function withPreservedFocus(renderFn) {
    var active = document.activeElement;
    var selector = null,
      selStart = null,
      selEnd = null;
    var trackAttrs = ["data-combo-input", "data-item-search"];
    if (active) {
      for (var i = 0; i < trackAttrs.length; i++) {
        if (active.hasAttribute(trackAttrs[i])) {
          var val = active.getAttribute(trackAttrs[i]);
          selector = val
            ? "[" + trackAttrs[i] + '="' + val.replace(/"/g, '\\"') + '"]'
            : "[" + trackAttrs[i] + "]";
          break;
        }
      }
      try {
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
      } catch (e) {}
    }
    renderFn();
    if (selector) {
      var el = document.querySelector(selector);
      if (el) {
        el.focus();
        if (selStart != null) {
          try {
            el.setSelectionRange(selStart, selEnd);
          } catch (e) {}
        }
      }
    }
  }

  /* thumbnail markup for an item/line: real picture if provided, else a monogram badge */
  function thumbHTML(entity, size) {
    size = size || 36;
    var style = "width:" + size + "px;height:" + size + "px;";
    if (entity.img) {
      return (
        '<div class="thumb" style="' +
        style +
        '"><img src="' +
        esc(entity.img) +
        '" alt="" onerror="this.parentElement.innerHTML=\'' +
        initials(entity.name) +
        "';this.parentElement.style.background='" +
        colorFor(entity.name) +
        "';\"></div>"
      );
    }
    var bg = entity.color || colorFor(entity.name);
    return (
      '<div class="thumb" style="' +
      style +
      ";background:" +
      bg +
      ';">' +
      initials(entity.name) +
      "</div>"
    );
  }

  /* Resize + compress a picked image file to a JPEG data URL so it can
     sync through Firestore without blowing the document size limit. */
  function compressImageFile(file, maxSide, quality) {
    maxSide = maxSide || 800;
    quality = quality == null ? 0.72 : quality;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Please choose an image file (JPG, PNG, or WebP)."));
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error("Image is too large. Please use a file under 12 MB."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read that file."));
      };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Could not open that image."));
        };
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL("image/jpeg", quality));
          } catch (e) {
            reject(new Error("Could not process that image."));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function setImgPreview(src) {
    var preview = document.getElementById("imgPreview");
    var hidden = document.getElementById("imgHidden");
    var clearBtn = document.getElementById("imgClearBtn");
    if (hidden) hidden.value = src || "";
    if (clearBtn) clearBtn.hidden = !src;
    if (!preview) return;
    if (src) {
      preview.innerHTML = '<img src="' + esc(src) + '" alt="Preview">';
      preview.classList.add("has-img");
    } else {
      preview.innerHTML =
        '<span class="img-upload-placeholder">No picture</span>';
      preview.classList.remove("has-img");
    }
  }

  /* ================= init ================= */
  async function fetchAppData() {
    var results = await Promise.all([
      storeGet("items", null),
      storeGet("invoices", []),
      storeGet("invoiceCounter", 1000),
    ]);
    var items = results[0];
    var invoices = results[1];
    var counter = results[2];
    if (!items) {
      items = [
        {
          id: uid(),
          name: "Kundan",
          img: "",
          color: colorFor("Kundan"),
          qty: 12,
          price: 100,
          unit: "pc",
          cat: "kundan",
          desc: "",
          sku: "",
          unitLabel: "",
        },
        {
          id: uid(),
          name: "Chain",
          img: "",
          color: colorFor("Chain"),
          qty: 34,
          price: 100,
          unit: "pc",
          cat: "chains",
          desc: "",
          sku: "",
          unitLabel: "",
        },
        {
          id: uid(),
          name: "Beads",
          img: "",
          color: colorFor("Beads"),
          qty: 56,
          price: 100,
          unit: "packet",
          cat: "tulip",
          desc: "",
          sku: "",
          unitLabel: "",
        },
      ];
      storeSet("items", items);
    }
    return { items: items, invoices: invoices, counter: counter };
  }

  async function init(dataPromise) {
    var data = await (dataPromise || fetchAppData());
    state.items = data.items;
    state.invoices = data.invoices;
    state.invoiceCounter = data.counter;
    render();
    subscribeOrders();
  }

  /* ================= incoming orders (from the website) =================
     Customers placing an order on index.html write a document straight
     into the "orders" Firestore collection. We listen live here so a new
     order shows up on this dashboard (and its badge count) the instant
     it comes in, with no refresh needed. Nothing is billed and no stock
     is touched until a staff member reviews it and clicks "Bill Banayen". */
  async function subscribeOrders() {
    if (state.ordersSubscribed) return;
    try {
      var fb = await window.firebaseReady;
      if (!fb || !fb.ok) return;
      state.ordersSubscribed = true;
      var q = fb.query(
        fb.collection(fb.db, "orders"),
        fb.orderBy("createdAt", "desc"),
      );
      fb.onSnapshot(
        q,
        function (snap) {
          state.orders = snap.docs.map(function (d) {
            var data = d.data();
            data.id = d.id;
            return data;
          });
          render();
        },
        function (err) {
          console.warn("Orders live sync failed:", err);
        },
      );
    } catch (e) {
      console.warn("Could not subscribe to orders:", e);
    }
  }

  function pendingOrders() {
    return state.orders.filter(function (o) {
      return o.status === "pending";
    });
  }

  async function setOrderStatus(orderId, status, extra) {
    var order = state.orders.find(function (o) {
      return o.id === orderId;
    });
    if (order) order.status = status;
    try {
      var fb = await window.firebaseReady;
      if (fb && fb.ok) {
        var ref = fb.doc(fb.db, "orders", orderId);
        await fb.updateDoc(
          ref,
          Object.assign({ status: status }, extra || {}),
        );
      }
    } catch (e) {
      console.warn("Could not update order status:", e);
    }
  }

  function dismissOrder(orderId) {
    setOrderStatus(orderId, "dismissed");
    render();
  }

  function billOrder(orderId) {
    var order = state.orders.find(function (o) {
      return o.id === orderId;
    });
    if (!order) return;
    state.invoiceCounter += 1;
    var cust = order.customer || {};
    var addressBits = [cust.address, cust.city].filter(Boolean).join(", ");
    state.draft = {
      invoiceNo: "JSK-" + state.invoiceCounter,
      deliveryCharges: 0,
      date: new Date().toISOString().slice(0, 10),
      clientName: cust.name || "",
      phone: cust.phone || "",
      address: addressBits,
      lines: (order.lines || []).map(function (l) {
        return { id: uid(), itemId: l.itemId, qty: l.qty, query: l.name || "" };
      }),
      sourceOrderId: order.id,
    };
    state.editingInvoiceId = null;
    state.editingSnapshot = null;
    state.view = "new-invoice";
    render();
  }

  async function saveItems() {
    await storeSet("items", state.items);
  }
  async function saveInvoices() {
    await storeSet("invoices", state.invoices);
  }
  async function saveCounter() {
    await storeSet("invoiceCounter", state.invoiceCounter);
  }

  /* ================= navigation ================= */
  function abandonEditIfAny() {
    if (state.editingInvoiceId && state.editingSnapshot) {
      state.editingSnapshot.forEach(function (l) {
        var item = state.items.find(function (i) {
          return i.id === l.itemId;
        });
        if (item) item.qty = Math.max(0, item.qty - l.qty);
      });
      saveItems();
    }
    state.editingInvoiceId = null;
    state.editingSnapshot = null;
  }

  function goTo(view) {
    if (
      state.view === "new-invoice" &&
      view !== "new-invoice" &&
      state.editingInvoiceId
    ) {
      abandonEditIfAny();
      state.draft = null;
      state.formErrors = null;
    }
    state.view = view;
    if (view === "new-invoice" && !state.draft) {
      startDraft();
    }
    if (view !== "invoices") {
      state.clientFilter = null;
    }
    render();
  }

  function startDraft() {
    state.invoiceCounter += 1;
    state.draft = {
      invoiceNo: "JSK-" + state.invoiceCounter,
      deliveryCharges: 0,
      date: new Date().toISOString().slice(0, 10),
      clientName: "",
      phone: "",
      address: "",
      lines: [{ id: uid(), itemId: "", qty: 1, query: "" }],
    };
  }

  function startDraftForItem(itemId) {
    state.invoiceCounter += 1;
    state.draft = {
      invoiceNo: "JSK-" + state.invoiceCounter,
      deliveryCharges: 0,
      date: new Date().toISOString().slice(0, 10),
      clientName: "",
      phone: "",
      address: "",
      lines: [{ id: uid(), itemId: itemId, qty: 1, query: "" }],
    };
    state.editingInvoiceId = null;
    state.editingSnapshot = null;
    state.view = "new-invoice";
    render();
  }

  /* ================= item CRUD ================= */
  function openItemModal(item) {
    state.modal = {
      type: "item",
      payload: item
        ? Object.assign({}, item)
        : {
            id: null,
            name: "",
            img: "",
            qty: 0,
            price: 0,
            unit: "pc",
            cat: "tulip",
            desc: "",
            sku: "",
            unitLabel: "",
          },
    };
    render();
  }
  async function submitItemModal(formEl) {
    var fd = new FormData(formEl);
    var name = (fd.get("name") || "").toString().trim();
    var qty = Number(fd.get("qty")) || 0;
    var price = Number(fd.get("price")) || 0;
    var img = (fd.get("img") || "").toString().trim();
    var unit = (fd.get("unit") || "pc").toString();
    var cat = (fd.get("cat") || "tulip").toString();
    var desc = (fd.get("desc") || "").toString().trim();
    var sku = (fd.get("sku") || "").toString().trim();
    var unitLabelText = (fd.get("unitLabel") || "").toString().trim();
    if (!name) {
      return;
    }
    var payload = state.modal.payload;
    var newlyCreatedItem = null;
    if (payload.id) {
      var it = state.items.find(function (i) {
        return i.id === payload.id;
      });
      if (it) {
        it.name = name;
        it.qty = qty;
        it.price = price;
        it.img = img;
        it.unit = unit;
        it.cat = cat;
        it.desc = desc;
        it.sku = sku;
        it.unitLabel = unitLabelText;
        it.color = colorFor(name);
      }
    } else {
      newlyCreatedItem = {
        id: uid(),
        name: name,
        img: img,
        color: colorFor(name),
        qty: qty,
        price: price,
        unit: unit,
        cat: cat,
        desc: desc,
        sku: sku,
        unitLabel: unitLabelText,
      };
      state.items.push(newlyCreatedItem);
    }
    saveItems();
    if (newlyCreatedItem && state.pendingLineForNewItem && state.draft) {
      var line = state.draft.lines.find(function (l) {
        return l.id === state.pendingLineForNewItem;
      });
      if (line) {
        line.itemId = newlyCreatedItem.id;
        line.query = newlyCreatedItem.name;
      }
    }
    state.pendingLineForNewItem = null;
    state.modal = null;
    render();
  }
  function confirmDeleteItem(id) {
    state.modal = { type: "confirmDeleteItem", payload: { id: id } };
    render();
  }
  async function deleteItem(id) {
    state.items = state.items.filter(function (i) {
      return i.id !== id;
    });
    saveItems();
    state.modal = null;
    render();
  }

  /* ================= invoice draft editing ================= */
  function addDraftLine() {
    state.draft.lines.push({ id: uid(), itemId: "", qty: 1, query: "" });
    render();
  }
  function removeDraftLine(lineId) {
    if (state.draft.lines.length === 1) return;
    state.draft.lines = state.draft.lines.filter(function (l) {
      return l.id !== lineId;
    });
    render();
  }
  function updateDraftLine(lineId, field, value) {
    var line = state.draft.lines.find(function (l) {
      return l.id === lineId;
    });
    if (!line) return;
    if (field === "itemId") {
      line.itemId = value;
      var item = state.items.find(function (i) {
        return i.id === value;
      });
      line.query = item ? item.name : "";
    }
    if (field === "qty") line.qty = Math.max(0, Number(value) || 0);
    render();
  }
  function updateDraftField(field, value) {
    state.draft[field] = value;
  }

  function selectComboItem(lineId, itemId) {
    state.activeComboLine = null;
    updateDraftLine(lineId, "itemId", itemId);
  }

  function triggerQuickAddItem(lineId, name) {
    state.activeComboLine = null;
    state.pendingLineForNewItem = lineId;
    openItemModal({
      id: null,
      name: name,
      img: "",
      qty: 0,
      price: 0,
      unit: "pc",
      cat: "tulip",
      desc: "",
      sku: "",
      unitLabel: "",
    });
  }

  function draftSubtotal() {
    var total = 0;
    state.draft.lines.forEach(function (l) {
      var item = state.items.find(function (i) {
        return i.id === l.itemId;
      });
      if (item) total += item.price * l.qty;
    });
    return total;
  }

  function draftDeliveryCharges() {
    return Number(state.draft.deliveryCharges) || 0;
  }

  function draftTotal() {
    return draftSubtotal() + draftDeliveryCharges();
  }

  function draftErrors() {
    var errs = [];
    if (!state.draft.clientName.trim()) errs.push("Client name is required.");
    var validLines = state.draft.lines.filter(function (l) {
      return l.itemId;
    });
    if (validLines.length === 0) errs.push("Add at least one item.");
    validLines.forEach(function (l) {
      var item = state.items.find(function (i) {
        return i.id === l.itemId;
      });
      if (item && l.qty > item.qty) {
        errs.push(
          "Only " +
            item.qty +
            " " +
            unitLabel(item.unit) +
            " of " +
            item.name +
            " in stock.",
        );
      }
      if (item && l.qty <= 0) {
        errs.push("Quantity for " + item.name + " must be greater than 0.");
      }
    });
    return errs;
  }

  async function saveDraftInvoice() {
    var errs = draftErrors();
    if (errs.length) {
      state.formErrors = errs;
      render();
      return;
    }
    var lines = state.draft.lines
      .filter(function (l) {
        return l.itemId;
      })
      .map(function (l) {
        var item = state.items.find(function (i) {
          return i.id === l.itemId;
        });
        return {
          itemId: item.id,
          name: item.name,
          img: item.img,
          color: item.color,
          unit: item.unit,
          qty: l.qty,
          price: item.price,
          amount: item.price * l.qty,
        };
      });
    var subtotal = lines.reduce(function (s, l) {
      return s + l.amount;
    }, 0);
    var deliveryCharges = Number(state.draft.deliveryCharges) || 0;
    var total = subtotal + deliveryCharges;

    lines.forEach(function (l) {
      var item = state.items.find(function (i) {
        return i.id === l.itemId;
      });
      if (item) item.qty = Math.max(0, item.qty - l.qty);
    });

    var savedId;
    if (state.editingInvoiceId) {
      var existing = state.invoices.find(function (i) {
        return i.id === state.editingInvoiceId;
      });
      if (existing) {
        existing.date = state.draft.date;
        existing.deliveryCharges = deliveryCharges;
        existing.clientName = state.draft.clientName.trim();
        existing.phone = state.draft.phone.trim();
        existing.address = state.draft.address.trim();
        existing.lines = lines;
        existing.subtotal = subtotal;
        existing.total = total;
        savedId = existing.id;
      }
      state.editingInvoiceId = null;
      state.editingSnapshot = null;
    } else {
      var invoice = {
        id: uid(),
        invoiceNo: state.draft.invoiceNo,
        deliveryCharges: deliveryCharges,
        date: state.draft.date,
        clientName: state.draft.clientName.trim(),
        phone: state.draft.phone.trim(),
        address: state.draft.address.trim(),
        lines: lines,
        subtotal: subtotal,
        total: total,
      };
      state.invoices.unshift(invoice);
      savedId = invoice.id;
    }

    saveItems();
    saveInvoices();
    saveCounter();
    if (state.draft.sourceOrderId) {
      setOrderStatus(state.draft.sourceOrderId, "billed", {
        invoiceId: savedId,
      });
    }
    state.draft = null;
    state.formErrors = null;
    state.activeInvoiceId = savedId;
    state.view = "invoice-view";
    render();
  }

  function cancelDraft() {
    if (state.editingInvoiceId) {
      var backToId = state.editingInvoiceId;
      abandonEditIfAny();
      state.draft = null;
      state.formErrors = null;
      state.activeInvoiceId = backToId;
      state.view = "invoice-view";
      render();
      return;
    }
    state.draft = null;
    state.formErrors = null;
    goTo("dashboard");
  }

  function editInvoice(id) {
    var inv = state.invoices.find(function (i) {
      return i.id === id;
    });
    if (!inv) return;
    // put this invoice's quantities back into stock so they can be re-allocated / adjusted
    inv.lines.forEach(function (l) {
      var item = state.items.find(function (i) {
        return i.id === l.itemId;
      });
      if (item) item.qty += l.qty;
    });
    saveItems();
    state.editingInvoiceId = inv.id;
    state.editingSnapshot = inv.lines.map(function (l) {
      return { itemId: l.itemId, qty: l.qty };
    });
    state.draft = {
      invoiceNo: inv.invoiceNo,
      deliveryCharges: inv.deliveryCharges || 0,
      date: inv.date,
      clientName: inv.clientName,
      phone: inv.phone || "",
      address: inv.address || "",
      lines: inv.lines.map(function (l) {
        return { id: uid(), itemId: l.itemId, qty: l.qty, query: l.name || "" };
      }),
    };
    state.formErrors = null;
    state.view = "new-invoice";
    render();
  }

  function viewInvoice(id) {
    state.activeInvoiceId = id;
    state.view = "invoice-view";
    render();
  }
  function confirmDeleteInvoice(id) {
    state.modal = { type: "confirmDeleteInvoice", payload: { id: id } };
    render();
  }
  async function deleteInvoice(id) {
    var inv = state.invoices.find(function (i) {
      return i.id === id;
    });
    if (inv) {
      // restore stock for the deleted invoice's lines
      inv.lines.forEach(function (l) {
        var item = state.items.find(function (i) {
          return i.id === l.itemId;
        });
        if (item) item.qty += l.qty;
      });
      saveItems();
    }
    state.invoices = state.invoices.filter(function (i) {
      return i.id !== id;
    });
    saveInvoices();
    state.modal = null;
    if (state.activeInvoiceId === id) {
      state.activeInvoiceId = null;
      state.view = "invoices";
    }
    render();
  }

  function viewClientInvoices(clientName) {
    state.clientFilter = clientName;
    state.view = "invoices";
    render();
  }

  function viewItemOrders(itemId) {
    state.activeItemId = itemId;
    state.view = "item-orders";
    render();
  }

  /* ================= render helpers ================= */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function beadsDivider() {
    var colors = ["var(--gold)", "var(--teal)", "var(--gold)", "var(--maroon)"];
    var dots = "";
    for (var i = 0; i < 28; i++) {
      dots +=
        '<span style="background:' + colors[i % colors.length] + '"></span>';
    }
    return '<div class="beads">' + dots + "</div>";
  }

  function invoiceFooterHTML() {
    return '<div class="inv-footer">JSK CREATION<span class="dot-sep"></span>Beads &amp; Jewellery Supply</div>';
  }

  function renderSidebar() {
    var pendingCount = pendingOrders().length;
    var navItems = [
      { id: "dashboard", label: "Dashboard" },
      { id: "orders", label: "Naya Order", badge: pendingCount },
      { id: "items", label: "Inventory" },
      { id: "new-invoice", label: "New Invoice" },
      { id: "invoices", label: "Invoice History" },
      { id: "clients", label: "Clients" },
    ];
    var buttons = navItems
      .map(function (n) {
        var active =
          state.view === n.id ||
          (state.view === "invoice-view" && n.id === "invoices") ||
          (state.view === "item-orders" && n.id === "items");
        return (
          '<button class="' +
          (active ? "active" : "") +
          '" data-nav="' +
          n.id +
          '"><span class="dot"></span>' +
          n.label +
          (n.badge
            ? '<span class="pill low" style="margin-left:8px;">' +
              n.badge +
              "</span>"
            : "") +
          "</button>"
        );
      })
      .join("");
    return (
      '<div class="sidebar no-print">' +
      '<div class="brand">JSK Creation<small>Beads &amp; Jewellery Supply</small></div>' +
      '<div class="nav">' +
      buttons +
      "</div>" +
      '<a href="index.html" class="back-to-store">&larr; Back to Store</a>' +
      '<div class="sidebar-foot">' +
      state.invoices.length +
      " invoices billed<br>" +
      state.items.length +
      " items tracked</div>" +
      '<div class="sidebar-auth-row">' +
      '<button type="button" class="btn-link" data-change-password>Change Password</button>' +
      '<button type="button" class="btn-link" data-logout>Logout</button>' +
      "</div>" +
      "</div>"
    );
  }

  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderOrders() {
    var pending = pendingOrders();
    var recentOther = state.orders
      .filter(function (o) {
        return o.status !== "pending";
      })
      .slice(0, 15);

    function orderCard(o, showActions) {
      var cust = o.customer || {};
      var lines = o.lines || [];
      var itemsHtml = lines
        .map(function (l) {
          return (
            "<tr><td>" +
            esc(l.name || "Item") +
            "</td><td>" +
            l.qty +
            '</td><td class="num">' +
            fmtMoney((l.price || 0) * (l.qty || 0)) +
            "</td></tr>"
          );
        })
        .join("");
      var statusPill =
        o.status === "billed"
          ? '<span class="pill" style="background:#e6f4ea;color:#1f6e43;">billed</span>'
          : o.status === "dismissed"
            ? '<span class="pill low">dismissed</span>'
            : '<span class="pill low">pending</span>';
      return (
        '<div class="card" style="margin-bottom:16px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
        "<div>" +
        '<h3 class="display" style="margin:0 0 4px;font-size:17px;">' +
        esc(cust.name || "Unknown customer") +
        " " +
        statusPill +
        "</h3>" +
        '<div class="muted">' +
        esc(cust.phone || "") +
        (cust.address || cust.city
          ? " &middot; " + esc([cust.address, cust.city].filter(Boolean).join(", "))
          : "") +
        "</div>" +
        (cust.notes
          ? '<div class="muted" style="margin-top:4px;">Note: ' + esc(cust.notes) + "</div>"
          : "") +
        "</div>" +
        '<div style="text-align:right;">' +
        '<div class="muted">' +
        fmtDateTime(o.createdAt) +
        "</div>" +
        '<div class="value teal" style="font-size:18px;">' +
        fmtMoney(o.total) +
        "</div>" +
        "</div>" +
        "</div>" +
        '<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>' +
        itemsHtml +
        "</tbody></table></div>" +
        (showActions
          ? '<div class="btn-row" style="margin-top:12px;">' +
            '<button class="btn btn-primary" data-bill-order="' +
            o.id +
            '">Bill Banayen</button>' +
            '<button class="btn btn-ghost" data-dismiss-order="' +
            o.id +
            '">Dismiss</button>' +
            "</div>"
          : "") +
        "</div>"
      );
    }

    return (
      '<div class="page-head">' +
      "<div><h1>Naya Order</h1><p>Website se aane wale orders yahan live aate hain. Har order check karke bill banayein.</p></div>" +
      "</div>" +
      beadsDivider() +
      (pending.length
        ? pending.map(function (o) { return orderCard(o, true); }).join("")
        : '<div class="empty"><div class="glyph">🧾</div><h3>Koi naya order nahi</h3><p>Jab customer website se order karega, wo yahan turant aa jayega.</p></div>') +
      (recentOther.length
        ? '<h3 class="display" style="margin:24px 0 12px;font-size:16px;">Purane Orders</h3>' +
          recentOther.map(function (o) { return orderCard(o, false); }).join("")
        : "")
    );
  }

  function renderDashboard() {
    var stockValue = state.items.reduce(function (s, i) {
      return s + i.qty * i.price;
    }, 0);
    var revenue = state.invoices.reduce(function (s, i) {
      return s + i.total;
    }, 0);
    var lowStock = state.items.filter(function (i) {
      return i.qty <= 5;
    });
    var recent = state.invoices.slice(0, 5);
    var pendingCount = pendingOrders().length;

    var recentRows = recent
      .map(function (inv) {
        return (
          "<tr>" +
          '<td class="item-name">' +
          esc(inv.clientName) +
          '<div class="muted">' +
          esc(inv.invoiceNo) +
          "</div></td>" +
          "<td>" +
          fmtDate(inv.date) +
          "</td>" +
          '<td class="num">' +
          fmtMoney(inv.total) +
          "</td>" +
          '<td><button class="btn btn-ghost" data-view-invoice="' +
          inv.id +
          '" style="padding:6px 12px;font-size:12px;">View</button></td>' +
          "</tr>"
        );
      })
      .join("");

    var lowStockHtml = lowStock.length
      ? lowStock
          .map(function (i) {
            return (
              '<tr><td class="item-name" style="display:flex;align-items:center;gap:10px;">' +
              thumbHTML(i, 28) +
              " " +
              esc(i.name) +
              '</td><td><span class="pill low">' +
              i.qty +
              " " +
              unitLabel(i.unit) +
              " left</span></td></tr>"
            );
          })
          .join("")
      : '<tr><td class="muted" style="padding:14px 10px;">All items are well stocked.</td></tr>';

    return (
      '<div class="page-head">' +
      "<div><h1>Dashboard</h1><p>Overview of stock and billing for JSK Creation.</p></div>" +
      '<button class="btn btn-primary" data-nav="new-invoice">+ New Invoice</button>' +
      "</div>" +
      beadsDivider() +
      '<div class="grid stat-grid">' +
      '<div class="stat" style="cursor:pointer;" data-nav="orders"><div class="label">Naya Order</div><div class="value' +
      (pendingCount ? " teal" : "") +
      '">' +
      pendingCount +
      "</div></div>" +
      '<div class="stat"><div class="label">Items Tracked</div><div class="value">' +
      state.items.length +
      "</div></div>" +
      '<div class="stat"><div class="label">Stock Value</div><div class="value teal">' +
      fmtMoney(stockValue) +
      "</div></div>" +
      '<div class="stat"><div class="label">Invoices Billed</div><div class="value">' +
      state.invoices.length +
      "</div></div>" +
      '<div class="stat"><div class="label">Total Revenue</div><div class="value teal">' +
      fmtMoney(revenue) +
      "</div></div>" +
      "</div>" +
      '<div class="grid" style="grid-template-columns:1.4fr 1fr; margin-top:28px; align-items:start;">' +
      '<div class="card">' +
      '<h3 class="display" style="margin:0 0 12px;font-size:17px;">Recent Invoices</h3>' +
      (recent.length
        ? '<div class="table-wrap"><table><tbody>' +
          recentRows +
          "</tbody></table></div>"
        : '<div class="empty"><div class="glyph">🧾</div><h3>No invoices yet</h3><p>Create your first invoice to see it here.</p></div>') +
      "</div>" +
      '<div class="card">' +
      '<h3 class="display" style="margin:0 0 12px;font-size:17px;">Low Stock</h3>' +
      '<div class="table-wrap"><table><tbody>' +
      lowStockHtml +
      "</tbody></table></div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderItems() {
    var query = (state.itemSearchQuery || "").trim().toLowerCase();
    var filteredItems = query
      ? state.items.filter(function (i) {
          var words = i.name.toLowerCase().split(/\s+/);
          return (
            i.name.toLowerCase().indexOf(query) > -1 ||
            words.some(function (w) {
              return w.indexOf(query) === 0;
            })
          );
        })
      : state.items;

    var rows = filteredItems
      .map(function (i) {
        var low = i.qty <= 5;
        var out = i.qty <= 0;
        return (
          "<tr>" +
          '<td style="width:44px;">' +
          thumbHTML(i, 40) +
          "</td>" +
          '<td class="item-name">' +
          esc(i.name) +
          '<div class="muted">' +
          categoryLabel(i.cat) +
          (i.sku ? " &middot; " + esc(i.sku) : "") +
          "</div></td>" +
          "<td>" +
          i.qty +
          " " +
          unitLabel(i.unit) +
          " " +
          (out
            ? '<span class="pill low" style="margin-left:8px;">out of stock</span>'
            : low
              ? '<span class="pill low" style="margin-left:8px;">low</span>'
              : "") +
          "</td>" +
          '<td class="num">' +
          fmtMoney(i.price) +
          " / " +
          unitLabel(i.unit) +
          "</td>" +
          '<td class="num">' +
          fmtMoney(i.qty * i.price) +
          "</td>" +
          '<td style="text-align:right; white-space:nowrap;">' +
          '<button class="btn btn-ghost" data-view-orders="' +
          i.id +
          '" style="padding:6px 12px;font-size:12px;">View Orders</button> ' +
          '<button class="btn btn-ghost" data-edit-item="' +
          i.id +
          '" style="padding:6px 12px;font-size:12px;">Edit</button> ' +
          '<button class="btn btn-danger" data-del-item="' +
          i.id +
          '" style="padding:6px 12px;font-size:12px;">Delete</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    var emptyState = state.items.length
      ? '<div class="empty"><div class="glyph">🔎</div><h3>No matches</h3><p>No items match "' +
        esc(state.itemSearchQuery) +
        '".</p></div>'
      : '<div class="empty"><div class="glyph">📦</div><h3>No items yet</h3><p>Add your first item to start building invoices.</p></div>';

    return (
      '<div class="page-head">' +
      "<div><h1>Inventory</h1><p>Items you stock. These are the exact same items shown live on the website — edit stock, price or details here and the site updates automatically.</p></div>" +
      '<div class="btn-row">' +
      '<div class="icon-field" style="width:230px;">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input type="text" data-item-search value="' +
      esc(state.itemSearchQuery || "") +
      '" placeholder="Search items…">' +
      "</div>" +
      '<button class="btn btn-gold" data-add-item>+ Add Item</button>' +
      "</div>" +
      "</div>" +
      beadsDivider() +
      '<div class="card">' +
      (filteredItems.length
        ? '<div class="table-wrap"><table><thead><tr><th></th><th>Item Name</th><th>Quantity We Have</th><th>Price per pc</th><th>Stock Value</th><th></th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : emptyState) +
      "</div>"
    );
  }

  function renderNewInvoice() {
    if (!state.draft) startDraft();
    var d = state.draft;

    var lineRows = d.lines
      .map(function (l) {
        var item = state.items.find(function (i) {
          return i.id === l.itemId;
        });
        var amount = item ? item.price * l.qty : 0;
        var query = item ? item.name : l.query || "";
        var isActive = state.activeComboLine === l.id;
        var hasExact = state.items.some(function (i) {
          return i.name.trim().toLowerCase() === query.trim().toLowerCase();
        });
        var listHtml = "";
        if (isActive) {
          var matches = comboFilter(state.items, query).slice(0, 8);
          listHtml += matches
            .map(function (i) {
              return (
                '<div class="combo-item" data-combo-pick="' +
                l.id +
                '" data-combo-item-id="' +
                i.id +
                '">' +
                thumbHTML(i, 24) +
                '<div class="combo-item-text"><div class="combo-item-name">' +
                esc(i.name) +
                '</div><div class="muted" style="font-size:11px;">' +
                i.qty +
                " " +
                unitLabel(i.unit) +
                " left &middot; " +
                fmtMoney(i.price) +
                "/" +
                unitLabel(i.unit) +
                "</div></div>" +
                "</div>"
              );
            })
            .join("");
          if (query.trim() && !hasExact) {
            listHtml +=
              '<div class="combo-item combo-add" data-combo-quickadd="' +
              l.id +
              '" data-combo-quickadd-name="' +
              esc(query.trim()) +
              '">+ Add "' +
              esc(query.trim()) +
              '" as new item</div>';
          }
          if (!matches.length && !query.trim()) {
            listHtml +=
              '<div class="combo-empty muted">Type to search items…</div>';
          }
        }
        return (
          '<div class="line-item-row">' +
          '<div class="combo">' +
          '<input type="text" class="combo-input" data-combo-input="' +
          l.id +
          '" value="' +
          esc(query) +
          '" placeholder="Type item name…" autocomplete="off">' +
          (isActive ? '<div class="combo-list">' + listHtml + "</div>" : "") +
          "</div>" +
          '<input type="number" min="0" step="1" value="' +
          l.qty +
          '" data-line="' +
          l.id +
          '" data-field="qty">' +
          '<div class="muted" style="text-align:right;">' +
          (item ? fmtMoney(item.price) + "/" + unitLabel(item.unit) : "—") +
          "</div>" +
          '<div class="amt">' +
          fmtMoney(amount) +
          "</div>" +
          '<button class="remove-row" data-remove-line="' +
          l.id +
          '" title="Remove">✕</button>' +
          "</div>"
        );
      })
      .join("");

    var errs = state.formErrors;
    var errHtml =
      errs && errs.length
        ? '<div style="background:#FBEEEA;border:1px solid #EAD3CC;color:var(--danger);padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;">' +
          errs.map(esc).join("<br>") +
          "</div>"
        : "";

    return (
      '<div class="page-head">' +
      "<div><h1>" +
      (state.editingInvoiceId ? "Edit Invoice" : "New Invoice") +
      "</h1><p>Invoice " +
      esc(d.invoiceNo) +
      " · " +
      fmtDate(d.date) +
      "</p></div>" +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-cancel-draft>Cancel</button>' +
      '<button class="btn btn-primary" data-save-draft>' +
      (state.editingInvoiceId ? "Save Changes" : "Save &amp; View Invoice") +
      "</button>" +
      "</div>" +
      "</div>" +
      beadsDivider() +
      errHtml +
      '<div class="grid" style="grid-template-columns:1fr 1fr;">' +
      '<div class="card">' +
      '<h3 class="display" style="margin:0 0 14px;font-size:16px;">Client Details</h3>' +
      '<div class="field"><label>Client Name</label><div class="icon-field">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
      '<input type="text" data-draft-field="clientName" value="' +
      esc(d.clientName) +
      '" placeholder="e.g. Yash Gota">' +
      "</div></div>" +
      '<div class="field-row">' +
      '<div class="field"><label>Phone Number</label><div class="icon-field">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
      '<input type="text" data-draft-field="phone" value="' +
      esc(d.phone) +
      '" placeholder="03xx-xxxxxxx">' +
      "</div></div>" +
      '<div class="field"><label>Date</label><div class="icon-field">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
      '<input type="date" data-draft-field="date" value="' +
      d.date +
      '">' +
      "</div></div>" +
      "</div>" +
      '<div class="field"><label>Client Address</label><div class="icon-field">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
      '<input type="text" data-draft-field="address" value="' +
      esc(d.address) +
      '" placeholder="Shop / city">' +
      "</div></div>" +
      "</div>" +
      '<div class="card">' +
      '<h3 class="display" style="margin:0 0 14px;font-size:16px;">Invoice Meta</h3>' +
      '<div class="field"><label>Invoice No.</label><div class="prefix-input"><span class="prefix-tag">JSK</span><input type="text" value="' +
      esc(d.invoiceNo.replace(/^JSK-/, "")) +
      '" disabled></div></div>' +
      '<div class="field"><label>Delivery Charges</label><div class="prefix-input"><span class="prefix-tag">Rs.</span><input type="number" min="0" step="1" data-draft-field="deliveryCharges" value="' +
      (Number(d.deliveryCharges) || 0) +
      '" placeholder="0"></div></div>' +
      '<p class="field-hint">Invoice numbers are generated automatically in sequence.</p>' +
      "</div>" +
      "</div>" +
      '<div class="card" style="margin-top:20px;">' +
      '<h3 class="display" style="margin:0 0 14px;font-size:16px;">Items</h3>' +
      (state.items.length
        ? '<div class="line-item-row muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;"><div>Item</div><div>Qty</div><div style="text-align:right;">Price</div><div style="text-align:right;">Amount</div><div></div></div>' +
          lineRows +
          '<button class="add-row-btn" data-add-line>+ Add another item</button>'
        : '<div class="empty"><div class="glyph">📦</div><h3>No items in inventory</h3><p>Add items in the Inventory tab first.</p></div>') +
      '<div class="totals-box"><div class="row" style="flex-direction:column; align-items:flex-end; gap:6px;">' +
      '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Items Subtotal</span><span class="muted num">' +
      fmtMoney(draftSubtotal()) +
      "</span></div>" +
      '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Delivery Charges</span><span class="muted num">' +
      fmtMoney(draftDeliveryCharges()) +
      "</span></div>" +
      '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Total Price</span><span class="amt">' +
      fmtMoney(draftTotal()) +
      "</span></div>" +
      "</div></div>" +
      "</div>"
    );
  }

  function renderInvoicesList() {
    var list = state.invoices;
    var filterChip = "";
    if (state.clientFilter) {
      list = list.filter(function (inv) {
        return inv.clientName === state.clientFilter;
      });
      filterChip =
        '<div class="filter-chip">Showing invoices for ' +
        esc(state.clientFilter) +
        " <button data-clear-filter>✕</button></div>";
    }

    var rows = list
      .map(function (inv) {
        return (
          "<tr>" +
          '<td class="item-name">' +
          esc(inv.invoiceNo) +
          "</td>" +
          "<td>" +
          esc(inv.clientName) +
          '<div class="muted">' +
          esc(inv.phone || "") +
          "</div></td>" +
          "<td>" +
          fmtDate(inv.date) +
          "</td>" +
          "<td>" +
          inv.lines.length +
          " item(s)</td>" +
          '<td class="num">' +
          fmtMoney(inv.total) +
          "</td>" +
          '<td style="text-align:right; white-space:nowrap;">' +
          '<button class="btn btn-ghost" data-view-invoice="' +
          inv.id +
          '" style="padding:6px 12px;font-size:12px;">View</button> ' +
          '<button class="btn btn-ghost" data-edit-invoice="' +
          inv.id +
          '" style="padding:6px 12px;font-size:12px;">Edit</button> ' +
          '<button class="btn btn-danger" data-del-invoice="' +
          inv.id +
          '" style="padding:6px 12px;font-size:12px;">Delete</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="page-head">' +
      "<div><h1>Invoice History</h1><p>Every invoice billed to your clients.</p></div>" +
      '<button class="btn btn-primary" data-nav="new-invoice">+ New Invoice</button>' +
      "</div>" +
      beadsDivider() +
      filterChip +
      '<div class="card">' +
      (list.length
        ? '<div class="table-wrap"><table><thead><tr><th>Invoice No.</th><th>Client</th><th>Date</th><th>Items</th><th>Total</th><th></th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<div class="empty"><div class="glyph">🧾</div><h3>No invoices yet</h3><p>Billed invoices will appear here.</p></div>') +
      "</div>"
    );
  }

  function renderClients() {
    var map = {};
    state.invoices.forEach(function (inv) {
      var key = inv.clientName.trim().toLowerCase();
      if (!map[key]) {
        map[key] = {
          name: inv.clientName,
          phone: inv.phone,
          address: inv.address,
          qty: 0,
          total: 0,
          invoices: 0,
          lastDate: inv.date,
        };
      }
      var c = map[key];
      c.qty += inv.lines.reduce(function (s, l) {
        return s + l.qty;
      }, 0);
      c.total += inv.total;
      c.invoices += 1;
      if (inv.phone && !c.phone) c.phone = inv.phone;
      if (inv.date > c.lastDate) {
        c.lastDate = inv.date;
      }
    });
    var clients = Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return b.total - a.total;
      });

    var rows = clients
      .map(function (c) {
        return (
          "<tr>" +
          '<td class="item-name" style="display:flex;align-items:center;gap:10px;">' +
          thumbHTML({ name: c.name }, 34) +
          " <div>" +
          esc(c.name) +
          '<div class="muted">' +
          esc(c.phone || "") +
          "</div></div></td>" +
          "<td>" +
          c.invoices +
          "</td>" +
          "<td>" +
          c.qty +
          " units</td>" +
          '<td class="num">' +
          fmtMoney(c.total) +
          "</td>" +
          "<td>" +
          fmtDate(c.lastDate) +
          "</td>" +
          '<td style="text-align:right;"><button class="btn btn-ghost" data-view-client="' +
          esc(c.name) +
          '" style="padding:6px 12px;font-size:12px;">View Invoices</button></td>' +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="page-head">' +
      "<div><h1>Clients</h1><p>Everyone you have billed, with total quantity and spend.</p></div>" +
      "</div>" +
      beadsDivider() +
      '<div class="card">' +
      (clients.length
        ? '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Invoices</th><th>Total Quantity</th><th>Total Spent</th><th>Last Billed</th><th></th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<div class="empty"><div class="glyph">🧑‍🤝‍🧑</div><h3>No clients yet</h3><p>Clients appear here automatically once you save an invoice.</p></div>') +
      "</div>"
    );
  }

  function renderItemOrders() {
    var item = state.items.find(function (i) {
      return i.id === state.activeItemId;
    });
    if (!item) {
      return '<div class="empty"><div class="glyph">📦</div><h3>Item not found</h3></div>';
    }

    var byClient = {};
    state.invoices.forEach(function (inv) {
      inv.lines.forEach(function (l) {
        if (l.itemId !== item.id) return;
        var key = inv.clientName.trim().toLowerCase();
        if (!byClient[key]) {
          byClient[key] = { name: inv.clientName, qty: 0, total: 0, orders: 0 };
        }
        byClient[key].qty += l.qty;
        byClient[key].total += l.amount;
        byClient[key].orders += 1;
      });
    });
    var clients = Object.keys(byClient)
      .map(function (k) {
        return byClient[k];
      })
      .sort(function (a, b) {
        return b.total - a.total;
      });
    var grandTotal = clients.reduce(function (s, c) {
      return s + c.total;
    }, 0);
    var grandQty = clients.reduce(function (s, c) {
      return s + c.qty;
    }, 0);

    var rows = clients
      .map(function (c) {
        return (
          "<tr>" +
          '<td class="item-name" style="display:flex;align-items:center;gap:10px;">' +
          thumbHTML({ name: c.name }, 32) +
          " " +
          esc(c.name) +
          "</td>" +
          "<td>" +
          c.qty +
          " " +
          unitLabel(item.unit) +
          "</td>" +
          '<td class="num">' +
          fmtMoney(c.total) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="page-head no-print">' +
      "<div><h1>Item Orders</h1><p>Everyone who has ordered " +
      esc(item.name) +
      ", and how much.</p></div>" +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-nav="items">Back to Inventory</button>' +
      '<button class="btn btn-primary" data-new-order-item="' +
      item.id +
      '">+ New Order for ' +
      esc(item.name) +
      "</button>" +
      "</div>" +
      "</div>" +
      '<div class="invoice-sheet">' +
      '<div class="inv-top">' +
      '<div class="inv-brand">JSK Creation<small>Beads &amp; Jewellery Supply</small></div>' +
      "</div>" +
      '<div class="inv-client" style="display:flex; align-items:center; gap:14px; margin-top:22px;">' +
      thumbHTML(item, 56) +
      "<div>" +
      '<h2 style="margin:0;">' +
      esc(item.name) +
      "</h2>" +
      '<div class="sub">' +
      item.qty +
      " " +
      unitLabel(item.unit) +
      " in stock &middot; " +
      fmtMoney(item.price) +
      " per " +
      unitLabel(item.unit) +
      "</div>" +
      "</div>" +
      "</div>" +
      beadsDivider() +
      (clients.length
        ? '<div class="inv-items"><div class="table-wrap">' +
          "<table><thead><tr><th>Clients</th><th>Quantity</th><th>Total Price</th></tr></thead><tbody>" +
          rows +
          "</tbody></table>" +
          "</div></div>" +
          '<div class="totals-box"><div class="row"><span class="lbl">Total Price</span><span class="amt">' +
          fmtMoney(grandTotal) +
          "</span></div></div>" +
          '<p class="muted" style="margin-top:6px;">' +
          grandQty +
          " " +
          unitLabel(item.unit) +
          " ordered in total across " +
          clients.length +
          " client(s).</p>"
        : '<div class="empty"><div class="glyph">🧾</div><h3>No orders yet</h3><p>Once this item appears on a saved invoice, buyers will be listed here.</p></div>') +
      invoiceFooterHTML() +
      "</div>"
    );
  }

  function renderInvoiceView() {
    var inv = state.invoices.find(function (i) {
      return i.id === state.activeInvoiceId;
    });
    if (!inv) {
      return '<div class="empty"><div class="glyph">🧾</div><h3>Invoice not found</h3></div>';
    }
    var rows = inv.lines
      .map(function (l) {
        return (
          "<tr>" +
          '<td><div class="row-item">' +
          thumbHTML(l, 28) +
          " " +
          esc(l.name) +
          "</div></td>" +
          '<td class="qty">' +
          l.qty +
          " " +
          unitLabel(l.unit) +
          "</td>" +
          '<td class="amt">' +
          fmtMoney(l.price) +
          "</td>" +
          '<td class="amt">' +
          fmtMoney(l.amount) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="page-head no-print">' +
      "<div><h1>Invoice</h1><p>" +
      esc(inv.invoiceNo) +
      "</p></div>" +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-nav="invoices">Back to History</button>' +
      '<button class="btn btn-ghost" data-edit-invoice="' +
      inv.id +
      '">Edit Invoice</button>' +
      '<button class="btn btn-gold" data-print>Print / Save PDF</button>' +
      "</div>" +
      "</div>" +
      '<div class="invoice-sheet">' +
      '<div class="inv-top">' +
      '<div class="inv-brand">JSK Creation<small>Beads &amp; Jewellery Supply</small></div>' +
      '<div class="inv-meta">Invoice No.<br><span class="num">' +
      esc(inv.invoiceNo) +
      "</span><br>Date: " +
      fmtDate(inv.date) +
      "</div>" +
      "</div>" +
      beadsDivider() +
      '<div class="inv-client">' +
      "<h2>" +
      esc(inv.clientName) +
      "</h2>" +
      '<div class="sub">' +
      esc(inv.phone || "") +
      (inv.phone && inv.address ? " · " : "") +
      esc(inv.address || "") +
      "</div>" +
      "</div>" +
      '<div class="inv-items table-wrap">' +
      '<table><thead><tr><th>Item</th><th class="qty">Quantity</th><th class="amt">Price</th><th class="amt">Amount</th></tr></thead><tbody>' +
      rows +
      "</tbody></table>" +
      "</div>" +
      '<div class="totals-box"><div class="row" style="flex-direction:column; align-items:flex-end; gap:6px;">' +
      (inv.deliveryCharges
        ? '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Items Subtotal</span><span class="muted num">' +
          fmtMoney(
            inv.subtotal != null
              ? inv.subtotal
              : inv.total - inv.deliveryCharges,
          ) +
          "</span></div>" +
          '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Delivery Charges</span><span class="muted num">' +
          fmtMoney(inv.deliveryCharges) +
          "</span></div>"
        : "") +
      '<div style="display:flex; gap:26px; align-items:baseline;"><span class="lbl">Total Price</span><span class="amt">' +
      fmtMoney(inv.total) +
      "</span></div>" +
      "</div></div>" +
      invoiceFooterHTML() +
      "</div>"
    );
  }

  /* ================= modal ================= */
  function renderModal() {
    if (!state.modal) return "";
    if (state.modal.type === "item") {
      var it = state.modal.payload;
      var isEdit = !!it.id;
      return (
        '<div class="modal-backdrop" data-close-modal>' +
        '<div class="modal" onclick="event.stopPropagation()">' +
        "<h2>" +
        (isEdit ? "Edit Item" : "Add Item") +
        "</h2>" +
        '<p class="muted" style="margin-top:0;">Track it in your inventory so it can be billed on invoices — and shown live on the website.</p>' +
        '<form id="item-form">' +
        '<div class="field"><label>Item Name</label><input name="name" type="text" value="' +
        esc(it.name) +
        '" placeholder="e.g. Kundan" required></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>Quantity We Have</label><input name="qty" type="number" min="0" step="1" value="' +
        it.qty +
        '"></div>' +
        '<div class="field"><label>Unit</label><select name="unit">' +
        '<option value="pc" ' +
        ((it.unit || "pc") === "pc" ? "selected" : "") +
        ">Per pc</option>" +
        '<option value="pair" ' +
        (it.unit === "pair" ? "selected" : "") +
        ">Per pair</option>" +
        '<option value="packet" ' +
        (it.unit === "packet" ? "selected" : "") +
        ">Per packet</option>" +
        '<option value="yard" ' +
        (it.unit === "yard" ? "selected" : "") +
        ">Per yard</option>" +
        '<option value="gram" ' +
        (it.unit === "gram" ? "selected" : "") +
        ">Per gram</option>" +
        "</select></div>" +
        "</div>" +
        '<div class="field"><label>Price</label><div class="prefix-input"><span class="prefix-tag">Rs.</span><input name="price" type="number" min="0" step="1" value="' +
        it.price +
        '"></div></div>' +
        '<div class="field"><label>Website Category</label><select name="cat">' +
        '<option value="tulip" ' +
        ((it.cat || "tulip") === "tulip" ? "selected" : "") +
        ">Tulip</option>" +
        '<option value="moon" ' +
        (it.cat === "moon" ? "selected" : "") +
        ">Moon</option>" +
        '<option value="lotus" ' +
        (it.cat === "lotus" ? "selected" : "") +
        ">Lotus</option>" +
        '<option value="kundan" ' +
        (it.cat === "kundan" ? "selected" : "") +
        ">Kundan</option>" +
        '<option value="ghanthan-mala" ' +
        (it.cat === "ghanthan-mala" ? "selected" : "") +
        ">Ghanthan Mala</option>" +
        '<option value="connectors" ' +
        (it.cat === "connectors" ? "selected" : "") +
        ">Connectors</option>" +
        '<option value="minakari" ' +
        (it.cat === "minakari" ? "selected" : "") +
        ">Minakari</option>" +
        '<option value="chains" ' +
        (it.cat === "chains" ? "selected" : "") +
        ">Chains</option>" +
        '<option value="stones" ' +
        (it.cat === "stones" ? "selected" : "") +
        ">Stones</option>" +
        "</select></div>" +
        '<div class="field"><label>Website Pack Text <em style="text-transform:none;font-weight:400;color:#9A8C7C;">(optional, e.g. "per 50g pack")</em></label><input name="unitLabel" type="text" value="' +
        esc(it.unitLabel || "") +
        '" placeholder="Leave blank to auto-use the unit above"></div>' +
        '<div class="field"><label>SKU <em style="text-transform:none;font-weight:400;color:#9A8C7C;">(optional)</em></label><input name="sku" type="text" value="' +
        esc(it.sku || "") +
        '" placeholder="Auto-generated if left blank"></div>' +
        '<div class="field"><label>Website Description <em style="text-transform:none;font-weight:400;color:#9A8C7C;">(optional)</em></label><input name="desc" type="text" value="' +
        esc(it.desc || "") +
        '" placeholder="Shown on the product card on the website"></div>' +
        '<div class="field">' +
        "<label>Item Picture <em style=\"text-transform:none;font-weight:400;color:#9A8C7C;\">(optional)</em></label>" +
        '<div class="img-upload">' +
        '<div class="img-upload-preview' +
        (it.img ? " has-img" : "") +
        '" id="imgPreview">' +
        (it.img
          ? '<img src="' + esc(it.img) + '" alt="Preview">'
          : '<span class="img-upload-placeholder">No picture</span>') +
        "</div>" +
        '<div class="img-upload-actions">' +
        '<label class="btn btn-ghost img-browse-btn" for="imgFileInput">Browse file</label>' +
        '<input type="file" id="imgFileInput" accept="image/*" hidden>' +
        '<button type="button" class="btn btn-ghost" id="imgClearBtn"' +
        (it.img ? "" : " hidden") +
        ">Remove</button>" +
        "</div>" +
        "</div>" +
        '<input type="hidden" name="img" id="imgHidden" value="' +
        esc(it.img || "") +
        '">' +
        '<p class="field-hint" id="imgUploadHint">Choose a photo from your phone or computer (JPG, PNG, WebP). Leave empty to use an automatic monogram badge. Set Quantity to 0 to mark it "Out of Stock" on the website.</p>' +
        "</div>" +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>' +
        '<button type="submit" class="btn btn-primary" id="itemFormSubmit">' +
        (isEdit ? "Save Changes" : "Add Item") +
        "</button>" +
        "</div>" +
        "</form>" +
        "</div>" +
        "</div>"
      );
    }
    if (state.modal.type === "confirmDeleteItem") {
      var item = state.items.find(function (i) {
        return i.id === state.modal.payload.id;
      });
      return (
        '<div class="modal-backdrop" data-close-modal>' +
        '<div class="modal" onclick="event.stopPropagation()">' +
        "<h2>Delete Item?</h2>" +
        '<p class="muted">This removes "' +
        esc(item ? item.name : "") +
        '" from inventory and the website. Past invoices are not affected.</p>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-close-modal>Cancel</button>' +
        '<button class="btn btn-danger" style="background:var(--danger);color:#fff;border:none;" data-confirm-del-item="' +
        state.modal.payload.id +
        '">Delete</button>' +
        "</div>" +
        "</div>" +
        "</div>"
      );
    }
    if (state.modal.type === "changePassword") {
      var cpError = state.modal.payload && state.modal.payload.error;
      return (
        '<div class="modal-backdrop" data-close-modal>' +
        '<div class="modal" onclick="event.stopPropagation()">' +
        "<h2>Change Warehouse Password</h2>" +
        '<p class="muted" style="margin-top:0;">Enter your current password and choose a new one.</p>' +
        '<form id="change-password-form">' +
        '<div class="field"><label>Current Password</label><input type="password" id="cpCurrent" autocomplete="current-password" required></div>' +
        '<div class="field"><label>New Password</label><input type="password" id="cpNew" autocomplete="new-password" required minlength="4"></div>' +
        '<div class="field"><label>Confirm New Password</label><input type="password" id="cpConfirm" autocomplete="new-password" required minlength="4"></div>' +
        (cpError ? '<p class="gate-error">' + esc(cpError) + "</p>" : "") +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Update Password</button>' +
        "</div>" +
        "</form>" +
        "</div>" +
        "</div>"
      );
    }
    if (state.modal.type === "confirmDeleteInvoice") {
      return (
        '<div class="modal-backdrop" data-close-modal>' +
        '<div class="modal" onclick="event.stopPropagation()">' +
        "<h2>Delete Invoice?</h2>" +
        '<p class="muted">This permanently removes the invoice from history.</p>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-close-modal>Cancel</button>' +
        '<button class="btn btn-danger" style="background:var(--danger);color:#fff;border:none;" data-confirm-del-invoice="' +
        state.modal.payload.id +
        '">Delete</button>' +
        "</div>" +
        "</div>" +
        "</div>"
      );
    }
    return "";
  }

  /* ================= root render ================= */
  function render() {
    var body = "";
    switch (state.view) {
      case "orders":
        body = renderOrders();
        break;
      case "items":
        body = renderItems();
        break;
      case "new-invoice":
        body = renderNewInvoice();
        break;
      case "invoices":
        body = renderInvoicesList();
        break;
      case "clients":
        body = renderClients();
        break;
      case "item-orders":
        body = renderItemOrders();
        break;
      case "invoice-view":
        body = renderInvoiceView();
        break;
      default:
        body = renderDashboard();
    }
    var html =
      renderSidebar() + '<div class="main">' + body + "</div>" + renderModal();
    document.getElementById("app").innerHTML = html;
    bindEvents();
  }

  /* ================= events ================= */
  function bindEvents() {
    var root = document.getElementById("app");

    root.querySelectorAll("[data-nav]").forEach(function (el) {
      el.addEventListener("click", function () {
        goTo(el.getAttribute("data-nav"));
      });
    });
    root.querySelectorAll("[data-view-invoice]").forEach(function (el) {
      el.addEventListener("click", function () {
        viewInvoice(el.getAttribute("data-view-invoice"));
      });
    });
    root.querySelectorAll("[data-view-client]").forEach(function (el) {
      el.addEventListener("click", function () {
        viewClientInvoices(el.getAttribute("data-view-client"));
      });
    });
    root.querySelectorAll("[data-view-orders]").forEach(function (el) {
      el.addEventListener("click", function () {
        viewItemOrders(el.getAttribute("data-view-orders"));
      });
    });
    root.querySelectorAll("[data-new-order-item]").forEach(function (el) {
      el.addEventListener("click", function () {
        startDraftForItem(el.getAttribute("data-new-order-item"));
      });
    });
    root.querySelectorAll("[data-bill-order]").forEach(function (el) {
      el.addEventListener("click", function () {
        billOrder(el.getAttribute("data-bill-order"));
      });
    });
    root.querySelectorAll("[data-dismiss-order]").forEach(function (el) {
      el.addEventListener("click", function () {
        dismissOrder(el.getAttribute("data-dismiss-order"));
      });
    });
    root.querySelectorAll("[data-edit-invoice]").forEach(function (el) {
      el.addEventListener("click", function () {
        editInvoice(el.getAttribute("data-edit-invoice"));
      });
    });
    var clearFilter = root.querySelector("[data-clear-filter]");
    if (clearFilter)
      clearFilter.addEventListener("click", function () {
        state.clientFilter = null;
        render();
      });

    var addItemBtn = root.querySelector("[data-add-item]");
    if (addItemBtn)
      addItemBtn.addEventListener("click", function () {
        openItemModal(null);
      });
    root.querySelectorAll("[data-edit-item]").forEach(function (el) {
      el.addEventListener("click", function () {
        var item = state.items.find(function (i) {
          return i.id === el.getAttribute("data-edit-item");
        });
        openItemModal(item);
      });
    });
    root.querySelectorAll("[data-del-item]").forEach(function (el) {
      el.addEventListener("click", function () {
        confirmDeleteItem(el.getAttribute("data-del-item"));
      });
    });
    root.querySelectorAll("[data-del-invoice]").forEach(function (el) {
      el.addEventListener("click", function () {
        confirmDeleteInvoice(el.getAttribute("data-del-invoice"));
      });
    });
    var printBtn = root.querySelector("[data-print]");
    if (printBtn)
      printBtn.addEventListener("click", function () {
        window.print();
      });

    root.querySelectorAll("[data-close-modal]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.modal = null;
        render();
      });
    });
    var logoutBtn = root.querySelector("[data-logout]");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        logout();
      });
    }
    var changePassBtn = root.querySelector("[data-change-password]");
    if (changePassBtn) {
      changePassBtn.addEventListener("click", function () {
        state.modal = { type: "changePassword", payload: {} };
        render();
      });
    }
    var cpForm = document.getElementById("change-password-form");
    if (cpForm) {
      cpForm.addEventListener("submit", function (e) {
        e.preventDefault();
        submitChangePassword();
      });
    }
    var itemForm = document.getElementById("item-form");
    if (itemForm) {
      itemForm.addEventListener("submit", function (e) {
        e.preventDefault();
        submitItemModal(itemForm);
      });
      var imgFileInput = document.getElementById("imgFileInput");
      var imgClearBtn = document.getElementById("imgClearBtn");
      var imgHint = document.getElementById("imgUploadHint");
      var itemSubmit = document.getElementById("itemFormSubmit");
      if (imgFileInput) {
        imgFileInput.addEventListener("change", function () {
          var file = imgFileInput.files && imgFileInput.files[0];
          if (!file) return;
          var defaultHint =
            'Choose a photo from your phone or computer (JPG, PNG, WebP). Leave empty to use an automatic monogram badge. Set Quantity to 0 to mark it "Out of Stock" on the website.';
          if (imgHint) imgHint.textContent = "Processing image…";
          if (itemSubmit) itemSubmit.disabled = true;
          compressImageFile(file)
            .then(function (dataUrl) {
              setImgPreview(dataUrl);
              if (imgHint) imgHint.textContent = defaultHint;
            })
            .catch(function (err) {
              if (imgHint)
                imgHint.textContent =
                  (err && err.message) || "Could not use that image.";
            })
            .then(function () {
              if (itemSubmit) itemSubmit.disabled = false;
              imgFileInput.value = "";
            });
        });
      }
      if (imgClearBtn) {
        imgClearBtn.addEventListener("click", function () {
          setImgPreview("");
        });
      }
    }
    var confirmDelItem = root.querySelector("[data-confirm-del-item]");
    if (confirmDelItem)
      confirmDelItem.addEventListener("click", function () {
        deleteItem(confirmDelItem.getAttribute("data-confirm-del-item"));
      });
    var confirmDelInvoice = root.querySelector("[data-confirm-del-invoice]");
    if (confirmDelInvoice)
      confirmDelInvoice.addEventListener("click", function () {
        deleteInvoice(
          confirmDelInvoice.getAttribute("data-confirm-del-invoice"),
        );
      });

    var cancelBtn = root.querySelector("[data-cancel-draft]");
    if (cancelBtn) cancelBtn.addEventListener("click", cancelDraft);
    var saveBtn = root.querySelector("[data-save-draft]");
    if (saveBtn) saveBtn.addEventListener("click", saveDraftInvoice);
    var addLineBtn = root.querySelector("[data-add-line]");
    if (addLineBtn) addLineBtn.addEventListener("click", addDraftLine);
    root.querySelectorAll("[data-remove-line]").forEach(function (el) {
      el.addEventListener("click", function () {
        removeDraftLine(el.getAttribute("data-remove-line"));
      });
    });
    root.querySelectorAll("[data-line]").forEach(function (el) {
      el.addEventListener("change", function () {
        updateDraftLine(
          el.getAttribute("data-line"),
          el.getAttribute("data-field"),
          el.value,
        );
      });
    });
    root.querySelectorAll("[data-draft-field]").forEach(function (el) {
      el.addEventListener("input", function () {
        updateDraftField(el.getAttribute("data-draft-field"), el.value);
      });
      el.addEventListener("change", function () {
        updateDraftField(el.getAttribute("data-draft-field"), el.value);
      });
    });

    // item combobox (searchable item picker on invoice lines)
    root.querySelectorAll("[data-combo-input]").forEach(function (el) {
      el.addEventListener("focus", function () {
        var lineId = el.getAttribute("data-combo-input");
        if (state.activeComboLine !== lineId) {
          state.activeComboLine = lineId;
          withPreservedFocus(render);
        }
      });
      el.addEventListener("input", function () {
        var lineId = el.getAttribute("data-combo-input");
        var line = state.draft.lines.find(function (l) {
          return l.id === lineId;
        });
        if (line) {
          line.query = el.value;
          var currentItem = state.items.find(function (i) {
            return i.id === line.itemId;
          });
          if (currentItem && currentItem.name !== el.value) {
            line.itemId = "";
          }
        }
        state.activeComboLine = lineId;
        withPreservedFocus(render);
      });
      el.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var lineId = el.getAttribute("data-combo-input");
        var q = el.value.trim();
        if (!q) return;
        var exact = state.items.find(function (i) {
          return i.name.trim().toLowerCase() === q.toLowerCase();
        });
        if (exact) {
          selectComboItem(lineId, exact.id);
          return;
        }
        var matches = comboFilter(state.items, q);
        if (matches.length === 1) {
          selectComboItem(lineId, matches[0].id);
        } else if (matches.length === 0) {
          triggerQuickAddItem(lineId, q);
        }
      });
      el.addEventListener("blur", function () {
        var lineId = el.getAttribute("data-combo-input");
        setTimeout(function () {
          var stillFocused =
            document.activeElement &&
            document.activeElement.getAttribute &&
            document.activeElement.getAttribute("data-combo-input") === lineId;
          if (!stillFocused && state.activeComboLine === lineId) {
            state.activeComboLine = null;
            render();
          }
        }, 150);
      });
    });
    root.querySelectorAll("[data-combo-pick]").forEach(function (el) {
      el.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectComboItem(
          el.getAttribute("data-combo-pick"),
          el.getAttribute("data-combo-item-id"),
        );
      });
    });
    root.querySelectorAll("[data-combo-quickadd]").forEach(function (el) {
      el.addEventListener("mousedown", function (e) {
        e.preventDefault();
        triggerQuickAddItem(
          el.getAttribute("data-combo-quickadd"),
          el.getAttribute("data-combo-quickadd-name"),
        );
      });
    });

    // inventory search box
    var itemSearchEl = root.querySelector("[data-item-search]");
    if (itemSearchEl) {
      itemSearchEl.addEventListener("input", function () {
        state.itemSearchQuery = itemSearchEl.value;
        withPreservedFocus(render);
      });
    }
  }

  boot();
})();