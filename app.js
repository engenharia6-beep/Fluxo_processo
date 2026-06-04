// ============================================================
//  CONTROLE DE FLUXO PRODUTIVO — app.js v2.0
// ============================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

// ─── Estado global ────────────────────────────────────────
let operadorLogado = null;  // { id, nome, setor, isPCP, podeRejeitarPara, recebeDE }
let opsDisponiveis = [];    // lista de OPs que o setor pode receber
let opSelecionada  = null;  // { op, codigo, descricao, qtde }
let streamCamera   = null;
let jsQRLoaded     = false;
let fluxoConfig    = [];    // config do fluxo vinda da API

// ============================================================
//  INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  carregarOperadores();
  document.getElementById('qr-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') processarQR(e.target.value);
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
      opt.value       = op.id;
      opt.textContent = op.nome;
      opt.dataset.nome  = op.nome;
      opt.dataset.setor = op.setor;
      sel.appendChild(opt);
    });
  } catch (e) {
    document.getElementById('login-operador').innerHTML =
      '<option value="">Erro ao carregar</option>';
  }
}

async function fazerLogin() {
  const sel  = document.getElementById('login-operador');
  const pin  = document.getElementById('login-pin').value.trim();
  const erro = document.getElementById('login-erro');
  erro.textContent = '';

  if (!sel.value) { erro.textContent = 'Selecione um operador.'; return; }
  if (!pin)        { erro.textContent = 'Digite o PIN.'; return; }

  const opt = sel.options[sel.selectedIndex];
  mostrarLoading(true);
  try {
    const resp = await apiPost({ action: 'login', nome: opt.dataset.nome, pin });
    operadorLogado = resp.operador;

    // Carrega config do fluxo
    fluxoConfig = await apiGet('getFluxoConfig');

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
  operadorLogado = null;
  opSelecionada  = null;
  opsDisponiveis = [];
  fecharCamera();
  document.getElementById('login-pin').value   = '';
  document.getElementById('login-erro').textContent = '';
  irPara('tela-login');
}

function togglePin() {
  const inp = document.getElementById('login-pin');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  TELA PRINCIPAL (main) — bifurca por perfil
// ============================================================
async function iniciarTelaMain() {
  if (!operadorLogado) { irPara('tela-login'); return; }

  opSelecionada = null;
  fecharCamera();

  if (operadorLogado.isPCP) {
    mostrarSecaoPCP();
  } else {
    await mostrarSecaoSetor();
  }
}

// ─── PCP ──────────────────────────────────────────────────
let pendencias    = [];   // cache da lista de pendências
let pcpSelecionada = null; // OP selecionada no PCP

function mostrarSecaoPCP() {
  document.getElementById('secao-pcp').classList.remove('hidden');
  document.getElementById('secao-setor').classList.add('hidden');
  carregarPendencias();
}

async function carregarPendencias() {
  const lista = document.getElementById('pcp-pendencias');
  lista.innerHTML = '<div class="ops-loading">Carregando pendências...</div>';
  pcpSelecionada = null;
  esconderPreviewPCP();

  try {
    pendencias = await apiGet('getPendencias');
    renderizarPendencias(pendencias);
  } catch (e) {
    lista.innerHTML = '<div class="ops-loading">Erro ao carregar pendências.</div>';
  }
}

function renderizarPendencias(ops) {
  const lista = document.getElementById('pcp-pendencias');
  if (!ops || ops.length === 0) {
    lista.innerHTML = `
      <div class="ops-vazia">
        <div class="ops-vazia-icon">✅</div>
        <div>Todas as OPs já foram lançadas!</div>
      </div>`;
    return;
  }
  lista.innerHTML = ops.map(op => `
    <div class="op-item" onclick="selecionarPendencia('${op.op}')" id="pcp-op-${op.op}">
      <div class="op-item-header">
        <span class="op-item-num">OP ${op.op}</span>
        <span class="op-item-qtde">Qtde: ${op.qtde || '—'}</span>
      </div>
      <div class="op-item-cod">${op.codigo || ''}</div>
      <div class="op-item-desc">${op.descricao || ''}</div>
      <div class="op-item-custodia">🏢 ${op.cliente || ''} · 📅 ${op.data || ''}</div>
    </div>`
  ).join('');
}

async function selecionarPendencia(opNum) {
  pcpSelecionada = pendencias.find(p => p.op.toString() === opNum.toString());
  if (!pcpSelecionada) return;

  // Destaca na lista
  document.querySelectorAll('.op-item').forEach(el => el.classList.remove('selecionada'));
  document.getElementById('pcp-op-' + opNum)?.classList.add('selecionada');

  // Preenche preview
  document.getElementById('pcp-preview-op').textContent     = 'OP ' + pcpSelecionada.op;
  document.getElementById('pcp-preview-cliente').textContent = pcpSelecionada.cliente;
  document.getElementById('pcp-preview-cod').textContent     = pcpSelecionada.codigo;
  document.getElementById('pcp-preview-desc').textContent    = pcpSelecionada.descricao;
  document.getElementById('pcp-preview-qtde').textContent    = 'Qtde: ' + pcpSelecionada.qtde;

  // Mostra preview
  document.getElementById('pcp-preview').classList.remove('hidden');

  // Carrega foto
  if (pcpSelecionada.codigo) {
    carregarFotoProduto(pcpSelecionada.codigo);
  }
}

async function carregarFotoProduto(codigo) {
  const img     = document.getElementById('pcp-foto');
  const loading = document.getElementById('pcp-foto-loading');

  img.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const prod = await apiGet('getCadastroProduto', { codigo });
    if (prod.foto) {
      img.src = prod.foto;
      img.onload  = () => { loading.classList.add('hidden'); img.classList.remove('hidden'); };
      img.onerror = () => { loading.classList.add('hidden'); };
      // Atualiza descrição se veio do cadastro e estava vazia
      if (prod.descricao && !pcpSelecionada.descricao) {
        document.getElementById('pcp-preview-desc').textContent = prod.descricao;
      }
    } else {
      loading.classList.add('hidden');
    }
  } catch (e) {
    loading.classList.add('hidden');
  }
}

function esconderPreviewPCP() {
  document.getElementById('pcp-preview').classList.add('hidden');
  document.getElementById('pcp-foto').classList.add('hidden');
  document.getElementById('pcp-foto').src = '';
  document.getElementById('pcp-obs').value = '';
  pcpSelecionada = null;
}

async function processarQRPCP(raw) {
  raw = (raw || '').trim();
  if (!raw) return;
  fecharCamera();

  // Extrai OP do QR (formato: OP@Codigo@Qtde)
  const partes = raw.split('@');
  const op     = partes[0];

  // Tenta encontrar na lista de pendências
  const encontrada = pendencias.find(p => p.op.toString() === op.toString());
  if (encontrada) {
    selecionarPendencia(op);
    mostrarToast('✅ OP ' + op + ' localizada!');
  } else {
    mostrarToast('⚠️ OP ' + op + ' não encontrada nas pendências.', true);
  }
}

async function lancarOP() {
  if (!pcpSelecionada) { mostrarModal('⚠️', 'Selecione uma OP primeiro.'); return; }

  const obs = document.getElementById('pcp-obs').value.trim();

  mostrarLoading(true);
  try {
    const resp = await apiPost({
      action:       'lancarOP',
      operadorNome: operadorLogado.nome,
      op:           pcpSelecionada.op,
      codigo:       pcpSelecionada.codigo,
      qtde:         pcpSelecionada.qtde,
      obs,
      qrcode:       document.getElementById('pcp-qr')?.value || ''
    });
    mostrarModal('✅',
      `OP ${resp.op} lançada!\n` +
      `${pcpSelecionada.descricao}\n` +
      `Custódia: ${resp.custodia}`
    );
    await carregarPendencias();
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

// ─── SETOR (receber / rejeitar) ───────────────────────────
async function mostrarSecaoSetor() {
  document.getElementById('secao-pcp').classList.add('hidden');
  document.getElementById('secao-setor').classList.remove('hidden');

  document.getElementById('setor-recebeDE').textContent =
    operadorLogado.recebeDE || '—';

  // Mostra botão rejeitar só se o setor pode rejeitar
  const podRejeitar = operadorLogado.podeRejeitarPara.length > 0;
  document.getElementById('btn-rejeitar').classList.toggle('hidden', !podRejeitar);

  await carregarOPsDisponiveis();
}

async function carregarOPsDisponiveis() {
  const lista = document.getElementById('ops-lista');
  lista.innerHTML = '<div class="ops-loading">Carregando OPs...</div>';
  opSelecionada = null;
  atualizarBotoesAcao();

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
    lista.innerHTML = `
      <div class="ops-vazia">
        <div class="ops-vazia-icon">📭</div>
        <div>Nenhuma OP disponível em ${operadorLogado.recebeDE || '—'}</div>
      </div>`;
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

  // Destaca visualmente
  document.querySelectorAll('.op-item').forEach(el => el.classList.remove('selecionada'));
  document.getElementById('op-item-' + opNum)?.classList.add('selecionada');

  atualizarBotoesAcao();

  // Se veio do QR, limpa o input
  const qrInput = document.getElementById('setor-qr');
  if (qrInput) qrInput.value = '';
}

function processarQR(raw) {
  raw = (raw || '').trim();
  if (!raw) return;
  fecharCamera();

  if (operadorLogado.isPCP) {
    document.getElementById('pcp-qr').value = raw;
    processarQRPCP(raw);
    return;
  }

  // Para outros setores: extrai OP do QR e seleciona na lista
  const partes = raw.split('@');
  const op     = partes[0];

  const encontrada = opsDisponiveis.find(o => o.op.toString() === op.toString());
  if (encontrada) {
    selecionarOP(op);
    mostrarToast('✅ OP ' + op + ' selecionada!');
  } else {
    mostrarToast('⚠️ OP ' + op + ' não está disponível para ' + operadorLogado.setor, true);
  }
}

function atualizarBotoesAcao() {
  const temOP = !!opSelecionada;
  document.getElementById('btn-receber').disabled   = !temOP;
  document.getElementById('btn-rejeitar').disabled  = !temOP;
}

async function receberOP() {
  if (!opSelecionada) return;
  mostrarLoading(true);
  try {
    const resp = await apiPost({
      action:       'receberOP',
      operadorNome: operadorLogado.nome,
      setor:        operadorLogado.setor,
      op:           opSelecionada.op,
      qrcode:       document.getElementById('setor-qr')?.value || ''
    });
    mostrarModal('✅',
      `OP ${resp.op} recebida!\n` +
      `${resp.descricao ? resp.descricao + '\n' : ''}` +
      `Custódia: ${resp.custodia}` +
      `${resp.proximoSetor ? '\nPróximo: ' + resp.proximoSetor : ''}`
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

  // Popula opções de destino
  const sel = document.getElementById('rejeitar-destino');
  sel.innerHTML = operadorLogado.podeRejeitarPara.map(d =>
    `<option value="${d}">${d}</option>`
  ).join('');
  document.getElementById('rejeitar-motivo').value = '';
  document.getElementById('modal-rejeitar').classList.remove('hidden');
}

async function confirmarRejeicao() {
  const destino = document.getElementById('rejeitar-destino').value;
  const motivo  = document.getElementById('rejeitar-motivo').value.trim();

  if (!motivo) { mostrarToast('⚠️ Informe o motivo da rejeição.', true); return; }

  fecharModalRejeitar();
  mostrarLoading(true);
  try {
    const resp = await apiPost({
      action:       'rejeitarOP',
      operadorNome: operadorLogado.nome,
      setor:        operadorLogado.setor,
      op:           opSelecionada.op,
      destino,
      motivo
    });
    mostrarModal('↩️',
      `OP ${resp.op} rejeitada!\n` +
      `Enviada para: ${resp.custodia}\n` +
      `Motivo: ${motivo}`
    );
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
  const video  = document.getElementById('camera-video');
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
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
//  TELA STATUS (visão geral)
// ============================================================
let statusData = [];

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

const COR_SETOR = {
  'PCP': '#7B1FA2', 'ESTOQUE': '#1565C0', 'PRODUÇÃO': '#E65100',
  'QUALIDADE': '#2E7D32', 'CONSOLIDAÇÃO': '#00838F',
  'EXPEDIDO': '#558B2F', 'PA': '#4527A0', 'RESERVA': '#6D4C41'
};

function renderizarStatus(dados) {
  const lista = document.getElementById('status-lista');
  if (!dados || dados.length === 0) {
    lista.innerHTML = '<div class="ops-vazia"><div class="ops-vazia-icon">📭</div><div>Nenhuma OP encontrada.</div></div>';
    return;
  }
  lista.innerHTML = dados.map(r => {
    const cor = COR_SETOR[r['Custódia']?.toString().toUpperCase()] || '#455A64';
    return `
      <div class="status-card" onclick="verHistorico('${r['OP']}')">
        <div class="status-card-top" style="border-left: 4px solid ${cor}">
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
        <div class="status-footer">
          👤 ${r['Último Operador'] || '—'} &nbsp;·&nbsp;
          🕐 ${formatarData(r['Última Atualização'])}
        </div>
      </div>`;
  }).join('');
}

async function verHistorico(op) {
  mostrarLoading(true);
  try {
    const hist = await apiGet('getHistoricoOP', { op });
    const html = hist.length === 0
      ? '<p>Sem histórico.</p>'
      : hist.map(h => `
          <div class="hist-item hist-${(h['Ação']||'').toLowerCase()}">
            <div class="hist-acao">${iconeAcao(h['Ação'])} ${h['Ação']}</div>
            <div class="hist-detalhe">${h['Custódia De'] || '—'} → ${h['Custódia Até'] || '—'}</div>
            <div class="hist-meta">👤 ${h['Operador']} · 🕐 ${formatarData(h['Data'])}</div>
            ${h['OBS'] ? `<div class="hist-obs">💬 ${h['OBS']}</div>` : ''}
          </div>`
        ).join('');

    document.getElementById('modal-hist-op').textContent  = 'OP ' + op;
    document.getElementById('modal-hist-body').innerHTML  = html;
    document.getElementById('modal-historico').classList.remove('hidden');
  } catch (e) {
    mostrarModal('❌', e.message);
  } finally {
    mostrarLoading(false);
  }
}

function fecharModalHistorico() {
  document.getElementById('modal-historico').classList.add('hidden');
}

function iconeAcao(acao) {
  if (!acao) return '·';
  acao = acao.toUpperCase();
  if (acao === 'LANÇAMENTO')  return '🚀';
  if (acao === 'RECEBIMENTO') return '✅';
  if (acao === 'REJEIÇÃO')    return '↩️';
  return '·';
}

// ============================================================
//  API HELPERS
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

// ============================================================
//  UI HELPERS
// ============================================================
let modalCallback = null;

function mostrarModal(icon, msg, callback) {
  modalCallback = callback || null;
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-msg').textContent  = msg;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  if (modalCallback) { modalCallback(); modalCallback = null; }
}

function mostrarToast(msg, erro = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className   = 'toast ' + (erro ? 'toast-erro' : 'toast-ok');
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function mostrarLoading(ativo) {
  document.getElementById('loading').classList.toggle('hidden', !ativo);
}

function formatarData(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return val; }
}

function carregarScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
