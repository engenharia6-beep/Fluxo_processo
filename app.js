// ============================================================
// CONFIGURAÇÃO
// ============================================================
const API = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

// Setores que operam no app
// seqVe = Seq que este setor vê | seqGrava = Seq que grava ao confirmar
const SETORES_APP = [
  { nome: 'PRODUÇÃO',     seqVe: 1, seqGrava: 2 },
  { nome: 'QUALIDADE',    seqVe: 2, seqGrava: 3 },
  { nome: 'CONSOLIDAÇÃO', seqVe: 3, seqGrava: 4 },
  { nome: 'EXPEDIDO',     seqVe: 4, seqGrava: 5 },
  { nome: 'P.A',          seqVe: 5, seqGrava: 6 },
];

function getConfigSetor(setor) {
  const nome = String(setor).trim().toUpperCase().replace(/^\d+-/, '');
  return SETORES_APP.find(s => s.nome.toUpperCase() === nome) || null;
}

// ============================================================
// ESTADO
// ============================================================
let estado = {
  operador:    null,   // { id, nome, setor }
  ops:         [],     // lista completa de OPs disponíveis
  opsFiltradas:[],     // lista após filtro
  opSelecionada: null, // OP selecionada no momento
  setorDestino: null,  // para rejeição
};

// ============================================================
// UTILS
// ============================================================
function $(id) { return document.getElementById(id); }

function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  $(id).classList.add('ativa');
}

function loading(show, txt = 'PROCESSANDO...') {
  $('loading').classList.toggle('ativo', show);
  $('loading-txt').textContent = txt;
}

function toast(msg, tipo = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${tipo} visivel`;
  setTimeout(() => el.classList.remove('visivel'), 3000);
}

async function api(params, body = null) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${API}${qs ? '?' + qs : ''}`;
  const opt = body
    ? { method: 'POST', body: JSON.stringify(body) }
    : { method: 'GET' };
  const r = await fetch(url, opt);
  return r.json();
}



// ============================================================
// LOGIN
// ============================================================
function atualizarBtnLogin() {
  const nome = $('campo-nome').value.trim();
  const pin  = $('campo-pin').value.trim();
  $('btn-login').disabled = !(nome.length >= 2 && pin.length >= 4);
}

async function fazerLogin() {
  const nome = $('campo-nome').value.trim();
  const pin  = $('campo-pin').value.trim();
  if (!nome || !pin) return;

  loading(true, 'AUTENTICANDO...');
  $('login-erro').style.display = 'none';

  try {
    const data = await api({}, { acao: 'login', nome, pin });
    if (data.status === 'ok') {
      estado.operador = data.operador;
      entrarNaPrincipal();
    } else {
      $('login-erro').textContent = data.mensagem || 'Usuário ou PIN inválido';
      $('login-erro').style.display = 'block';
      $('campo-pin').value = '';
    }
  } catch(e) {
    toast('Erro de conexão', 'erro');
  } finally {
    loading(false);
  }
}

// ============================================================
// TELA PRINCIPAL
// ============================================================
function entrarNaPrincipal() {
  $('hd-nome').textContent  = estado.operador.nome;
  $('hd-setor').textContent = estado.operador.setor;
  mostrarTela('tela-principal');
  carregarOPs();
}

async function carregarOPs() {
  loading(true, 'BUSCANDO OPs...');
  try {
    const data = await api({ acao: 'getOPsDisponiveis', setor: estado.operador.setor });
    if (data.status === 'ok') {
      estado.ops = data.ops || [];
      aplicarFiltro();
    } else {
      toast('Erro ao carregar OPs', 'erro');
    }
  } catch(e) {
    toast('Erro de conexão', 'erro');
  } finally {
    loading(false);
  }
}

function aplicarFiltro() {
  const filtro = $('filtro-pedido').value.trim().toLowerCase();
  estado.opsFiltradas = filtro
    ? estado.ops.filter(op => String(op.pedido).toLowerCase().includes(filtro) || String(op.op).toLowerCase().includes(filtro))
    : [...estado.ops];

  estado.opSelecionada = null;
  atualizarBotoes();
  renderizarLista();
}

function renderizarLista() {
  const lista = $('ops-lista');
  $('contador-ops').textContent = estado.opsFiltradas.length;

  if (!estado.opsFiltradas.length) {
    lista.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✓</div>
        <div class="empty-state-txt">NENHUMA OP DISPONÍVEL</div>
      </div>`;
    return;
  }

  lista.innerHTML = estado.opsFiltradas.map(op => `
    <div class="op-card" data-op="${op.op}" onclick="selecionarOP('${op.op}')">
      <div class="op-header">
        <div class="op-numero">${op.op}</div>
        <div class="op-pedido">PED ${op.pedido || '—'}</div>
      </div>
      <div class="op-body">
        ${op.foto ? `<img class="op-foto" src="${op.foto}" alt="${op.codigo}" onerror="this.style.display='none'">` : ''}
        <div class="op-info">
          <div class="op-codigo">${op.codigo}</div>
          <div class="op-desc">${op.descricao || '—'}</div>
        </div>
      </div>
      <div class="op-footer">
        <div class="op-qtde">${op.qtde} <span>UN</span></div>
        <div class="op-setor-atual">${op.statusAtual}</div>
      </div>
    </div>
  `).join('');
}

function selecionarOP(opNum) {
  estado.opSelecionada = estado.opsFiltradas.find(o => String(o.op) === String(opNum)) || null;

  document.querySelectorAll('.op-card').forEach(c => {
    c.classList.toggle('selecionado', c.dataset.op === String(opNum));
  });

  atualizarBotoes();
}

function atualizarBotoes() {
  const temSelecionada = !!estado.opSelecionada;
  $('btn-receber').disabled  = !temSelecionada;
  const cfg = getConfigSetor(estado.operador.setor);
  $('btn-rejeitar').disabled = !temSelecionada || !cfg || cfg.seqGrava <= 2;
}

// ============================================================
// MODAL RECEBER
// ============================================================
function abrirModalReceber() {
  const op = estado.opSelecionada;
  if (!op) return;
  $('mr-op').textContent      = op.op;
  $('mr-codigo').textContent  = op.codigo;
  $('mr-qtde').textContent    = op.qtde;
  $('mr-pedido').textContent  = op.pedido || '—';
  $('mr-cliente').textContent = op.cliente || '—';
  $('mr-obs').value           = '';
  $('modal-receber').classList.add('ativo');
}

function fecharModalReceber() {
  $('modal-receber').classList.remove('ativo');
}

async function confirmarReceber() {
  const op = estado.opSelecionada;
  if (!op) return;

  loading(true, 'GRAVANDO...');
  fecharModalReceber();

  try {
    const data = await api({}, {
      acao:      'receberOP',
      op:        op.op,
      codigo:    op.codigo,
      qtde:      op.qtde,
      pedido:    op.pedido,
      setor:     estado.operador.setor,
      operador:  estado.operador.nome,
      obs:       $('mr-obs').value.trim()
    });

    if (data.status === 'ok') {
      toast(data.mensagem, 'sucesso');
      estado.opSelecionada = null;
      await carregarOPs();
    } else {
      toast(data.erro || 'Erro ao gravar', 'erro');
    }
  } catch(e) {
    toast('Erro de conexão', 'erro');
  } finally {
    loading(false);
  }
}

// ============================================================
// MODAL REJEITAR
// ============================================================
function abrirModalRejeitar() {
  const op = estado.opSelecionada;
  if (!op) return;

  $('mj-op').textContent = op.op;
  $('mj-obs').value      = '';
  estado.setorDestino    = null;

  // Montar destinos possíveis (setores anteriores ao atual)
  const cfgAtual = getConfigSetor(estado.operador.setor);
  const destinos = cfgAtual ? SETORES_APP.filter(s => s.seqGrava < cfgAtual.seqGrava) : [];

  $('mj-destinos').innerHTML = destinos.map(s => `
    <button class="rejeitar-op-btn" onclick="selecionarDestino('${s.nome}', this)">
      ${s.nome}
    </button>
  `).join('');

  $('modal-rejeitar').classList.add('ativo');
}

function fecharModalRejeitar() {
  $('modal-rejeitar').classList.remove('ativo');
}

function selecionarDestino(setor, el) {
  estado.setorDestino = setor;
  document.querySelectorAll('.rejeitar-op-btn').forEach(b => b.classList.remove('selecionado'));
  el.classList.add('selecionado');
}

async function confirmarRejeitar() {
  const op = estado.opSelecionada;
  if (!op || !estado.setorDestino) {
    toast('Selecione o destino da rejeição', 'erro');
    return;
  }

  loading(true, 'GRAVANDO...');
  fecharModalRejeitar();

  try {
    const data = await api({}, {
      acao:         'rejeitarOP',
      op:           op.op,
      codigo:       op.codigo,
      qtde:         op.qtde,
      pedido:       op.pedido,
      setor:        estado.operador.setor,
      setorDestino: estado.setorDestino,
      operador:     estado.operador.nome,
      obs:          $('mj-obs').value.trim()
    });

    if (data.status === 'ok') {
      toast(data.mensagem, 'sucesso');
      estado.opSelecionada = null;
      await carregarOPs();
    } else {
      toast(data.erro || 'Erro ao gravar', 'erro');
    }
  } catch(e) {
    toast('Erro de conexão', 'erro');
  } finally {
    loading(false);
  }
}

// ============================================================
// EVENTOS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Login
  $('campo-nome').addEventListener('input', atualizarBtnLogin);
  $('campo-pin').addEventListener('input', atualizarBtnLogin);
  $('campo-nome').addEventListener('keydown', e => { if (e.key === 'Enter') $('campo-pin').focus(); });
  $('campo-pin').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
  $('btn-login').addEventListener('click', fazerLogin);

  // Principal
  $('btn-sair').addEventListener('click', () => {
    estado = { operador: null, ops: [], opsFiltradas: [], opSelecionada: null, setorDestino: null };
    $('campo-nome').value = '';
    $('campo-pin').value  = '';
    $('btn-login').disabled = true;
    mostrarTela('tela-login');
  });

  $('btn-atualizar').addEventListener('click', carregarOPs);
  $('filtro-pedido').addEventListener('input', aplicarFiltro);
  $('btn-limpar-filtro').addEventListener('click', () => {
    $('filtro-pedido').value = '';
    aplicarFiltro();
  });

  $('btn-receber').addEventListener('click', abrirModalReceber);
  $('btn-rejeitar').addEventListener('click', abrirModalRejeitar);

  // Modal receber
  $('mr-cancelar').addEventListener('click', fecharModalReceber);
  $('mr-confirmar').addEventListener('click', confirmarReceber);
  $('modal-receber').addEventListener('click', e => { if (e.target === $('modal-receber')) fecharModalReceber(); });

  // Modal rejeitar
  $('mj-cancelar').addEventListener('click', fecharModalRejeitar);
  $('mj-confirmar').addEventListener('click', confirmarRejeitar);
  $('modal-rejeitar').addEventListener('click', e => { if (e.target === $('modal-rejeitar')) fecharModalRejeitar(); });
});
