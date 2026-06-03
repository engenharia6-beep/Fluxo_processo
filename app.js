// ============================================================
//  CONTROLE PRODUTIVO — app.js
//  Configure a URL do seu Apps Script abaixo:
// ============================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

// ─── Estado global ────────────────────────────────────────
let operadorLogado  = null;   // { id, nome, processo }
let statusSelecionado = 'I';  // 'I' ou 'F'
let qrDados         = null;   // { op, codigo, qtde, raw }
let streamCamera    = null;   // MediaStream ativo
let statusData      = [];     // cache do Fluxo_Status

// ─── QRCode scanner (jsQR via CDN) ────────────────────────
let jsQRLoaded = false;

// ============================================================
//  INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  carregarOperadores();

  // Scanner externo: foca o input de QR automaticamente quando
  // a tela de scan está ativa
  document.getElementById('qr-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      processarQR(document.getElementById('qr-input').value);
    }
  });
});

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function irPara(telaId) {
  document.querySelectorAll('.tela').forEach(t => {
    t.classList.remove('ativa');
    t.style.display = 'none';
  });
  const alvo = document.getElementById(telaId);
  alvo.style.display = 'flex';
  alvo.classList.add('ativa');

  // Ações ao entrar em cada tela
  if (telaId === 'tela-scan') {
    iniciarTelaScan();
  } else if (telaId === 'tela-status') {
    carregarStatus();
  } else if (telaId === 'tela-home') {
    fecharCamera();
  }
}

// ============================================================
//  LOGIN
// ============================================================
async function carregarOperadores() {
  try {
    const lista = await apiGet('getOperadores');
    const sel = document.getElementById('login-operador');
    sel.innerHTML = '<option value="">Selecione o operador</option>';
    lista.forEach(op => {
      const opt = document.createElement('option');
      opt.value = op.id;
      opt.textContent = op.nome;
      opt.dataset.nome = op.nome;
      opt.dataset.processo = op.processo;
      sel.appendChild(opt);
    });
  } catch (e) {
    document.getElementById('login-operador').innerHTML =
      '<option value="">Erro ao carregar — verifique a API</option>';
  }
}

async function fazerLogin() {
  const sel = document.getElementById('login-operador');
  const pin = document.getElementById('login-pin').value.trim();
  const erroEl = document.getElementById('login-erro');
  erroEl.textContent = '';

  if (!sel.value) { erroEl.textContent = 'Selecione um operador.'; return; }
  if (!pin)        { erroEl.textContent = 'Digite o PIN.'; return; }

  const opt = sel.options[sel.selectedIndex];
  mostrarLoading(true);

  try {
    const resp = await apiPost({ action: 'login', nome: opt.dataset.nome, pin });
    operadorLogado = resp.operador;

    // Atualiza header
    document.getElementById('header-operador').textContent  = operadorLogado.nome;
    document.getElementById('header-processo').textContent  = operadorLogado.processo;

    irPara('tela-home');
  } catch (e) {
    erroEl.textContent = e.message || 'Erro ao fazer login.';
  } finally {
    mostrarLoading(false);
  }
}

function fazerLogout() {
  operadorLogado = null;
  qrDados = null;
  fecharCamera();
  document.getElementById('login-pin').value = '';
  document.getElementById('login-erro').textContent = '';
  irPara('tela-login');
}

function togglePin() {
  const inp = document.getElementById('login-pin');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  TELA SCAN
// ============================================================
function iniciarTelaScan() {
  if (!operadorLogado) { irPara('tela-login'); return; }

  // Exibe processo fixo
  document.getElementById('scan-processo-badge').textContent = operadorLogado.processo;
  document.getElementById('processo-fixo').textContent = operadorLogado.processo;

  // Limpa campos
  document.getElementById('qr-input').value = '';
  document.getElementById('scan-obs').value = '';
  document.getElementById('scan-feedback').classList.add('hidden');
  esconderDadosQR();
  selecionarStatus('I');

  // Foca input para scanner externo
  setTimeout(() => document.getElementById('qr-input').focus(), 300);
}

function selecionarStatus(s) {
  statusSelecionado = s;
  document.getElementById('btn-iniciado').classList.toggle('ativo', s === 'I');
  document.getElementById('btn-finalizado').classList.toggle('ativo', s === 'F');
}

// ─── Parse do QR ──────────────────────────────────────────
// Formato esperado: 3762@7898641420904@12@OP=OP@Código@Qtde
function processarQR(raw) {
  raw = raw.trim();
  if (!raw) return;

  const partes = raw.split('@');
  if (partes.length < 3) {
    mostrarFeedback('QR Code inválido. Formato esperado: OP@Código@Qtde', 'erro');
    return;
  }

  qrDados = {
    raw,
    op:     partes[0],
    codigo: partes[1],
    qtde:   partes[2]
  };

  document.getElementById('dado-op').textContent      = qrDados.op;
  document.getElementById('dado-codigo').textContent  = qrDados.codigo;
  document.getElementById('dado-qtde').textContent    = qrDados.qtde;
  document.getElementById('dado-descricao').textContent = '...buscando...';

  document.getElementById('qr-dados').classList.remove('hidden');

  // Busca descrição (opcional — o backend faz o PROCX)
  document.getElementById('dado-descricao').textContent = '(será buscado ao salvar)';

  fecharCamera();
}

function esconderDadosQR() {
  qrDados = null;
  document.getElementById('qr-dados').classList.add('hidden');
  document.getElementById('qr-input').value = '';
}

// ─── Câmera ───────────────────────────────────────────────
async function abrirCamera() {
  // Carrega jsQR dinamicamente se necessário
  if (!jsQRLoaded) {
    await carregarScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    jsQRLoaded = true;
  }

  try {
    streamCamera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    const video = document.getElementById('camera-video');
    video.srcObject = streamCamera;
    document.getElementById('camera-container').classList.remove('hidden');
    escanearFrames();
  } catch (e) {
    mostrarModal('❌', 'Não foi possível acessar a câmera. Verifique as permissões.');
  }
}

function fecharCamera() {
  if (streamCamera) {
    streamCamera.getTracks().forEach(t => t.stop());
    streamCamera = null;
  }
  document.getElementById('camera-container').classList.add('hidden');
}

function escanearFrames() {
  const video   = document.getElementById('camera-video');
  const canvas  = document.createElement('canvas');
  const ctx     = canvas.getContext('2d');

  function tick() {
    if (!streamCamera) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code) {
        document.getElementById('qr-input').value = code.data;
        processarQR(code.data);
        return; // para o loop
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── Salvar ───────────────────────────────────────────────
async function salvarRegistro() {
  if (!qrDados) {
    mostrarFeedback('Bipe ou digite um QR Code primeiro.', 'erro');
    return;
  }
  if (!operadorLogado) { irPara('tela-login'); return; }

  const obs = document.getElementById('scan-obs').value.trim();
  const payload = {
    action:        'registrarFluxo',
    operadorId:    operadorLogado.id,
    operadorNome:  operadorLogado.nome,
    processo:      operadorLogado.processo,
    qrcode:        qrDados.raw,
    op:            qrDados.op,
    codigo:        qrDados.codigo,
    qtde:          qrDados.qtde,
    status:        statusSelecionado,
    obs
  };

  const btnTxt = document.getElementById('btn-salvar-txt');
  btnTxt.textContent = 'SALVANDO...';
  mostrarLoading(true);

  try {
    const resp = await apiPost(payload);
    mostrarModal('✅', `Registrado com sucesso!\nOP: ${qrDados.op}\nDescrição: ${resp.descricao || '-'}`);
    // Limpa para próxima leitura
    esconderDadosQR();
    document.getElementById('scan-obs').value = '';
    setTimeout(() => document.getElementById('qr-input').focus(), 400);
  } catch (e) {
    mostrarModal('❌', 'Erro ao salvar: ' + (e.message || 'Verifique a conexão.'));
  } finally {
    mostrarLoading(false);
    btnTxt.textContent = 'SALVAR REGISTRO';
  }
}

// ============================================================
//  FLUXO STATUS
// ============================================================
const PROCESSOS_LABELS = ['PCP','ESTOQUE','PRODUÇÃO','QUALIDADE','CONSOLIDAÇÃO','EXPEDIDO','PA','RESERVA'];

async function carregarStatus() {
  const lista = document.getElementById('status-lista');
  lista.innerHTML = '<div class="carregando">Carregando...</div>';
  try {
    statusData = await apiGet('getFluxoStatus');
    renderizarStatus(statusData);
  } catch (e) {
    lista.innerHTML = '<div class="carregando">Erro ao carregar dados.</div>';
  }
}

function filtrarStatus() {
  const termo = document.getElementById('busca-op').value.toLowerCase();
  const filtrado = statusData.filter(row =>
    row['OP']?.toString().toLowerCase().includes(termo) ||
    row['Código']?.toString().toLowerCase().includes(termo) ||
    row['Descrição']?.toString().toLowerCase().includes(termo)
  );
  renderizarStatus(filtrado);
}

function renderizarStatus(dados) {
  const lista = document.getElementById('status-lista');
  if (!dados || dados.length === 0) {
    lista.innerHTML = '<div class="carregando">Nenhum registro encontrado.</div>';
    return;
  }

  lista.innerHTML = dados.map(row => {
    const processosCells = PROCESSOS_LABELS.map(p => {
      const val = row[p] || '';
      const cls = val === 'I' ? 'iniciado' : val === 'F' ? 'finalizado' : '';
      const ico = val === 'I' ? '▶' : val === 'F' ? '✓' : '·';
      return `
        <div class="proc-cell ${cls}">
          <span class="proc-cell-nome">${p}</span>
          <span class="proc-cell-status">${ico}</span>
        </div>`;
    }).join('');

    return `
      <div class="op-card">
        <div class="op-card-header">
          <span class="op-numero">OP ${row['OP'] || ''}</span>
          <span class="op-codigo">${row['Código'] || ''}</span>
        </div>
        <div class="op-descricao">${row['Descrição'] || ''}</div>
        <div class="op-processos">${processosCells}</div>
      </div>`;
  }).join('');
}

// ============================================================
//  API HELPERS
// ============================================================
async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const resp = await fetch(`${API_URL}?${qs}`);
  const json = await resp.json();
  if (json.status !== 'ok') throw new Error(json.message || 'Erro na API');
  return json.data;
}

async function apiPost(body) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const json = await resp.json();
  if (json.status !== 'ok') throw new Error(json.message || 'Erro na API');
  return json.data;
}

// ============================================================
//  UI HELPERS
// ============================================================
function mostrarModal(icon, msg) {
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-msg').textContent  = msg;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function mostrarFeedback(msg, tipo) {
  const el = document.getElementById('scan-feedback');
  el.textContent = msg;
  el.className = `scan-feedback ${tipo}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function mostrarLoading(ativo) {
  document.getElementById('loading').classList.toggle('hidden', !ativo);
}

function carregarScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
