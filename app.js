
let supabaseClient = null;
let html5QrCode = null;
let currentTicket = null;
let allGuests = [];
let lastCreatedTicket = null;
const ticketTemplate = new Image();
ticketTemplate.src = "./ticket-template.jpg";

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
          <button class="secondary" onclick="downloadGuestTicket('${g.token}')">Ticket</button>
          <button class="ghost danger" onclick="deleteGuest('${g.token}', '${escapeHtml(g.guest_name).replaceAll("'", "&#39;")}')">Elimina</button>
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


window.downloadGuestTicket = async (token) => {
  const ticket = allGuests.find(g => g.token === token);
  if (!ticket) return alert("Invitato non trovato.");
  try {
    document.querySelector('[data-tab="create"]').click();
    $("ticketPreview").classList.remove("hidden");
    lastCreatedTicket = ticket;
    await renderTicket(ticket);
    await downloadTicket(ticket);
  } catch (error) {
    alert(error.message);
  }
};

window.deleteGuest = async (token, guestName) => {
  const safeName = guestName || token;
  if (!confirm(`Eliminare definitivamente ${safeName}?`)) return;

  const { error } = await supabaseClient.rpc("delete_ticket", {
    p_token: token
  });

  if (error) {
    alert(error.message);
    return;
  }

  if (lastCreatedTicket?.token === token) {
    lastCreatedTicket = null;
    $("ticketPreview").classList.add("hidden");
  }

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


function loadImage(image){
  if (image.complete && image.naturalWidth) return Promise.resolve(image);
  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Impossibile caricare la grafica del ticket.")), { once: true });
  });
}

function fitText(ctx, text, maxWidth, startSize, minSize = 28){
  let size = startSize;
  while (size >= minSize){
    ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}

async function renderTicket(ticket){
  await loadImage(ticketTemplate);

  const canvas = $("ticketCanvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(ticketTemplate, 0, 0, canvas.width, canvas.height);

  const ticketUrl = `${location.origin}${location.pathname}?ticket=${encodeURIComponent(ticket.token)}`;
  const qrCanvas = document.createElement("canvas");

  new QRious({
    element: qrCanvas,
    value: ticketUrl,
    size: 430,
    level: "H",
    foreground: "#10140d",
    background: "#f3ead2",
    padding: 18
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const name = ticket.guest_name.toUpperCase();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#f3ead2";
  fitText(ctx, name, 880, 66, 38);
  ctx.fillText(name, 540, 1055);

  ctx.shadowBlur = 5;
  ctx.fillStyle = "#f49a68";
  ctx.font = "700 38px Arial, Helvetica, sans-serif";
  const typeLabel = ticket.ticket_type.toUpperCase().includes("GUEST")
    ? ticket.ticket_type.toUpperCase()
    : `${ticket.ticket_type.toUpperCase()} GUEST`;
  ctx.fillText(typeLabel, 540, 1122);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#f49a68";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 13]);
  ctx.beginPath();
  ctx.moveTo(145, 990);
  ctx.lineTo(935, 990);
  ctx.moveTo(145, 1175);
  ctx.lineTo(935, 1175);
  ctx.stroke();
  ctx.setLineDash([]);

  const qrX = 325;
  const qrY = 1210;
  const qrSize = 430;
  ctx.fillStyle = "#f3ead2";
  ctx.fillRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = "#f49a68";
  ctx.font = "700 30px Arial, Helvetica, sans-serif";
  ctx.fillText(ticket.token, 540, 1690);

  return canvas;
}

async function downloadTicket(ticket){
  const canvas = await renderTicket(ticket);
  const link = document.createElement("a");
  link.download = `${ticket.token}-${ticket.guest_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.png`;
  link.href = canvas.toDataURL("image/png", 1);
  link.click();
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
  $("ticketPreview").classList.remove("hidden");
  await renderTicket(data);

  $("guestName").value = "";
  $("guestEmail").value = "";
  await refreshGuests();
});

$("downloadTicketBtn").addEventListener("click", async () => {
  if (!lastCreatedTicket) return;
  try {
    await downloadTicket(lastCreatedTicket);
  } catch (error) {
    alert(error.message);
  }
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
