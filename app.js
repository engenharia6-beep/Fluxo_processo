// ============================================================
//  FLUXO PRODUTIVO — app.js v3.0
// ============================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

// ─── Estado ───────────────────────────────────────────────
let operadorLogado  = null;
let opsDisponiveis  = [];
let opSelecionada   = null;
let streamCamera    = null;
let jsQRLoaded      = false;
let statusData      = [];
let statusAdminData = [];

// ============================================================
//  INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  carregarOperadores();
  document.getElementById('setor-qr')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') processarQR(e.target.value);
  });
});

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function irPara(telaId) {
  document.querySelectorAll('.tela').forEach(t => {
    t.classList.remove('ativa'); t.style.display = 'none';
  });
  const alvo = document.getElementById(telaId);
  alvo.style.display = 'flex';
  alvo.classList.add('ativa');

  if (telaId === 'tela-main')   iniciarTelaMain();
  if (telaId === 'tela-status') carregarStatus();
  if (telaId === 'tela-login')  fecharCamera();
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
      opt.dataset.nome  = op.nome;
      opt.dataset.setor = op.setor;
      sel.appendChild(opt);
    });
  } catch (e) {
    document.getElementById('login-operador').innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

async function fazerLogin() {
  const sel  = document.getElementById('login-operador');
  const pin  = document.getElementById('login-pin').value.trim();
  const erro = document.getElementById('login-erro');
  erro.textContent = '';
  if (!sel.value) { erro.textContent = 'Selecione um operador.'; return; }
  if (!pin)        { erro.textContent = 'Digite o PIN.'; return; }

  mostrarLoading(true);
  try {
    const opt  = sel.options[sel.selectedIndex];
    const resp = await apiPost({ action: 'login', nome: opt.dataset.nome, pin });
    operadorLogado = resp.operador;
    document.getElementById('header-nome').textContent  = operadorLogado.nome;
    document.getElementById('header-setor').textContent = operadorLogado.setor;
    irPara('tela-main');
  } catch (e) {
    erro.textContent = e.message || 'Erro ao fazer login.';
  } finally {
    mostrarLoading(false);
  }
}

function fazerLogout() {
  operadorLogado = null; opSelecionada = null; opsDisponiveis = [];
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
//  TELA MAIN — bifurca PCP x Setor
// ============================================================
async function iniciarTelaMain() {
  if (!operadorLogado) { irPara('tela-login'); return; }
  opSelecionada = null;
  fecharCamera();

  if (operadorLogado.isPCP) {
    document.getElementById('secao-setor').classList.add('hidden');
    document.getElementById('secao-pcp').classList.remove('hidden');
    carregarStatusAdmin();
  } else {
    document.getElementById('secao-pcp').classList.add('hidden');
    document.getElementById('secao-setor').classList.remove('hidden');
    await mostrarSecaoSetor();
  }
}

// ============================================================
//  SETOR — receber / rejeitar
// ============================================================
async function mostrarSecaoSetor() {
  document.getElementById('setor-recebeDE').textContent = operadorLogado.recebeDE || '—';
  const podRejeitar = operadorLogado.podeRejeitarPara.length > 0;
  document.getElementById('btn-rejeitar').classList.toggle('hidden', !podRejeitar);
  await carregarOPsDisponiveis();
}

async function carregarOPsDisponiveis() {
  const lista = document.getElementById('ops-lista');
  lista.innerHTML = '<div class="ops-loading">Carregando OPs...</div>';
  opSelecionada = null;
  atualizarBotoesAcao();
  const busca = document.getElementById('busca-setor');
  if (busca) busca.value = '';
  try {
    opsDisponiveis = await apiGet('getOPsDisponiveis', { setor: operadorLogado.setor });
    renderizarOPs(opsDisponiveis);
  } catch (e) {
    lista.innerHTML = '<div class="ops-loading">Erro ao carregar OPs.</div>';
  }
}

function renderizarOPs(ops) {
  const lista = document.getElementById('ops-lista');
  if (!ops || ops.length === 0) {
    lista.innerHTML = `<div class="ops-vazia"><div class="ops-vazia-icon">📭</div><div>Nenhuma OP em ${operadorLogado.recebeDE || '—'}</div></div>`;
    return;
  }
  lista.innerHTML = ops.map(op => `
    <div class="op-item" onclick="selecionarOP('${op.op}')" id="op-item-${op.op}">
      <div class="op-item-header">
        <span class="op-item-num">OP ${op.op}</span>
        <span class="op-item-qtde">Qtde: ${op.qtde || '—'}</span>
      </div>
      <div class="op-item-cod">${op.codigo || ''}</div>
      <div class="op-item-desc">${op.descricao || ''}</div>
      <div class="op-item-custodia">📍 ${op.custodia}</div>
    </div>`
  ).join('');
}

function selecionarOP(opNum) {
  opSelecionada = opsDisponiveis.find(o => o.op.toString() === opNum.toString());
  document.querySelectorAll('.op-item').forEach(el => el.classList.remove('selecionada'));
  document.getElementById('op-item-' + opNum)?.classList.add('selecionada');
  atualizarBotoesAcao();
}

function filtrarOPs(termo) {
  if (!termo) { renderizarOPs(opsDisponiveis); return; }
  const t = termo.toLowerCase();
  const filtrado = opsDisponiveis.filter(op =>
    op.op?.toString().toLowerCase().includes(t) ||
    op.codigo?.toString().toLowerCase().includes(t) ||
    op.descricao?.toString().toLowerCase().includes(t)
  );
  renderizarOPs(filtrado);
  // Seleciona automaticamente se só restar 1
  if (filtrado.length === 1) selecionarOP(filtrado[0].op);
}

function tentarQR(raw) {
  raw = (raw || '').trim();
  if (!raw.includes('@')) return;
  // É um QR Code bipado — extrai a OP e seleciona
  const op = raw.split('@')[0];
  const encontrada = opsDisponiveis.find(o => o.op.toString() === op.toString());
  if (encontrada) {
    selecionarOP(op);
    document.getElementById('busca-setor').value = op;
    mostrarToast('✅ OP ' + op + ' selecionada!');
  } else {
    mostrarToast('⚠️ OP ' + op + ' não disponível para ' + operadorLogado.setor, true);
  }
}

function processarQR(raw) { tentarQR(raw); }

function atualizarBotoesAcao() {
  const tem = !!opSelecionada;
  document.getElementById('btn-receber').disabled  = !tem;
  document.getElementById('btn-rejeitar').disabled = !tem;
}

async function receberOP() {
  if (!opSelecionada) return;
  mostrarLoading(true);
  try {
    const resp = await apiPost({
      action: 'receberOP',
      operadorNome: operadorLogado.nome,
      setor: operadorLogado.setor,
      op: opSelecionada.op
    });
    mostrarModal('✅',
      `OP ${resp.op} recebida!\n${resp.descricao || ''}\nCustódia: ${resp.custodia}` +
      (resp.proximoSetor ? '\nPróximo: ' + resp.proximoSetor : '')
    );
    await carregarOPsDisponiveis();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

function abrirModalRejeitar() {
  if (!opSelecionada) return;
  const sel = document.getElementById('rejeitar-destino');
  sel.innerHTML = operadorLogado.podeRejeitarPara.map(d => `<option value="${d}">${d}</option>`).join('');
  document.getElementById('rejeitar-motivo').value = '';
  document.getElementById('modal-rejeitar').classList.remove('hidden');
}

async function confirmarRejeicao() {
  const destino = document.getElementById('rejeitar-destino').value;
  const motivo  = document.getElementById('rejeitar-motivo').value.trim();
  if (!motivo) { mostrarToast('⚠️ Informe o motivo.', true); return; }
  fecharModalRejeitar();
  mostrarLoading(true);
  try {
    const resp = await apiPost({
      action: 'rejeitarOP', operadorNome: operadorLogado.nome,
      setor: operadorLogado.setor, op: opSelecionada.op, destino, motivo
    });
    mostrarModal('↩️', `OP ${resp.op} rejeitada!\nEnviada para: ${resp.custodia}\nMotivo: ${motivo}`);
    await carregarOPsDisponiveis();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

function fecharModalRejeitar() {
  document.getElementById('modal-rejeitar').classList.add('hidden');
}

// ============================================================
//  PCP ADMIN
// ============================================================
function pcpTab(tab) {
  document.querySelectorAll('.pcp-tab').forEach(t => t.classList.remove('ativo'));
  document.querySelectorAll('.pcp-tab-content').forEach(t => t.classList.add('hidden'));
  event.target.classList.add('ativo');
  document.getElementById('pcp-tab-' + tab).classList.remove('hidden');
}

// ── Fluxo Geral (admin) ──
async function carregarStatusAdmin() {
  const lista = document.getElementById('pcp-status-lista');
  lista.innerHTML = '<div class="ops-loading">Carregando...</div>';
  try {
    statusAdminData = await apiGet('getFluxoStatus');
    renderizarStatusAdmin(statusAdminData);
  } catch (e) {
    lista.innerHTML = '<div class="ops-loading">Erro ao carregar.</div>';
  }
}

function filtrarStatusAdmin() {
  const t = document.getElementById('pcp-busca').value.toLowerCase();
  renderizarStatusAdmin(statusAdminData.filter(r =>
    r['OP']?.toString().toLowerCase().includes(t) ||
    r['Código']?.toString().toLowerCase().includes(t) ||
    r['Custódia']?.toString().toLowerCase().includes(t)
  ));
}

function renderizarStatusAdmin(dados) {
  const lista = document.getElementById('pcp-status-lista');
  if (!dados || dados.length === 0) {
    lista.innerHTML = '<div class="ops-vazia"><div class="ops-vazia-icon">📭</div><div>Nenhuma OP.</div></div>';
    return;
  }
  lista.innerHTML = dados.map(r => {
    const cor = COR_SETOR[r['Custódia']?.toString().toUpperCase()] || '#455A64';
    return `
      <div class="status-card" onclick="verHistoricoAdmin('${r['OP']}')">
        <div class="status-card-top" style="border-left:4px solid ${cor}">
          <div>
            <div class="status-op">OP ${r['OP']}</div>
            <div class="status-cod">${r['Código'] || ''}</div>
            <div class="status-desc">${r['Descrição'] || ''}</div>
          </div>
          <div class="status-right">
            <div class="status-badge" style="background:${cor}">${r['Custódia'] || '—'}</div>
            <div class="status-qtde">Qtde: ${r['Qtde'] || '—'}</div>
          </div>
        </div>
        <div class="status-footer">👤 ${r['Último Operador'] || '—'} · 🕐 ${formatarData(r['Última Atualização'])}</div>
      </div>`;
  }).join('');
}

async function verHistoricoAdmin(op) {
  mostrarLoading(true);
  try {
    const hist = await apiGet('getHistoricoOP', { op });
    // Busca foto do produto
    const statusOp = statusAdminData.find(r => r['OP']?.toString() === op.toString());
    if (statusOp?.['Código']) {
      try {
        const prod = await apiGet('getCadastroProduto', { codigo: statusOp['Código'] });
        if (prod.foto) {
          const fotoEl = document.getElementById('modal-hist-foto');
          fotoEl.src = prod.foto;
          document.getElementById('modal-hist-foto-wrap').classList.remove('hidden');
        }
      } catch (e) { /* sem foto */ }
    }
    document.getElementById('modal-hist-op').textContent      = 'OP ' + op;
    document.getElementById('modal-hist-produto').textContent = statusOp?.['Descrição'] || '';
    document.getElementById('modal-hist-body').innerHTML = renderizarHistorico(hist, true);
    document.getElementById('modal-historico').classList.remove('hidden');
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

function renderizarHistorico(hist, comBotaoApagar = false) {
  if (!hist || hist.length === 0) return '<p style="color:#aaa;text-align:center">Sem histórico.</p>';
  return hist.map(h => `
    <div class="hist-item hist-${(h['Ação']||'').toLowerCase().replace(' ','-')}">
      <div class="hist-header-row">
        <div class="hist-acao">${iconeAcao(h['Ação'])} ${h['Ação']}</div>
        ${comBotaoApagar ? `<button class="btn-apagar-reg" onclick="apagarRegistro('${h['ID']}','${h['OP']}')">🗑</button>` : ''}
      </div>
      <div class="hist-detalhe">${h['Custódia De'] || '—'} → ${h['Custódia Até'] || '—'}</div>
      <div class="hist-meta">👤 ${h['Operador']} · ${h['Setor']} · 🕐 ${formatarData(h['Data'])}</div>
      ${h['OBS'] ? `<div class="hist-obs">💬 ${h['OBS']}</div>` : ''}
    </div>`
  ).join('');
}

function fecharModalHistorico() {
  document.getElementById('modal-historico').classList.add('hidden');
  document.getElementById('modal-hist-foto-wrap').classList.add('hidden');
  document.getElementById('modal-hist-foto').src = '';
}

async function apagarRegistro(registroId, op) {
  if (!confirm('Apagar este registro?')) return;
  mostrarLoading(true);
  try {
    await apiPost({ action: 'apagarRegistro', operadorNome: operadorLogado.nome, registroId });
    mostrarToast('✅ Registro apagado!');
    fecharModalHistorico();
    carregarStatusAdmin();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

// ── Mover OP ──
async function moverOP() {
  const op       = document.getElementById('mover-op').value.trim();
  const custodia = document.getElementById('mover-custodia').value;
  const motivo   = document.getElementById('mover-motivo').value.trim();
  if (!op || !custodia || !motivo) { mostrarModal('⚠️', 'Preencha todos os campos.'); return; }
  mostrarLoading(true);
  try {
    const resp = await apiPost({ action: 'moverOP', operadorNome: operadorLogado.nome, op, novaCustodia: custodia, motivo });
    mostrarModal('✅', `OP ${resp.op} movida!\nNova custódia: ${resp.custodia}`);
    document.getElementById('mover-op').value     = '';
    document.getElementById('mover-motivo').value = '';
    carregarStatusAdmin();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

// ── Editar OP ──
async function editarOP() {
  const op   = document.getElementById('editar-op').value.trim();
  const qtde = document.getElementById('editar-qtde').value.trim();
  const desc = document.getElementById('editar-desc').value.trim();
  if (!op) { mostrarModal('⚠️', 'Informe a OP.'); return; }
  if (!qtde && !desc) { mostrarModal('⚠️', 'Altere ao menos um campo.'); return; }
  mostrarLoading(true);
  try {
    await apiPost({ action: 'editarOP', operadorNome: operadorLogado.nome, op, qtde, descricao: desc });
    mostrarModal('✅', 'OP ' + op + ' atualizada!');
    carregarStatusAdmin();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

// ============================================================
//  STATUS GERAL (tela-status)
// ============================================================
const COR_SETOR = {
  'ESTOQUE':'#1565C0','PRODUÇÃO':'#E65100','QUALIDADE':'#2E7D32',
  'CONSOLIDAÇÃO':'#00838F','EXPEDIDO':'#558B2F','PA':'#4527A0','RESERVA':'#6D4C41'
};

async function carregarStatus() {
  const lista = document.getElementById('status-lista');
  lista.innerHTML = '<div class="ops-loading">Carregando...</div>';
  try {
    statusData = await apiGet('getFluxoStatus');
    renderizarStatus(statusData);
  } catch (e) {
    lista.innerHTML = '<div class="ops-loading">Erro ao carregar.</div>';
  }
}

function filtrarStatus() {
  const t = document.getElementById('busca-op').value.toLowerCase();
  renderizarStatus(statusData.filter(r =>
    r['OP']?.toString().toLowerCase().includes(t) ||
    r['Código']?.toString().toLowerCase().includes(t) ||
    r['Descrição']?.toString().toLowerCase().includes(t) ||
    r['Custódia']?.toString().toLowerCase().includes(t)
  ));
}

function renderizarStatus(dados) {
  const lista = document.getElementById('status-lista');
  if (!dados || dados.length === 0) {
    lista.innerHTML = '<div class="ops-vazia"><div class="ops-vazia-icon">📭</div><div>Nenhuma OP.</div></div>';
    return;
  }
  lista.innerHTML = dados.map(r => {
    const cor = COR_SETOR[r['Custódia']?.toString().toUpperCase()] || '#455A64';
    return `
      <div class="status-card" onclick="verHistorico('${r['OP']}','${r['Código'] || ''}','${r['Descrição'] || ''}')">
        <div class="status-card-top" style="border-left:4px solid ${cor}">
          <div>
            <div class="status-op">OP ${r['OP']}</div>
            <div class="status-cod">${r['Código'] || ''}</div>
            <div class="status-desc">${r['Descrição'] || ''}</div>
          </div>
          <div class="status-right">
            <div class="status-badge" style="background:${cor}">${r['Custódia'] || '—'}</div>
            <div class="status-qtde">Qtde: ${r['Qtde'] || '—'}</div>
          </div>
        </div>
        <div class="status-footer">👤 ${r['Último Operador'] || '—'} · 🕐 ${formatarData(r['Última Atualização'])}</div>
      </div>`;
  }).join('');
}

async function verHistorico(op, codigo, descricao) {
  mostrarLoading(true);
  try {
    const hist = await apiGet('getHistoricoOP', { op });

    // Carrega foto
    if (codigo) {
      try {
        const prod = await apiGet('getCadastroProduto', { codigo });
        if (prod.foto) {
          const fotoEl = document.getElementById('modal-hist-foto');
          fotoEl.src = prod.foto;
          fotoEl.onload  = () => document.getElementById('modal-hist-foto-wrap').classList.remove('hidden');
          fotoEl.onerror = () => document.getElementById('modal-hist-foto-wrap').classList.add('hidden');
        }
      } catch (e) { /* sem foto */ }
    }

    document.getElementById('modal-hist-op').textContent      = 'OP ' + op;
    document.getElementById('modal-hist-produto').textContent = descricao || '';
    document.getElementById('modal-hist-body').innerHTML      = renderizarHistorico(hist, false);
    document.getElementById('modal-historico').classList.remove('hidden');
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

// ============================================================
//  CÂMERA
// ============================================================
async function abrirCamera() {
  if (!jsQRLoaded) {
    await carregarScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    jsQRLoaded = true;
  }
  try {
    streamCamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    document.getElementById('camera-video').srcObject = streamCamera;
    document.getElementById('camera-container').classList.remove('hidden');
    escanearFrames();
  } catch (e) {
    mostrarModal('❌', 'Não foi possível acessar a câmera.');
  }
}

function fecharCamera() {
  if (streamCamera) { streamCamera.getTracks().forEach(t => t.stop()); streamCamera = null; }
  document.getElementById('camera-container')?.classList.add('hidden');
}

function escanearFrames() {
  const video = document.getElementById('camera-video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  function tick() {
    if (!streamCamera) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code) { processarQR(code.data); return; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
//  API / UI HELPERS
// ============================================================
async function apiGet(action, params = {}) {
  const qs   = new URLSearchParams({ action, ...params }).toString();
  const resp = await fetch(`${API_URL}?${qs}`);
  const json = await resp.json();
  if (json.status !== 'ok') throw new Error(json.message || 'Erro na API');
  return json.data;
}

async function apiPost(body) {
  const resp = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  const json = await resp.json();
  if (json.status !== 'ok') throw new Error(json.message || 'Erro na API');
  return json.data;
}

function mostrarModal(icon, msg) {
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-msg').textContent  = msg;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function fecharModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

function mostrarToast(msg, erro = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className   = 'toast ' + (erro ? 'toast-erro' : 'toast-ok');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function mostrarLoading(ativo) {
  document.getElementById('loading').classList.toggle('hidden', !ativo);
}

function formatarData(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  } catch { return val; }
}

function iconeAcao(acao) {
  if (!acao) return '·';
  const a = acao.toUpperCase();
  if (a.includes('LANÇAMENTO'))  return '🚀';
  if (a.includes('RECEBIMENTO')) return '✅';
  if (a.includes('REJEIÇÃO'))    return '↩️';
  if (a.includes('AJUSTE'))      return '🔧';
  return '·';
}

function carregarScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
