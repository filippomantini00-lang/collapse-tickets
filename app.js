
let supabaseClient = null;
let html5QrCode = null;
let currentTicket = null;
let allGuests = [];
let lastCreatedTicket = null;

const $ = (id) => document.getElementById(id);

function show(viewId) {
  ["setupView", "loginView", "appView"].forEach(id => $(id).classList.add("hidden"));
  $(viewId).classList.remove("hidden");
  $("logoutBtn").classList.toggle("hidden", viewId !== "appView");
}

function getConfig(){
  return {
    url: localStorage.getItem("collapse_supabase_url"),
    key: localStorage.getItem("collapse_supabase_key")
  };
}

function initSupabase(){
  const { url, key } = getConfig();
  if (!url || !key) return false;
  supabaseClient = window.supabase.createClient(url, key);
  return true;
}

async function boot(){
  if (!initSupabase()){
    show("setupView");
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  if (data.session){
    show("appView");
    await refreshGuests();
  } else {
    show("loginView");
  }
}

$("saveConfigBtn").addEventListener("click", async () => {
  const url = $("supabaseUrl").value.trim();
  const key = $("supabaseKey").value.trim();
  if (!url || !key) return alert("Inserisci URL e chiave anon.");
  localStorage.setItem("collapse_supabase_url", url);
  localStorage.setItem("collapse_supabase_key", key);
  location.reload();
});

$("changeConfigBtn").addEventListener("click", () => {
  localStorage.removeItem("collapse_supabase_url");
  localStorage.removeItem("collapse_supabase_key");
  location.reload();
});

$("loginBtn").addEventListener("click", async () => {
  $("loginMessage").textContent = "Accesso...";
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error){
    $("loginMessage").textContent = error.message;
    return;
  }
  show("appView");
  await refreshGuests();
});

$("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  show("loginView");
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(x => x.classList.add("hidden"));
    $(btn.dataset.tab + "Tab").classList.remove("hidden");
    if (btn.dataset.tab !== "scanner") stopScanner();
  });
});

function normalizeToken(raw){
  const value = (raw || "").trim();
  try {
    const url = new URL(value);
    return (url.searchParams.get("ticket") || value).toUpperCase();
  } catch {
    return value.toUpperCase();
  }
}

async function findTicket(token){
  const { data, error } = await supabaseClient
    .from("tickets")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function renderTicketResult(ticket){
  currentTicket = ticket;
  const box = $("scanResult");
  box.className = "result";
  $("confirmEntryBtn").classList.add("hidden");

  if (!ticket){
    box.classList.add("bad");
    $("resultStatus").textContent = "BIGLIETTO NON VALIDO";
    $("resultName").textContent = "Codice non riconosciuto";
    $("resultMeta").textContent = "Controlla il codice oppure cerca il nome nella lista.";
    return;
  }

  if (ticket.checked_in_at){
    box.classList.add("warn");
    $("resultStatus").textContent = "GIÀ UTILIZZATO";
    $("resultName").textContent = ticket.guest_name;
    $("resultMeta").textContent =
      `${ticket.ticket_type} · ingresso registrato ${new Date(ticket.checked_in_at).toLocaleString("it-IT")}`;
    return;
  }

  box.classList.add("ok");
  $("resultStatus").textContent = "BIGLIETTO VALIDO";
  $("resultName").textContent = ticket.guest_name;
  $("resultMeta").textContent = `${ticket.ticket_type} · ${ticket.token}`;
  $("confirmEntryBtn").classList.remove("hidden");
}

async function checkToken(raw){
  try{
    const token = normalizeToken(raw);
    if (!token) return;
    const ticket = await findTicket(token);
    renderTicketResult(ticket);
  }catch(err){
    alert(err.message);
  }
}

$("manualCheckBtn").addEventListener("click", () => checkToken($("manualCode").value));
$("manualCode").addEventListener("keydown", e => {
  if (e.key === "Enter") checkToken($("manualCode").value);
});

$("confirmEntryBtn").addEventListener("click", async () => {
  if (!currentTicket || currentTicket.checked_in_at) return;
  const { data, error } = await supabaseClient.rpc("check_in_ticket", {
    p_token: currentTicket.token
  });
  if (error){
    alert(error.message);
    return;
  }
  await checkToken(currentTicket.token);
  await refreshGuests();
});

$("startScannerBtn").addEventListener("click", async () => {
  $("startScannerBtn").classList.add("hidden");
  $("stopScannerBtn").classList.remove("hidden");
  html5QrCode = new Html5Qrcode("reader");
  try{
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async decodedText => {
        await stopScanner();
        await checkToken(decodedText);
      }
    );
  }catch(err){
    $("startScannerBtn").classList.remove("hidden");
    $("stopScannerBtn").classList.add("hidden");
    alert("Impossibile avviare la fotocamera: " + err);
  }
});

$("stopScannerBtn").addEventListener("click", stopScanner);

async function stopScanner(){
  if (html5QrCode){
    try { await html5QrCode.stop(); } catch {}
    try { await html5QrCode.clear(); } catch {}
    html5QrCode = null;
  }
  $("startScannerBtn").classList.remove("hidden");
  $("stopScannerBtn").classList.add("hidden");
}

async function refreshGuests(){
  const { data, error } = await supabaseClient
    .from("tickets")
    .select("*")
    .order("created_at", { ascending: false });

  if (error){
    alert(error.message);
    return;
  }
  allGuests = data || [];
  renderStats();
  renderGuestRows(allGuests);
}

function renderStats(){
  const total = allGuests.length;
  const checked = allGuests.filter(g => g.checked_in_at).length;
  $("totalCount").textContent = total;
  $("checkedCount").textContent = checked;
  $("remainingCount").textContent = total - checked;
}

function renderGuestRows(rows){
  $("guestRows").innerHTML = rows.map(g => `
    <tr>
      <td><strong>${escapeHtml(g.guest_name)}</strong><br><span class="muted">${escapeHtml(g.email || "")}</span></td>
      <td>${escapeHtml(g.ticket_type)}</td>
      <td>${g.checked_in_at
        ? `<span class="badge ok">ENTRATO</span>`
        : `<span class="badge wait">IN ATTESA</span>`}</td>
      <td><code>${escapeHtml(g.token)}</code></td>
      <td>
        <div class="row-actions">
          <button class="secondary" onclick="openGuest('${g.token}')">Apri</button>
          ${g.checked_in_at ? `<button class="ghost" onclick="resetGuest('${g.token}')">Reset</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

window.openGuest = async (token) => {
  document.querySelector('[data-tab="scanner"]').click();
  $("manualCode").value = token;
  await checkToken(token);
};

window.resetGuest = async (token) => {
  if (!confirm("Vuoi annullare il check-in di questo biglietto?")) return;
  const { error } = await supabaseClient.rpc("reset_ticket_check_in", { p_token: token });
  if (error) return alert(error.message);
  await refreshGuests();
};

$("guestSearch").addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = allGuests.filter(g =>
    [g.guest_name, g.email, g.token, g.ticket_type]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(q))
  );
  renderGuestRows(filtered);
});

$("refreshBtn").addEventListener("click", refreshGuests);

function generateToken(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({length:4}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
  return `CPV5-${part()}-${part()}`;
}

$("createGuestBtn").addEventListener("click", async () => {
  const guest_name = $("guestName").value.trim();
  const email = $("guestEmail").value.trim() || null;
  const ticket_type = $("guestType").value;
  if (!guest_name){
    $("createMessage").textContent = "Inserisci il nome.";
    return;
  }

  $("createMessage").textContent = "Creazione...";
  const token = generateToken();

  const { data, error } = await supabaseClient
    .from("tickets")
    .insert({ guest_name, email, ticket_type, token })
    .select()
    .single();

  if (error){
    $("createMessage").textContent = error.message;
    return;
  }

  lastCreatedTicket = data;
  $("createMessage").textContent = "Biglietto creato.";
  $("ticketGuestName").textContent = data.guest_name;
  $("ticketCode").textContent = data.token;
  $("ticketPreview").classList.remove("hidden");

  const ticketUrl = `${location.origin}${location.pathname}?ticket=${encodeURIComponent(data.token)}`;
  QRCode.toCanvas($("ticketQr"), ticketUrl, { width: 280, margin: 2 });

  $("guestName").value = "";
  $("guestEmail").value = "";
  await refreshGuests();
});

$("downloadQrBtn").addEventListener("click", () => {
  if (!lastCreatedTicket) return;
  const canvas = $("ticketQr");
  const link = document.createElement("a");
  link.download = `${lastCreatedTicket.token}-${lastCreatedTicket.guest_name.replace(/\s+/g,"-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

boot();
