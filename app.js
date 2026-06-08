// ============================================================
// CONFIGURAÇÃO
// ============================================================
const API = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

const SETORES_APP = [
  { nome: 'PCP',          pcp: true               },
  { nome: 'PRODUÇÃO',     seqVe: 1, seqGrava: 2  },
  { nome: 'QUALIDADE',    seqVe: 2, seqGrava: 3  },
  { nome: 'CONSOLIDAÇÃO', seqVe: 3, seqGrava: 4, destinoLivre: true, destinos: ['EXPEDIDO', 'P.A'] },
  { nome: 'EXPEDIDO',     seqVe: 4, seqGrava: 5  },
  { nome: 'P.A',          seqVe: 5, seqGrava: 6  },
];

const PROCESSOS = ['Produção','Preforma','Foco','Embalagem','Desmontagem','Retrabalho','Silk','Limpeza'];

function getConfigSetor(setor) {
  const nome = String(setor).trim().toUpperCase().replace(/^\d+-/, '');
  return SETORES_APP.find(s => s.nome.toUpperCase() === nome) || null;
}
function isPCP() { return !!(getConfigSetor(estado.operador?.setor)?.pcp); }
function ehProducao() { return String(estado.operador?.setor || '').toUpperCase().includes('PRODU'); }

// ============================================================
// ESTADO
// ============================================================
let estado = {
  operador:      null,
  ops:           [],
  opsFiltradas:  [],
  opSelecionada: null,
  setorDestino:  null,
  // Produção Diária
  pd: {
    processo:    null,   // processo selecionado
    opSelecionada: null, // OP selecionada (pode ser null)
    ops:         [],     // lista de OPs para selecionar
    registros:   [],     // registros do dia
  }
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
      // PRODUÇÃO vê tela de seleção de módulo; outros vão direto
      if (ehProducao()) {
        mostrarTelaModulos();
      } else {
        entrarNaPrincipal();
      }
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
// TELA SELEÇÃO DE MÓDULO (só PRODUÇÃO)
// ============================================================
function mostrarTelaModulos() {
  $('mod-nome').textContent  = estado.operador.nome;
  $('mod-setor').textContent = estado.operador.setor;
  mostrarTela('tela-modulos');
}

// ============================================================
// FLUXO PRODUTIVO
// ============================================================
function entrarNaPrincipal() {
  $('hd-nome').textContent  = estado.operador.nome;
  $('hd-setor').textContent = estado.operador.setor;
  // Botão "Módulos" só para PRODUÇÃO (que tem acesso aos 2 módulos)
  $('btn-voltar-modulos').style.display = ehProducao() ? 'block' : 'none';
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
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-txt">NENHUMA OP DISPONÍVEL</div></div>`;
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
  $('btn-receber').disabled = !temSelecionada;
  const cfg = getConfigSetor(estado.operador.setor);
  const podeRejeitar = temSelecionada && (isPCP() || (cfg && cfg.seqGrava > 2));
  $('btn-rejeitar').disabled = !podeRejeitar;
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
  estado.destinoReceber       = null;
  const cfg = getConfigSetor(estado.operador.setor);
  const destDiv = $('mr-destinos');
  if (cfg && cfg.destinoLivre && cfg.destinos) {
    destDiv.style.display = 'block';
    destDiv.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Enviar para:</div>' +
      cfg.destinos.map(d => `<button class="rejeitar-op-btn" onclick="selecionarDestinoReceber('${d}', this)">${d}</button>`).join('');
  } else {
    destDiv.style.display = 'none';
    destDiv.innerHTML = '';
    estado.destinoReceber = cfg ? cfg.destinos?.[0] || '' : '';
  }
  $('modal-receber').classList.add('ativo');
}

function selecionarDestinoReceber(destino, el) {
  estado.destinoReceber = destino;
  document.querySelectorAll('#mr-destinos .rejeitar-op-btn').forEach(b => b.classList.remove('selecionado'));
  el.classList.add('selecionado');
}

function fecharModalReceber() { $('modal-receber').classList.remove('ativo'); }

async function confirmarReceber() {
  const op = estado.opSelecionada;
  if (!op) return;
  loading(true, 'GRAVANDO...');
  fecharModalReceber();
  try {
    const cfg = getConfigSetor(estado.operador.setor);
    if (cfg && cfg.destinoLivre && !estado.destinoReceber) {
      loading(false);
      toast('Selecione o destino antes de confirmar', 'erro');
      $('modal-receber').classList.add('ativo');
      return;
    }
    const data = await api({}, {
      acao: 'receberOP', op: op.op, codigo: op.codigo, qtde: op.qtde,
      pedido: op.pedido, setor: estado.operador.setor, operador: estado.operador.nome,
      destino: estado.destinoReceber || '', origem: op.statusAtual || '',
      obs: $('mr-obs').value.trim()
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
  const cfgAtual = getConfigSetor(estado.operador.setor);
  const destinos = isPCP()
    ? SETORES_APP.filter(s => !s.pcp)
    : (cfgAtual ? SETORES_APP.filter(s => !s.pcp && s.seqGrava < cfgAtual.seqGrava) : []);
  $('mj-destinos').innerHTML = destinos.map(s => `
    <button class="rejeitar-op-btn" onclick="selecionarDestino('${s.nome}', this)">${s.nome}</button>
  `).join('');
  $('modal-rejeitar').classList.add('ativo');
}

function fecharModalRejeitar() { $('modal-rejeitar').classList.remove('ativo'); }

function selecionarDestino(setor, el) {
  estado.setorDestino = setor;
  document.querySelectorAll('.rejeitar-op-btn').forEach(b => b.classList.remove('selecionado'));
  el.classList.add('selecionado');
}

async function confirmarRejeitar() {
  const op = estado.opSelecionada;
  if (!op || !estado.setorDestino) { toast('Selecione o destino da rejeição', 'erro'); return; }
  loading(true, 'GRAVANDO...');
  fecharModalRejeitar();
  try {
    const data = await api({}, {
      acao: 'rejeitarOP', op: op.op, codigo: op.codigo, qtde: op.qtde,
      pedido: op.pedido, setor: estado.operador.setor, setorDestino: estado.setorDestino,
      operador: estado.operador.nome, obs: $('mj-obs').value.trim()
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
// PRODUÇÃO DIÁRIA — PASSO 1: SELECIONAR PROCESSO
// ============================================================
function entrarProducaoDiaria() {
  estado.pd = { processo: null, opSelecionada: null, ops: [], registros: [] };
  $('pd-hd-nome').textContent  = estado.operador.nome;
  $('pd-hd-setor').textContent = estado.operador.setor;
  renderizarProcessos();
  mostrarTela('tela-pd');
  mostrarPasso('passo-processo');
}

function renderizarProcessos() {
  $('pd-processos').innerHTML = PROCESSOS.map(p => `
    <button class="pd-processo-btn" onclick="selecionarProcesso('${p}')">${p}</button>
  `).join('');
}

function selecionarProcesso(proc) {
  estado.pd.processo = proc;
  document.querySelectorAll('.pd-processo-btn').forEach(b => {
    b.classList.toggle('ativo', b.textContent === proc);
  });
  $('btn-pd-proximo').disabled = false;
}

function mostrarPasso(id) {
  document.querySelectorAll('.pd-passo').forEach(p => p.classList.remove('ativo'));
  $(id).classList.add('ativo');
}

async function pdProximo() {
  if (!estado.pd.processo) return;
  await carregarOPsProducao();
  $('pd-processo-label').textContent = estado.pd.processo;
  mostrarPasso('passo-op');
}

// ============================================================
// PRODUÇÃO DIÁRIA — PASSO 2: SELECIONAR OP
// ============================================================
async function carregarOPsProducao() {
  loading(true, 'BUSCANDO OPs...');
  try {
    const data = await api({ acao: 'getOPsProducao' });
    if (data.status === 'ok') {
      estado.pd.ops = data.ops || [];
      renderizarOPsProducao();
    }
  } catch(e) {
    toast('Erro de conexão', 'erro');
  } finally {
    loading(false);
  }
}

function renderizarOPsProducao() {
  const lista = $('pd-ops-lista');
  if (!estado.pd.ops.length) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-txt">NENHUMA OP ATIVA</div></div>`;
    return;
  }
  lista.innerHTML = estado.pd.ops.map(op => {
    const sp = op.statusProducao;
    const badge = sp === 'Iniciado'  ? '<span class="pd-badge azul">● EM ANDAMENTO</span>'
                : sp === 'Concluído' ? '<span class="pd-badge verde">● CONCLUÍDO</span>'
                : '<span class="pd-badge cinza">○ NÃO INICIADO</span>';
    return `
      <div class="pd-op-card" data-op="${op.op}" onclick="selecionarOPProducao('${op.op}')">
        <div class="op-header">
          <div class="op-numero">${op.op}</div>
          ${badge}
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
          <div class="op-setor-atual">PED ${op.pedido || '—'}</div>
        </div>
      </div>`;
  }).join('');
}

function selecionarOPProducao(opNum) {
  const op = estado.pd.ops.find(o => String(o.op) === String(opNum));
  estado.pd.opSelecionada = op || null;
  document.querySelectorAll('.pd-op-card').forEach(c => {
    c.classList.toggle('selecionado', c.dataset.op === String(opNum));
  });
  $('btn-pd-lancar').disabled = false;
}

function pdSemOP() {
  estado.pd.opSelecionada = null;
  document.querySelectorAll('.pd-op-card').forEach(c => c.classList.remove('selecionado'));
  abrirModalLancamento();
}

function pdLancarComOP() {
  if (!estado.pd.opSelecionada) { toast('Selecione uma OP ou use "Sem OP"', 'erro'); return; }
  abrirModalLancamento();
}

function pdVoltar() {
  mostrarPasso('passo-processo');
  estado.pd.processo = null;
  $('btn-pd-proximo').disabled = true;
  document.querySelectorAll('.pd-processo-btn').forEach(b => b.classList.remove('ativo'));
}

// ============================================================
// PRODUÇÃO DIÁRIA — MODAL DE LANÇAMENTO
// ============================================================
function abrirModalLancamento() {
  const op      = estado.pd.opSelecionada;
  const proc    = estado.pd.processo;
  $('ml-processo').textContent = proc;
  $('ml-op').textContent       = op ? op.op : '— (sem OP)';
  $('ml-qtde').value           = '';
  // Botões de status
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));
  // Iniciado só aparece se tem OP
  $('btn-ml-iniciado').style.display = op ? 'block' : 'none';
  $('modal-lancamento').classList.add('ativo');
}

function fecharModalLancamento() {
  $('modal-lancamento').classList.remove('ativo');
}

function selecionarStatusML(status, el) {
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));
  el.classList.add('ativo');
  // Qtde obrigatória só no Finalizado
  $('ml-qtde-grupo').style.display = (status === 'Finalizado') ? 'block' : 'none';
  $('ml-status-selecionado').value = status;
}

async function confirmarLancamento() {
  const status = $('ml-status-selecionado').value;
  const proc   = estado.pd.processo;
  const op     = estado.pd.opSelecionada;

  if (!status) { toast('Selecione o status', 'erro'); return; }
  if (status === 'Finalizado') {
    const qtde = Number($('ml-qtde').value);
    if (!qtde || qtde <= 0) { toast('Informe a quantidade', 'erro'); return; }
  }

  loading(true, 'GRAVANDO...');
  fecharModalLancamento();

  try {
    const qtde = status === 'Finalizado' ? Number($('ml-qtde').value) : 0;
    const data = await api({}, {
      acao:      'registrarProducao',
      op:        op ? op.op : '',
      processo:  proc,
      qtde:      qtde,
      status:    status,
      operador:  estado.operador.nome
    });

    if (data.status === 'ok') {
      toast(data.mensagem, 'sucesso');
      // Atualiza badge da OP na lista
      if (op && (status === 'Iniciado' || status === 'Concluído')) {
        const idx = estado.pd.ops.findIndex(o => o.op === op.op);
        if (idx >= 0) estado.pd.ops[idx].statusProducao = status;
        renderizarOPsProducao();
        // Mantém OP selecionada
        document.querySelectorAll('.pd-op-card').forEach(c => {
          c.classList.toggle('selecionado', c.dataset.op === op.op);
        });
      }
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

  // Sair — qualquer tela
  document.querySelectorAll('.btn-sair-global').forEach(btn => {
    btn.addEventListener('click', () => {
      estado = { operador: null, ops: [], opsFiltradas: [], opSelecionada: null, setorDestino: null,
                 pd: { processo: null, opSelecionada: null, ops: [], registros: [] } };
      $('campo-nome').value = '';
      $('campo-pin').value  = '';
      $('btn-login').disabled = true;
      mostrarTela('tela-login');
    });
  });

  // Seleção de módulo
  $('btn-modulo-fluxo').addEventListener('click', entrarNaPrincipal);
  $('btn-modulo-pd').addEventListener('click', entrarProducaoDiaria);

  // Principal — Fluxo
  $('btn-atualizar').addEventListener('click', carregarOPs);
  $('filtro-pedido').addEventListener('input', aplicarFiltro);
  $('btn-limpar-filtro').addEventListener('click', () => { $('filtro-pedido').value = ''; aplicarFiltro(); });
  $('btn-receber').addEventListener('click', abrirModalReceber);
  $('btn-rejeitar').addEventListener('click', abrirModalRejeitar);
  $('btn-voltar-modulos').addEventListener('click', mostrarTelaModulos);

  // Modal receber
  $('mr-cancelar').addEventListener('click', fecharModalReceber);
  $('mr-confirmar').addEventListener('click', confirmarReceber);
  $('modal-receber').addEventListener('click', e => { if (e.target === $('modal-receber')) fecharModalReceber(); });

  // Modal rejeitar
  $('mj-cancelar').addEventListener('click', fecharModalRejeitar);
  $('mj-confirmar').addEventListener('click', confirmarRejeitar);
  $('modal-rejeitar').addEventListener('click', e => { if (e.target === $('modal-rejeitar')) fecharModalRejeitar(); });

  // Produção Diária
  $('btn-pd-proximo').addEventListener('click', pdProximo);
  $('btn-pd-voltar').addEventListener('click', pdVoltar);
  $('btn-pd-sem-op').addEventListener('click', pdSemOP);
  $('btn-pd-lancar').addEventListener('click', pdLancarComOP);
  $('btn-pd-voltar-modulos').addEventListener('click', mostrarTelaModulos);

  // Modal lançamento
  $('ml-cancelar').addEventListener('click', fecharModalLancamento);
  $('ml-confirmar').addEventListener('click', confirmarLancamento);
  $('btn-ml-iniciado').addEventListener('click', function(){ selecionarStatusML('Iniciado', this); });
  $('btn-ml-finalizado').addEventListener('click', function(){ selecionarStatusML('Finalizado', this); });
  $('btn-ml-concluido').addEventListener('click', function(){ selecionarStatusML('Concluído', this); });
  $('modal-lancamento').addEventListener('click', e => { if (e.target === $('modal-lancamento')) fecharModalLancamento(); });
});
